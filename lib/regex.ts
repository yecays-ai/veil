import { DEFAULT_REGEX_GROUP_ID } from "./regex-defaults";

export type RegexRole = "user" | "assistant";
export type RegexMode = "stored" | "prompt" | "display";
export type RegexRule = {
  id: string;
  name: string;
  find: string;
  replace: string;
  enabled: boolean;
  appliesTo: RegexRole[];
  mode: RegexMode;
};
export type RegexGroup = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  rules: RegexRule[];
  createdAt: number;
  updatedAt: number;
};
export type RegexDocument = { version: 1; groups: RegexGroup[] };
export type RegexImportResult = { document: RegexDocument; warnings: string[] };

const record = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => typeof value === "string" ? value.slice(0, max) : "";
export const emptyRegexDocument = (): RegexDocument => ({ version: 1, groups: [] });

export function newRegexRule(): RegexRule {
  return { id: crypto.randomUUID(), name: "New Rule", find: "", replace: "",
    enabled: true, appliesTo: ["user", "assistant"], mode: "stored" };
}
export function newRegexGroup(): RegexGroup {
  const now = Date.now();
  return { id: crypto.randomUUID(), name: "New Regex", description: "", enabled: true,
    rules: [], createdAt: now, updatedAt: now };
}
export function newRegexDraft(): RegexGroup { return { ...newRegexGroup(), name: "" }; }
export function canSaveRegexGroup(group: RegexGroup): boolean {
  const name = group.name.trim();
  return !!name && name.length <= 200;
}

export function validateRegexDocument(value: unknown): RegexDocument {
  if (!record(value) || value.version !== 1 || !Array.isArray(value.groups) ||
    value.groups.filter((group: unknown) => !record(group) || group.id !== DEFAULT_REGEX_GROUP_ID).length > 100)
    throw new Error("Saved Regex data has an unsupported format.");
  const groupIds = new Set<string>();
  const groups = value.groups.map((group): RegexGroup => {
    if (!record(group) || typeof group.id !== "string" || !group.id || groupIds.has(group.id) ||
      typeof group.name !== "string" || !group.name.trim() || group.name.length > 200 ||
      typeof group.description !== "string" || group.description.length > 2000 ||
      typeof group.enabled !== "boolean" || !Array.isArray(group.rules) || group.rules.length > 200 ||
      typeof group.createdAt !== "number" || !Number.isFinite(group.createdAt) ||
      typeof group.updatedAt !== "number" || !Number.isFinite(group.updatedAt))
      throw new Error("Saved Regex contains invalid Groups or duplicate IDs.");
    groupIds.add(group.id);
    const ruleIds = new Set<string>();
    const rules = group.rules.map((rule): RegexRule => {
      if (!record(rule) || typeof rule.id !== "string" || !rule.id || ruleIds.has(rule.id) ||
        typeof rule.name !== "string" || rule.name.length > 200 ||
        typeof rule.find !== "string" || rule.find.length > 4000 ||
        typeof rule.replace !== "string" || rule.replace.length > 12000 ||
        typeof rule.enabled !== "boolean" || !Array.isArray(rule.appliesTo) ||
        !rule.appliesTo.length || rule.appliesTo.length > 2 ||
        new Set(rule.appliesTo).size !== rule.appliesTo.length ||
        !rule.appliesTo.every((role) => role === "user" || role === "assistant") ||
        !["stored", "prompt", "display"].includes(String(rule.mode)))
        throw new Error("Saved Regex contains invalid Rules or duplicate IDs.");
      ruleIds.add(rule.id);
      return { id: rule.id, name: rule.name, find: rule.find, replace: rule.replace,
        enabled: rule.enabled, appliesTo: [...rule.appliesTo] as RegexRole[], mode: rule.mode as RegexMode };
    });
    return { id: group.id, name: group.name, description: group.description,
      enabled: group.enabled, rules, createdAt: group.createdAt, updatedAt: group.updatedAt };
  });
  return { version: 1, groups };
}

function parseJson(json: string): unknown {
  if (json.length > 5_000_000) throw new Error("Regex JSON is too large.");
  try { return JSON.parse(json); }
  catch { throw new Error("Regex JSON could not be read."); }
}
const unsupported = ["markdownOnly", "promptOnly", "historyOnly", "runOnEdit", "trimStrings",
  "substituteRegex", "minDepth", "maxDepth", "tags", "appTags"];
