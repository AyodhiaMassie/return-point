import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { captureDocumentPosition, restoreDocumentPosition } from '../src/page-scripts';

describe('injected document scripts', () => {
  let root: { scrollHeight: number };
  let pageWindow: { innerHeight: number; scrollY: number; scrollTo: ReturnType<typeof vi.fn> };
  beforeEach(() => {
    vi.useFakeTimers();
    root = { scrollHeight: 2000 };
    pageWindow = { innerHeight: 1000, scrollY: 500, scrollTo: vi.fn(({ top }: { top: number }) => { pageWindow.scrollY = Math.min(top, Math.max(0, root.scrollHeight - pageWindow.innerHeight)); }) };
    vi.stubGlobal('window', pageWindow);
    vi.stubGlobal('location', { href: 'https://example.com/article' });
    vi.stubGlobal('document', { contentType: 'text/html', scrollingElement: root, documentElement: root });
  });
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

  it('captures scroll pixels, scrollable height, and ratio', () => {
    expect(captureDocumentPosition('https://example.com/article')).toEqual({ scrollY: 500, maxScroll: 1000, progress: .5 });
  });
  it('clamps overscroll and accepts a short HTML page', () => {
    pageWindow.scrollY = -50;
    expect(captureDocumentPosition('https://example.com/article').progress).toBe(0);
    root.scrollHeight = 500;
    expect(captureDocumentPosition('https://example.com/article')).toEqual({ scrollY: 0, maxScroll: 0, progress: 0 });
  });
  it('rejects a PDF whose URL does not end in .pdf', () => {
    vi.stubGlobal('document', { contentType: 'application/pdf', scrollingElement: root, documentElement: root });
    expect(() => captureDocumentPosition('https://example.com/article')).toThrow('Only HTML');
  });
  it('detects a changed page before capturing', () => {
    expect(() => captureDocumentPosition('https://example.com/other')).toThrow('page changed');
  });
  it('restores proportionally and waits for stable geometry', async () => {
    root.scrollHeight = 3000;
    const result = restoreDocumentPosition(.5, location.href);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ success: true, scrollY: 1000, attempts: 3 });
    expect(pageWindow.scrollTo).toHaveBeenCalledWith({ top: 1000, left: 0, behavior: 'instant' });
  });
  it('recalculates the target when the layout grows', async () => {
    setTimeout(() => { root.scrollHeight = 4000; }, 100);
    const result = restoreDocumentPosition(.5, location.href);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ success: true, scrollY: 1500 });
  });
  it('restores zero progress on a non-scrollable page successfully', async () => {
    root.scrollHeight = 500;
    const result = restoreDocumentPosition(0, location.href);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ success: true, scrollY: 0 });
    expect((await result).message).toContain('short page');
  });
  it('bounds retries and reports failure for a page that cannot scroll', async () => {
    root.scrollHeight = 500;
    const result = restoreDocumentPosition(.8, location.href);
    await vi.runAllTimersAsync();
    expect(await result).toMatchObject({ success: false, attempts: 6 });
    expect(pageWindow.scrollTo).toHaveBeenCalledTimes(6);
  });
  it('reports failure when the page prevents scrolling', async () => {
    pageWindow.scrollY = 0;
    pageWindow.scrollTo.mockImplementation(() => undefined);
    const result = restoreDocumentPosition(.5, location.href);
    await vi.runAllTimersAsync();
    expect((await result).success).toBe(false);
  });
});
