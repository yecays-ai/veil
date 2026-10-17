import { historyTimestamp } from "../chat/time-context";
import { modelFacingContent } from "../chat/attachment";
import { SUMMARY_CHARACTERS, type SummaryPlan } from "../chat/summary";
import type { PromptTurn } from "../chat/types";
import { sensitiveMemoryText } from "./maintenance-input";

export const SUMMARY_SYSTEM_PROMPT = [
  "You keep my running summary of a conversation between me, the Character described in the context, and the user.",
  "Write it in the first person, as my own recollection (\"I\"); call the user by the name in the context. Never write \"the user\" or \"the character\", and do not sound like a report.",
  "Merge previousSummary with the new messages into one updated summary: keep what still matters (what happened, when, why, how it ended, what is still open, how we felt toward each other when the messages say so) and let small talk and finished trivia fall away.",
  "Use only what previousSummary and the messages say. Do not invent anything, do not copy contact names, nicknames or profile facts that other parts of the app keep, and never write secrets, keys or passwords. Write dates instead of words like today or yesterday.",
  `Answer with the summary text only, plain prose, at most ${SUMMARY_CHARACTERS} characters. No JSON, no headings, no preface.`,
].join(" ");

/** A message that looks like it holds a secret is not sent to the Memory model; the summary just skips it. */
const OMITTED = "(message omitted: it may contain a secret)";

export function buildSummaryInput(plan: Extract<SummaryPlan, { kind: "due" }>, character: { context: string; timezone?: string }): PromptTurn[] {
  const data = { character: character.context, previousSummary: plan.previous ?? null,
    messages: plan.chunk.map((m) => ({ role: m.role, time: historyTimestamp(m.createdAt, character.timezone || "UTC"),
      content: sensitiveMemoryText(m.content) ? OMITTED : modelFacingContent(m, m.content) })) };
  return [{ role: "system", content: SUMMARY_SYSTEM_PROMPT }, { role: "user", content: JSON.stringify(data) }];
}

/** Accepts only a plain, complete, bounded answer. A longer answer is rejected, never cut into a different meaning. */
export function parseSummaryOutput(text: string): string | null {
  const summary = text.trim();
  if (!summary || summary.length > SUMMARY_CHARACTERS || sensitiveMemoryText(summary) || /^[{[]/.test(summary)) return null;
  return summary;
}