function legacyRule(value: Record<string, unknown>, warnings: string[]): RegexRule {
  if (typeof value.findRegex !== "string") throw new Error("Legacy Regex Rule is missing Find.");
  const placement = Array.isArray(value.placement) ? value.placement : [];
  const appliesTo: RegexRole[] = [];
  if (placement.includes(1)) appliesTo.push("user");
  if (placement.includes(2)) appliesTo.push("assistant");
  if (!appliesTo.length) {
    appliesTo.push("user", "assistant");
    warnings.push("Placement could not be mapped; review Applies To.");
  }
  if (placement.some((item) => item !== 1 && item !== 2))
    warnings.push("Unsupported legacy placement was ignored.");
  for (const key of unsupported) if (value[key] !== undefined)
    warnings.push(`${key} is unsupported; review the imported Rule.`);
  warnings.push("Legacy Rule Mode defaults to Stored; review Mode before enabling.");
  return { id: crypto.randomUUID(), name: text(value.scriptName, 200) || "Imported Rule",
    find: value.findRegex.slice(0, 4000), replace: text(value.replaceString, 12000),
    enabled: value.disabled !== true, appliesTo, mode: "stored" };
}
function importRuleValue(value: unknown, warnings: string[]): RegexRule {
  if (!record(value)) throw new Error("Regex Rule JSON has an unsupported structure.");
  if (typeof value.findRegex === "string") return legacyRule(value, warnings);
  if (typeof value.find !== "string" || typeof value.replace !== "string" ||
    !Array.isArray(value.appliesTo) || !value.appliesTo.length ||
    !value.appliesTo.every((role) => role === "user" || role === "assistant") ||
    !["stored", "prompt", "display"].includes(String(value.mode)))
    throw new Error("Regex Rule JSON has an unsupported structure.");
  return { id: crypto.randomUUID(), name: text(value.name, 200) || "Imported Rule",
    find: value.find.slice(0, 4000), replace: value.replace.slice(0, 12000),
    enabled: value.enabled !== false, appliesTo: [...new Set(value.appliesTo)] as RegexRole[],
    mode: value.mode as RegexMode };
}
export function importRegexGroup(document: RegexDocument, json: string): RegexImportResult {
  const source = parseJson(json);
  if (!record(source) || !Array.isArray(source.rules))
    throw new Error("Regex Group JSON has an unsupported structure.");
  const warnings: string[] = [];
  const now = Date.now();
  const group: RegexGroup = { id: crypto.randomUUID(), name: text(source.name, 200) || "Imported Regex",
    description: text(source.description, 2000), enabled: source.enabled !== false && source.disabled !== true,
    rules: source.rules.map((rule) => importRuleValue(rule, warnings)),
    createdAt: now, updatedAt: now };
  return { document: validateRegexDocument({ ...document, groups: [...document.groups, group] }),
    warnings: [...new Set(warnings)] };
}
export function importRegexRule(document: RegexDocument, groupId: string, json: string): RegexImportResult {
  if (!document.groups.some((group) => group.id === groupId)) throw new Error("Regex Group not found.");
  const warnings: string[] = [];
  const rule = importRuleValue(parseJson(json), warnings);
  return { document: validateRegexDocument({ ...document, groups: document.groups.map((group) =>
    group.id === groupId ? { ...group, rules: [...group.rules, rule], updatedAt: Date.now() } : group) }),
    warnings: [...new Set(warnings)] };
}
export const exportRegexGroup = (group: RegexGroup) => JSON.stringify(group, null, 2);
export const exportRegexRule = (rule: RegexRule) => JSON.stringify(rule, null, 2);
export function resolveRegexGroups(document: RegexDocument, ids?: readonly string[]): RegexGroup[] {
  if (ids === undefined) return document.groups;
  const byId = new Map(document.groups.map((group) => [group.id, group]));
  const defaults = document.groups.filter((group) => group.id === DEFAULT_REGEX_GROUP_ID);
  return [...defaults, ...ids.flatMap((id) => {
    const group = byId.get(id);
    return group && group.id !== DEFAULT_REGEX_GROUP_ID ? [group] : [];
  })];
}
