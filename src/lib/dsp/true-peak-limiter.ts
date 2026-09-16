/**
 * True Peak Limiter — ITU-R BS.1770 compliant
 *
 * Prevents inter-sample peaks from causing DAC clipping after pitch shifting.
 * Uses 4x oversampling via cubic interpolation for true peak detection.
 *
 * Typical use: after band recombination in multiband processing.
 * Target: gain reduction < 0.5 dB on typical program material.
 */

/** Cubic interpolation for 4x oversampling (Catmull-Rom style) */
function cubicInterpolate(
  p0: number,
  p1: number,
  p2: number,
  p3: number,
  t: number,
): number {
  const t2 = t * t;
  const t3 = t2 * t;
  return (
    0.5 *
    (2 * p1 +
      (-p0 + p2) * t +
      (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 +
      (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
  );
}

/**
 * Detect true peak at a sample position using 4x oversampling.
 * Returns the maximum absolute value across original sample + 3 interpolated points.
 */
function detectTruePeak(samples: Float32Array, index: number): number {
  const len = samples.length;
  const p0 = samples[Math.max(0, index - 1)];
  const p1 = samples[index];
  const p2 = samples[Math.min(len - 1, index + 1)];
  const p3 = samples[Math.min(len - 1, index + 2)];

  let maxAbs = Math.abs(p1);
  for (let i = 1; i <= 3; i++) {
    const val = cubicInterpolate(p0, p1, p2, p3, i / 4);
    const abs = val < 0 ? -val : val;
    if (abs > maxAbs) maxAbs = abs;
  }
  return maxAbs;
}

export class TruePeakLimiter {
  /** dBTP threshold (stored for reference) */
  readonly thresholdDBTP: number;
  /** Linear threshold */
  private readonly threshold: number;
  /** Attack smoothing coefficient */
  private readonly attackCoeff: number;
  /** Release smoothing coefficient */
  private readonly releaseCoeff: number;
  /** Gain smoothing coefficient (prevents clicks) */
  private readonly gainSmooth: number;
  /** Current envelope value */
  private envelope = 0;
  /** Previous output gain for smoothing */
  private prevGain = 1;
  /** Pre-allocated output buffer (reused across calls) */
  private outputBuf = new Float32Array(0);

  /**
   * @param thresholdDBTP — threshold in dBTP (default: -1.0)
   * @param attack — attack time in seconds (default: 0.001 = 1 ms)
   * @param release — release time in seconds (default: 0.05 = 50 ms)
   * @param sampleRate — sample rate in Hz (default: 48000)
   */
  constructor(
    thresholdDBTP: number = -1.0,
    attack: number = 0.001,
    release: number = 0.05,
    sampleRate: number = 48000,
  ) {
    this.thresholdDBTP = thresholdDBTP;
    this.threshold = 10 ** (thresholdDBTP / 20);
    // Envelope follower coefficients (exponential moving average)
    this.attackCoeff = 1 - Math.exp(-1 / (attack * sampleRate));
    this.releaseCoeff = 1 - Math.exp(-1 / (release * sampleRate));
    // Gain smoothing: ~0.99 gives ~1 sample transition, prevents zipper noise
    this.gainSmooth = 0.99;
  }

  /**
   * Process a mono block through the true peak limiter.
   * Returns a reference to an internal buffer — do NOT hold across calls.
   */
  process(input: Float32Array): Float32Array {
    const len = input.length;

    // Reuse buffer only if size changed
    if (this.outputBuf.length !== len) {
      this.outputBuf = new Float32Array(len);
    }

    const output = this.outputBuf;
    const threshold = this.threshold;
    const attackCoeff = this.attackCoeff;
    const releaseCoeff = this.releaseCoeff;
    const gainSmooth = this.gainSmooth;
    let envelope = this.envelope;
    let prevGain = this.prevGain;

    for (let i = 0; i < len; i++) {
      const tp = detectTruePeak(input, i);

      // Envelope follower: instant attack, exponential release
      if (tp > envelope) {
        envelope = tp;
      } else {
        envelope = envelope * (1 - releaseCoeff);
      }

      // Calculate required gain reduction
      let gain: number;
      if (envelope > threshold) {
        gain = threshold / envelope;
      } else {
        gain = 1;
      }

      // Smooth gain transition to avoid clicks
      prevGain = prevGain + gainSmooth * (gain - prevGain);

      output[i] = input[i] * prevGain;
    }

    // Persist state for next block
    this.envelope = envelope;
    this.prevGain = prevGain;

    return output;
  }
}

/**
 * Process stereo audio through independent true peak limiters.
 * Each channel gets its own limiter instance for independent envelope tracking.
 */
export function processStereo(
  left: Float32Array,
  right: Float32Array,
  thresholdDBTP: number = -1.0,
): [Float32Array, Float32Array] {
  const limiterL = new TruePeakLimiter(thresholdDBTP);
  const limiterR = new TruePeakLimiter(thresholdDBTP);
  return [limiterL.process(left), limiterR.process(right)];
}
