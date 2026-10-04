export const CHAT_SESSION_CSS_EXAMPLE = `/* Only this conversation */
:root {
  --c-bubble-self: #246bfd;
  --c-bubble-other: #ffffff;
  --c-text-title: #202124;
  --c-input: #f2f2f7;
}

.chat-bubble-role-user {
  background: var(--c-bubble-self);
  color: #ffffff;
  border-radius: 12px;
}

.chat-bubble-role-assistant {
  background: var(--c-bubble-other);
  color: var(--c-text-title);
  border-radius: 12px;
}

.chat-input-textarea {
  background: var(--c-input);
}`;

/** Remove imports because an imported stylesheet cannot be restricted to one conversation. */
export function removeCssImports(raw: string): string {
  if (!raw || !raw.includes("@import")) return raw;
  return raw.replace(
    /@import\s+(?:url\(\s*(['"]?)([^'")]+)\1\s*\)|(['"])([^'"]+)\3)[^;]*;/gi,
    "",
  );
}

/**
 * Prefix every style rule with the active conversation root. This is adapted
 * from momo.float.phone's session CSS scoper; root selectors become the scope
 * itself and container at-rules recurse without changing declarations.
 */
export function scopeSessionCSS(raw: string, scope: string): string {
  if (!raw.trim()) return "";
  const result: string[] = [];
  let index = 0;
  while (index < raw.length) {
    while (index < raw.length && /\s/.test(raw[index])) result.push(raw[index++]);
    if (index >= raw.length) break;
    if (raw[index] === "/" && raw[index + 1] === "*") {
      const end = raw.indexOf("*/", index + 2);
      if (end === -1) { result.push(raw.slice(index)); break; }
      result.push(raw.slice(index, end + 2));
      index = end + 2;
      continue;
    }
    if (raw[index] === "@") {
      const match = raw.slice(index).match(/^@([\w-]+)\s*/);
      const name = match?.[1].toLowerCase();
      if (name === "keyframes" || name === "font-face") {
        const start = raw.indexOf("{", index);
        if (start === -1) { result.push(raw.slice(index)); break; }
        const end = findMatchingBrace(raw, start);
        result.push(raw.slice(index, end + 1));
        index = end + 1;
        continue;
      }
      if (name === "media" || name === "supports" || name === "layer") {
        const start = raw.indexOf("{", index);
        if (start === -1) { result.push(raw.slice(index)); break; }
        const end = findMatchingBrace(raw, start);
        result.push(raw.slice(index, start + 1));
        result.push(scopeSessionCSS(raw.slice(start + 1, end), scope));
        result.push("}");
        index = end + 1;
        continue;
      }
    }
    const start = raw.indexOf("{", index);
    if (start === -1) { result.push(raw.slice(index)); break; }
    const selector = raw.slice(index, start).trim();
    const end = findMatchingBrace(raw, start);
    const body = raw.slice(start, end + 1);
    result.push(selector.split(",").map((part) => scopeSelector(part.trim(), scope)).join(", "));
    result.push(" ", body);
    index = end + 1;
  }
  return result.join("");
}

function scopeSelector(selector: string, scope: string): string {
  if (!selector) return selector;
  if (/^(body|html|:root)$/i.test(selector)) return scope;
  if (/^(body|html|:root)\s/i.test(selector))
    return `${scope} ${selector.replace(/^(body|html|:root)\s*/i, "")}`;
  if (/^(body|html|:root)\./i.test(selector))
    return scope + selector.replace(/^(body|html|:root)/i, "");
  if (selector === scope || selector.startsWith(`${scope} `) ||
      selector.startsWith(`${scope}:`) || selector.startsWith(`${scope}[`) ||
      selector.startsWith(`${scope}.`) || selector.startsWith(`${scope}>`)) return selector;
  return `${scope} ${selector}`;
}

function findMatchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    if (text[index] === "{") depth++;
    else if (text[index] === "}" && --depth === 0) return index;
  }
  return text.length - 1;
}
