import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createChromeMock } from './chrome-mock';
import { saveEntry, deleteEntry } from '../src/storage';
import type { ResumeOperation } from '../src/resume';

const input = { url: 'https://example.com/article', title: 'Article', note: 'A full note', scrollY: 500, maxScroll: 1000, progress: .5 };

describe('one-click resume coordination', () => {
  let mock: ReturnType<typeof createChromeMock>;
  let resume: typeof import('../src/resume');
  beforeEach(async () => {
    vi.resetModules();
    mock = createChromeMock();
    resume = await import('../src/resume');
  });

  it('persists the operation before navigation and handles an immediately complete page', async () => {
    const entry = await saveEntry(input);
    const originalUpdate = mock.api.tabs.update.getMockImplementation()!;
    mock.api.tabs.update.mockImplementation(async (id, properties) => {
      expect(mock.sessionData[resume.operationKey(id)]).toMatchObject({ stage: 'loading', entryId: entry.id });
      return originalUpdate(id, properties);
    });
    const operation = await resume.beginResume(entry.id, 1);
    await resume.checkResumeTab(operation.tabId);
    expect(mock.api.tabs.create).toHaveBeenCalledWith({ windowId: 1, url: 'about:blank', active: false });
    expect(mock.api.tabs.update).toHaveBeenCalledWith(operation.tabId, { url: input.url, active: true });
    expect(mock.api.scripting.executeScript).toHaveBeenCalledTimes(1);
    expect(await resume.latestOperation(1)).toMatchObject({ stage: 'success', entryId: entry.id });
  });

  it('waits for load completion and ignores unrelated tabs and duplicate completion events', async () => {
    const entry = await saveEntry(input);
    mock.api.tabs.update.mockImplementation(async (id, properties) => {
      const tab = mock.tabs.get(id)!;
      Object.assign(tab, properties, { status: 'loading' });
      return { ...tab };
    });
    const operation = await resume.beginResume(entry.id, 1);
    await resume.checkResumeTab(operation.tabId);
    await resume.checkResumeTab(999);
    expect(mock.api.scripting.executeScript).not.toHaveBeenCalled();
    mock.tabs.get(operation.tabId)!.status = 'complete';
    await Promise.all([resume.checkResumeTab(operation.tabId), resume.checkResumeTab(operation.tabId)]);
    expect(mock.api.scripting.executeScript).toHaveBeenCalledTimes(1);
  });

  it('recovers pending intent after a fresh worker instance without global state', async () => {
    const entry = await saveEntry(input);
    mock.tabs.set(7, { id: 7, windowId: 1, url: input.url, incognito: false, status: 'complete' } as chrome.tabs.Tab);
    const saved: ResumeOperation = { id: 'resume-id', entryId: entry.id, tabId: 7, windowId: 1, url: input.url,
      progress: .5, stage: 'restoring', message: 'Restoring', createdAt: Date.now(), updatedAt: Date.now() };
    mock.sessionData[resume.operationKey(7)] = saved;
    vi.resetModules();
    const freshWorker = await import('../src/resume');
    await freshWorker.reconcileResumes();
    expect(await freshWorker.readOperation(7)).toMatchObject({ stage: 'success' });
  });

  it('recovers a worker stopped before its blank tab was navigated', async () => {
    const entry = await saveEntry(input);
    mock.tabs.set(7, { id: 7, windowId: 1, url: 'about:blank', incognito: false, status: 'complete' } as chrome.tabs.Tab);
    mock.sessionData[resume.operationKey(7)] = { id: 'resume-id', entryId: entry.id, tabId: 7, windowId: 1,
      url: input.url, progress: .5, stage: 'loading', createdAt: Date.now(), updatedAt: Date.now() };
    await resume.reconcileResumes();
    expect(mock.api.tabs.update).toHaveBeenCalledWith(7, { url: input.url, active: true });
    await resume.checkResumeTab(7);
    expect(await resume.readOperation(7)).toMatchObject({ stage: 'success' });
  });

  it('reports script injection errors in durable state', async () => {
    const entry = await saveEntry(input);
    mock.api.scripting.executeScript.mockRejectedValue(new Error('Access denied'));
    const operation = await resume.beginResume(entry.id, 1);
    await resume.checkResumeTab(operation.tabId);
    expect(await resume.readOperation(operation.tabId)).toMatchObject({ stage: 'error', message: expect.stringContaining('Access denied') });
  });

  it('reports a negative restoration result rather than claiming success', async () => {
    const entry = await saveEntry(input);
    mock.api.scripting.executeScript.mockResolvedValue([{ frameId: 0, result: { success: false, message: 'Layout never settled', scrollY: 0, attempts: 6 } }]);
    const operation = await resume.beginResume(entry.id, 1);
    await resume.checkResumeTab(operation.tabId);
    expect(await resume.readOperation(operation.tabId)).toMatchObject({ stage: 'error', message: 'Layout never settled' });
  });

  it('rejects a missing entry and missing permission without opening a new tab', async () => {
    await expect(resume.beginResume('missing', 1)).rejects.toThrow('no longer exists');
    const entry = await saveEntry(input);
    mock.api.permissions.contains.mockResolvedValue(false);
    await expect(resume.beginResume(entry.id, 1)).rejects.toThrow('revoked');
    expect(mock.api.tabs.create).not.toHaveBeenCalled();
  });

  it('reports navigation failures', async () => {
    const entry = await saveEntry(input);
    mock.api.tabs.update.mockRejectedValue(new Error('Navigation failed'));
    await expect(resume.beginResume(entry.id, 1)).rejects.toThrow('could not be opened');
    expect(await resume.latestOperation(1)).toMatchObject({ stage: 'error' });
  });

  it('reports session storage failures to the caller and never navigates without saved state', async () => {
    const entry = await saveEntry(input);
    mock.api.storage.session.set.mockRejectedValue(new Error('Session unavailable'));
    await expect(resume.beginResume(entry.id, 1)).rejects.toThrow('Session unavailable');
    expect(mock.api.tabs.update).not.toHaveBeenCalled();
  });

  it('reports a closed tab and an entry deleted during loading', async () => {
    const entry = await saveEntry(input);
    mock.api.tabs.update.mockImplementation(async (id, properties) => {
      const tab = mock.tabs.get(id)!;
      Object.assign(tab, properties, { status: 'loading' });
      return { ...tab };
    });
    const first = await resume.beginResume(entry.id, 1);
    await resume.tabClosedDuringResume(first.tabId);
    expect(await resume.readOperation(first.tabId)).toMatchObject({ stage: 'error', message: expect.stringContaining('closed') });
    const second = await resume.beginResume(entry.id, 1);
    await deleteEntry(entry.id);
    await resume.checkResumeTab(second.tabId);
    expect(await resume.readOperation(second.tabId)).toMatchObject({ stage: 'error', message: expect.stringContaining('no longer exists') });
  });

  it('turns an expired load into an actionable failure', async () => {
    mock.sessionData[resume.operationKey(7)] = { id: 'old', entryId: 'entry', tabId: 7, windowId: 1,
      url: input.url, progress: .5, stage: 'loading', createdAt: Date.now() - resume.RESUME_TIMEOUT_MS - 1, updatedAt: Date.now() };
    await resume.reconcileResumes();
    expect(await resume.readOperation(7)).toMatchObject({ stage: 'error', message: expect.stringContaining('too long') });
  });

  it('scopes the selected note to its original browser window', async () => {
    const entry = await saveEntry(input);
    const operation = await resume.beginResume(entry.id, 1);
    await resume.checkResumeTab(operation.tabId);
    expect(await resume.latestOperation(2)).toBeUndefined();
    await resume.dismissResume(1);
    expect(await resume.latestOperation(1)).toBeUndefined();
  });
});
