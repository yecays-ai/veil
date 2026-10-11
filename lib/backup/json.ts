/** Strict JSON input: duplicate members, unsafe object keys and non-finite numbers are rejected.
 * JSON.parse alone silently keeps the last duplicate member, which is unsuitable for backups. */
export function parseBackupJson(text: string): unknown {
  let offset = 0;
  const fail = (): never => { throw new Error("Invalid backup JSON."); };
  const whitespace = () => { while (/[\t\n\r ]/.test(text[offset] ?? "x")) offset++; };
  function string(): string {
    const start = offset++;
    while (offset < text.length) {
      const char = text[offset++];
      if (char === "\\") offset++;
      else if (char === '"') {
        try { return JSON.parse(text.slice(start, offset)) as string; } catch { fail(); }
      }
    }
    return fail();
  }
  function value(depth: number): void {
    if (depth > 64) fail();
    whitespace();
    const char = text[offset];
    if (char === '"') { string(); return; }
    if (char === "{" || char === "[") {
      const object = char === "{", end = object ? "}" : "]", keys = new Set<string>();
      offset++; whitespace();
      if (text[offset] === end) { offset++; return; }
      for (;;) {
        if (object) {
          whitespace();
          if (text[offset] !== '"') fail();
          const key = string();
          if (keys.has(key) || ["__proto__", "constructor", "prototype"].includes(key)) fail();
          keys.add(key); whitespace();
          if (text[offset++] !== ":") fail();
        }
        value(depth + 1); whitespace();
        const separator = text[offset++];
        if (separator === end) return;
        if (separator !== ",") fail();
      }
    }
    const token = /^(?:true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)/.exec(text.slice(offset));
    if (!token) fail();
    offset += token![0].length;
    if (!/^(true|false|null)$/.test(token![0]) && !Number.isFinite(Number(token![0]))) fail();
  }
  value(0); whitespace();
  if (offset !== text.length) fail();
  try { return JSON.parse(text) as unknown; } catch { return fail(); }
}
