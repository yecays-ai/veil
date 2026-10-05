const timestamp = /^\[(\d{4}-\d{2}-\d{2}) (\d{2}):(\d{2}) ([A-Za-z0-9_+./-]+)\](?:\r?\n|$)/;
// A possible unfinished metadata prefix is withheld only during streaming.
const unfinished = /^\[(?:\d{0,4}(?:-\d{0,2}(?:-\d{0,2}(?: \d{0,2}(?::\d{0,2}(?: [A-Za-z0-9_+./-]*)?)?)?)?)?)?$/;

function validTimestamp(date: string, hour: string, minute: string, zone: string) {
  const parsed = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date ||
      Number(hour) > 23 || Number(minute) > 59) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: zone });
    return true;
  } catch { return false; }
}

/** Remove only standalone VEIL timestamp lines at reply/blank-line segment starts. */
export function sanitizeHistoryTimestamps(raw: string, streaming = false): string {
  return raw.split(/(\r?\n[ \t]*\r?\n(?:[ \t]*\r?\n)*)/).map((segment, index) => {
    if (index % 2) return segment;
    let content = segment;
    while (true) {
      const leading = content.match(/^\s*/)?.[0] || "";
      const body = content.slice(leading.length);
      const match = body.match(timestamp);
      if (match && validTimestamp(match[1], match[2], match[3], match[4])) {
        content = leading + body.slice(match[0].length);
        continue;
      }
      // CR may arrive separately from the final LF of a metadata line.
      if (streaming && (unfinished.test(body) ||
          (body.endsWith("\r") && timestamp.test(body.slice(0, -1))))) return leading;
      return content;
    }
  }).join("");
}
