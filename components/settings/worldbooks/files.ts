import type { WorldBook, WorldBookEntry } from "../../../lib/worldbook";
import { exportWorldBook, exportWorldBookEntry } from "../../../lib/worldbook";

export function downloadWorldBook(value: WorldBook | WorldBookEntry) {
  const json = "entries" in value ? exportWorldBook(value) : exportWorldBookEntry(value);
  const name = (value.name || "worldbook").replace(/[^a-zA-Z0-9_-]+/g, "_");
  const url = URL.createObjectURL(new Blob([json], { type: "application/json" }));
  const anchor = window.document.createElement("a");
  anchor.href = url; anchor.download = `${name}.json`; anchor.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
