import './styles.css';
import { captureTab, currentTab, errorMessage, validateTab, WebsiteAccess } from './chrome-api';
import { NOTE_LIMIT, sortEntries, type EntryStatus, type ReturnPoint, type ScrollSnapshot } from './models';
import { sendCommand } from './messages';
import { latestOperation, type ResumeOperation } from './resume';
import { LIBRARY_KEY, readEntries } from './storage';
import { domainFor, validatePageUrl } from './urls';

type Editor = { kind: 'save'; tabId: number; url: string; title: string; note: string; snapshot: ScrollSnapshot }
  | { kind: 'note'; entryId: string; note: string };

const app = document.querySelector<HTMLElement>('#app')!;
const notification = document.querySelector<HTMLElement>('#notification')!;
const access = new WebsiteAccess();
let windowId: number;
let entries: ReturnPoint[] = [];
let tab: chrome.tabs.Tab | undefined;
let tabError = '';
let mode: 'library' | 'editor' | 'resume' = 'library';
let section: EntryStatus = 'active';
let editor: Editor | undefined;
let operation: ResumeOperation | undefined;
let busy = false;
let refreshSequence = 0;

function element<K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = ''): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  node.className = className;
  if (text) node.textContent = text; // Titles, URLs, and notes never enter innerHTML.
  return node;
}

function button(label: string, action: () => void, className = 'button secondary', disabled = false): HTMLButtonElement {
  const node = element('button', className, label);
  node.type = 'button';
  node.disabled = busy || disabled;
  node.addEventListener('click', action);
  return node;
}

function notify(message: string, failure = false): void {
  notification.textContent = message;
  notification.className = `notification ${failure ? 'error' : 'success'}`;
  notification.setAttribute('role', failure ? 'alert' : 'status');
  notification.hidden = false;
}

async function runBusy(action: () => Promise<void>): Promise<void> {
  if (busy) return;
  busy = true;
  notification.hidden = true;
  render();
  try { await action(); } catch (error) { notify(errorMessage(error), true); }
  finally { busy = false; render(); }
}

function withWebsiteAccess(url: string, action: () => Promise<void>): void {
  try {
    // Start this call in the click handler, before any asynchronous tab/storage work.
    const permission = access.requestFromClick(url);
    void runBusy(async () => {
      if (!await permission) throw new Error('Website access was declined. Allow this website when you save or resume to use ReturnPoint here.');
      await action();
    });
  } catch (error) { notify(errorMessage(error), true); }
}

const percent = (progress: number): string => `${Math.round(progress * 100)}%`;

function progressBar(progress: number): HTMLElement {
  const bar = element('div', 'progress-track');
  bar.setAttribute('role', 'progressbar');
  bar.setAttribute('aria-label', 'Saved reading progress');
  bar.setAttribute('aria-valuemin', '0');
  bar.setAttribute('aria-valuemax', '100');
  bar.setAttribute('aria-valuenow', String(Math.round(progress * 100)));
  const fill = element('span', 'progress-fill');
  fill.style.width = percent(progress);
  bar.append(fill);
  return bar;
}

function pageDetails(title: string, url: string): HTMLElement {
  const details = element('div', 'page-details');
  details.append(element('p', 'eyebrow', domainFor(url)), element('h2', 'page-title', title));
  const address = element('p', 'page-url', url);
  address.title = url;
  details.append(address);
  return details;
}

function render(): void {
  app.replaceChildren();
  app.setAttribute('aria-busy', String(busy));
  if (mode === 'editor' && editor) renderEditor(editor);
  else if (mode === 'resume' && operation) renderResume(operation);
  else renderLibrary();
}

function renderLibrary(): void {
  const current = element('section', 'current-page');
  current.append(element('p', 'eyebrow', 'YOUR CURRENT PAGE'));
  if (tab && !tabError) {
    current.append(element('h2', 'current-title', tab.title || 'Untitled webpage'), element('p', 'domain', domainFor(tab.url ?? '')));
  } else current.append(element('p', 'helper', tabError || 'Finding your active page…'));
  current.append(button(busy ? 'Working…' : '+ Save Reading Position', prepareSave, 'button primary full', !tab || !!tabError));
  current.append(element('p', 'microcopy', 'Save your current position and add a note.'));
  app.append(current);

  const nav = element('div', 'section-tabs');
  nav.setAttribute('role', 'tablist');
  nav.setAttribute('aria-label', 'ReturnPoint library');
  for (const status of ['active', 'completed'] as const) {
    const count = entries.filter((entry) => entry.status === status).length;
    const item = button(`${status === 'active' ? 'Active' : 'Completed'}  ${count}`, () => { section = status; render(); }, `section-tab ${section === status ? 'selected' : ''}`);
    item.setAttribute('role', 'tab');
    item.id = `tab-${status}`;
    item.setAttribute('aria-selected', String(section === status));
    item.setAttribute('aria-controls', 'entry-list');
    nav.append(item);
  }
  app.append(nav);
  const list = element('section', 'entry-list');
  list.id = 'entry-list';
  list.setAttribute('role', 'tabpanel');
  list.setAttribute('aria-labelledby', `tab-${section}`);
  const visible = sortEntries(entries, section);
  if (!visible.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('div', 'empty-symbol', section === 'active' ? '↩' : '✓'),
      element('h2', '', section === 'active' ? 'Make room for a pause.' : 'A little reading, finished.'),
      element('p', 'helper', section === 'active'
        ? 'Save a page you’re reading. Your place and your thoughts will be here when you return.'
        : 'Mark a ReturnPoint as completed and it will live here. You can move it back anytime.'));
    list.append(empty);
  } else for (const entry of visible) list.append(entryCard(entry));
  app.append(list);
}

