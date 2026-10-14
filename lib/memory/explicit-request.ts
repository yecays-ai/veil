/**
 * Local, conservative recognizer for "please remember this" style requests. It only marks a message as worth a
 * closer look in the next maintenance request; it never triggers a request and never writes a memory by itself.
 * Anything unsure — questions, recollections ("你还记得吗？", "我记得…"), narration — is not a request.
 */
const QUESTION_START = /^(?:do|did|does|can|could|will|would|have|has|are|is|why|what|when|how|who)\b/i;
const CJK_QUESTION_END = /[吗嘛呢么]$|是不是|有没有|对不对/;
const CJK_REQUEST = /^(?:请|麻烦|拜托)?你?(?:一定|务必|要|得)?(?:帮我|给我|替我)?(?:记住|记一下|记下来?|记着|牢记|别忘了|别忘记|不要忘了?|不要忘记)/;
const EN_REQUEST = /^(?:(?:please|pls|plz)[ ,]+)?(?:always )?(?:remember(?! (?:when|how|to|the time|that time)\b)|don'?t forget|do not forget|keep in mind|make a note)\b/i;

export function explicitMemoryRequest(text: string): boolean {
  for (const raw of text.split(/[。！!.\n；;，,]+/)) {
    const clause = raw.trim();
    if (!clause || /[?？]/.test(clause) || CJK_QUESTION_END.test(clause) || QUESTION_START.test(clause)) continue;
    if (CJK_REQUEST.test(clause) || EN_REQUEST.test(clause)) return true;
  }
  return false;
}
