import { beforeEach, describe, expect, it } from 'vitest';
import { hostPermissionFor, validatePageUrl } from '../src/urls';
import { captureTab, WebsiteAccess } from '../src/chrome-api';
import { createChromeMock } from './chrome-mock';

describe('URLs and website access', () => {
  let mock: ReturnType<typeof createChromeMock>;
  beforeEach(() => { mock = createChromeMock(); });
  it.each(['chrome://settings', 'file:///test.html', 'about:blank', 'data:text/html,hello', 'javascript:alert(1)', 'broken'])('rejects %s', (url) => {
    expect(() => validatePageUrl(url)).toThrow();
  });
  it.each(['https://example.com/book.pdf?download=1', 'https://example.com/book.PDF#page=3', 'https://example.com/book%2Epdf'])('rejects PDF URLs %s', (url) => {
    expect(() => validatePageUrl(url)).toThrow('PDF');
  });
  it('rejects credentials and the protected Chrome Web Store', () => {
    expect(() => validatePageUrl('https://user:password@example.com')).toThrow('credentials');
    expect(() => validatePageUrl('https://chromewebstore.google.com/detail/anything')).toThrow('protects');
  });
  it('requests only the website scheme and host and supports localhost ports', () => {
    expect(hostPermissionFor('https://www.example.com/article?a=b')).toBe('https://www.example.com/*');
    expect(hostPermissionFor('http://localhost:5173/demo/')).toBe('http://localhost/*');
  });
  it('uses a pre-checked grant without requesting again', async () => {
    const access = new WebsiteAccess();
    await access.check('https://example.com/one');
    expect(await access.requestFromClick('https://example.com/two')).toBe(true);
    expect(mock.api.permissions.contains).toHaveBeenCalled();
    expect(mock.api.permissions.request).not.toHaveBeenCalled();
  });
  it('calls request synchronously before its returned promise is awaited', async () => {
    const access = new WebsiteAccess();
    mock.api.permissions.contains.mockResolvedValue(false);
    await access.check('https://example.com');
    const request = access.requestFromClick('https://example.com');
    expect(mock.api.permissions.request).toHaveBeenCalledWith({ origins: ['https://example.com/*'] });
    expect(await request).toBe(true);
  });
  it('handles denied and revoked permission', async () => {
    const access = new WebsiteAccess();
    await access.check('https://example.com');
    access.clear();
    mock.api.permissions.request.mockResolvedValue(false);
    expect(await access.requestFromClick('https://example.com')).toBe(false);
  });
  it('rejects incognito and unavailable tabs before injection', async () => {
    mock.tabs.set(1, { id: 1, incognito: true, url: 'https://example.com' } as chrome.tabs.Tab);
    await expect(captureTab(1, 'https://example.com')).rejects.toThrow('incognito');
    await expect(captureTab(2, 'https://example.com')).rejects.toThrow('No tab');
    expect(mock.api.scripting.executeScript).not.toHaveBeenCalled();
  });
  it('rejects navigation changes and revoked access', async () => {
    mock.tabs.set(1, { id: 1, incognito: false, url: 'https://example.com/new' } as chrome.tabs.Tab);
    await expect(captureTab(1, 'https://example.com/old')).rejects.toThrow('changed');
    mock.api.permissions.contains.mockResolvedValue(false);
    await expect(captureTab(1, 'https://example.com/new')).rejects.toThrow('revoked');
  });
  it('reports failed script injection', async () => {
    mock.tabs.set(1, { id: 1, incognito: false, url: 'https://example.com' } as chrome.tabs.Tab);
    mock.api.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access this page'));
    await expect(captureTab(1, 'https://example.com')).rejects.toThrow('Could not read this page');
  });
});
