export function validatePageUrl(raw: string): URL {
  let url: URL;
  try { url = new URL(raw); } catch { throw new Error('This page has an invalid URL.'); }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('Open an HTTP or HTTPS webpage. Browser pages and local files cannot be saved.');
  }
  if (url.username || url.password) throw new Error('URLs containing login credentials cannot be saved.');
  let path: string;
  try { path = decodeURIComponent(url.pathname); } catch { path = url.pathname; }
  if (/\.pdf(?:\/)?$/i.test(path)) throw new Error('PDFs are not supported. Open an ordinary HTML webpage.');
  if (url.hostname === 'chromewebstore.google.com'
    || (url.hostname === 'chrome.google.com' && url.pathname.startsWith('/webstore'))) {
    throw new Error('Chrome protects the Web Store from extensions. Open another webpage.');
  }
  return url;
}

export function hostPermissionFor(raw: string): string {
  const url = validatePageUrl(raw);
  // Chrome host permissions cover a scheme and host (all ports), including localhost.
  return `${url.protocol}//${url.hostname}/*`;
}

export function domainFor(raw: string): string {
  try { return new URL(raw).host.replace(/^www\./, ''); } catch { return 'Invalid URL'; }
}
