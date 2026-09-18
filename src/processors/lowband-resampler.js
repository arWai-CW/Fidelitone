/**
 * LowbandResampler — bounded time-domain pitch shifting for the low-frequency band.
 *
 * The low band stays out of the STFT phase vocoder. A fractional read cursor
 * provides the positive rate semantics from ADR 0002, while period-synchronous
 * timeline corrections keep a live stream bounded at rates below and above 1.
 * The processor therefore behaves like a small phase-locked WSOLA/PSOLA stage:
 * it repeats or skips whole estimated lowband periods instead of wrapping into
 * stale ring-buffer samples.
 *
 * Message protocol:
 *   INIT { channels, pitchScale, sampleRate } → INIT_OK
 *   SET_PITCH { pitchScale } → SET_PITCH_OK
 *   RESET → RESET_OK
 */

const FRAME_HOP = 128;
const PREBUFFER_SAMPLES = 256;
const MAX_INPUT_BUFFER = 262144;
const MIN_RATE = 0.5;
const MAX_RATE = 2.0;
const CUBIC_PADDING = 2;
const FADE_IN_SAMPLES = 128;
const LONG_INPUT_GAP_BLOCKS = 16;
const PERIOD_SEARCH_WINDOW = 128;
const PERIOD_SEARCH_STEP = 8;
const PERIOD_MIN_FREQ = 300;
const PERIOD_MAX_FREQ = 25;
const TIMELINE_MARGIN = 4096;
const RATE_SMOOTHING = 0.18;

