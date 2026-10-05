export function downloadRegex(json: string, name: string) {
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${name.replace(/[^a-zA-Z0-9_-]+/g, "-") || "regex"}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
