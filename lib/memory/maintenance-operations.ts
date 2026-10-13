import { parseStateOperations } from "./state-maintenance";
import { memoryFingerprint } from "./fingerprint";
import { MAINTENANCE_LIMITS, sensitiveMemoryText, type MaintenanceSnapshot } from "./maintenance-input";
import type { MemoryDraft, MemorySource } from "./types";

const invalid = (): never => { throw new Error("Invalid Memory maintenance operations."); };
const obj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown): v is string => typeof v === "string" && !!v.trim();
/** No eval, repair request, ID supplied by the model, or trust in prompt-only permissions. */
export function parseMaintenanceOperations(raw: string, snapshot: MaintenanceSnapshot, createId: () => string = () => crypto.randomUUID()) {
  if (raw.length > MAINTENANCE_LIMITS.outputCharacters) return invalid();
  let parsed: unknown; try { parsed = JSON.parse(raw); } catch { return invalid(); }
  if (!obj(parsed) || Object.keys(parsed).some((key) => key !== "operations") || !Array.isArray(parsed.operations)
    || parsed.operations.length > MAINTENANCE_LIMITS.operations) return invalid();
  const stateOperations = parseStateOperations(parsed.operations.filter((value) => obj(value) && String(value.op).startsWith("STATE_")),
    snapshot.state, snapshot.characterId, snapshot.messages);
  const candidates = new Map(snapshot.candidates.map((r) => [r.id, r]));
  const manual = new Set(snapshot.manual.map((r) => r.id)), changed = new Set<string>(), newFingerprints = new Set<string>();
  const put: MemoryDraft[] = []; let discarded = 0;
  const blocked = (text: string, sources: MemorySource[]) => sensitiveMemoryText(text)
    || snapshot.manual.some((r) => r.fingerprint === memoryFingerprint(text))
    || snapshot.suppressions.some((s) => s.fingerprint === memoryFingerprint(text)
      || s.sources.some((old) => sources.some((n) => n.sessionId === old.sessionId && n.messageId === old.messageId)));
  for (const value of parsed.operations) {
    if (obj(value) && String(value.op).startsWith("STATE_")) continue;
    if (!obj(value) || !str(value.op)) return invalid();
    const op = value.op;
    if (op === "IGNORE") { if (Object.keys(value).length !== 1) return invalid(); continue; }
    if (!["CREATE", "REINFORCE", "UPDATE", "SUPERSEDE", "MERGE", "ARCHIVE", "FLAG"].includes(op)) return invalid();
    const creates = ["CREATE", "UPDATE", "SUPERSEDE", "MERGE"].includes(op);
    const fields = ["op", "messageIds", ...(creates ? ["text", "kind", "subject"] : []),
      ...(op === "MERGE" ? ["targetIds"] : op === "CREATE" ? [] : ["targetId"])];
    if (Object.keys(value).some((key) => !fields.includes(key)) || fields.some((key) => !Object.hasOwn(value, key))) return invalid();
    if (!Array.isArray(value.messageIds) || !value.messageIds.length || value.messageIds.some((id) => !str(id)
      || !snapshot.messages.some((m) => m.id === id)) || new Set(value.messageIds).size !== value.messageIds.length) return invalid();
    const sources = (value.messageIds as string[]).map((messageId) => ({ sessionId: snapshot.sessionId, messageId }));
    const ids: unknown[] = op === "CREATE" ? [] : op === "MERGE" ? Array.isArray(value.targetIds) ? value.targetIds : invalid() : [value.targetId];
    if ((op === "MERGE" && ids.length < 2) || new Set(ids).size !== ids.length || ids.some((id) => !str(id))) return invalid();
    if (ids.some((id) => manual.has(id as string))) { discarded++; continue; }
    const targets = ids.map((id) => candidates.get(id as string) ?? invalid());
    if (targets.some((r) => r.characterId !== snapshot.characterId || r.origin !== "auto" || r.status !== "active")
      || targets.some((r) => changed.has(r.id))) return invalid();
    if (creates && (!str(value.text) || value.text.length > MAINTENANCE_LIMITS.entryCharacters
      || !["fact", "event", "ongoing", "relationship", "continuity"].includes(String(value.kind))
      || !["character", "user", "other"].includes(String(value.subject)))) return invalid();
    const combined = [...new Map([...targets.flatMap((r) => r.sources), ...sources].map((s) => [`${s.sessionId}\0${s.messageId}`, s])).values()];
    if (blocked(creates ? value.text as string : targets[0].text, combined)
      || targets.some((r) => blocked(r.text, r.sources))) { discarded++; continue; }
    if (!creates) {
      const target = targets[0];
      changed.add(target.id);
      const { id, characterId, text, kind, subject, origin, status, lineage } = target;
      put.push({ id, characterId, text, kind, subject, origin, lineage: { mergedFrom: lineage.mergedFrom, supersededBy: lineage.supersededBy },
        status: op === "ARCHIVE" ? "archived" : op === "FLAG" ? "flagged" : status, sources: combined });
      continue;
    }
    const text = (value.text as string).trim(), fingerprint = memoryFingerprint(text);
    // Exact duplicate CREATE is discarded locally, never converted to an unauthorized target.
    if (!fingerprint || newFingerprints.has(fingerprint) || snapshot.candidates.some((r) => r.fingerprint === fingerprint)) { discarded++; continue; }
    newFingerprints.add(fingerprint);
    const id = createId();
    if (!str(id) || put.some((r) => r.id === id) || candidates.has(id) || manual.has(id)) return invalid();
    for (const target of targets) {
      changed.add(target.id);
      put.push({ id: target.id, characterId: snapshot.characterId, text: target.text, kind: target.kind, subject: target.subject,
        status: "superseded", origin: "auto", sources: target.sources, lineage: { mergedFrom: target.lineage.mergedFrom, supersededBy: id } });
    }
    put.push({ id, characterId: snapshot.characterId, text, kind: value.kind as string, subject: value.subject as string,
      // UPDATE and MERGE depend on their originals: inherit their sources and register them in lineage so that
      // removing any contributing source unwinds the whole result. SUPERSEDE stands on the new evidence alone.
      status: "active", origin: "auto", sources: op === "SUPERSEDE" ? sources : combined,
      lineage: op === "SUPERSEDE" ? {} : { mergedFrom: targets.map((r) => r.id) } });
  }
  return { put, stateOperations, discarded, operationCount: parsed.operations.length };
}
