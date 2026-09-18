/**
 * Linkwitz-Riley 4th-order crossover AudioWorkletProcessor.
 *
 * The low band is two cascaded Butterworth low-pass sections. The high band is
 * two cascaded Butterworth high-pass sections, so both bands have matching
 * phase behaviour around the crossover frequency and sum cleanly on recombine.
 */

class CrossoverProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    this._initialized = false;
    this._channels = 2;
    this._crossoverFreq = 175;
    this._lpB = null;
    this._lpA = null;
    this._hpB = null;
    this._hpA = null;
    this._lpS1 = null;
    this._lpS2 = null;
    this._hpS1 = null;
    this._hpS2 = null;
    this.port.onmessage = (e) => this._handleMessage(e.data);
  }

  _handleMessage(msg) {
    if (msg.type === 'INIT') {
      this._crossoverFreq = msg.crossoverFreq || 175;
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
    } else if (msg.type === 'RESET') {
      this._resetStates();
      this.port.postMessage({ type: 'RESET_OK', ok: true });
    }
  }

  _initFilter(crossoverFreq) {
    const coeffs = computeButterworth(crossoverFreq, sampleRate);
    this._lpB = coeffs.lpB;
    this._lpA = coeffs.a;
    this._hpB = coeffs.hpB;
    this._hpA = coeffs.a;
    this._resetStates();
  }

  _resetStates() {
    this._lpS1 = this._makeStates();
    this._lpS2 = this._makeStates();
    this._hpS1 = this._makeStates();
    this._hpS2 = this._makeStates();
  }

  _makeStates() {
    const states = new Array(this._channels);
    for (let ch = 0; ch < this._channels; ch++) {
      states[ch] = new Float64Array(2);
    }
    return states;
  }

  process(inputs, outputs) {
    if (!this._initialized) return true;

    const input = inputs[0];
    const outLow = outputs[0];
    const outHigh = outputs[1];

    if (!input || !outLow || !outHigh) return true;

    const chCount = Math.min(input.length, this._channels, outLow.length, outHigh.length);
    const len = input[0] ? input[0].length : 0;
    if (!len) return true;

    const lpB = this._lpB;
    const lpA = this._lpA;
    const hpB = this._hpB;
    const hpA = this._hpA;

    for (let ch = 0; ch < chCount; ch++) {
      const src = input[ch] || input[0] || new Float32Array(len);
      const dstLow = outLow[ch];
      const dstHigh = outHigh[ch];
      if (!dstLow || !dstHigh) continue;

      const lpS1 = this._lpS1[ch];
      const lpS2 = this._lpS2[ch];
      const hpS1 = this._hpS1[ch];
      const hpS2 = this._hpS2[ch];

      for (let i = 0; i < len; i++) {
        const x = src[i];

        // First low-pass section (Direct Form II Transposed).
        let w = x - lpA[1] * lpS1[0] - lpA[2] * lpS1[1];
        let lp = lpB[0] * w + lpB[1] * lpS1[0] + lpB[2] * lpS1[1];
        lpS1[1] = lpS1[0];
        lpS1[0] = w;

        // Second low-pass section.
        w = lp - lpA[1] * lpS2[0] - lpA[2] * lpS2[1];
        lp = lpB[0] * w + lpB[1] * lpS2[0] + lpB[2] * lpS2[1];
        lpS2[1] = lpS2[0];
        lpS2[0] = w;

        // First high-pass section.
        w = x - hpA[1] * hpS1[0] - hpA[2] * hpS1[1];
        let hp = hpB[0] * w + hpB[1] * hpS1[0] + hpB[2] * hpS1[1];
        hpS1[1] = hpS1[0];
        hpS1[0] = w;

        // Second high-pass section.
        w = hp - hpA[1] * hpS2[0] - hpA[2] * hpS2[1];
        hp = hpB[0] * w + hpB[1] * hpS2[0] + hpB[2] * hpS2[1];
        hpS2[1] = hpS2[0];
        hpS2[0] = w;

        dstLow[i] = lp;
        dstHigh[i] = hp;
      }
    }

    return true;
  }
}

/**
 * Compute matched 2nd-order Butterworth low/high-pass coefficients.
 * Cascading each section twice produces a Linkwitz-Riley 4th-order crossover.
 */
function computeButterworth(cutoffFreq, sr) {
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

registerProcessor('crossover', CrossoverProcessor);
