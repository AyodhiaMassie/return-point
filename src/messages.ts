import type { EntryStatus, ReturnPoint } from './models';
import type { ResumeOperation } from './resume';

export type Command =
  | { type: 'save'; tabId: number; url: string; note: string }
  | { type: 'edit-note'; id: string; note: string }
  | { type: 'update-position'; id: string; windowId: number }
  | { type: 'set-status'; id: string; status: EntryStatus }
  | { type: 'delete'; id: string }
  | { type: 'resume'; id: string; windowId: number }
  | { type: 'reconcile' }
  | { type: 'dismiss-resume'; windowId: number };

export type CommandResult = ReturnPoint | ResumeOperation | null;
export type Response = { ok: true; data: CommandResult } | { ok: false; error: string };

export async function sendCommand<T extends CommandResult = CommandResult>(command: Command): Promise<T> {
  let response: Response;
  try { response = await chrome.runtime.sendMessage(command) as Response; }
  catch { throw new Error('ReturnPoint’s background worker is unavailable. Reopen the panel and try again.'); }
  if (!response || !response.ok) {
    throw new Error(response && !response.ok ? response.error : 'The extension did not respond. Try again.');
  }
  return response.data as T;
}
