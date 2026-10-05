import type { RegexGroup, RegexMode, RegexRole, RegexRule } from "./regex";

export type RegexStep = { ruleId: string; ruleName: string; before: string; after: string;
  status: "matched" | "unchanged" | "invalid"; error?: string };
const cache = new Map<string, RegExp>();
const CACHE_LIMIT = 64;
export type RegexVariables = { character?: string; user?: string };
const escapeRegex = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function resolveVariables(find: string, variables: RegexVariables): string {
  return find.replace(/\{\{(character|user)\}\}/g, (_, key: keyof RegexVariables) =>
    variables[key]?.trim() ? escapeRegex(variables[key]!.trim()) : "(?!)");
}

export function parseRegexPattern(find: string): { pattern: string; flags: string } {
  if (!find.startsWith("/")) return { pattern: find, flags: "" };
  for (let index = find.length - 1; index > 0; index--) {
    if (find[index] !== "/") continue;
    let slashes = 0;
    for (let before = index - 1; before >= 0 && find[before] === "\\"; before--) slashes++;
    if (slashes % 2 === 0) return { pattern: find.slice(1, index), flags: find.slice(index + 1) };
  }
  return { pattern: find, flags: "" };
}
function compiled(find: string, variables: RegexVariables = {}): RegExp {
  const { pattern, flags } = parseRegexPattern(resolveVariables(find, variables));
  const key = `${pattern}\u0000${flags}`;
  const existing = cache.get(key);
  if (existing) return existing;
  const next = new RegExp(pattern, flags);
  if (cache.size >= CACHE_LIMIT) cache.delete(cache.keys().next().value!);
  cache.set(key, next);
  return next;
}
export function regexPatternError(find: string): string | null {
  if (!find) return null;
  try { compiled(find); return null; }
  catch (reason) { return reason instanceof Error ? reason.message : "Invalid pattern."; }
}
function replaceCaptures(template: string, match: string, captures: (string | undefined)[], groups?: Record<string, string>) {
  return template.replace(/\$(\$|&|0|[1-9]\d?|<[^>]+>)/g, (token, key: string) => {
    if (key === "$") return "$";
    if (key === "&" || key === "0") return match;
    if (key.startsWith("<")) return groups?.[key.slice(1, -1)] ?? token;
    const index = Number(key);
    return index <= captures.length ? captures[index - 1] ?? "" : token;
  });
}
export function testRegexRule(rule: RegexRule, text: string, variables: RegexVariables = {}): { output: string; step: RegexStep } {
  const base = { ruleId: rule.id, ruleName: rule.name, before: text };
  if (!rule.find) return { output: text, step: { ...base, after: text, status: "unchanged" } };
  try {
    const pattern = compiled(rule.find, variables);
    const output = text.replace(pattern, (...args) => {
      const groups = typeof args.at(-1) === "object" ? args.at(-1) as Record<string, string> : undefined;
      const offsetIndex = args.length - (groups ? 3 : 2);
      return replaceCaptures(rule.replace, args[0] as string,
        args.slice(1, offsetIndex) as (string | undefined)[], groups);
    });
    return { output, step: { ...base, after: output,
      status: output === text ? "unchanged" : "matched" } };
  } catch (reason) {
    return { output: text, step: { ...base, after: text, status: "invalid",
      error: reason instanceof Error ? reason.message : "Invalid pattern." } };
  }
}
export function testRegexGroups(text: string, groups: readonly RegexGroup[], role: RegexRole, target: RegexMode,
  variables: RegexVariables = {}) {
  let output = text;
  const steps: RegexStep[] = [];
  for (const group of groups) {
    if (!group.enabled) continue;
    for (const rule of group.rules) {
      if (!rule.enabled || !rule.appliesTo.includes(role) || rule.mode !== target) continue;
      const result = testRegexRule(rule, output, variables);
      output = result.output;
      steps.push(result.step);
    }
  }
  return { output, steps };
}
export function applyRegex(text: string, groups: readonly RegexGroup[], role: RegexRole, target: RegexMode,
  variables: RegexVariables = {}): string {
  return testRegexGroups(text, groups, role, target, variables).output;
}
