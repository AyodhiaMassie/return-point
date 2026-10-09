export type EntryStatus = 'active' | 'completed';

export interface ScrollSnapshot {
  scrollY: number;
  maxScroll: number;
  progress: number; // Ratio from 0 to 1. UI displays a percentage.
}

export interface ReturnPoint extends ScrollSnapshot {
  id: string;
  url: string;
  title: string;
  note: string;
  createdAt: number;
  updatedAt: number;
  status: EntryStatus;
}

export interface SaveInput extends ScrollSnapshot {
  url: string;
  title: string;
  note: string;
}

export const NOTE_LIMIT = 2000;

export function validateSnapshot(value: ScrollSnapshot): void {
  if (![value.scrollY, value.maxScroll, value.progress].every(Number.isFinite)
    || value.scrollY < 0 || value.maxScroll < 0 || value.scrollY > value.maxScroll
    || value.progress < 0 || value.progress > 1) {
    throw new Error('The saved reading position is invalid. Save the page again.');
  }
}

export function upsertReturnPoint(entries: ReturnPoint[], input: SaveInput, now = Date.now()): ReturnPoint {
  validateSnapshot(input);
  if (input.note.length > NOTE_LIMIT) throw new Error(`Keep your note within ${NOTE_LIMIT} characters.`);
  const existing = entries.find((entry) => entry.url === input.url);
  return {
    ...input,
    title: input.title.trim() || new URL(input.url).hostname,
    note: input.note.trim(),
    id: existing?.id ?? crypto.randomUUID(),
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    status: 'active',
  };
}

export function sortEntries(entries: ReturnPoint[], status: EntryStatus): ReturnPoint[] {
  return entries.filter((entry) => entry.status === status).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function isReturnPoint(value: unknown): value is ReturnPoint {
  if (!value || typeof value !== 'object') return false;
  const entry = value as ReturnPoint;
  try { validateSnapshot(entry); } catch { return false; }
  return typeof entry.id === 'string' && entry.id.length > 0
    && typeof entry.url === 'string' && typeof entry.title === 'string'
    && typeof entry.note === 'string' && entry.note.length <= NOTE_LIMIT
    && Number.isFinite(entry.createdAt) && Number.isFinite(entry.updatedAt)
    && (entry.status === 'active' || entry.status === 'completed');
}
