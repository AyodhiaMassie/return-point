import { captureTab, currentTab, errorMessage, validateTab } from './chrome-api';
import type { Command, CommandResult, Response } from './messages';
import { deleteEntry, editNote, getEntry, saveEntry, setEntryStatus, updatePosition } from './storage';
import { beginResume, checkResumeTab, dismissResume, reconcileResumes, tabClosedDuringResume } from './resume';

// Register listeners synchronously so Chrome can wake this worker for navigation events.
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === 'complete') void checkResumeTab(tabId).catch(console.error);
});
chrome.tabs.onRemoved.addListener((tabId) => { void tabClosedDuringResume(tabId).catch(console.error); });
chrome.runtime.onInstalled.addListener(() => { void configure().catch(console.error); });
chrome.runtime.onStartup.addListener(() => { void reconcileResumes().catch(console.error); });

let mutations: Promise<unknown> = Promise.resolve();
function serializeMutation(action: () => Promise<CommandResult>): Promise<CommandResult> {
  const next = mutations.catch(() => undefined).then(action);
  mutations = next;
  return next;
}

async function handleCommand(command: Command): Promise<CommandResult> {
  switch (command.type) {
    case 'save': {
      const tab = await chrome.tabs.get(command.tabId);
      validateTab(tab);
      const active = await currentTab(tab.windowId);
      if (active.id !== tab.id) throw new Error('The selected tab changed. Refresh the page details and save again.');
      const snapshot = await captureTab(command.tabId, command.url);
      return serializeMutation(() => saveEntry({ ...snapshot, url: command.url, title: tab.title ?? command.url, note: command.note }));
    }
    case 'edit-note': return serializeMutation(() => editNote(command.id, command.note));
    case 'update-position': {
      const entry = await getEntry(command.id);
      const tab = await currentTab(command.windowId);
      validateTab(tab);
      if (tab.url !== entry.url) throw new Error('Select the tab with this exact saved URL to update its position. You can still edit its note.');
      const snapshot = await captureTab(tab.id, entry.url);
      return serializeMutation(() => updatePosition(entry.id, snapshot));
    }
    case 'set-status': return serializeMutation(() => setEntryStatus(command.id, command.status));
    case 'delete': return serializeMutation(async () => { await deleteEntry(command.id); return null; });
    case 'resume': return beginResume(command.id, command.windowId);
    case 'reconcile': await reconcileResumes(); return null;
    case 'dismiss-resume': await dismissResume(command.windowId); return null;
    default: throw new Error('Unrecognized ReturnPoint action.');
  }
}

chrome.runtime.onMessage.addListener((message: unknown, sender, respond: (response: Response) => void) => {
  // Only our own extension pages may issue commands, never scripts running inside webpages.
  if (sender.id !== chrome.runtime.id || !sender.url?.startsWith(chrome.runtime.getURL(''))) return false;
  if (!message || typeof message !== 'object' || !('type' in message)) return false;
  void handleCommand(message as Command).then(
    (data) => respond({ ok: true, data }),
    (error: unknown) => respond({ ok: false, error: errorMessage(error) }),
  );
  return true; // Keep this asynchronous response channel open; an async listener is not portable.
});

async function configure(): Promise<void> {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  await chrome.storage.local.setAccessLevel({ accessLevel: 'TRUSTED_CONTEXTS' });
}

void configure().catch(console.error);
// Reconcile on every worker evaluation, including wakes after suspension.
void reconcileResumes().catch(console.error);
