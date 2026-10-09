export function maximumScroll(documentHeight: number, viewportHeight: number): number {
  if (!Number.isFinite(documentHeight) || !Number.isFinite(viewportHeight)) return 0;
  return Math.max(0, documentHeight - Math.max(0, viewportHeight));
}

export function scrollProgress(scrollY: number, maxScroll: number): number {
  if (!Number.isFinite(scrollY) || !Number.isFinite(maxScroll) || maxScroll <= 0) return 0;
  return Math.min(1, Math.max(0, scrollY / maxScroll));
}

export function restorationTarget(progress: number, maxScroll: number): number {
  if (!Number.isFinite(progress) || !Number.isFinite(maxScroll)) return 0;
  return Math.round(Math.min(1, Math.max(0, progress)) * Math.max(0, maxScroll));
}
