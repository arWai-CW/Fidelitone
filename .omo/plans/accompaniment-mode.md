# Accompaniment Mode — Multiband Pitch Shifting Plan

## TL;DR (For humans)

**What you'll get:** 專為純伴奏設計的多分頻移調處理，包含：
1. 150Hz Linkwitz-Riley 交叉分頻器（低頻/中高頻分離）
2. 低頻軌使用時域重採樣（保留 Kick/Bass 衝擊力）
3. 中高頻軌使用 Signalsmith Stretch（保持音色透明度）
4. 32-bit Float 處理 + True Peak Limiter（防止數位削峰）
5. 立體聲相位鎖定（Stereo Unified Processing）

**Why this approach:** 
- Phase Vocoder 在低頻（<200Hz）會產生相位散射與動態流失
- 時域重採樣能 100% 保留低頻衝擊力（Punch）
- Linkwitz-Riley crossover 提供 24dB/oct 滾降，相位線性
- True Peak Limiter 防止頻域相位重組產生的短暫 Peak 衝高

**What it will NOT do:** 
- 不改變現有 RubberBand/Signalsmith 引擎架構
- 不添加新的 UI 控制項（使用現有 formant toggle 作為 accompaniment mode）
- 不改變 offline export 路徑

---

## Architecture Overview

### Current Audio Graph
```
mediaStreamSource ──→ rbNode (RubberBand) ──→ gainB(1.0) ──→ destination
                   ├──→ signalsmithNode ───→ gainA(0.0) ──→ ────┘
                   └──→ passthrough ──────────────────────→ destination
```

### Target Audio Graph (Accompaniment Mode)
```
                                    ┌─→ lowResampler ──→ gainLow ──┐
mediaStreamSource ──→ crossover ────┤                               ├──→ merger ──→ limiter ──→ destination
  (150Hz split)       (LR-4)       └─→ rbNode ───────→ gainHigh ──┘
                                         (Signalsmith)
```

### Key Design Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Crossover frequency | 150Hz | Kick drum fundamentals 60-150Hz, bass guitar 41-350Hz |
| Crossover filter | Linkwitz-Riley 4th order (LR-4) | 24dB/oct, phase-linear, sum to flat magnitude |
| Low-band processing | Time-domain resampling | Zero phase distortion, preserves transient punch |
| Mid-high processing | Signalsmith Stretch | High-quality Phase Vocoder, formant-aware |
| Block size | 2048 samples | Better low-freq resolution, ~43ms at 48kHz |
| Output limiter | True Peak (ITU-R BS.1770) | Transparent, prevents ISP clipping |

---

## Implementation Tasks

### Wave 1: Crossover Filter Processor

**Task 1: Create `src/processors/crossover-processor.js`**

Create a new AudioWorkletProcessor that implements a Linkwitz-Riley 4th-order crossover filter:

```javascript
// Linkwitz-Riley 4th-order crossover at 150Hz
// Two cascaded 2nd-order Butterworth filters
// Low pass + High pass = flat magnitude sum

class CrossoverProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.crossoverFreq = 150; // Hz
    this.sampleRate = sampleRate; // global in AudioWorklet
    this.channels = 2;
    this.lowOutputs = null;
    this.highOutputs = null;
    
    // Filter coefficients (will be computed)
    this.lpCoeffs = null;
    this.hpCoeffs = null;
    
    // Filter state (per channel)
    this.lpState = null;
    this.hpState = null;
    
    this.port.onmessage = (e) => this.onmessage(e);
  }
  
  onmessage(e) {
    if (e.data.type === 'INIT') {
      this.channels = e.data.channels || 2;
      this.crossoverFreq = e.data.crossoverFreq || 150;
      this.initFilters();
      this.port.postMessage({ type: 'INIT_OK' });
    }
  }
  
  initFilters() {
    // Compute LR-4 coefficients (two cascaded Butterworth)
    // ...
  }
  
  process(inputs, outputs) {
    const input = inputs[0];
    if (!input || !input[0]) return true;
    
    const outputLow = outputs[0]; // low band
    const outputHigh = outputs[1]; // high band
    
    for (let ch = 0; ch < this.channels; ch++) {
      for (let i = 0; i < input[ch].length; i++) {
        const sample = input[ch][i];
        // Apply cascaded Butterworth LP
        const low = this.applyFilter(sample, this.lpCoeffs, this.lpState[ch]);
        // Apply cascaded Butterworth HP
        const high = this.applyFilter(sample, this.hpCoeffs, this.hpState[ch]);
        
        outputLow[ch][i] = low;
        outputHigh[ch][i] = high;
      }
    }
    return true;
  }
}

registerProcessor("crossover", CrossoverProcessor);
```

