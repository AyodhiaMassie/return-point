import type { ScrollSnapshot } from './models';

export interface RestorationResult { success: boolean; message: string; scrollY: number; attempts: number }

// These functions are serialized by Chrome. Keep them self-contained: no imported runtime helpers.
export function captureDocumentPosition(expectedUrl: string): ScrollSnapshot {
  if (location.href !== expectedUrl) throw new Error('The page changed. Refresh its details and save again.');
  if (!['text/html', 'application/xhtml+xml'].includes(document.contentType)) {
    throw new Error('Only HTML webpages are supported. PDFs and other documents cannot be saved.');
  }
  const root = document.scrollingElement ?? document.documentElement;
  const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
  const scrollY = Math.min(maxScroll, Math.max(0, window.scrollY));
  return { scrollY, maxScroll, progress: maxScroll > 0 ? Math.min(1, scrollY / maxScroll) : 0 };
}

export async function restoreDocumentPosition(progress: number, expectedUrl: string): Promise<RestorationResult> {
  if (location.href !== expectedUrl) throw new Error('The page navigated away before its position could be restored.');
  if (!['text/html', 'application/xhtml+xml'].includes(document.contentType)) {
    throw new Error('This URL opened a PDF or another unsupported document.');
  }
  const ratio = Math.min(1, Math.max(0, progress));
  let previousHeight = -1;
  let stableHits = 0;
  // Load completion is handled by tab events; these bounded retries only settle document layout.
  for (let attempt = 1; attempt <= 6; attempt++) {
    if (location.href !== expectedUrl) throw new Error('The page changed during restoration.');
    const root = document.scrollingElement ?? document.documentElement;
    const maxScroll = Math.max(0, root.scrollHeight - window.innerHeight);
    const target = Math.round(maxScroll * ratio);
    window.scrollTo({ top: target, left: 0, behavior: 'instant' });
    await new Promise<void>((resolve) => setTimeout(resolve, 200));
    const currentMax = Math.max(0, root.scrollHeight - window.innerHeight);
    const reached = Math.abs(window.scrollY - Math.round(currentMax * ratio)) <= 8;
    const usable = ratio === 0 || currentMax > 0;
    stableHits = usable && reached && Math.abs(currentMax - previousHeight) <= 8 ? stableHits + 1 : 0;
    previousHeight = currentMax;
    if (stableHits >= 2) {
      return { success: true, scrollY: window.scrollY, attempts: attempt,
        message: currentMax === 0 ? 'This short page fits on screen. You are at the top.' : 'You’re back where you left off.' };
    }
  }
  return { success: false, scrollY: window.scrollY, attempts: 6,
    message: 'The page did not settle at your saved position. It may be too short, still changing, or use a separate scroll area. Try Resume again after checking the page.' };
}
