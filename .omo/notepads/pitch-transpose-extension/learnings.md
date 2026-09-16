# Learnings — pitch-transpose-extension

## [2026-09-16] Project start
- Chrome MV3 extension: YouTube audio capture + pitch transpose
- Two engines: Signalsmith Stretch (realtime, MIT) + Rubber Band v4.0 (offline + Phase B realtime)
- Both run single-threaded WASM — no SharedArrayBuffer needed
- CSP requires `wasm-unsafe-eval` for WASM loading
- Popup is ephemeral controller; offscreen document is persistent audio engine
- chrome.storage.local bridges popup ↔ offscreen state

## [2026-09-16] Task 2 — offscreen skeleton
- AudioWorkletProcessor inlined via Blob URL (Vite won't bundle worklet code)
- Vite preserves `src/` prefix in output: `dist/src/offscreen/offscreen.html`
- AudioContext needs a silent oscillator + gain=0 → destination to stay alive
- `audioWorklet.addModule()` takes a Blob URL, revoked after registration
- Passthrough processor: `output[ch].set(input[ch])` — zero allocation in process()
- chrome.runtime.onMessage bridges popup → offscreen for SET_PITCH / SET_BYPASS
- chrome.storage.onChanged listens for local storage changes

## Task 14: RubberBandLiveShifter in AudioWorklet

### Architecture Decision
- WASM loaded in offscreen (main) thread, NOT in AudioWorklet thread
- AudioWorkletProcessor handles ring buffers and interleave/deinterleave
- Processor sends interleaved blocks to main thread via MessagePort
- Main thread processes via WASM LiveShifter and sends output back via OUTPUT_READY message
- This avoids WASM loading complexity in worklet thread while keeping latency low

### Key Findings
- RubberBand block size is 512 samples (confirmed from verify.mjs)
- Web Audio blocks are 128 frames → need ring buffers to accumulate 4 blocks before processing
- Interleaving required: Web Audio uses per-channel arrays, RubberBand expects interleaved
- Ring buffer capacity set to blockSize * channels * 4 (4x headroom for jitter)

### Implementation Notes
- Processor code is plain JS (no TS) in template string for Blob URL loading
- `sampleRate` is a global in AudioWorkletProcessor scope (don't redeclare)
- initLiveShifter() called from INIT_OK handler to ensure processor is ready first
- shiftBlock() called inline in PROCESS handler (no async needed for WASM calls)

### Fallback Strategy
- Signalsmith code moved to src/lib/dsp/signalsmith-fallback.ts
- Passthrough processor still registered for bypass mode
- If WASM fails to load, falls back to passthrough
