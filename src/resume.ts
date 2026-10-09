import { restoreTab, requireHostAccess, errorMessage } from './chrome-api';
import { getEntry } from './storage';
import { validatePageUrl } from './urls';

export type ResumeStage = 'loading' | 'restoring' | 'success' | 'error';
export interface ResumeOperation {
  id: string;
  entryId: string;
  tabId: number;
  windowId: number;
  url: string;
  progress: number;
  stage: ResumeStage;
  message: string;
  createdAt: number;
  updatedAt: number;
}

const OPERATION_PREFIX = 'returnpoint.resume.';
const SELECTION_PREFIX = 'returnpoint.selection.';
export const RESUME_TIMEOUT_MS = 90_000;
export const operationKey = (tabId: number): string => `${OPERATION_PREFIX}${tabId}`;
const selectionKey = (windowId: number): string => `${SELECTION_PREFIX}${windowId}`;

async function writeOperation(operation: ResumeOperation): Promise<void> {
  await chrome.storage.session.set({ [operationKey(operation.tabId)]: operation });
}

export async function readOperation(tabId: number): Promise<ResumeOperation | undefined> {
  return (await chrome.storage.session.get(operationKey(tabId)))[operationKey(tabId)] as ResumeOperation | undefined;
}

export async function latestOperation(windowId: number): Promise<ResumeOperation | undefined> {
  const selection = (await chrome.storage.session.get(selectionKey(windowId)))[selectionKey(windowId)] as number | undefined;
  return selection === undefined ? undefined : readOperation(selection);
}

export async function dismissResume(windowId: number): Promise<void> {
  await chrome.storage.session.remove(selectionKey(windowId));
}

// A queue only suppresses overlapping event handlers within this worker instance.
// Every piece of state needed after suspension lives in chrome.storage.session.
const tabQueues = new Map<number, Promise<unknown>>();
function serializeTab<T>(tabId: number, action: () => Promise<T>): Promise<T> {
  const next = (tabQueues.get(tabId) ?? Promise.resolve()).catch(() => undefined).then(action);
  tabQueues.set(tabId, next);
  void next.finally(() => { if (tabQueues.get(tabId) === next) tabQueues.delete(tabId); }).catch(() => undefined);
  return next;
}

export async function beginResume(entryId: string, windowId: number): Promise<ResumeOperation> {
  const entry = await getEntry(entryId);
  validatePageUrl(entry.url);
  const window = await chrome.windows.get(windowId);
  if (window.incognito) throw new Error('ReturnPoint cannot resume pages in an incognito window.');
  await requireHostAccess(entry.url);
  // Create a blank tab first: persist the intent BEFORE navigating to even the fastest page.
  const tab = await chrome.tabs.create({ windowId, url: 'about:blank', active: false });
  if (tab.id === undefined) throw new Error('Chrome could not create a tab for this ReturnPoint.');
  const operation: ResumeOperation = {
    id: crypto.randomUUID(), entryId, tabId: tab.id, windowId, url: entry.url,
    progress: entry.progress, stage: 'loading', message: 'Opening your page…',
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  try {
    await serializeTab(tab.id, async () => {
      const old = await latestOperation(windowId);
      await chrome.storage.session.set({
        [operationKey(operation.tabId)]: operation,
        [selectionKey(windowId)]: operation.tabId,
      });
      if (old && (old.stage === 'success' || old.stage === 'error')) {
        await chrome.storage.session.remove(operationKey(old.tabId));
      }
      await chrome.tabs.update(operation.tabId, { url: entry.url, active: true });
    });
  } catch (error) {
    // Report failure to the caller as well, even if session storage itself failed.
    await failOperation(operation, errorMessage(error)).catch(() => undefined);
    throw new Error(`The page could not be opened. ${errorMessage(error)}`);
  }
  // onUpdated may have fired before tabs.update resolved. Re-read the tab to close that race.
  void checkResumeTab(operation.tabId).catch(console.error);
  return operation;
}

async function failOperation(operation: ResumeOperation, message: string): Promise<void> {
  await writeOperation({ ...operation, stage: 'error', message, updatedAt: Date.now() });
}

export function checkResumeTab(tabId: number): Promise<void> {
  return serializeTab(tabId, async () => {
    const operation = await readOperation(tabId);
    if (!operation || operation.stage === 'success' || operation.stage === 'error') return;
    try {
      if (Date.now() - operation.createdAt > RESUME_TIMEOUT_MS) {
        throw new Error('The page took too long to load. Check your connection, then click Resume again.');
      }
      await getEntry(operation.entryId);
      const tab = await chrome.tabs.get(tabId);
      if (tab.incognito) throw new Error('Incognito pages cannot be restored.');
      if (tab.url === 'about:blank' && !tab.pendingUrl) {
        // Recovery if the worker stopped after persisting intent, but before starting navigation.
        await chrome.tabs.update(tabId, { url: operation.url, active: true });
        return;
      }
      if (tab.status !== 'complete' || tab.pendingUrl) return;
      await writeOperation({ ...operation, stage: 'restoring', message: 'Finding your place…', updatedAt: Date.now() });
      const result = await restoreTab(tab, operation.progress);
      await writeOperation({ ...operation, stage: result.success ? 'success' : 'error',
        message: result.message, updatedAt: Date.now() });
    } catch (error) { await failOperation(operation, errorMessage(error)); }
  });
}

export async function tabClosedDuringResume(tabId: number): Promise<void> {
  await serializeTab(tabId, async () => {
    const operation = await readOperation(tabId);
    if (operation && (operation.stage === 'loading' || operation.stage === 'restoring')) {
      await failOperation(operation, 'The new tab was closed before restoration finished. Click Resume to open it again.');
    }
  });
}

export async function reconcileResumes(): Promise<void> {
  const stored = await chrome.storage.session.get(null);
  const operations = Object.entries(stored)
    .filter(([key]) => key.startsWith(OPERATION_PREFIX))
    .map(([, value]) => value as ResumeOperation);
  await Promise.all(operations.filter((op) => op.stage === 'loading' || op.stage === 'restoring')
    .map((op) => checkResumeTab(op.tabId)));
}
