import { isReturnPoint, upsertReturnPoint, type EntryStatus, type ReturnPoint, type SaveInput, type ScrollSnapshot, validateSnapshot, NOTE_LIMIT } from './models';
import { validatePageUrl } from './urls';

export const LIBRARY_KEY = 'returnpoint.library.v1';
interface Library { version: 1; entries: ReturnPoint[] }

export async function readEntries(): Promise<ReturnPoint[]> {
  let result: Record<string, unknown>;
  try { result = await chrome.storage.local.get(LIBRARY_KEY); }
  catch { throw new Error('Your library could not be read. Reopen ReturnPoint and try again.'); }
  const stored = result[LIBRARY_KEY];
  if (stored === undefined) return [];
  const library = stored as Library;
  if (!library || library.version !== 1 || !Array.isArray(library.entries)
    || !library.entries.every(isReturnPoint)
    || new Set(library.entries.map((entry) => entry.url)).size !== library.entries.length
    || new Set(library.entries.map((entry) => entry.id)).size !== library.entries.length) {
    // Never overwrite an unreadable library with an empty one.
    throw new Error('Your saved library is unreadable. Its data has been left untouched.');
  }
  return library.entries;
}

async function writeEntries(entries: ReturnPoint[]): Promise<void> {
  try { await chrome.storage.local.set({ [LIBRARY_KEY]: { version: 1, entries } satisfies Library }); }
  catch { throw new Error('Changes could not be saved on this device. Your previous library is unchanged.'); }
}

export async function getEntry(id: string): Promise<ReturnPoint> {
  const entry = (await readEntries()).find((entry) => entry.id === id);
  if (!entry) throw new Error('This ReturnPoint no longer exists. Go back to your library.');
  return entry;
}

// All mutations run through the background worker's queue, avoiding read/modify/write races.
export async function saveEntry(input: SaveInput): Promise<ReturnPoint> {
  validatePageUrl(input.url);
  const entries = await readEntries();
  const entry = upsertReturnPoint(entries, input);
  await writeEntries([...entries.filter((item) => item.id !== entry.id), entry]);
  return entry;
}

async function changeEntry(id: string, change: (entry: ReturnPoint) => ReturnPoint): Promise<ReturnPoint> {
  const entries = await readEntries();
  const existing = entries.find((entry) => entry.id === id);
  if (!existing) throw new Error('This ReturnPoint no longer exists. Go back to your library.');
  const updated = { ...change(existing), updatedAt: Date.now() };
  await writeEntries(entries.map((entry) => entry.id === id ? updated : entry));
  return updated;
}

export function editNote(id: string, note: string): Promise<ReturnPoint> {
  if (note.length > NOTE_LIMIT) throw new Error(`Keep your note within ${NOTE_LIMIT} characters.`);
  return changeEntry(id, (entry) => ({ ...entry, note: note.trim() }));
}

export function updatePosition(id: string, snapshot: ScrollSnapshot): Promise<ReturnPoint> {
  validateSnapshot(snapshot);
  return changeEntry(id, (entry) => ({ ...entry, ...snapshot }));
}

export function setEntryStatus(id: string, status: EntryStatus): Promise<ReturnPoint> {
  if (status !== 'active' && status !== 'completed') throw new Error('Invalid ReturnPoint status.');
  return changeEntry(id, (entry) => ({ ...entry, status }));
}

export async function deleteEntry(id: string): Promise<void> {
  const entries = await readEntries();
  if (!entries.some((entry) => entry.id === id)) throw new Error('This ReturnPoint has already been deleted.');
  await writeEntries(entries.filter((entry) => entry.id !== id));
}
