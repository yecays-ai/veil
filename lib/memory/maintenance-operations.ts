import { parseStateOperations } from "./state-maintenance";
import { memoryFingerprint } from "./fingerprint";
import { MAINTENANCE_LIMITS, sensitiveMemoryText, type MaintenanceSnapshot } from "./maintenance-input";
import { ONGOING_REVIEW, ongoingDue, reviewAtFrom } from "./ongoing";
import type { MemoryDraft, MemoryOngoing, MemorySource } from "./types";

/** `json`: the response was not parseable JSON. `format`: it parsed but broke the operation contract. */
export class MaintenanceParseError extends Error {
  constructor(readonly stage: "json" | "format") { super("Invalid Memory maintenance operations."); }
}
const invalid = (): never => { throw new MaintenanceParseError("format"); };
/**
 * Strict JSON first. Failing that, accept one complete JSON object when the model wrapped it in a code fence or added a sentence
 * around it: exactly one top-level object, braces balanced outside strings, and it must still parse and pass the full contract below.
 */
export function topLevelObjects(raw: string): { spans: [number, number][]; balanced: boolean } {
  const spans: [number, number][] = [];
  let depth = 0, start = -1, inString = false, escaped = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (depth === 0) { if (ch === "{") { depth = 1; start = i; } continue; }
    if (inString) { if (escaped) escaped = false; else if (ch === "\\") escaped = true; else if (ch === '"') inString = false; continue; }
    if (ch === '"') inString = true; else if (ch === "{") depth++; else if (ch === "}" && --depth === 0) spans.push([start, i + 1]);
  }
  return { spans, balanced: depth === 0 };
}
export function extractJsonObject(raw: string): string | undefined {
  const { spans, balanced } = topLevelObjects(raw);
  return balanced && spans.length === 1 ? raw.slice(spans[0][0], spans[0][1]) : undefined;
}
export type JsonDefects = { controlChars: number; trailingCommas: number; strayQuotes: number };
/**
 * One pass over JSON-like text with string state. Counts three syntax slips that models make, and with `repair` rewrites the two
 * that have a single unambiguous reading: a raw control character inside a string becomes its escape, a comma before } or ] is dropped.
 * A quote inside a string that is not followed by , : } or ] is only counted (strayQuotes): which quotes belong to the text is a guess.
 */
