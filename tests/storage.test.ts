import { beforeEach, describe, expect, it } from 'vitest';
import { deleteEntry, editNote, getEntry, LIBRARY_KEY, readEntries, saveEntry, setEntryStatus, updatePosition } from '../src/storage';
import { sortEntries, upsertReturnPoint, type SaveInput } from '../src/models';
import { createChromeMock } from './chrome-mock';

export const exampleInput: SaveInput = { url: 'https://example.com/article', title: 'An article', note: 'Read next chapter', scrollY: 500, maxScroll: 1000, progress: .5 };

describe('local ReturnPoint storage', () => {
  let mock: ReturnType<typeof createChromeMock>;
  beforeEach(() => { mock = createChromeMock(); });

  it('starts with an empty library', async () => { expect(await readEntries()).toEqual([]); });
  it('creates an entry with an ID, timestamps, and active status', async () => {
    const entry = await saveEntry(exampleInput);
    expect(entry.id).toBeTruthy();
    expect(entry.status).toBe('active');
    expect(entry.createdAt).toBeGreaterThan(0);
    expect(await getEntry(entry.id)).toEqual(entry);
    expect(mock.api.storage.local.set).toHaveBeenCalledWith({ [LIBRARY_KEY]: { version: 1, entries: [entry] } });
  });
  it('updates an exact URL rather than duplicating it, preserving identity and creation time', async () => {
    const first = await saveEntry(exampleInput);
    await setEntryStatus(first.id, 'completed');
    const updated = await saveEntry({ ...exampleInput, note: 'New note', progress: .8, scrollY: 800 });
    expect(updated.id).toBe(first.id);
    expect(updated.createdAt).toBe(first.createdAt);
    expect(updated.note).toBe('New note');
    expect(updated.status).toBe('active');
    expect(await readEntries()).toHaveLength(1);
  });
  it('keeps different query strings and fragments as distinct exact URLs', async () => {
    await saveEntry(exampleInput);
    await saveEntry({ ...exampleInput, url: `${exampleInput.url}?v=2` });
    await saveEntry({ ...exampleInput, url: `${exampleInput.url}#next` });
    expect(await readEntries()).toHaveLength(3);
  });
  it('edits notes without changing the saved reading position', async () => {
    const entry = await saveEntry(exampleInput);
    const updated = await editNote(entry.id, '  <script>alert(1)</script>\nSecond line  ');
    expect(updated.note).toBe('<script>alert(1)</script>\nSecond line');
    expect(updated.progress).toBe(.5);
  });
  it('updates position without changing notes or status', async () => {
    const entry = await saveEntry(exampleInput);
    await setEntryStatus(entry.id, 'completed');
    const updated = await updatePosition(entry.id, { scrollY: 800, maxScroll: 1000, progress: .8 });
    expect(updated.note).toBe(exampleInput.note);
    expect(updated.status).toBe('completed');
    expect(updated.progress).toBe(.8);
  });
  it('moves entries between completed and active and stores both', async () => {
    const entry = await saveEntry(exampleInput);
    expect((await setEntryStatus(entry.id, 'completed')).status).toBe('completed');
    expect(await readEntries()).toHaveLength(1);
    expect((await setEntryStatus(entry.id, 'active')).status).toBe('active');
  });
  it('deletes only the selected entry', async () => {
    const first = await saveEntry(exampleInput);
    const second = await saveEntry({ ...exampleInput, url: 'https://example.com/other' });
    await deleteEntry(first.id);
    expect(await readEntries()).toEqual([second]);
    await expect(getEntry(first.id)).rejects.toThrow('no longer exists');
    await expect(deleteEntry(first.id)).rejects.toThrow('already been deleted');
  });
  it('rejects edits of missing entries', async () => {
    await expect(editNote('missing', 'hello')).rejects.toThrow('no longer exists');
    await expect(setEntryStatus('missing', 'active')).rejects.toThrow('no longer exists');
  });
  it('reports failed reads and writes', async () => {
    mock.api.storage.local.get.mockRejectedValueOnce(new Error('Unavailable'));
    await expect(readEntries()).rejects.toThrow('could not be read');
    mock.api.storage.local.set.mockRejectedValueOnce(new Error('Quota'));
    await expect(saveEntry(exampleInput)).rejects.toThrow('could not be saved');
    expect(await readEntries()).toEqual([]);
  });
  it('does not overwrite corrupt stored data', async () => {
    mock.localData[LIBRARY_KEY] = { version: 1, entries: [{ id: 'broken' }] };
    await expect(saveEntry(exampleInput)).rejects.toThrow('left untouched');
    expect(mock.api.storage.local.set).not.toHaveBeenCalled();
  });
  it('rejects stored duplicates', async () => {
    const entry = upsertReturnPoint([], exampleInput);
    mock.localData[LIBRARY_KEY] = { version: 1, entries: [entry, { ...entry, id: 'another' }] };
    await expect(readEntries()).rejects.toThrow('unreadable');
  });
  it('rejects unsupported URLs, invalid geometry, and oversized notes', async () => {
    await expect(saveEntry({ ...exampleInput, url: 'javascript:alert(1)' })).rejects.toThrow('HTTP');
    await expect(saveEntry({ ...exampleInput, progress: NaN })).rejects.toThrow('invalid');
    await expect(saveEntry({ ...exampleInput, scrollY: 1001 })).rejects.toThrow('invalid');
    await expect(saveEntry({ ...exampleInput, note: 'x'.repeat(2001) })).rejects.toThrow('2000');
  });
  it('sorts each section by most recent update without mutating the source', () => {
    const first = upsertReturnPoint([], exampleInput, 100);
    const second = upsertReturnPoint([], { ...exampleInput, url: 'https://example.com/other' }, 200);
    const completed = { ...first, id: 'completed', status: 'completed' as const, updatedAt: 300 };
    const source = [first, second, completed];
    expect(sortEntries(source, 'active')).toEqual([second, first]);
    expect(sortEntries(source, 'completed')).toEqual([completed]);
    expect(source[0]).toBe(first);
  });
});
