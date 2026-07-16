// Shared date/time formatters. All user-facing dates must use these
// to ensure consistent YYYY/M/D or YYYY/M/D HH:mm display per
// spec/ux-principles.md design-language section.

// Today as a YYYY-MM-DD key in **UTC** — the single date convention shared
// with the DB. `finalize_iteration` computes `v_today` as
// `(now() at time zone 'utc')::date` (supabase/migrations/
// 20260715000002_skip_iteration.sql), so any client that decides
// started-vs-not-yet-started (e.g. the Finish/Skip dialog) must use the same
// UTC boundary or its copy can contradict what the RPC actually does.
export function utcTodayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export function formatDate(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  return `${year}/${month}/${day}`;
}

export function formatDateTime(date: Date | string): string {
  const d = typeof date === "string" ? new Date(date) : date;
  const year = d.getFullYear();
  const month = d.getMonth() + 1;
  const day = d.getDate();
  const hours = String(d.getHours()).padStart(2, "0");
  const minutes = String(d.getMinutes()).padStart(2, "0");
  return `${year}/${month}/${day} ${hours}:${minutes}`;
}

export function initials(name: string): string {
  const words = name.trim().split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return name.slice(0, 2).toUpperCase();
}
