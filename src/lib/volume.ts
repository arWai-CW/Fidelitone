// Pure helpers for the YouTube page-volume control (ADR-0005, revised by
// ADR-0006). Volume is the UI-facing 0–100 scale (YouTube's own slider range).
// No chrome.* here: the maths must be unit-testable on its own.

/** UI range for the page volume; matches the numeric input and YouTube. */
export const VOLUME_MIN = 0;
export const VOLUME_MAX = 100;

/**
 * Clamps to 0–100. A non-finite value clamps to silence: an unusable number
 * must never end up blasting audio at full scale.
 */
export function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return VOLUME_MIN;
  return Math.min(VOLUME_MAX, Math.max(VOLUME_MIN, value));
}

/**
 * Signed percentage of `current` relative to `base`, rounded — the panel's
 * deviation language since ADR-0006 dropped dB (a percentage is what users
 * read off the slider, so it is what the panel says). A base of 0 has no
 * relative scale to compare against, so it reports 0; callers surface that
 * state separately.
 */
export function volumeDeltaPercent(current: number, base: number): number {
  if (!Number.isFinite(current) || !Number.isFinite(base) || base <= VOLUME_MIN) return 0;
  const from = clampVolume(base);
  const to = clampVolume(current);
  if (from <= VOLUME_MIN) return 0;
  return Math.round(((to - from) / from) * 100);
}

/**
 * Interpolates a volume change for a timed ramp. dB-linear (equal dB steps per
 * unit time) so the change reads at a constant perceived speed; silence has no
 * logarithmic path, so a leg ending at 0 falls back to linear.
 */
export function rampVolume(from: number, to: number, progress: number): number {
  const start = clampVolume(from);
  const end = clampVolume(to);
  const t = Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : 1;
  if (t >= 1) return end;
  if (t <= 0) return start;
  if (start <= VOLUME_MIN || end <= VOLUME_MIN) return start + (end - start) * t;
  return start * (end / start) ** t;
}