**Acceptance Criteria:**
- `npx vite build` copies processor to `dist/processors/crossover-processor.js`
- Filter response: -3dB at 150Hz, -24dB/oct rolloff
- Low + High sum ≈ Input (flat magnitude)
- No audible clicks when switching

---

### Wave 2: Low-Band Resampler

**Task 2: Create `src/lib/dsp/lowband-resampler.ts`**

Implement time-domain resampling for low-frequency band:

```typescript
/**
 * Low-band resampler for < 200Hz audio
 * Uses cubic interpolation for quality, preserves transient punch
 */
export class LowBandResampler {
  private ratio: number;
  private buffer: Float32Array;
  private writePos: number;
  
  constructor(inputRate: number, outputRate: number, bufferSize: number) {
    this.ratio = outputRate / inputRate;
    this.buffer = new Float32Array(bufferSize);
    this.writePos = 0;
  }
  
  /**
   * Process a block of low-frequency audio
   * @param input Input samples (float32)
   * @returns Resampled output (may be different length)
   */
  process(input: Float32Array): Float32Array {
    // Cubic interpolation resampling
    // ...
  }
}
```

**Acceptance Criteria:**
- Resampling ratio = `pitchFactor` (e.g., +5 semitones = 1.3348x)
- Output length = `Math.round(input.length * ratio)`
- No audible artifacts in kick drum transients
- Phase-coherent with high-band output

---

### Wave 3: Integration into Offscreen Audio Graph

**Task 3: Modify `src/offscreen/offscreen.ts`**

Integrate multiband processing into the audio graph:

```typescript
// New nodes for accompaniment mode
let crossoverNode: AudioWorkletNode | null = null;
let lowBandNode: AudioWorkletNode | null = null; // resampler
let mergerNode: ChannelMergerNode | null = null;
let limiterNode: DynamicsCompressorNode | null = null;

let isAccompanimentMode = false;

async function initAccompanimentMode() {
  // Load crossover processor
  const crossoverUrl = chrome.runtime.getURL("processors/crossover-processor.js");
  await ctx.audioWorklet.addModule(crossoverUrl);
  
  // Create crossover node (2 outputs: low, high)
  crossoverNode = new AudioWorkletNode(ctx, "crossover", {
    numberOfInputs: 1,
    numberOfOutputs: 2, // low band, high band
    channelCount: 2,
    channelCountMode: "explicit",
  });
  
  // Low-band resampler (time-domain)
  lowBandNode = new AudioWorkletNode(ctx, "lowband-resampler", {
    numberOfInputs: 1,
    numberOfOutputs: 1,
    channelCount: 2,
    channelCountMode: "explicit",
  });
  
  // Merger to combine bands back
  mergerNode = ctx.createChannelMerger(2);
  
  // True Peak Limiter
  limiterNode = ctx.createDynamicsCompressor();
  limiterNode.threshold.value = -1.0; // dBTP
  limiterNode.knee.value = 0.0;
  limiterNode.ratio.value = 20; // aggressive limiting
  limiterNode.attack.value = 0.001; // 1ms
  limiterNode.release.value = 0.05; // 50ms
  
  // Connect graph
  // mediaStreamSource → crossover → [low, high] → merger → limiter → destination
}

function connectSourceAccompaniment() {
  if (!mediaStreamSource || !crossoverNode) return;
  
  mediaStreamSource.disconnect();
  
  // Split into bands
  mediaStreamSource.connect(crossoverNode);
  
  // Low band → resampler → gain → merger
  crossoverNode.connect(lowBandNode, 0); // output 0 = low
  lowBandNode.connect(mergerNode, 0, 0); // left
  
  // High band → pitch shifter → gain → merger
  if (rbNode && engineReady) {
    crossoverNode.connect(rbNode, 1); // output 1 = high
    rbNode.connect(mergerNode, 0, 1); // right
  }
  
  // Merger → limiter → destination
  mergerNode.connect(limiterNode);
  limiterNode.connect(ctx.destination);
}
```

