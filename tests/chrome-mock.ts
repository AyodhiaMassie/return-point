import { vi } from 'vitest';

export function chromeEvent() {
  const listeners: Array<(...args: any[]) => unknown> = [];
  return {
    addListener: vi.fn((listener: (...args: any[]) => unknown) => listeners.push(listener)),
    removeListener: vi.fn(),
    emit: (...args: any[]) => listeners.map((listener) => listener(...args)),
  };
}

export function createChromeMock() {
  const localData: Record<string, unknown> = {};
  const sessionData: Record<string, unknown> = {};
  const area = (data: Record<string, unknown>) => ({
    get: vi.fn(async (keys: string | string[] | null) => {
      if (keys === null) return structuredClone(data);
      const result: Record<string, unknown> = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) if (key in data) result[key] = structuredClone(data[key]);
      return result;
    }),
    set: vi.fn(async (items: Record<string, unknown>) => { Object.assign(data, structuredClone(items)); }),
    remove: vi.fn(async (keys: string | string[]) => { for (const key of typeof keys === 'string' ? [keys] : keys) delete data[key]; }),
    setAccessLevel: vi.fn(async () => undefined),
  });
  const tabs = new Map<number, chrome.tabs.Tab>();
  let nextTabId = 20;
  const api = {
    storage: { local: area(localData), session: area(sessionData), onChanged: chromeEvent() },
    permissions: {
      contains: vi.fn(async () => true), request: vi.fn(async () => true),
      onAdded: chromeEvent(), onRemoved: chromeEvent(),
    },
    tabs: {
      get: vi.fn(async (id: number) => { const tab = tabs.get(id); if (!tab) throw new Error('No tab with that ID.'); return { ...tab }; }),
      query: vi.fn(async ({ windowId }: { windowId: number }) => [...tabs.values()].filter((tab) => tab.active && tab.windowId === windowId)),
      create: vi.fn(async (properties: { windowId: number; url: string; active: boolean }) => {
        const tab = { ...properties, id: nextTabId++, index: 0, pinned: false, highlighted: false, incognito: false, status: 'complete' as const,
          frozen: false, selected: properties.active, discarded: false, autoDiscardable: true, groupId: -1 };
        tabs.set(tab.id, tab);
        return { ...tab };
      }),
      update: vi.fn(async (id: number, properties: { url?: string; active?: boolean }) => {
        const tab = tabs.get(id);
        if (!tab) throw new Error('No tab with that ID.');
        Object.assign(tab, properties, { status: 'complete' });
        return { ...tab };
      }),
      onUpdated: chromeEvent(), onRemoved: chromeEvent(), onActivated: chromeEvent(),
    },
    windows: { get: vi.fn(async (id: number) => ({ id, incognito: false })), getCurrent: vi.fn(async () => ({ id: 1, incognito: false })) },
    scripting: { executeScript: vi.fn(async () => [{ frameId: 0, result: { success: true, message: 'Restored.', scrollY: 500, attempts: 3 } }]) },
    runtime: { id: 'test-extension', getURL: (path: string) => `chrome-extension://test-extension/${path}`, onMessage: chromeEvent(), onInstalled: chromeEvent(), onStartup: chromeEvent(), sendMessage: vi.fn() },
    sidePanel: { setPanelBehavior: vi.fn(async () => undefined) },
  };
  vi.stubGlobal('chrome', api);
  return { api, localData, sessionData, tabs };
}
