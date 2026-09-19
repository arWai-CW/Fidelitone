export function computeButterworth(cutoffFreq, sr) {
  const wc = Math.tan(Math.PI * cutoffFreq / sr);
  const wc2 = wc * wc;
  const sqrt2 = Math.SQRT2;
  const norm = 1 / (1 + sqrt2 * wc + wc2);

  const a = [1, 2 * (wc2 - 1) * norm, (1 - sqrt2 * wc + wc2) * norm];
  return {
    lpB: [wc2 * norm, 2 * wc2 * norm, wc2 * norm],
    hpB: [norm, -2 * norm, norm],
    a,
  };
}

export function cubicInterpolate(p0, p1, p2, p3, t) {
  const t2 = t * t;
  const t3 = t2 * t;
  return 0.5 * (
    (2 * p1) +
    (-p0 + p2) * t +
    (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
    (-p0 + 3 * p1 - 3 * p2 + p3) * t3
  );
}

export function semitonesToPitchScale(semitones) {
  return 2 ** (semitones / 12);
}
