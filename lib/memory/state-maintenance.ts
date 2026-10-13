import { appendCharacterState, reviewCharacterState, effectiveCharacterStates, type StateFoundation, type BackgroundSnapshot } from "./state-foundation";
import type { ChatMessage } from "../chat/types";
import { sensitiveMemoryText } from "./maintenance-input";

export type StateMaintenanceInput = { foundation: StateFoundation; background: BackgroundSnapshot; sourceHashes: NonNullable<import("./state-foundation").CharacterStateVersion["sourceHashes"]> };
export type StateOperation =
  | { op: "STATE_CREATE"; key: string; value: string; backgroundId: string; messageIds: string[]; assessment: StateAssessment; compatibility: "compatible" }
  | { op: "STATE_UPDATE"; targetId: string; value: string; backgroundId: string; messageIds: string[]; assessment: StateAssessment; compatibility: "compatible" }
  | { op: "STATE_REVIEW"; targetId: string; backgroundId: string; verdict: "compatible" | "conflict" | "pending" };
type StateAssessment = { subject: "character"; reality: "actual"; duration: "lasting"; significance: "major" };
const object = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, names: string[]) => Object.keys(v).length === names.length && names.every((key) => Object.hasOwn(v, key));
const bad = (): never => { throw new Error("Invalid Character State operation."); };

/** Strict response contract. Semantic assertions are model judgments, not a deterministic truth classifier. */
export function parseStateOperations(operations: readonly unknown[], input: StateMaintenanceInput | undefined,
  characterId: string, messages: readonly ChatMessage[]): StateOperation[] {
  if (!operations.length) return [];
  if (!input || input.background.characterId !== characterId || operations.length > 8) return bad();
  const heads = new Map(effectiveCharacterStates(input.foundation, characterId).map(({ row }) => [row.id, row]));
  const messageIds = new Set(messages.filter((m) => m.role === "assistant" || m.role === "user").map((m) => m.id));
  const touched = new Set<string>();
  for (const value of operations) {
    if (!object(value) || value.backgroundId !== input.background.id) return bad();
    const review = value.op === "STATE_REVIEW", create = value.op === "STATE_CREATE";
    const fields = review ? ["op", "targetId", "backgroundId", "verdict"]
      : ["op", create ? "key" : "targetId", "value", "backgroundId", "messageIds", "assessment", "compatibility"];
    if (!exact(value, fields) || !["STATE_CREATE", "STATE_UPDATE", "STATE_REVIEW"].includes(String(value.op))) return bad();
    const head = typeof value.targetId === "string" ? heads.get(value.targetId) : undefined;
    const key = create ? value.key : head?.key;
    if (typeof key !== "string" || !/^[a-z][a-z0-9_-]{0,63}$/.test(key) || touched.has(key)
      || (create && [...heads.values()].some((row) => row.key === key)) || (!create && !head)) return bad();
    touched.add(key);
    if (review) { if (!["compatible", "conflict", "pending"].includes(String(value.verdict))) return bad(); continue; }
    if (typeof value.value !== "string" || !value.value.trim() || value.value.length > 500 || sensitiveMemoryText(value.value)
      || value.compatibility !== "compatible" || !object(value.assessment)
      || !exact(value.assessment, ["subject", "reality", "duration", "significance"])
      || value.assessment.subject !== "character" || value.assessment.reality !== "actual"
      || value.assessment.duration !== "lasting" || value.assessment.significance !== "major"
      || !Array.isArray(value.messageIds) || !value.messageIds.length || new Set(value.messageIds).size !== value.messageIds.length
      || value.messageIds.some((id) => typeof id !== "string" || !messageIds.has(id))) return bad();
  }
  return structuredClone(operations) as StateOperation[];
}

/** Same planner is invoked at parse and at atomic commit; callers cannot submit unchecked State rows. */
export function applyStateOperations(input: StateMaintenanceInput, characterId: string, sessionId: string,
  messages: readonly ChatMessage[], operations: readonly StateOperation[], now: number, id = () => crypto.randomUUID()): StateFoundation {
  parseStateOperations(operations, input, characterId, messages);
  let data = structuredClone(input.foundation);
  for (const operation of operations) {
    const heads = effectiveCharacterStates(data, characterId).map(({ row }) => row);
    if (operation.op === "STATE_REVIEW") {
      if (operation.verdict !== "pending") data = reviewCharacterState(data, characterId, operation.backgroundId,
        [{ stateId: operation.targetId, verdict: operation.verdict }]);
      const row = data.states.find((r) => r.id === operation.targetId)!;
      if (operation.verdict === "pending") row.review = null;
      else row.sourceHashes = row.sources.map((source) => {
        const evidence = input.sourceHashes.find((s) => s.sessionId === source.sessionId && s.messageId === source.messageId);
        if (!evidence) return bad(); return structuredClone(evidence);
      });
      continue;
    }
    const previous = operation.op === "STATE_UPDATE" ? heads.find((r) => r.id === operation.targetId) : undefined;
    const sources = [...(previous?.sources ?? [])];
    for (const messageId of operation.messageIds) if (!sources.some((s) => s.sessionId === sessionId && s.messageId === messageId)) sources.push({ sessionId, messageId });
    data = appendCharacterState(data, { id: id(), characterId, key: previous?.key ?? (operation as Extract<StateOperation, { op: "STATE_CREATE" }>).key,
      value: operation.value.trim(), version: (previous?.version ?? 0) + 1, previousId: previous?.id ?? null,
      backgroundId: operation.backgroundId, sources, sourceHashes: sources.map((source) => {
        const evidence = input.sourceHashes.find((s) => s.sessionId === source.sessionId && s.messageId === source.messageId);
        if (!evidence) return bad(); return structuredClone(evidence);
      }), review: { backgroundId: operation.backgroundId, verdict: "compatible" }, createdAt: now }, previous?.id ?? null);
  }
  return data;
}

export const STATE_MAINTENANCE_RULES = [
  "Character State records only major, lasting changes in this Character's own life, respecting the Character's world and established setting. The Character's own account is evidence; do not require user confirmation.",
  "Never write State for user experiences, hypotheticals, jokes, temporary emotions, routine activities, Ongoing tasks, Presence, Last Seen or signatures. Those do not become major life changes through repetition alone.",
  "Optional operations in the same operations array: STATE_CREATE {op,key,value,backgroundId,messageIds,assessment,compatibility}; STATE_UPDATE {op,targetId,value,backgroundId,messageIds,assessment,compatibility}; STATE_REVIEW {op,targetId,backgroundId,verdict}.",
  "key is a stable lowercase life-field identifier, at most 64 characters; value at most 500. For writes assessment must explicitly be {subject:'character',reality:'actual',duration:'lasting',significance:'major'} and compatibility:'compatible'. Omit writes when any assertion cannot be supported. Cite only the supplied new message IDs; UPDATE retains all predecessor sources locally.",
  "Review each supplied State head against the exact current Background: compatible means the lasting change can coexist with its world and immutable setting, interpreting earlier life facts as historical. A newly user-edited Background is authoritative: contradicting current setting means conflict. Use pending if uncertain; never default to compatible. Do not invent completion evidence or fill gaps. Use only supplied Background and State IDs; no extra request is available.",
].join(" ");
