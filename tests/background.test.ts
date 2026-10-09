import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './chrome-mock';
import type { Command, Response } from '../src/messages';
import { readEntries, saveEntry } from '../src/storage';

describe('background event wiring and commands', () => {
  let mock: ReturnType<typeof createChromeMock>;
  beforeEach(async () => {
    vi.resetModules();
    mock = createChromeMock();
    await import('../src/background');
  });

  function command(message: Command, sender = { id: 'test-extension', url: 'chrome-extension://test-extension/sidepanel.html' }): Promise<Response> {
    return new Promise((resolve) => {
      const responses = mock.api.runtime.onMessage.emit(message, sender, resolve);
      if (!responses.includes(true)) resolve({ ok: false, error: 'Rejected sender' });
    });
  }

  it('registers navigation, removal, startup, and message listeners synchronously', () => {
    expect(mock.api.tabs.onUpdated.addListener).toHaveBeenCalledOnce();
    expect(mock.api.tabs.onRemoved.addListener).toHaveBeenCalledOnce();
    expect(mock.api.runtime.onMessage.addListener).toHaveBeenCalledOnce();
    expect(mock.api.runtime.onStartup.addListener).toHaveBeenCalledOnce();
    expect(mock.api.sidePanel.setPanelBehavior).toHaveBeenCalledWith({ openPanelOnActionClick: true });
  });

  it('rejects commands from a webpage, even a content script with the extension ID', async () => {
    const response = await command({ type: 'delete', id: 'anything' }, { id: 'test-extension', url: 'https://example.com' });
    expect(response).toEqual({ ok: false, error: 'Rejected sender' });
  });

  it('serializes concurrent writes so entries and exact-URL uniqueness are preserved', async () => {
    mock.tabs.set(1, { id: 1, windowId: 1, active: true, incognito: false, url: 'https://example.com/one', title: 'One' } as chrome.tabs.Tab);
    mock.tabs.set(2, { id: 2, windowId: 2, active: true, incognito: false, url: 'https://example.com/two', title: 'Two' } as chrome.tabs.Tab);
    mock.api.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { scrollY: 500, maxScroll: 1000, progress: .5 } } as any]);
    const results = await Promise.all([
      command({ type: 'save', tabId: 1, url: 'https://example.com/one', note: 'First' }),
      command({ type: 'save', tabId: 2, url: 'https://example.com/two', note: 'Second' }),
      command({ type: 'save', tabId: 1, url: 'https://example.com/one', note: 'Updated first' }),
    ]);
    expect(results.every((result) => result.ok)).toBe(true);
    const library = await readEntries();
    expect(library).toHaveLength(2);
    expect(library.find((entry) => entry.url.endsWith('/one'))?.note).toBe('Updated first');
  });

  it('explains a URL mismatch when updating progress', async () => {
    const entry = await saveEntry({ url: 'https://example.com/saved', title: 'Saved', note: '', scrollY: 0, maxScroll: 1000, progress: 0 });
    mock.tabs.set(1, { id: 1, windowId: 1, active: true, incognito: false, url: 'https://example.com/different' } as chrome.tabs.Tab);
    const response = await command({ type: 'update-position', id: entry.id, windowId: 1 });
    expect(response).toMatchObject({ ok: false, error: expect.stringContaining('exact saved URL') });
    expect(mock.api.scripting.executeScript).not.toHaveBeenCalled();
  });
});