function clamp(value, min, max) {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
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

class InputRing {
  constructor(size) {
    this.buffer = new Float32Array(size);
    this.writeIndex = 0;
    this.oldestIndex = 0;
  }

  get count() {
    return this.writeIndex - this.oldestIndex;
  }

  append(samples) {
    const length = Math.min(samples?.length || 0, this.buffer.length);
    if (!length) return;

    const overflow = this.count + length - this.buffer.length;
    if (overflow > 0) this.oldestIndex += overflow;

    for (let i = 0; i < length; i++) {
      const sample = samples[i];
      this.buffer[this.writeIndex % this.buffer.length] =
        Number.isFinite(sample) ? sample : 0;
      this.writeIndex += 1;
    }
  }

  sampleAt(position) {
    const index = Math.floor(position);
    const fraction = position - index;
    return cubicInterpolate(
      this.sampleInteger(index - 1),
      this.sampleInteger(index),
      this.sampleInteger(index + 1),
      this.sampleInteger(index + 2),
      fraction,
    );
  }

  safeSampleAt(position) {
    return this.canRead(position, 1) ? this.sampleAt(position) : 0;
  }

  sampleInteger(position) {
    const offset =
      ((position % this.buffer.length) + this.buffer.length) %
      this.buffer.length;
    return this.buffer[offset];
  }

  canRead(position, length) {
    return position >= this.oldestIndex + CUBIC_PADDING &&
      position + length <= this.writeIndex - CUBIC_PADDING;
  }

  trimBefore(readPosition) {
    const capacityOldest = this.writeIndex - this.buffer.length;
    const readSafeOldest = Math.floor(
      readPosition - CUBIC_PADDING - TIMELINE_MARGIN,
    );
    const latestSafeOldest = Math.floor(
      readPosition - CUBIC_PADDING - 1,
    );
    const nextOldest = Math.max(
      capacityOldest,
      this.oldestIndex,
      readSafeOldest,
    );
    this.oldestIndex = Math.max(
      this.oldestIndex,
      Math.min(nextOldest, latestSafeOldest),
    );
  }
}

class ChannelState {
  constructor() {
    this.input = new InputRing(MAX_INPUT_BUFFER);
  }

  reset() {
    this.input.writeIndex = 0;
    this.input.oldestIndex = 0;
    this.input.buffer.fill(0);
  }
}

const ProcessorBase =
  typeof AudioWorkletProcessor !== 'undefined' ? AudioWorkletProcessor : class {};

export class LowbandResampler extends ProcessorBase {
  constructor() {
    super();
    this._sampleRate = 48000;
    this._channels = 2;
    this._targetRate = 1.0;
    this._currentRate = 1.0;
    this._readPos = 0;
    this._primed = false;
    this._outputGain = 0;
    this._missingInputBlocks = 0;
    this._periodSamples = Math.round(this._sampleRate / 100);
    this._periodAge = 0;
    this._jumpFrom = 0;
    this._jumpTo = 0;
    this._jumpRemaining = 0;
    this._channelStates = [];
    this._makeChannels(this._channels);
    if (this.port) {
      this.port.onmessage = (e) => this._handleMessage(e.data);
    }
  }

  _makeChannels(channels) {
    this._channelStates = [];
    for (let ch = 0; ch < channels; ch++) {
      this._channelStates.push(new ChannelState());
    }
  }

  _setRate(value) {
    this._targetRate = clamp(value, MIN_RATE, MAX_RATE);
  }

  _handleMessage(data) {
    if (data.type === 'INIT') {
      const channels = Number.isFinite(data.channels)
        ? Math.round(data.channels)
        : 2;
      this._channels = clamp(channels, 1, 8);
      if (Number.isFinite(data.sampleRate) && data.sampleRate > 0) {
        this._sampleRate = data.sampleRate;
      }
      this._periodSamples = Math.round(this._sampleRate / 100);
      this._setRate(data.pitchScale);
      this._currentRate = this._targetRate;
      this._makeChannels(this._channels);
      this._resetGraph();
      if (this.port) this.port.postMessage({ type: 'INIT_OK' });
    } else if (data.type === 'SET_PITCH') {
      this._setRate(data.pitchScale);
      if (this.port) this.port.postMessage({ type: 'SET_PITCH_OK' });
    } else if (data.type === 'RESET') {
      this._resetGraph();
      if (this.port) this.port.postMessage({ type: 'RESET_OK' });
    }
  }

  _resetGraph() {
    this._readPos = 0;
    this._primed = false;
    this._outputGain = 0;
    this._missingInputBlocks = 0;
    this._jumpFrom = 0;
    this._jumpTo = 0;
    this._jumpRemaining = 0;
    this._periodAge = 0;
    for (const state of this._channelStates) state.reset();
  }

  _inputChannels(inputs) {
    return inputs?.[0] || [];
  }

  _hasInput(inputs, frameCount) {
    const channels = this._inputChannels(inputs);
    return channels.some((channel) => channel?.length >= frameCount);
  }

  _appendInput(inputs, frameCount) {
    const channels = this._inputChannels(inputs);
    for (let ch = 0; ch < this._channels; ch++) {
      const source = channels[ch]?.length >= frameCount
        ? channels[ch]
        : channels[0]?.length >= frameCount
          ? channels[0]
          : null;
      const samples = source
        ? source.subarray(0, frameCount)
        : new Float32Array(frameCount);
      this._channelStates[ch].input.append(samples);
    }
  }

  _oldestIndex() {
    return Math.max(
      0,
      ...this._channelStates.map((state) => state.input.oldestIndex + CUBIC_PADDING),
    );
  }

  _liveEdge() {
    return Math.min(
      ...this._channelStates.map((state) => state.input.writeIndex - CUBIC_PADDING),
    );
  }

  _trimInput() {
    for (const state of this._channelStates) {
      state.input.trimBefore(this._readPos);
    }
  }

  _prime(frameCount) {
    if (this._primed) return true;
    const firstInput = this._channelStates[0]?.input;
    if (!firstInput) return false;

    this._readPos = firstInput.oldestIndex + CUBIC_PADDING;
    const required = Math.ceil(frameCount * this._currentRate) +
      CUBIC_PADDING + PREBUFFER_SAMPLES;
    if (!this._channelStates.every((state) =>
      state.input.canRead(this._readPos, required))) {
      return false;
    }

    this._primed = true;
    this._outputGain = 0;
    this._jumpRemaining = 0;
    return true;
  }

  _fallbackPeriod() {
    return clamp(
      Math.round(this._sampleRate / 100),
      64,
      Math.round(this._sampleRate / PERIOD_MAX_FREQ),
    );
  }

  _estimatePeriod(position) {
    const edge = this._liveEdge() - PERIOD_SEARCH_WINDOW;
    const oldest = this._oldestIndex();
    if (edge - position < PERIOD_SEARCH_WINDOW || position < oldest) return 0;

    const center = Math.min(position, edge - PERIOD_SEARCH_WINDOW);
    const minLag = clamp(
      Math.round(this._sampleRate / PERIOD_MIN_FREQ),
      16,
      Math.round(this._sampleRate / (PERIOD_MAX_FREQ * 2)),
    );
    const maxLag = clamp(
      Math.round(this._sampleRate / PERIOD_MAX_FREQ),
      minLag * 2,
      4096,
    );
    const windowLength = Math.min(PERIOD_SEARCH_WINDOW, maxLag);
    let bestLag = 0;
    let bestScore = 0.35;

    for (let lag = minLag; lag <= maxLag; lag += PERIOD_SEARCH_STEP) {
      let numerator = 0;
      let energyA = 0;
      let energyB = 0;
      for (let i = 0; i < windowLength; i++) {
        let a = 0;
        let b = 0;
        for (const state of this._channelStates) {
          a += state.input.safeSampleAt(center + i);
          b += state.input.safeSampleAt(center + i + lag);
        }
        a /= this._channelStates.length;
        b /= this._channelStates.length;
        numerator += a * b;
        energyA += a * a;
        energyB += b * b;
      }

      const denominator = Math.sqrt(Math.max(1e-12, energyA * energyB));
      const score = numerator / denominator;
      if (score > bestScore) {
        bestScore = score;
        bestLag = lag;
      }
    }

    return bestLag;
  }

  _repairTimeline(frameCount) {
    const rate = this._currentRate;
    const needed = Math.ceil(frameCount * rate) + CUBIC_PADDING;
    const oldest = this._oldestIndex();
    const edge = this._liveEdge();
    const currentEnd = this._readPos + needed;
    const backlog = edge - currentEnd;
    const needsBackwardRepair = currentEnd > edge;
    const needsForwardRepair = this._readPos < oldest ||
      backlog > TIMELINE_MARGIN;

    if (!needsBackwardRepair && !needsForwardRepair) {
      return true;
    }

    const freshPeriod = this._periodAge >= 32
      ? this._estimatePeriod(this._readPos)
      : 0;
    const period = freshPeriod || this._periodSamples;
    if (freshPeriod) {
      this._periodSamples = freshPeriod;
      this._periodAge = 0;
    }
    let target = this._readPos;
    if (needsBackwardRepair) {
      const deficit = currentEnd - edge;
      const steps = Math.max(1, Math.ceil(deficit / period));
      target = this._readPos - steps * period;
      target = Math.max(oldest, Math.min(target, edge - needed));
      if (target >= this._readPos - 1) {
        target = Math.max(
          oldest,
          this._readPos - Math.max(period, Math.ceil(frameCount * rate)),
        );
      }
    } else {
      const deficit = needsForwardRepair && this._readPos < oldest
        ? oldest - this._readPos
        : Math.max(0, currentEnd - (edge - TIMELINE_MARGIN));
      const steps = Math.max(1, Math.ceil(deficit / period));
      target = this._readPos + steps * period;
      target = Math.max(oldest, Math.min(target, edge - needed));
      if (target <= this._readPos + 1) {
        target = Math.min(
          edge - needed,
          this._readPos + Math.max(period, Math.ceil(frameCount * rate)),
        );
      }
    }

    if (
      target < oldest ||
      target + needed > edge ||
      target === this._readPos
    ) {
      return false;
    }

    this._jumpFrom = this._readPos;
    this._jumpTo = target;
    this._jumpRemaining = FADE_IN_SAMPLES;
    this._readPos = target;
    this._periodSamples = period;
    return true;
  }

  _outputChannels(outputs) {
    return outputs?.[0] || [];
  }

  _render(outputChannels, frameCount) {
    if (!this._repairTimeline(frameCount)) {
      this._outputGain = Math.max(
        0,
        this._outputGain - 1 / FADE_IN_SAMPLES,
      );
      this._renderSilence(outputChannels, frameCount);
      return false;
    }

    const rate = this._currentRate;
    const output = outputChannels[0];
    if (!output || output.length < frameCount) {
      this._renderSilence(outputChannels, frameCount);
      return false;
    }

    for (let i = 0; i < frameCount; i++) {
      this._outputGain = Math.min(
        1,
        this._outputGain + 1 / FADE_IN_SAMPLES,
      );
      const position = this._readPos + rate * i;
      let jumpMix = 1;
      if (this._jumpRemaining > 0) {
        const progress = 1 - this._jumpRemaining / FADE_IN_SAMPLES;
        jumpMix = progress * progress * (3 - 2 * progress);
        this._jumpRemaining -= 1;
      }

      for (let ch = 0; ch < outputChannels.length; ch++) {
        const state = this._channelStates[ch] || this._channelStates[0];
        const channelOutput = outputChannels[ch];
        if (!channelOutput) continue;
        const newValue = state.input.sampleAt(position);
        const oldValue = state.input.safeSampleAt(
          this._jumpFrom + rate * i,
        );
        channelOutput[i] =
          (oldValue + (newValue - oldValue) * jumpMix) *
          this._outputGain;
      }
    }

    this._readPos += rate * frameCount;
    this._trimInput();
    return true;
  }

  _renderSilence(outputChannels, frameCount) {
    for (const output of outputChannels) output.fill(0, 0, frameCount);
  }

  process(inputs, outputs) {
    const outputChannels = this._outputChannels(outputs);
    const frameCount = outputChannels[0]?.length || FRAME_HOP;
    if (!frameCount) return true;

    const delta = this._targetRate - this._currentRate;
    if (Math.abs(delta) > 0.0001) {
      this._currentRate += delta * RATE_SMOOTHING;
    } else {
      this._currentRate = this._targetRate;
    }

    this._periodAge = Math.min(64, this._periodAge + 1);
    const hasInput = this._hasInput(inputs, frameCount);
    if (hasInput) {
      this._missingInputBlocks = 0;
      this._appendInput(inputs, frameCount);
      if (!this._prime(frameCount)) {
        this._renderSilence(outputChannels, frameCount);
        return true;
      }
      this._render(outputChannels, frameCount);
    } else {
      this._missingInputBlocks += 1;
      this._outputGain = Math.max(
        0,
        this._outputGain - 1 / FADE_IN_SAMPLES,
      );
      if (this._missingInputBlocks >= LONG_INPUT_GAP_BLOCKS) {
        this._primed = false;
        this._readPos = 0;
        this._jumpRemaining = 0;
      }
      this._renderSilence(outputChannels, frameCount);
    }
    return true;
  }
}

if (typeof AudioWorkletProcessor !== 'undefined') {
  registerProcessor('lowband-resampler', LowbandResampler);
}