function entryCard(entry: ReturnPoint): HTMLElement {
  const card = element('article', 'entry-card');
  card.append(element('p', 'eyebrow', domainFor(entry.url)), element('h2', 'card-title', entry.title));
  const reading = element('div', 'reading-label');
  reading.append(element('span', '', 'Reading progress'), element('strong', '', percent(entry.progress)));
  card.append(reading, progressBar(entry.progress));
  if (entry.note) card.append(element('p', 'note-preview', entry.note));
  const meta = element('p', 'entry-meta', `Updated ${new Date(entry.updatedAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`);
  card.append(meta);
  const actions = element('div', 'card-actions');
  actions.append(button('Resume ↗', () => startResume(entry), 'button primary compact'),
    button('Edit note', () => openNoteEditor(entry), 'text-button'),
    button(entry.status === 'active' ? 'Complete' : 'Move to Active', () => changeStatus(entry), 'text-button'));
  const remove = button('Delete', () => confirmDelete(entry, card), 'text-button danger');
  remove.setAttribute('aria-label', `Delete ${entry.title}`);
  actions.append(remove);
  card.append(actions);
  return card;
}

function confirmDelete(entry: ReturnPoint, card: HTMLElement): void {
  if (card.querySelector('.delete-confirmation')) return;
  const confirmation = element('div', 'delete-confirmation');
  confirmation.setAttribute('role', 'group');
  confirmation.setAttribute('aria-label', 'Confirm deletion');
  confirmation.append(element('p', '', 'Delete this saved place and its note?'));
  const actions = element('div', 'button-row');
  actions.append(button('Delete ReturnPoint', () => void runBusy(async () => {
    await sendCommand({ type: 'delete', id: entry.id });
    entries = await readEntries();
    notify('ReturnPoint deleted.');
  }), 'button destructive compact'), button('Keep it', () => confirmation.remove(), 'button secondary compact'));
  confirmation.append(actions);
  card.append(confirmation);
  actions.querySelectorAll('button')[1]?.focus();
}

function prepareSave(): void {
  if (!tab || tabError || tab.id === undefined || !tab.url) return;
  const selected = { tabId: tab.id, url: tab.url, title: tab.title || tab.url };
  withWebsiteAccess(selected.url, async () => {
    const snapshot = await captureTab(selected.tabId, selected.url);
    editor = { kind: 'save', ...selected, snapshot, note: entries.find((entry) => entry.url === selected.url)?.note ?? '' };
    mode = 'editor';
    if (!snapshot.maxScroll) notify('This page fits on screen. Its saved position will be the top.');
  });
}

function openNoteEditor(entry: ReturnPoint): void {
  editor = { kind: 'note', entryId: entry.id, note: entry.note };
  mode = 'editor';
  notification.hidden = true;
  render();
  document.querySelector<HTMLTextAreaElement>('#note')?.focus();
}