export function scanJson(text: string, repair = false): { text: string; defects: JsonDefects } {
  const defects: JsonDefects = { controlChars: 0, trailingCommas: 0, strayQuotes: 0 };
  const next = (from: number) => { let i = from; while (i < text.length && /\s/.test(text[i])) i++; return text[i]; };
  const ESCAPES: Record<string, string> = { "\n": "\\n", "\r": "\\r", "\t": "\\t" };
  let out = "", inString = false, escaped = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (!inString) {
      if (ch === '"') inString = true;
      else if (ch === "," && ["}", "]"].includes(next(i + 1) ?? "")) { defects.trailingCommas++; if (repair) continue; }
      out += ch; continue;
    }
    if (escaped) { escaped = false; out += ch; continue; }
    if (ch === "\\") { escaped = true; out += ch; continue; }
    if (ch === '"') {
      inString = false;
      const after = next(i + 1);
      if (after !== undefined && ![",", ":", "}", "]"].includes(after)) defects.strayQuotes++;
      out += ch; continue;
    }
    if (ch < " ") { defects.controlChars++; out += repair ? ESCAPES[ch] ?? `\\u${ch.charCodeAt(0).toString(16).padStart(4, "0")}` : ch; continue; }
    out += ch;
  }
  return { text: out, defects };
}
/** Strict first; then the one complete object inside words or a fence; then that object with the lossless repairs. Else throws. */
export function parseJsonLenient(raw: string): unknown {
  try { return JSON.parse(raw); } catch { /* try the tolerant readings below */ }
  const extracted = extractJsonObject(raw);
  if (extracted === undefined) throw new SyntaxError("No single JSON object.");
  try { return JSON.parse(extracted); } catch { return JSON.parse(scanJson(extracted, true).text); }
}
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && !!v.trim();
/** No eval, repair request, ID supplied by the model, or trust in prompt-only permissions. */
export function parseMaintenanceOperations(raw: string, snapshot: MaintenanceSnapshot, createId: () => string = () => crypto.randomUUID(), now: number = Date.now()) {
  if (raw.length > MAINTENANCE_LIMITS.outputCharacters) return invalid();
  let parsed: unknown;
  try { parsed = parseJsonLenient(raw); } catch { throw new MaintenanceParseError("json"); }
  if (!obj(parsed) || Object.keys(parsed).some((key) => key !== "operations") || !Array.isArray(parsed.operations)
    || parsed.operations.length > MAINTENANCE_LIMITS.operations) return invalid();
  const stateOperations = parseStateOperations(parsed.operations.filter((value) => obj(value) && String(value.op).startsWith("STATE_")),
    snapshot.state, snapshot.characterId, snapshot.messages);
  const candidates = new Map(snapshot.candidates.map((r) => [r.id, r]));
  const manual = new Set(snapshot.manual.map((r) => r.id)), changed = new Set<string>(), newFingerprints = new Set<string>();
  const put: MemoryDraft[] = []; let discarded = 0;
  // Counts only. `created` is CREATE; `updated` is every other operation that survives the local checks.
  const counts = { ignored: 0, created: 0, updated: 0, droppedManual: 0, droppedTooLong: 0, droppedProtected: 0, droppedDuplicate: 0 };
  const createdLifecycleItems = new Set<string>();
  const blocked = (text: string, sources: MemorySource[]) => sensitiveMemoryText(text)
    || snapshot.manual.some((r) => r.fingerprint === memoryFingerprint(text))
    || snapshot.suppressions.some((s) => s.fingerprint === memoryFingerprint(text)
      || s.sources.some((old) => sources.some((n) => n.sessionId === old.sessionId && n.messageId === old.messageId)));
  for (const value of parsed.operations) {
    if (obj(value) && String(value.op).startsWith("STATE_")) continue;
    if (!obj(value) || !str(value.op)) return invalid();
    const op = value.op;
    if (op === "IGNORE") { if (Object.keys(value).length !== 1) return invalid(); counts.ignored++; continue; }
    if (!["CREATE", "REINFORCE", "UPDATE", "SUPERSEDE", "MERGE", "ARCHIVE", "FLAG", "EXTEND"].includes(op)) return invalid();
    const creates = ["CREATE", "UPDATE", "SUPERSEDE", "MERGE"].includes(op);
    const fields = ["op", "messageIds", ...(creates ? ["text", "kind", "subject"] : []),
      ...(op === "MERGE" ? ["targetIds"] : op === "CREATE" ? [] : ["targetId"]), ...(op === "EXTEND" ? ["reviewInDays"] : [])];
    // reviewInDays (ongoing creates) and ended (ARCHIVE of ongoing) are optional at the shape level; their meaning is checked below.
    const optional = creates ? ["reviewInDays"] : op === "ARCHIVE" ? ["ended"] : [];
    if (Object.keys(value).some((key) => !fields.includes(key) && !optional.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) return invalid();
    const days = value.reviewInDays;
    if (Object.hasOwn(value, "reviewInDays") && (!Number.isSafeInteger(days) || (days as number) < 1 || (days as number) > ONGOING_REVIEW.maxDays)) return invalid();
    if (!Array.isArray(value.messageIds) || !value.messageIds.length || value.messageIds.some((id) => !str(id)
      || !snapshot.messages.some((m) => m.id === id)) || new Set(value.messageIds).size !== value.messageIds.length) return invalid();
    const cited = snapshot.messages.filter((message) => (value.messageIds as string[]).includes(message.id));
    for (const message of cited) {
      const parentId = message.transferEvent?.transferId ?? message.giftEvent?.giftId;
      const parent = parentId ? snapshot.messages.find((candidate) => candidate.id === parentId
        && (candidate.transfer || candidate.gift)) : undefined;
      if (parent && !(value.messageIds as string[]).includes(parent.id)) return invalid();
    }
    const lifecycleIds = new Set(cited.flatMap((message) => message.transfer ? [`transfer:${message.id}`]
      : message.transferEvent ? [`transfer:${message.transferEvent.transferId}`]
        : message.gift ? [`gift:${message.id}`] : message.giftEvent ? [`gift:${message.giftEvent.giftId}`] : []));
    if (op === "CREATE") {
      if ([...lifecycleIds].some((id) => createdLifecycleItems.has(id))) return invalid();
      for (const id of lifecycleIds) createdLifecycleItems.add(id);
    }
    const sources = (value.messageIds as string[]).map((messageId) => ({ sessionId: snapshot.sessionId, messageId }));
    const ids: unknown[] = op === "CREATE" ? [] : op === "MERGE" ? Array.isArray(value.targetIds) ? value.targetIds : invalid() : [value.targetId];
    if ((op === "MERGE" && ids.length < 2) || new Set(ids).size !== ids.length || ids.some((id) => !str(id))) return invalid();
    if (ids.some((id) => manual.has(id as string))) { discarded++; counts.droppedManual++; continue; }
    const targets = ids.map((id) => candidates.get(id as string) ?? invalid());
    if (targets.some((r) => r.characterId !== snapshot.characterId || r.origin !== "auto" || r.status !== "active")
      || targets.some((r) => changed.has(r.id))) return invalid();
    if (creates && (!str(value.text)
      || !["fact", "event", "ongoing", "relationship", "continuity"].includes(String(value.kind))
      || !["character", "user", "other"].includes(String(value.subject)))) return invalid();
    // An over-long entry is dropped on its own: rejecting the batch would only repeat the paid request.
    if (creates && (value.text as string).trim().length > MAINTENANCE_LIMITS.entryCharacters) { discarded++; counts.droppedTooLong++; continue; }
    if (creates && Object.hasOwn(value, "reviewInDays") && value.kind !== "ongoing") return invalid();
    if (op === "EXTEND" && targets.some((r) => r.kind !== "ongoing")) return invalid();
    if (op === "ARCHIVE") {
      const ongoing = targets[0].kind === "ongoing", ended = value.ended;
      if (ongoing ? !["explicit", "presumed"].includes(String(ended)) || (ended === "presumed" && !ongoingDue(targets[0], now))
        : Object.hasOwn(value, "ended")) return invalid();
    }
    const combined = [...new Map([...targets.flatMap((r) => r.sources), ...sources].map((s) => [`${s.sessionId}\0${s.messageId}`, s])).values()];
    if (blocked(creates ? value.text as string : targets[0].text, combined)
      || targets.some((r) => blocked(r.text, r.sources))) { discarded++; counts.droppedProtected++; continue; }
    if (!creates) {
      const target = targets[0];
      counts.updated++;
      changed.add(target.id);
      const { id, characterId, text, kind, subject, origin, status, lineage } = target;
      let ongoing: MemoryOngoing | undefined = target.ongoing;
      if (op === "EXTEND") ongoing = { ...ongoing, reviewAt: reviewAtFrom(now, value.reviewInDays as number) };
      else if (op === "ARCHIVE" && kind === "ongoing") ongoing = { ...ongoing, ended: value.ended as "explicit" | "presumed" };
      put.push({ id, characterId, text, kind, subject, origin, lineage: { mergedFrom: lineage.mergedFrom, supersededBy: lineage.supersededBy },
        status: op === "ARCHIVE" ? "archived" : op === "FLAG" ? "flagged" : status, sources: combined, ...(ongoing ? { ongoing } : {}) });
      continue;
    }
    const text = (value.text as string).trim(), fingerprint = memoryFingerprint(text);
    // Exact duplicate CREATE is discarded locally, never converted to an unauthorized target.
    if (!fingerprint || newFingerprints.has(fingerprint) || snapshot.candidates.some((r) => r.fingerprint === fingerprint)) { discarded++; counts.droppedDuplicate++; continue; }
    newFingerprints.add(fingerprint);
    if (op === "CREATE") counts.created++; else counts.updated++;
    const id = createId();
    if (!str(id) || put.some((r) => r.id === id) || candidates.has(id) || manual.has(id)) return invalid();
    for (const target of targets) {
      changed.add(target.id);
      put.push({ id: target.id, characterId: snapshot.characterId, text: target.text, kind: target.kind, subject: target.subject,
        status: "superseded", origin: "auto", sources: target.sources, lineage: { mergedFrom: target.lineage.mergedFrom, supersededBy: id },
        ...(target.ongoing ? { ongoing: target.ongoing } : {}) });
    }
    put.push({ id, characterId: snapshot.characterId, text, kind: value.kind as string, subject: value.subject as string,
      // UPDATE and MERGE depend on their originals: inherit their sources and register them in lineage so that
      // removing any contributing source unwinds the whole result. SUPERSEDE stands on the new evidence alone.
      status: "active", origin: "auto", sources: op === "SUPERSEDE" ? sources : combined,
      lineage: op === "SUPERSEDE" ? {} : { mergedFrom: targets.map((r) => r.id) },
      // A new or rewritten ongoing matter only has a review time when the model gave one; no old time is carried over.
      ...(value.kind === "ongoing" && Object.hasOwn(value, "reviewInDays") ? { ongoing: { reviewAt: reviewAtFrom(now, value.reviewInDays as number) } } : {}) });
  }
  return { put, stateOperations, discarded, operationCount: parsed.operations.length, counts: { ...counts, state: stateOperations.length } };
}
