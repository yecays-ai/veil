import { themeImageAssetIds, type ThemeDocument } from "./theme-types";

// One mounted Provider owns these URLs; overlapping reads never share unfinished URLs.
export class ThemeImageUrls {
  private revision = 0;
  private disposed = false;
  private urls: Record<string, string> = {};

  constructor(private readBlob: (id: string) => Promise<Blob | null>,
    private create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {}

  invalidate() { this.revision++; }

  async sync(document: ThemeDocument): Promise<Record<string, string> | null> {
    const revision = ++this.revision;
    const next: Record<string, string> = {};
    const created: string[] = [];
    const current = () => !this.disposed && revision === this.revision;
    try {
      for (const id of themeImageAssetIds(document)) {
        if (!current()) return null;
        const reference = `appearance-asset:${id}`;
        if (this.urls[reference]) { next[reference] = this.urls[reference]; continue; }
        const blob = await this.readBlob(id).catch(() => null);
        if (!current()) return null;
        if (blob) { next[reference] = this.create(blob); created.push(next[reference]); }
      }
      if (!current()) return null;
      for (const [reference, url] of Object.entries(this.urls))
        if (!next[reference]) this.revoke(url);
      this.urls = next;
      created.length = 0;
      return next;
    } finally { created.forEach(this.revoke); }
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
    Object.values(this.urls).forEach(this.revoke);
    this.urls = {};
  }
}