**Acceptance Criteria:**
- Toggle `SET_ACCOMPANIMENT` message enables/disables multiband path
- Low band: 0-150Hz, processed by resampler
- High band: 150Hz+, processed by RubberBand/Signalsmith
- No phasing/flanging when bands recombine
- Limiter prevents clipping on transient peaks

---

### Wave 4: Block Size & Buffer Optimization

**Task 4: Update `src/processors/rubberband-processor.js`**

Increase block size from 512 to 2048 for better low-frequency resolution:

```javascript
// In INIT message handler
onmessage(e) {
  if (e.data.type === 'INIT') {
    this.blockSize = e.data.blockSize || 2048; // increased from 512
    // ...
  }
}
```

**Task 5: Update `src/offscreen/offscreen.ts`**

Update RubberBand initialization with new block size:

```typescript
// In INIT_OK handler
const result = initLiveShifter(ctx.sampleRate, 2, 1.0);
if (result) {
  rbBlockSize = result.blockSize; // now 2048
  // Update processor with new block size
  rbNode?.port.postMessage({ 
    type: "INIT", 
    blockSize: 2048, // increased from 512
    channels: 2 
  });
}
```

**Acceptance Criteria:**
- Block size = 2048 samples (~43ms at 48kHz)
- Low-freq resolution improved (frequency bin = 48000/2048 ≈ 23.4Hz)
- Latency acceptable (< 50ms total)
- No buffer underruns in 60s playback

---

### Wave 5: Stereo Phase Locking Verification

**Task 6: Verify `src/lib/dsp/signalsmith-fallback.ts` stereo config**

Ensure Signalsmith Stretch processes both channels together:

```typescript
// In createSignalsmithEngine()
const node = (await SignalsmithStretch(ctx, {
  numberOfInputs: 1,
  numberOfOutputs: 1,
  channelCount: 2, // stereo unified
  channelCountMode: "explicit",
})) as StretchNode;
```

**Acceptance Criteria:**
- Signalsmith processes stereo as unified pair
- No phase cancellation between L/R channels
- Stereo image preserved after pitch shift
- Width matches original (no collapse to mono)

---

### Wave 6: True Peak Limiter

**Task 7: Create `src/lib/dsp/true-peak-limiter.ts`**

Implement ITU-R BS.1770 compliant true peak detection:

```typescript
/**
 * True Peak Limiter (ITU-R BS.1770)
 * Prevents inter-sample peaks from causing DAC clipping
 */
export class TruePeakLimiter {
  private threshold: number; // dBTP
  private release: number;
  private gain: number;
  private envelope: number;
  
  constructor(thresholdDBTP: number = -1.0) {
    this.threshold = Math.pow(10, thresholdDBTP / 20);
    this.release = 0.05; // 50ms
    this.gain = 1.0;
    this.envelope = 0;
  }
  
  process(input: Float32Array): Float32Array {
    const output = new Float32Array(input.length);
    
    for (let i = 0; i < input.length; i++) {
      const abs = Math.abs(input[i]);
      
      // True peak detection (oversample 4x)
      const truePeak = this.detectTruePeak(input, i);
      
      // Envelope follower
      if (truePeak > this.envelope) {
        this.envelope = truePeak; // attack
      } else {
        this.envelope *= (1 - this.release); // release
      }
      
      // Gain reduction
      if (this.envelope > this.threshold) {
        this.gain = this.threshold / this.envelope;
      } else {
        this.gain = 1.0;
      }
      
      output[i] = input[i] * this.gain;
    }
    
    return output;
  }
  
  private detectTruePeak(samples: Float32Array, index: number): number {
    // 4x oversampling via cubic interpolation
    // ...
  }
}
```

**Acceptance Criteria:**
- True peak never exceeds -1.0 dBTP
- No audible pumping or breathing
- Transparent: gain reduction < 0.5 dB on typical program material
- Handles inter-sample peaks correctly