function renderEditor(draft: Editor): void {
  app.append(button('← Back to Library', backToLibrary, 'back-button'));
  const entry = draft.kind === 'note' ? entries.find((item) => item.id === draft.entryId) : undefined;
  if (draft.kind === 'note' && !entry) {
    app.append(element('p', 'helper', 'This ReturnPoint was deleted. Go back to the library.'));
    return;
  }
  const title = draft.kind === 'save' ? draft.title : entry!.title;
  const url = draft.kind === 'save' ? draft.url : entry!.url;
  const snapshot = draft.kind === 'save' ? draft.snapshot : entry!;
  app.append(element('p', 'eyebrow view-label', draft.kind === 'save' ? 'SAVE YOUR PLACE' : 'EDIT YOUR NOTE'), pageDetails(title, url));
  const progress = element('div', 'progress-summary');
  progress.append(element('strong', '', percent(snapshot.progress)), element('span', '', 'of the page read'), progressBar(snapshot.progress));
  app.append(progress);
  const form = element('form', 'note-form');
  const label = element('label', 'field-label', 'A note for your future self');
  label.htmlFor = 'note';
  const optional = element('span', 'optional', 'Optional');
  label.append(optional);
  const textarea = element('textarea');
  textarea.id = 'note';
  textarea.name = 'note';
  textarea.rows = 6;
  textarea.maxLength = NOTE_LIMIT;
  textarea.placeholder = 'What’s on your mind? A thought, a question, a reason to come back…';
  textarea.value = draft.note;
  const hint = element('div', 'field-hint');
  const count = element('span', '', `${draft.note.length}/${NOTE_LIMIT}`);
  hint.append(element('span', '', 'Only stored on this device.'), count);
  textarea.addEventListener('input', () => { draft.note = textarea.value; count.textContent = `${draft.note.length}/${NOTE_LIMIT}`; });
  form.append(label, textarea, hint);
  const context = element('p', 'helper editor-context');
  context.id = 'editor-context';
  const submit = element('button', 'button primary full', busy ? 'Saving…' : draft.kind === 'save' ? 'Save ReturnPoint' : 'Update Note');
  submit.type = 'submit';
  submit.id = 'editor-submit';
  submit.disabled = busy;
  form.append(context, submit);
  form.addEventListener('submit', (event) => { event.preventDefault(); submitEditor(draft); });
  app.append(form);
  updateEditorContext();
}

function updateEditorContext(): void {
  if (mode !== 'editor' || !editor || editor.kind !== 'save') return;
  const matches = !tabError && tab?.id === editor.tabId && tab.url === editor.url;
  const context = document.querySelector<HTMLElement>('#editor-context');
  const submit = document.querySelector<HTMLButtonElement>('#editor-submit');
  if (context) context.textContent = matches
    ? 'Your position is captured again when you save. Saving this URL replaces its previous ReturnPoint.'
    : 'Switch back to this page to save its position, or go back and choose your current page.';
  if (submit) submit.disabled = busy || !matches;
}

function submitEditor(draft: Editor): void {
  const save = async (): Promise<void> => {
    const entry = draft.kind === 'save'
      ? await sendCommand<ReturnPoint>({ type: 'save', tabId: draft.tabId, url: draft.url, note: draft.note })
      : await sendCommand<ReturnPoint>({ type: 'edit-note', id: draft.entryId, note: draft.note });
    entries = await readEntries();
    mode = 'library';
    section = entry.status;
    editor = undefined;
    notify(draft.kind === 'save' ? `Your place is saved at ${percent(entry.progress)}.` : 'Your note is updated.');
  };
  if (draft.kind === 'save') withWebsiteAccess(draft.url, save);
  else void runBusy(save);
}

function startResume(entry: ReturnPoint): void {
  withWebsiteAccess(entry.url, async () => {
    operation = await sendCommand<ResumeOperation>({ type: 'resume', id: entry.id, windowId });
    mode = 'resume';
    await refreshOperation();
  });
}

function renderResume(resume: ResumeOperation): void {
  app.append(button('← Back to Library', backToLibrary, 'back-button'));
  const entry = entries.find((item) => item.id === resume.entryId);
  if (!entry) {
    app.append(element('p', 'helper', 'This ReturnPoint was deleted. Go back to your library.'));
    return;
  }
  app.append(element('p', 'eyebrow view-label', 'PICK UP WHERE YOU PAUSED'), pageDetails(entry.title, entry.url));
  const status = element('div', `restoration-status ${resume.stage}`);
  status.setAttribute('role', resume.stage === 'error' ? 'alert' : 'status');
  status.append(element('span', 'status-symbol', resume.stage === 'success' ? '✓' : resume.stage === 'error' ? '!' : '↩'), element('p', '', resume.message));
  app.append(status);
  const progress = element('div', 'reading-label');
  progress.append(element('span', '', 'Saved reading progress'), element('strong', '', percent(entry.progress)));
  app.append(progress, progressBar(entry.progress));
  const note = element('section', 'full-note');
  note.append(element('h3', 'field-label', 'Your note'), element('p', entry.note ? 'note-body' : 'helper', entry.note || 'No note for this page yet. Leave a thought for next time.'));
  note.append(button('Edit note', () => openNoteEditor(entry), 'text-button'));
  app.append(note);
  const matches = !!tab && !tabError && tab.url === entry.url;
  app.append(button(busy ? 'Working…' : 'Update Progress', () => withWebsiteAccess(entry.url, async () => {
    const updated = await sendCommand<ReturnPoint>({ type: 'update-position', id: entry.id, windowId });
    entries = await readEntries();
    notify(`Your reading position is updated to ${percent(updated.progress)}.`);
  }), 'button primary full', !matches || resume.stage === 'loading' || resume.stage === 'restoring'));
  app.append(element('p', 'helper update-context', matches
    ? 'Updates only when you click. Keep reading at your own pace.'
    : 'Select the tab with this exact saved URL to update its position. Your note can be edited anytime.'));
  app.append(button(entry.status === 'active' ? '✓  Mark Completed' : 'Move to Active', () => changeStatus(entry), 'button secondary full'));
  if (resume.stage === 'error') app.append(button('Resume Again ↗', () => startResume(entry), 'button secondary full retry-button'));
}

