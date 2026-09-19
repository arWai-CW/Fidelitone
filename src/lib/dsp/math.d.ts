export interface ButterworthCoefficients {
  lpB: number[];
  hpB: number[];
  a: number[];
}

export function computeButterworth(cutoffFreq: number, sr: number): ButterworthCoefficients;
export function cubicInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number;
export function semitonesToPitchScale(semitones: number): number;
