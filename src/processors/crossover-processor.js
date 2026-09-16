/**
 * Linkwitz-Riley 4th-Order Crossover AudioWorkletProcessor
 *
 * Splits audio into low band (0–crossoverFreq) and high band (crossoverFreq–Nyquist).
 * LR-4 = two cascaded 2nd-order Butterworth sections. Low + high sums to flat.
 */

class CrossoverProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._initialized = false;
    this._channels = 0;
    this._crossoverFreq = 150;

    // Butterworth LP coefficients (set during INIT)
    this._lpB = null;
    this._lpA = null;

    // Per-channel filter state for two cascaded stages
    // Stage 1 state, stage 2 state, per channel
    this._s1 = null; // [channels][2] — Direct Form II Transposed state
    this._s2 = null;

    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    if (msg.type === 'INIT') {
      this._crossoverFreq = msg.crossoverFreq || 150;
      this._channels = msg.channels || 2;
      this._initFilter(this._crossoverFreq);
      this._initialized = true;
      this.port.postMessage({ type: 'INIT_OK' });
    } else if (msg.type === 'SET_CROSSOVER') {
      if (msg.freq != null && msg.freq > 0 && msg.freq < sampleRate / 2) {
        this._crossoverFreq = msg.freq;
        this._initFilter(this._crossoverFreq);
        this.port.postMessage({ type: 'CROSSOVER_UPDATED', freq: this._crossoverFreq });
      }
    }
  }

  _initFilter(crossoverFreq) {
    const coeffs = computeButterworthLP(crossoverFreq, sampleRate);
    this._lpB = coeffs.b;
    this._lpA = coeffs.a;

    // Pre-allocate state buffers: 2 stages × 2 channels × 2 state taps
    this._s1 = new Array(this._channels);
    this._s2 = new Array(this._channels);
    for (let ch = 0; ch < this._channels; ch++) {
      this._s1[ch] = new Float64Array(2);
      this._s2[ch] = new Float64Array(2);
    }
  }

  process(inputs, outputs, parameters) {
    if (!this._initialized) return true;

    const input = inputs[0];
    const outLow = outputs[0];
    const outHigh = outputs[1];

    if (!input || !outLow || !outHigh) return true;

    const chCount = Math.min(input.length, this._channels, outLow.length, outHigh.length);
    const len = input[0] ? input[0].length : 0;

    const b0 = this._lpB[0];
    const b1 = this._lpB[1];
    const b2 = this._lpB[2];
    const a1 = this._lpA[1];
    const a2 = this._lpA[2];

    for (let ch = 0; ch < chCount; ch++) {
      const src = input[ch];
      const dstLow = outLow[ch];
      const dstHigh = outHigh[ch];
      if (!src || !dstLow || !dstHigh) continue;

      const s1 = this._s1[ch];
      const s2 = this._s2[ch];

      for (let i = 0; i < len; i++) {
        const x = src[i];

        // Stage 1: Direct Form II Transposed
        const w1 = x - a1 * s1[0] - a2 * s1[1];
        const lp1 = b0 * w1 + b1 * s1[0] + b2 * s1[1];
        s1[1] = s1[0];
        s1[0] = w1;

        // Stage 2: cascade
        const w2 = lp1 - a1 * s2[0] - a2 * s2[1];
        const lp = b0 * w2 + b1 * s2[0] + b2 * s2[1];
        s2[1] = s2[0];
        s2[0] = w2;

        dstLow[i] = lp;
        dstHigh[i] = x - lp; // complementary high pass
      }
    }

    return true;
  }
}

/**
 * Compute 2nd-order Butterworth lowpass coefficients via bilinear transform.
 * @param {number} cutoffFreq - Cutoff frequency in Hz
 * @param {number} sr - Sample rate in Hz
 * @returns {{ b: number[], a: number[] }}
 */
function computeButterworthLP(cutoffFreq, sr) {
  const wc = Math.tan(Math.PI * cutoffFreq / sr);
  const sqrt2 = Math.SQRT2;
  const k = 1 / (1 + sqrt2 * wc + wc * wc);

  return {
    b: [k, 2 * k, k],
    a: [1, 2 * (wc * wc - 1) * k, (1 - sqrt2 * wc + wc * wc) * k],
  };
}

registerProcessor('crossover', CrossoverProcessor);
