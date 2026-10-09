import { themeImageAssetId, type ThemeDocument } from "./theme-types";

// One mounted Provider owns these URLs; overlapping reads never share unfinished URLs.
export class ThemeImageUrls {
  private revision = 0;
  private disposed = false;
  private urls: Record<string, string> = {};
  private pendingUrls = new Set<string>();

  constructor(private readBlob: (id: string) => Promise<Blob | null>,
    private create: (blob: Blob) => string = (blob) => URL.createObjectURL(blob),
    private revoke: (url: string) => void = (url) => URL.revokeObjectURL(url)) {}

  invalidate() {
    this.revision++;
    this.pendingUrls.forEach(this.revoke);
    this.pendingUrls.clear();
  }

  async sync(document: ThemeDocument): Promise<Record<string, string> | null> {
    this.invalidate();
    const revision = this.revision;
    const next: Record<string, string> = {};
    const current = document.current.profile;
    const ids = new Set(
      [current.wallpaper.source, current.dock.image, ...Object.values(current.icons)]
        .map(themeImageAssetId).filter((id): id is string => id !== null),
    );
    const isCurrent = () => !this.disposed && revision === this.revision;
    const created: string[] = [];
    try {
      const prepared = await Promise.all([...ids].map(async (id) => {
        const reference = `appearance-asset:${id}`;
        if (this.urls[reference]) return [reference, this.urls[reference]] as const;
        const blob = await this.readBlob(id).catch(() => null);
        if (!isCurrent() || !blob) return null;
        const url = this.create(blob);
        created.push(url);
        this.pendingUrls.add(url);
        return [reference, url] as const;
      }));
      if (!isCurrent()) return null;
      for (const entry of prepared) if (entry) next[entry[0]] = entry[1];
      for (const [reference, url] of Object.entries(this.urls))
        if (!next[reference]) this.revoke(url);
      this.urls = next;
      created.forEach((url) => this.pendingUrls.delete(url));
      created.length = 0;
      return next;
    } finally {
      created.forEach((url) => { if (this.pendingUrls.delete(url)) this.revoke(url); });
    }
  }

  dispose() {
    this.disposed = true;
    this.invalidate();
    Object.values(this.urls).forEach(this.revoke);
    this.urls = {};
  }
}
