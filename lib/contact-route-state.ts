export type ContactSelectionMode = "single" | "multi";

export function contactSelectionState(params: Pick<URLSearchParams, "get" | "getAll">): {
  mode: ContactSelectionMode | undefined; initialSelection: string[];
} {
  const value = params.get("mode");
  return {
    mode: value === "single" ? "single" : value === "multi" ? "multi" : undefined,
    initialSelection: params.getAll("contact"),
  };
}

export function contactIdsFromQuery(params: Pick<URLSearchParams, "getAll">): string[] {
  return [...new Set(params.getAll("contact"))];
}
