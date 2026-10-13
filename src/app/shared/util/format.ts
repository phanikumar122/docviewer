/** Small formatting + id helpers shared across features. */

export function formatBytes(bytes: number, decimals = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(i === 0 ? 0 : decimals)} ${units[i]}`;
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

export function formatDateTime(ts: number): string {
  return new Date(ts).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function relativeTime(ts: number, now = Date.now()): string {
  const diff = now - ts;
  const sec = Math.round(diff / 1000);
  if (sec < 45) return 'just now';
  const min = Math.round(sec / 60);
  if (min < 60) return `${min}m ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const day = Math.round(hr / 24);
  if (day < 7) return `${day}d ago`;
  const wk = Math.round(day / 7);
  if (wk < 5) return `${wk}w ago`;
  return formatDate(ts);
}

let counter = 0;
/** Compact unique id — crypto.randomUUID when available, else timestamp+counter. */
export function uid(prefix = ''): string {
  const base =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;
  return prefix ? `${prefix}_${base}` : base;
}

export function baseName(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}

/** Append a suffix before the extension, e.g. report.pdf + "-merged" -> report-merged.pdf */
export function withSuffix(name: string, suffix: string): string {
  const i = name.lastIndexOf('.');
  if (i <= 0) return name + suffix;
  return name.slice(0, i) + suffix + name.slice(i);
}

/** Replace or add an extension: changeExt("a.pdf","txt") -> "a.txt" */
export function changeExt(name: string, ext: string): string {
  return `${baseName(name)}.${ext}`;
}
