import { selectMemoryContext, type MemoryConversation } from "../lib/memory/context";
import { memoryFingerprint } from "../lib/memory/fingerprint";
import type { Memory } from "../lib/memory/types";
import { selectMemoryContext as m4 } from "./memory-m4-baseline";
import { RETRIEVAL_CASES, type RetrievalCase } from "./memory-retrieval-fixture";

export const evaluationRows = (sample: RetrievalCase): Memory[] => [sample.memory, ...(sample.competitors ?? [])]
  .map((text, i) => ({ id: `m${i}`, characterId: "a", kind: "fact", text, subject: "character", status: "active", origin: "auto",
    sources: [], lineage: {}, fingerprint: memoryFingerprint(text), createdAt: 1, updatedAt: 1 }));
export const baselineText = (sample: RetrievalCase) => [
  ...(sample.earlier ?? []), ...(sample.recent ?? []).flat(), sample.current,
];
export const evaluationConversation = (sample: RetrievalCase): MemoryConversation => ({
  current: [{ role: "user", content: sample.current }],
  recent: (sample.recent ?? []).map(([user, assistant]) => [{ role: "user", content: user }, { role: "assistant", content: assistant }]),
  earlier: (sample.earlier ?? []).map((content) => ({ role: "user", content })),
});
export const evaluateRetrieval = () => RETRIEVAL_CASES.map((sample) => {
  const rows = evaluationRows(sample);
  const before = m4("a", rows, baselineText(sample)), after = selectMemoryContext("a", rows, evaluationConversation(sample));
  return { id: sample.id, language: sample.language, set: sample.set, relevant: sample.relevant,
    before: sample.relevant ? before.ids.includes("m0") : before.ids.length > 0,
    after: sample.relevant ? after.ids.includes("m0") : after.ids.length > 0,
    beforeIds: before.ids, afterIds: after.ids, beforeCharacters: before.characterLength, afterCharacters: after.characterLength };
});