function changeStatus(entry: ReturnPoint): void {
  void runBusy(async () => {
    const status = entry.status === 'active' ? 'completed' : 'active';
    await sendCommand({ type: 'set-status', id: entry.id, status });
    entries = await readEntries();
    section = status;
    mode = 'library';
    await sendCommand({ type: 'dismiss-resume', windowId });
    notify(status === 'completed' ? 'A good place to finish. Moved to Completed.' : 'Moved back to Active.');
  });
}

function backToLibrary(): void {
  mode = 'library';
  editor = undefined;
  notification.hidden = true;
  render();
  void sendCommand({ type: 'dismiss-resume', windowId }).catch((error: unknown) => notify(errorMessage(error), true));
}

async function refreshTab(): Promise<void> {
  const sequence = ++refreshSequence;
  let selected: chrome.tabs.Tab | undefined;
  let message = '';
  try {
    selected = await currentTab(windowId);
    validateTab(selected);
    await access.check(selected.url);
  } catch (error) { message = errorMessage(error); }
  if (sequence !== refreshSequence) return;
  tab = selected;
  tabError = message;
  if (mode === 'editor') updateEditorContext();
  else render();
}

async function refreshLibrary(): Promise<void> {
  entries = await readEntries();
  await Promise.all(entries.map(async (entry) => {
    try { validatePageUrl(entry.url); await access.check(entry.url); } catch { /* Bad saved URLs remain visible and are rejected on Resume. */ }
  }));
  if (mode !== 'editor') render();
}

async function refreshOperation(): Promise<void> {
  const next = await latestOperation(windowId);
  const changed = JSON.stringify(next) !== JSON.stringify(operation);
  operation = next;
  if (changed && mode === 'resume') render();
}

async function initialize(): Promise<void> {
  const currentWindow = await chrome.windows.getCurrent();
  if (currentWindow.id === undefined || currentWindow.incognito) throw new Error('Open ReturnPoint in a regular Chrome window.');
  windowId = currentWindow.id;
  chrome.tabs.onActivated.addListener((info) => { if (info.windowId === windowId) void refreshTab().catch((error: unknown) => notify(errorMessage(error), true)); });
  chrome.tabs.onUpdated.addListener((_id, change, updated) => {
    if (updated.windowId === windowId && updated.active && (change.url || change.title || change.status === 'complete')) {
      void refreshTab().catch((error: unknown) => notify(errorMessage(error), true));
    }
  });
  chrome.tabs.onRemoved.addListener((id) => { if (tab?.id === id) void refreshTab().catch(console.error); });
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'local' && changes[LIBRARY_KEY]) void refreshLibrary().catch((error: unknown) => notify(errorMessage(error), true));
    if (area === 'session') void refreshOperation().catch((error: unknown) => notify(errorMessage(error), true));
  });
  const permissionChanged = (): void => {
    access.clear();
    void Promise.all([refreshLibrary(), refreshTab()]).catch((error: unknown) => notify(errorMessage(error), true));
  };
  chrome.permissions.onAdded.addListener(permissionChanged);
  chrome.permissions.onRemoved.addListener(permissionChanged);
  await Promise.all([refreshLibrary(), refreshTab(), refreshOperation()]);
  if (operation) mode = 'resume';
  render();
  void sendCommand({ type: 'reconcile' }).catch((error: unknown) => notify(errorMessage(error), true));
  // While the panel is open, wake/reconcile stalled operations. Loading itself is event-driven.
  // Nothing tracks scrolling and no interval runs in the service worker.
  setInterval(() => {
    if (operation && (operation.stage === 'loading' || operation.stage === 'restoring')) {
      void sendCommand({ type: 'reconcile' }).catch((error: unknown) => notify(errorMessage(error), true));
    }
  }, 5000);
}

void initialize().catch((error: unknown) => {
  app.setAttribute('aria-busy', 'false');
  app.replaceChildren(element('p', 'helper', 'Your library is still on this device. Reopen the panel to try again.'));
  notify(errorMessage(error), true);
});