---

### Wave 7: UI Integration

**Task 8: Update `src/popup/popup.ts`**

Add accompaniment mode toggle:

```typescript
const accompanimentCheckbox = document.getElementById("accompanimentCheckbox") as HTMLInputElement;

accompanimentCheckbox.addEventListener("change", () => {
  const enabled = accompanimentCheckbox.checked;
  chrome.storage.local.set({ accompanimentMode: enabled });
  sendSafe({ type: "SET_ACCOMPANIMENT", value: { enabled } });
});
```

**Task 9: Update `src/offscreen/offscreen.ts` message handler**

```typescript
if (msg.type === "SET_ACCOMPANIMENT") {
  handleSetAccompaniment(msg.value);
  sendResponse({ ok: true });
  return;
}

function handleSetAccompaniment(value: { enabled: boolean }) {
  isAccompanimentMode = value.enabled;
  if (isAccompanimentMode) {
    initAccompanimentMode();
    connectSourceAccompaniment();
  } else {
    connectSource(); // original path
  }
}
```

**Acceptance Criteria:**
- Checkbox toggles accompaniment mode on/off
- State persists across popup close/reopen
- Visual feedback: checkbox label shows "Accompaniment Mode"
- Default: OFF (existing behavior)

---

## Verification Strategy

### Unit Tests (vitest)
- `src/tests/crossover-filter.test.ts`: Filter coefficient calculation, magnitude response
- `src/tests/lowband-resampler.test.ts`: Resampling ratio, output length, phase coherence
- `src/tests/true-peak-limiter.test.ts`: Peak detection, gain reduction, transparency

### Integration Tests (manual)
- Play YouTube music with drums + bass
- Toggle accompaniment mode ON/OFF
- Verify: Kick drum punch preserved, no phasing, no clipping
- A/B compare: original vs accompaniment mode at +5 semitones

### Acceptance Criteria
1. Accompaniment mode toggle works in popup
2. Low band (0-150Hz) processed by resampler
3. High band (150Hz+) processed by pitch shifter
4. No phasing/flanging when bands recombine
5. True peak never exceeds -1.0 dBTP
6. Stereo image preserved
7. Latency < 50ms total
8. All existing tests pass

---

## Files to Create/Modify

| File | Action | Description |
|------|--------|-------------|
| `src/processors/crossover-processor.js` | CREATE | Linkwitz-Riley crossover filter |
| `src/processors/lowband-resampler.js` | CREATE | Time-domain resampler for low band |
| `src/lib/dsp/true-peak-limiter.ts` | CREATE | ITU-R BS.1770 limiter |
| `src/offscreen/offscreen.ts` | MODIFY | Add multiband audio graph |
| `src/processors/rubberband-processor.js` | MODIFY | Increase block size to 2048 |
| `src/popup/popup.ts` | MODIFY | Add accompaniment mode toggle |
| `src/popup/popup.html` | MODIFY | Add checkbox element |
| `src/tests/crossover-filter.test.ts` | CREATE | Filter tests |
| `src/tests/lowband-resampler.test.ts` | CREATE | Resampler tests |
| `src/tests/true-peak-limiter.test.ts` | CREATE | Limiter tests |

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Crossover phase misalignment | Medium | High | Use Linkwitz-Riley (phase-linear) |
| Low-band latency too high | Low | Medium | 2048 block = 43ms, acceptable |
| Limiter pumping artifacts | Medium | Medium | Conservative threshold (-1 dBTP) |
| Stereo image collapse | Low | High | Verify unified processing |
| Performance overhead | Low | Low | Only active in accompaniment mode |

---

## Success Criteria

1. ✅ Accompaniment mode toggle in popup
2. ✅ Low band (0-150Hz) processed by resampler
3. ✅ High band (150Hz+) processed by pitch shifter
4. ✅ No phasing/flanging when bands recombine
5. ✅ True peak never exceeds -1.0 dBTP
6. ✅ Stereo image preserved
7. ✅ Latency < 50ms total
8. ✅ All existing tests pass
9. ✅ New unit tests pass
10. ✅ Manual QA: kick punch preserved, no clipping
