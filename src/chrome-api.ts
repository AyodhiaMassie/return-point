import type { ScrollSnapshot } from './models';
import { captureDocumentPosition, restoreDocumentPosition, type RestorationResult } from './page-scripts';
import { hostPermissionFor, validatePageUrl } from './urls';

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.';
}

export function validateTab(tab: chrome.tabs.Tab): asserts tab is chrome.tabs.Tab & { id: number; url: string } {
  if (tab.incognito) throw new Error('ReturnPoint does not save pages from incognito windows.');
  if (tab.id === undefined || !tab.url) throw new Error('This tab is unavailable. Select a webpage and try again.');
  validatePageUrl(tab.url);
}

export async function currentTab(windowId: number): Promise<chrome.tabs.Tab> {
  const [tab] = await chrome.tabs.query({ active: true, windowId });
  if (!tab) throw new Error('No active tab is available in this window.');
  return tab;
}

export async function requireHostAccess(url: string): Promise<void> {
  if (!await chrome.permissions.contains({ origins: [hostPermissionFor(url)] })) {
    throw new Error('Website access is missing or was revoked. Click Save or Resume and allow access to this website.');
  }
}

export async function captureTab(tabId: number, expectedUrl: string): Promise<ScrollSnapshot> {
  const tab = await chrome.tabs.get(tabId);
  validateTab(tab);
  if (tab.url !== expectedUrl) throw new Error('The active page changed. Select the saved page and try again.');
  await requireHostAccess(expectedUrl);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId }, func: captureDocumentPosition, args: [expectedUrl],
    });
    if (!injection?.result) throw new Error('The page did not provide a reading position.');
    return injection.result;
  } catch (error) {
    throw new Error(`Could not read this page. ${errorMessage(error)}`);
  }
}

export async function restoreTab(tab: chrome.tabs.Tab, progress: number): Promise<RestorationResult> {
  validateTab(tab);
  await requireHostAccess(tab.url);
  try {
    const [injection] = await chrome.scripting.executeScript({
      target: { tabId: tab.id }, func: restoreDocumentPosition, args: [progress, tab.url],
    });
    if (!injection?.result) throw new Error('The page did not return a restoration result.');
    return injection.result;
  } catch (error) {
    throw new Error(`Could not restore this page. ${errorMessage(error)}`);
  }
}

export class WebsiteAccess {
  private granted = new Map<string, boolean>();

  async check(url: string): Promise<boolean> {
    const pattern = hostPermissionFor(url);
    const allowed = await chrome.permissions.contains({ origins: [pattern] });
    this.granted.set(pattern, allowed);
    return allowed;
  }

  clear(): void { this.granted.clear(); }

  // Called synchronously in the button handler. No tab/storage await can consume the gesture.
  requestFromClick(url: string): Promise<boolean> {
    const pattern = hostPermissionFor(url);
    if (this.granted.get(pattern)) return Promise.resolve(true);
    return chrome.permissions.request({ origins: [pattern] }).then((allowed) => {
      this.granted.set(pattern, allowed);
      return allowed;
    });
  }
}
