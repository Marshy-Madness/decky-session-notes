import { GameSummary, Note, SortMode } from "../types";

export function formatDate(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

export function formatDateTime(ms: number | null | undefined): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

/** "3:43 PM" today, "Yesterday", "Oct 4" this year, otherwise the full date. */
export function formatWhen(ms: number | null | undefined): string {
  if (!ms) return "—";
  const d = new Date(ms);
  const now = new Date();
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((day(now) - day(d)) / 86400000);
  if (diffDays === 0) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (diffDays === 1) return "Yesterday";
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return formatDate(ms);
}

export function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m`;
  return `${Math.floor(seconds)}s`;
}

export function formatClock(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** First non-empty line of the body, with inline screenshot markers stripped. */
export function firstLine(body: string): string {
  return (
    body
      .split("\n")
      .map((l) => l.replace(/\[img:\d+\]/g, "").trim())
      .find(Boolean) ?? ""
  );
}

export const SORT_LABELS: Record<SortMode, string> = {
  alpha: "Alphabetical",
  created: "Created",
  edited: "Last Edited",
  recent: "Recent Games",
};

export function sortNotes(notes: Note[], mode: SortMode): Note[] {
  const byMode = (a: Note, b: Note) => {
    switch (mode) {
      case "alpha":
        return a.title.localeCompare(b.title, undefined, { sensitivity: "base" });
      case "created":
        return b.createdAt - a.createdAt;
      default:
        return b.updatedAt - a.updatedAt;
    }
  };
  return [...notes].sort((a, b) => Number(b.pinned) - Number(a.pinned) || byMode(a, b));
}

export function sortGames(games: GameSummary[], mode: SortMode): GameSummary[] {
  return [...games].sort((a, b) => {
    switch (mode) {
      case "alpha":
        return a.name.localeCompare(b.name, undefined, { sensitivity: "base" });
      case "created":
        return (b.firstNoteCreated ?? b.firstSeen ?? 0) - (a.firstNoteCreated ?? a.firstSeen ?? 0);
      case "edited":
        return (b.lastEdited ?? 0) - (a.lastEdited ?? 0);
      case "recent":
        return (b.lastLaunched ?? 0) - (a.lastLaunched ?? 0);
    }
  });
}

export function newId(): string {
  return crypto.randomUUID();
}
