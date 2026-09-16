# pitch-transpose-extension - Work Plan

## TL;DR (For humans)

**What you'll get:** A Chrome Extension (MV3) that captures YouTube audio via tabCapture, transposes it ±12 semitones in real-time using Signalsmith Stretch (AudioWorklet), and can export local audio files through Rubber Band v4.0 WASM at high quality as WAV/Opus files. Phase B upgrades the realtime engine to Rubber Band.

**Why this approach:** Signalsmith Stretch (MIT) provides near-zero-cost realtime integration via embedded WASM + AudioWorklet, while Rubber Band v4.0's `RubberBandLiveShifter` delivers the final goal: a single high-quality engine for both realtime and offline processing. Both run single-threaded WASM without SharedArrayBuffer — no COOP/COEP headaches in MV3.

**What it will NOT do:** No tempo/speed control. No region loop. No stream recording/download. No local file player. No popup waveform. No MP3 encoding. No Firefox support (Chromium only).

**Effort:** Large
**Risk:** Medium — Rubber Band v4.0 self-compilation to WASM is the main technical unknown (no existing v4.0 WASM build exists; v3.3 build flags from Daninet/rubberband-wasm are the reference)
**Decisions to sanity-check:** (1) WAV+Opus only, no MP3 (Chrome WebCodecs lacks MP3 encoder). (2) Popup-only UI, no separate player page. (3) Open-source GPLv2+ licensing for Rubber Band portions.

Your next move: run `/start-work pitch-transpose-extension`. Full execution detail follows below.

---

> TL;DR (machine): Large effort, Medium risk — 15 implementation tasks + 4 final verification tasks across 7 waves; delivers MV3 pitch-shifting extension with Signalsmith realtime + Rubber Band offline + Phase B LiveShifter upgrade.

## Scope
### Must have
- MV3 Chrome Extension with popup UI (continuous pitch slider ±12 semitones with cents fine-tune, bypass toggle)
- Offscreen document as persistent audio engine (popup = ephemeral controller via chrome.storage)
- tabCapture → getUserMedia → AudioWorklet pipeline for real-time stream capture
- Signalsmith Stretch AudioWorklet integration (MIT, embedded WASM, `schedule({semitones})`)
- Local file export: file picker → decodeAudioData → Rubber Band v4.0 WASM Worker → WAV/Opus download
- Rubber Band v4.0 self-compiled WASM (Emscripten, single-threaded, reference Daninet build flags)
- WAV export: manual PCM16 header + interleaved samples
- Opus export: WebCodecs AudioEncoder('opus')
- Automated tests: pitch math, WAV header correctness, Opus encoder config, RB Worker block processing
- Open-source packaging: LICENSE (GPLv2+ attribution for Rubber Band), README, CWS-ready .zip
- Phase B: RubberBandLiveShifter replaces Signalsmith in AudioWorklet for unified RB architecture
- Phase B: Hidden A/B comparison tool (debug mode hotkey) between Signalsmith and RB LiveShifter

### Must NOT have (guardrails, anti-slop, scope boundaries)
- Tempo/speed control (user explicitly excluded)
- Region loop UI (YouTube native loop covers this)
- Stream recording/download (user explicitly excluded)
- Local file player (file export only, no playback)
- Full player page / waveform visualization (popup-only)
- MP3 encoding (Chrome WebCodecs lacks MP3 encoder; WAV+Opus only)
- Firefox/Chromium-specific APIs beyond standard WebAudio
- i18n, analytics, automated store publishing
- Third-party mp3 libraries (lamejs etc.)

## Verification strategy
> Zero human intervention - all verification is agent-executed.
- Test decision: tests-after + vitest (TypeScript)
- Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-<N>-pitch-transpose-extension.<ext>
- Unit tests: pitch-math.test.ts, wav-writer.test.ts, opus-encoder.test.ts, rb-worker.test.ts
- Integration: manual QA listening pass (human required at final verification)

## Execution strategy
### Parallel execution waves
> Target 5-8 todos per wave. Fewer than 3 (except the final) means you under-split.

**Wave 1 — 基礎設施** (2 tasks, parallel)
1. 專案初始化（MV3 + Vite + TS + manifest.json + CSP）
7. Rubber Band v4.0 Emscripten WASM 編譯（與 Wave 1 平行，獨立工作）

**Wave 2 — 端點骨架** (2 tasks, parallel)
2. Offscreen document 常駐音訊引擎骨架
5. Popup UI（pitch 滑桿 + cents + bypass）

**Wave 3 — 連接層** (3 tasks, parallel)
3. tabCapture 音訊捕捉管線
6. chrome.storage 狀態同步
8. RB WASM Worker 骨架（depends on Todo 7）

**Wave 4 — DSP + 匯出管線** (2 tasks, parallel)
4. Signalsmith Stretch AudioWorklet 整合
9. 本機檔案匯出管線（depends on Todo 8）

**Wave 5 — 匯出格式器** (2 tasks, parallel)
10. WAV 匯出
11. Opus 匯出

**Wave 6 — 測試 + 打包** (2 tasks, parallel)
12. 自動化測試
13. Edge/商店打包 + 授權文件

**Wave 7 — Phase B** (2 tasks, sequential)
14. RB LiveShifter 即時引擎替換
15. A/B 品質比對工具

### Dependency matrix
| Todo | Depends on | Blocks | Can parallelize with |
| --- | --- | --- | --- |
| 1 | none | 2,3,4,5,6,9 | 7 |
| 7 | 1 (project structure) | 8 | 2,3,4,5,6 |
| 2 | 1 | 3,4,6 | 5,7 |
| 5 | 1 | 6 | 2,7 |
| 3 | 1,2 | 4,6 | 8 |
| 6 | 1,2,4,5 | 14 | 8 |
| 8 | 7 | 9 | 3,4,5,6 |
| 4 | 1,2,3 | 6,14 | 9 |
| 9 | 1,2,8 | 10,11 | 6 |
| 10 | 9 | 12,13 | 11 |
| 11 | 9 | 12,13 | 10 |
| 12 | 10,11 | 13 | — |
| 13 | 12 | 14 | — |
| 14 | 6,7,8 | 15 | — |
| 15 | 14 | F1–F4 | — |

## Todos
> Implementation + Test = ONE todo. Never separate.

<!-- WAVE 1 — 基礎設施 (parallel) -->

- [x] 1. 專案初始化：MV3 腳手架 + Vite + TypeScript
  What to do / Must NOT do:
  Create project scaffold: `package.json` (deps: `signalsmith-stretch`, devDeps: `vite`, `typescript`, `vitest`), `tsconfig.json` (strict, ESNext), `vite.config.ts` (target: `esnext`, build: multi-page for popup.html + offscreen.html), `manifest.json` (MV3, permissions: `tabCapture`, `offscreen`, `activeTab`; host_permissions: `http://*/* https://*/*`; CSP: `"script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'"`), directory structure: `src/popup/`, `src/offscreen/`, `src/worker/`, `src/lib/`, `src/wasm/`, `src/tests/`, `.gitignore`, `LICENSE` (placeholder). Must NOT install Rubber Band WASM or write any DSP code.
  Parallelization: Wave 1 | Blocked by: none | Blocks: 2,3,4,5,6,9
  References:
  - [Chrome MV3 CSP docs](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) — `wasm-unsafe-eval` required for WASM
  - [Chrome MV3 manifest permissions](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) — `tabCapture`, `offscreen` permissions
  - [Signalsmith Stretch package.json](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/package.json) — npm `signalsmith-stretch@1.0.0`
  - [Vite multi-page setup](https://vitejs.dev/guide/build.html#multi-page-app) — build config for popup + offscreen
  Acceptance criteria (agent-executable):
  - `npm install` completes without errors
  - `npx tsc --noEmit` exits 0
  - `npx vite build` produces `dist/` containing `manifest.json`, `popup.html`, `offscreen.html`, and JS bundles
  - `dist/manifest.json` contains `"content_security_policy": {"extension_pages": "script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'"}`
  - `dist/manifest.json` contains `"permissions": ["tabCapture", "offscreen"]`
  QA scenarios:
  - happy: `npm run build && ls dist/manifest.json dist/popup.html dist/offscreen.html` → all exist
  - failure: remove `wasm-unsafe-eval` from CSP → `npx tsc --noEmit` still passes (CSP is manifest, not TS), but manual check fails: extension loads with error in chrome://extensions
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-1-pitch-transpose-extension.log
  Commit: Y | feat(ext): scaffold MV3 extension with Vite + TypeScript + wasm-unsafe-eval CSP

- [x] 7. Rubber Band v4.0 Emscripten WASM 編譯
  What to do / Must NOT do:
  Clone rubberband v4.0.0 from GitHub; set up Emscripten build following Daninet/rubberband-wasm `build.sh` as reference: compile `RubberBandSingle.cpp` (single translation unit) with flags `-O3 -Oz -flto -fno-rtti`, `-s MODULARIZE=1`, `-s ALLOW_MEMORY_GROWTH=1`, `-s STANDALONE_WASM=1`, `-s FILESYSTEM=0`, `-s ASSERTIONS=0`, `-s ENVIRONMENT='web,worker'`; output `rubberband.wasm`; place in `src/wasm/`. Uses KissFFT (BSD, bundled) + Speex resampler (BSD, bundled). Must NOT use threads/SharedArrayBuffer/SIMD; must NOT compile RubberBandLiveShifter separately (it is part of the single-translation-unit build). Do NOT integrate into the extension yet — just produce the .wasm file and a verification script.
  Parallelization: Wave 1 | Blocked by: 1 (project structure for wasm/ dir) | Blocks: 8
  References:
  - [Daninet/rubberband-wasm build.sh](https://github.com/Daninet/rubberband-wasm/blob/master/build.sh) — exact emcc flags to replicate (lines 1-40)
  - [Rubber Band COMPILING.md](https://github.com/breakfastquay/rubberband/blob/default/COMPILING.md) — Meson build requirements, KissFFT/Speex deps
  - [Rubber Band v4.0 announcement](https://breakfastquay.com/rubberband) — RubberBandLiveShifter API release note (25 Oct 2024)
  - [RubberBandLiveShifter class reference](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html) — constructor, setPitchScale, shift, getBlockSize
  Acceptance criteria (agent-executable):
  - `src/wasm/rubberband.wasm` exists and is >500KB
  - A verification script (`src/wasm/verify.mjs`) loads the wasm via `WebAssembly.instantiate`, calls exported `getBlockSize()` (or appropriate init function), returns a positive integer
  - `node src/wasm/verify.mjs` exits 0 and prints block size
  QA scenarios:
  - happy: `node src/wasm/verify.mjs` → prints "Block size: N" (N > 0)
  - failure: emscripten not installed → error message naming the missing tool; wasm file not produced
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-7-pitch-transpose-extension.log
  Commit: Y | feat(wasm): compile Rubber Band v4.0 to single-threaded WASM via Emscripten

<!-- WAVE 2 — 端點骨架 (parallel) -->

- [x] 2. Offscreen document 常駐音訊引擎骨架
  What to do / Must NOT do:
  Create `src/offscreen/offscreen.html` (minimal HTML loading offscreen.ts), `src/offscreen/offscreen.ts`: on load, register offscreen document via `chrome.offscreen.createDocument({reasons:['AUDIO_PLAYBACK'], url:'offscreen.html'})` — or document IS the offscreen page; create AudioContext; register a minimal AudioWorkletProcessor (passthrough: copy input Float32Arrays to output in `process()`); connect: `audioContext.destination` with a silent source (AudioWorklet needs at least one source to run). Implement MessagePort listener ready for future pitch/bypass messages. Implement storage.onChanged listener ready for future state sync. Must NOT integrate Signalsmith or Rubber Band yet; must NOT implement tabCapture capture.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 3,4,6,14
  References:
  - [chrome.offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — `createDocument`, reasons `AUDIO_PLAYPLAY` / `USER_MEDIA`, one document per extension
  - [MDN AudioWorkletProcessor](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) — 128-frame blocks, no allocation in process()
  - [Signalsmith Stretch web-wrapper.js](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/web-wrapper.js) — reference for AudioWorklet registration pattern (lines 1-50)
  Acceptance criteria (agent-executable):
  - `npx vite build` produces `dist/offscreen.html` and `dist/offscreen.js`
  - Loading extension in Chrome → offscreen document creates successfully (check via `chrome://extensions` → Inspect views: offscreen.html)
  - AudioWorklet graph loads (console.log in processor's constructor fires)
  - AudioContext starts without errors
  QA scenarios:
  - happy: load unpacked extension → inspect offscreen → console shows "AudioWorkletProcessor created"
  - failure: omitting `AUDIO_PLAYBACK` reason → `chrome.offscreen.createDocument` rejects with descriptive error
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-2-pitch-transpose-extension.log
  Commit: Y | feat(offscreen): minimal passthrough AudioWorkletProcessor in offscreen document

- [x] 5. Popup UI：pitch 滑桿 + cents 微調 + bypass 切換
  What to do / Must NOT do:
  Create `src/popup/popup.html` and `src/popup/popup.ts`: continuous HTML `<input type="range" min="-12" max="12" step="0.01">` for pitch semitones; display current value formatted as `"N.NN st"` (2 decimal places = cents); bypass toggle button (two-state: "Active" / "Bypassed"); tab title display (`chrome.tabs.query` → active tab title); disabled/grayed state when `chrome.storage.local.get('connected')` is false. Must NOT add seek, loop, tempo, or waveform controls. Must NOT call any audio APIs directly.
  Parallelization: Wave 2 | Blocked by: 1 | Blocks: 6
  References:
  - [Chrome popup docs](https://developer.chrome.com/docs/extensions/reference/api/action#popup) — popup.html size constraints (~350px wide, ~600px max height)
  - [HTML range input](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/input/range) — min/max/step attributes for continuous cents control
  Acceptance criteria (agent-executable):
  - `npx vite build` produces `dist/popup.html` + `dist/popup.js`
  - Popup renders: slider range -12.00 to +12.00, step 0.01; bypass button toggles visual state; tab title displays
  - Slider value display updates on input event (show 2 decimal places)
  QA scenarios:
  - happy: open popup → slider at center (0.00 st), bypass button shows "Active"; drag slider → display shows e.g. "+3.25 st"
  - failure: no active tab → tab title shows "No active tab", controls grayed out
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-5-pitch-transpose-extension.log
  Commit: Y | feat(ui): popup pitch slider with cents fine-tune and bypass toggle

<!-- WAVE 3 — 連接層 (parallel) -->

- [x] 3. tabCapture 音訊捕捉管線
  What to do / Must NOT do:
  Popup action click handler: (1) `const [tab] = await chrome.tabs.query({active:true, currentWindow:true})`; (2) `const streamId = await chrome.tabCapture.getMediaStreamId({targetTabId: tab.id})`; (3) `chrome.runtime.sendMessage({type:'START_CAPTURE', streamId})` to offscreen; (4) offscreen receives message, calls `navigator.mediaDevices.getUserMedia({audio: {mandatory: {chromeMediaSource:'tab', chromeMediaSourceId: streamId}}})`; (5) creates `MediaStreamAudioSourceNode(stream)`, connects to existing AudioWorklet graph; (6) sets `chrome.storage.local.set({connected: true})`. Include error handling: `getUserMedia` rejection → send error message to popup → display in popup. Must NOT implement pitch processing; must NOT handle multiple tabs simultaneously.
  Parallelization: Wave 3 | Blocked by: 1,2 | Blocks: 4,6
  References:
  - [chrome.tabCapture API](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) — `getMediaStreamId`, requires user gesture (popup click counts)
  - [tabCapture getUserMedia pattern](https://developer.chrome.com/docs/extensions/reference/api/tabCapture) — `chromeMediaSource: 'tab'`, `chromeMediaSourceId`
  - [Chrome offscreen + tabCapture](https://developer.chrome.com/docs/extensions/reference/api/offscreen) — offscreen document reasons `USER_MEDIA` for getUserMedia
  - [MDN MediaStreamAudioSourceNode](https://developer.mozilla.org/en-US/docs/Web/API/MediaStreamAudioSourceNode) — connect MediaStream to Web Audio graph
  Acceptance criteria (agent-executable):
  - On YouTube tab with audio playing → click extension popup → audio from YouTube tab is heard through extension (passthrough, no pitch change yet)
  - `chrome.storage.local.get('connected')` returns `true` after capture starts
  - Closing the popup does NOT stop audio (offscreen persists)
  - On non-audio tab → popup shows error message "No audio detected"
  QA scenarios:
  - happy: play YouTube music → click extension → audio continues (passthrough, same pitch/volume); close popup → audio still plays
  - failure: no tab with audio → popup displays error; `tabCapture.getMediaStreamId` rejects → error caught, logged, popup notified
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-3-pitch-transpose-extension.log
  Commit: Y | feat(capture): tabCapture → offscreen getUserMedia audio pipeline

- [x] 6. chrome.storage 狀態同步（popup ↔ offscreen）
  What to do / Must NOT do:
  Popup writes to `chrome.storage.local` on every slider change (debounced 50ms to avoid flooding) and bypass toggle: keys `pitchSemitones` (number, -12 to +12), `bypass` (boolean). Offscreen document listens via `chrome.storage.onChanged.addListener((changes, area) => {...})` for `local` area; when `pitchSemitones` changes → send `{type:'SET_PITCH', semitones: changes.pitchSemitones.newValue}` via MessagePort to AudioWorkletProcessor; when `bypass` changes → send `{type:'SET_BYPASS', bypass: changes.bypass.newValue}`. On offscreen startup, read initial state from storage. Offscreen writes `connected: true/false` on capture start/stop; popup reads this to enable/disable controls. Must NOT use `postMessage` on the main thread for audio-critical parameters (use MessagePort inside AudioWorklet); must NOT implement undo/redo or history.
  Parallelization: Wave 3 | Blocked by: 1,2,4 (needs pitch setter) | Blocks: 14
  References:
  - [chrome.storage.local API](https://developer.chrome.com/docs/extensions/reference/api/storage#property-local) — `set`, `get`, `onChanged`
  - [AudioWorklet MessagePort](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/port) — `this.port.postMessage` / `this.port.onmessage` for RT-safe communication from main thread to processor
  - [Signalsmith Stretch schedule API](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/README.md) — `stretch.schedule({semitones, rate, output})` is the RT path
  Acceptance criteria (agent-executable):
  - Change slider to +5.00 st in popup → offscreen receives `pitchSemitones=5.00` within 100ms → AudioWorklet gets `SET_PITCH` message
  - Toggle bypass in popup → offscreen receives `bypass=true` → AudioWorklet gets `SET_BYPASS`
  - Close popup, reopen → slider shows last saved pitch (5.00), bypass state reflected
  - Offscreen restarts (service worker idle wake) → reads stored state, restores parameters
  QA scenarios:
  - happy: slider +7.25 → storage update within 100ms → pitch audible change; bypass toggle → immediate audible change; popup close/reopen → state preserved
  - failure: storage write fails (quota exceeded — very unlikely with 3 keys) → error logged, fallback to defaults (0 st, bypass off)
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-6-pitch-transpose-extension.log
  Commit: Y | feat(state): chrome.storage.local sync between popup and offscreen via MessagePort

- [x] 8. Rubber Band WASM Worker 骨架
  What to do / Must NOT do:
  Create `src/worker/rb-worker.ts`: (1) load `rubberband.wasm` via `fetch(new URL('../wasm/rubberband.wasm', import.meta.url))` + `WebAssembly.instantiateStreaming`; (2) expose via `self.onmessage`: `INIT(sampleRate, channels, pitchScale)` — instantiate `RubberBandLiveShifter(sampleRate, channels, options)`, call `setPitchScale(pitchScale)`; `PROCESS(inputFloat32Array)` — call `shift(input, output)` in getBlockSize() chunks, pre-allocate input/output Float32Arrays of length `channels × blockSize`; (3) post result Float32Array back. Must NOT implement chunk-based batching for file export (that's Todo 9); must NOT expose `RubberBandStretcher` API (use LiveShifter only — note for Phase B realtime migration). Pre-allocate all buffers (no allocation in hot path).
  Parallelization: Wave 3 | Blocked by: 7 (wasm file) | Blocks: 9
  References:
  - [RubberBandLiveShifter API](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html) — constructor: `(sampleRate, channels, Options)`, methods: `setPitchScale(double)`, `shift(const float*const* in, float*const* out)`, `getBlockSize()`, `getStartDelay()`
  - [Daninet rubberband-wasm worker pattern](https://github.com/Daninet/rubberband-wasm/blob/master/src/index.ts) — reference for WASM worker message handling
  - [WebAssembly.instantiateStreaming MDN](https://developer.mozilla.org/en-US/docs/WebAssembly/JavaScript_interface/instantiateStreaming_static)
  Acceptance criteria (agent-executable):
  - Worker loads rubberband.wasm; `INIT(44100, 2, 1.0)` returns success message with blockSize
  - `PROCESS(float32ArrayOfN)` returns Float32Array of same length (for pitchScale=1.0, output ≈ input)
  - `PROCESS` with pitchScale = `Math.pow(2, 12/12)` = 2.0 → output is pitch-shifted (verify via simple energy/frequency check: output energy distribution differs from input)
  - No memory allocation in the hot path (all buffers pre-allocated in INIT)
  QA scenarios:
  - happy: INIT(44100, 2, 1.0) → blockSize > 0; PROCESS(1s white noise) → output length = input length, no errors
  - failure: WASM file missing → Worker posts error message, does not crash; invalid sampleRate (e.g. 0) → error message
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-8-pitch-transpose-extension.log
  Commit: Y | feat(worker): Rubber Band v4.0 WASM Worker with LiveShifter block processing API

<!-- WAVE 4 — DSP + 匯出管線 (parallel) -->

- [x] 4. Signalsmith Stretch AudioWorklet 整合
  What to do / Must NOT do:
  In AudioWorkletProcessor (offscreen context): `import SignalsmithStretch from 'signalsmith-stretch'`; instantiate via `const stretch = await SignalsmithStretch(audioContext)` → returns AudioWorkletNode; connect into graph: `mediaStreamSource → stretchNode → destination`. Register MessagePort handler: on `SET_PITCH` → `stretch.schedule({semitones, output: audioContext.currentTime + 0.05})`. On `SET_BYPASS` → `stretch.schedule({active: !bypass, output: audioContext.currentTime + 0.05})`. Initial state: semitones=0, active=true. Must NOT implement offline mode; must NOT add Rubber Band to AudioWorklet yet (that's Todo 14). Keep Signalsmith code modular so it can be replaced in Phase B.
  Parallelization: Wave 4 | Blocked by: 1,2,3 | Blocks: 6,14
  References:
  - [Signalsmith Stretch release README](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/README.md) — `SignalsmithStretch(audioContext)` factory, `schedule()` API
  - [Signalsmith Stretch web-wrapper.js](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/web-wrapper.js) — AudioWorklet processor registration pattern (createNode with Blob URL)
  - [Signalsmith Stretch demo index.html](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/demo/index.html) — end-to-end instantiation example
  - [Signalsmith npm package](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/package.json) — `signalsmith-stretch@1.0.0` MIT
  Acceptance criteria (agent-executable):
  - Audio passes through Signalsmith Stretch in AudioWorklet without clicks/glitches
  - Setting semitones to +5 (via MessagePort) → audible pitch shift upward
  - Setting semitones to -7 → audible pitch shift downward
  - Bypass toggle → audio returns to original pitch (no shift)
  - Console shows no AudioWorklet errors during 60 seconds of continuous playback
  QA scenarios:
  - happy: play YouTube music → set +5 st → higher pitch; bypass → original pitch; no audio glitches
  - failure: semitones = +13 (beyond ±12) → no crash, audio continues (clamp or log warning)
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-4-pitch-transpose-extension.log
  Commit: Y | feat(dsp): Signalsmith Stretch AudioWorklet integration with semitones/bypass control

- [x] 9. 本機檔案匯出管線
  What to do / Must NOT do:
  Popup: add "Select File" button → hidden `<input type="file" accept="audio/*,audio/wav,audio/mp3,audio/flac,audio/ogg,audio/m4a">` → on file select, send file ArrayBuffer to offscreen via `chrome.runtime.sendMessage({type:'EXPORT_FILE', data: arrayBuffer})`. Offscreen: decode via `audioContext.decodeAudioData(arrayBuffer)` → get AudioBuffer → extract channel data (Float32Array per channel) → send to RB Worker via INIT + repeated PROCESS calls in `getBlockSize()` chunks → collect output Float32Array chunks → concatenate → send to format writer (Todo 10 or 11). Track progress via `chrome.storage.local.set({exportProgress: N%})`. Must NOT play audio during export; must NOT implement WAV/Opus writing (that's Todos 10/11); must NOT allow very large files (>200MB) — add size guard.
  Parallelization: Wave 4 | Blocked by: 1,2,8 | Blocks: 10,11
  References:
  - [MDN decodeAudioData](https://developer.mozilla.org/en-US/docs/Web/API/BaseAudioContext/decodeAudioData) — returns Promise<AudioBuffer>
  - [MDN AudioBuffer.getChannelData](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData) — returns Float32Array for a channel
  - [Chrome extension messaging](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) — `sendMessage` for large data (ArrayBuffer transferable)
  - [RubberBandLiveShifter getBlockSize](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html) — fixed block size, process in chunks
  Acceptance criteria (agent-executable):
  - Select a 30-second WAV file → decoded, processed in chunks by RB Worker → output buffers cover full input length (no samples lost)
  - Progress stored in chrome.storage updates (exportProgress goes from 0 to 100)
  - File >200MB → popup shows "File too large" warning, no processing
  - Corrupted file → decodeAudioData rejects → error message in popup, no crash
  QA scenarios:
  - happy: select 30s WAV → exportProgress reaches 100; output buffer length = input length (±1 block)
  - failure: select corrupted .txt file → error "Unable to decode audio file"
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-9-pitch-transpose-extension.log
  Commit: Y | feat(export): local file decode + Rubber Band Worker offline render pipeline

<!-- WAVE 5 — 匯出格式器 (parallel) -->

- [x] 10. WAV 匯出（手寫 PCM16 header + download）
  What to do / Must NOT do:
  Create `src/lib/wav-writer.ts`: function `writeWav(channels: Float32Array[], sampleRate: number): Blob` — (1) compute: numChannels, bitsPerSample=16, byteRate=sampleRate×channels×2, blockAlign=channels×2, dataSize=totalSamples×2; (2) allocate ArrayBuffer of 44+dataSize bytes; (3) write RIFF header: "RIFF" + fileSize + "WAVE"; (4) write fmt chunk: "fmt " + 16 + PCM(1) + numChannels + sampleRate + byteRate + blockAlign + bitsPerSample; (5) write data chunk: "data" + dataSize; (6) interleave channels, clamp [-1,1], scale to Int16 (`Math.round(sample * 0x7FFF)`); (7) return new Blob([buffer], {type:'audio/wav'}). Trigger download via `URL.createObjectURL(blob)` + temporary `<a download="transposed.wav">`. Must NOT support 24-bit or 32-bit float; must NOT add compression or metadata tags.
  Parallelization: Wave 5 | Blocked by: 9 (needs output buffers) | Blocks: 12,13
  References:
  - [WAV file format specification](https://www-mmsp.ece.mcgill.ca/Documents/AudioFormats/WAV/WAV.html) — RIFF structure, 44-byte header layout
  - [PCM16 encoding](https://developer.mozilla.org/en-US/docs/Web/API/AudioBuffer/getChannelData) — Float32 [-1,1] → Int16 [-32768,32767]
  Acceptance criteria (agent-executable):
  - `writeWav([channel0, channel1], 44100)` returns Blob of type `audio/wav`
  - First 4 bytes of Blob = `0x52 0x49 0x46 0x46` ("RIFF")
  - Bytes 8-11 = `0x57 0x41 0x56 0x45` ("WAVE")
  - Bytes 12-15 = `0x66 0x6D 0x74 0x20` ("fmt ")
  - Blob size = 44 + (totalSamples × numChannels × 2)
  - Produced WAV plays correctly in VLC / macOS `afplay`
  QA scenarios:
  - happy: process 44100Hz stereo 1s audio → WAV Blob, header bytes verified, file plays correctly; file size = 44 + (44100×2×2) = 176444 bytes
  - failure: empty input channels → produces minimal valid WAV (44 bytes, dataSize=0), plays silently without error
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-10-pitch-transpose-extension.log
  Commit: Y | feat(export): WAV writer with PCM16 encoding

- [x] 11. Opus 匯出（WebCodecs AudioEncoder + download）
  What to do / Must NOT do:
  Create `src/lib/opus-encoder.ts`: async function `encodeOpus(channels: Float32Array[], sampleRate: number): Blob` — (1) check `typeof AudioEncoder !== 'undefined'`; if unavailable, return null (fallback to WAV); (2) create `AudioEncoder({output: (chunk) => chunks.push(chunk), error: console.error})`; (3) configure `{codec:'opus', sampleRate, numberOfChannels: channels.length}`; (4) interleave channels to AudioData-compatible Int16 or Float32; (5) encode in 1024-sample frames via `encoder.encode(new AudioData({...}))`; (6) `await encoder.flush()`; (7) concatenate EncodedChunk.data → Blob with type `audio/ogg` or `audio/webm`; (8) trigger download as `transposed.opus`. Fallback: if WebCodecs unavailable → log warning, skip Opus export, WAV only. Must NOT implement AAC/MP3; must NOT implement OggContainerWriter (use raw concatenated chunks or simple WebM header if needed).
  Parallelization: Wave 5 | Blocked by: 9 (needs output buffers) | Blocks: 12,13
  References:
  - [MDN AudioEncoder](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder) — configure, encode, flush, codec 'opus'
  - [MDN AudioData](https://developer.mozilla.org/en-US/docs/Web/API/AudioData) — constructor for raw audio frames
  - [WebCodecs supported codecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API) — Opus supported for encoding; MP3 NOT supported
  - [Chrome AudioEncoder availability](https://developer.mozilla.org/en-US/docs/Web/API/AudioEncoder#browser_compatibility) — available in Chrome 94+, extension pages (secure context)
  Acceptance criteria (agent-executable):
  - `encodeOpus([ch0, ch1], 48000)` returns Blob of type `audio/ogg` or `audio/webm` (not null)
  - Produced file plays in VLC / browser `<audio>` element
  - If WebCodecs unavailable (simulated): returns null, no crash
  QA scenarios:
  - happy: encode 30s audio → Opus Blob, plays correctly; file size < WAV equivalent (compression ratio ~10:1)
  - failure: WebCodecs not available (mock) → returns null, console warning logged, WAV-only path still works
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-11-pitch-transpose-extension.log
  Commit: Y | feat(export): Opus encoder via WebCodecs AudioEncoder

<!-- WAVE 6 — 測試 + 打包 (parallel) -->

- [x] 12. 自動化測試（pitch math + WAV + Opus + Worker）
  What to do / Must NOT do:
  Create `src/tests/pitch-math.test.ts`: verify half-steps→ratio conversion: `Math.pow(2, 0/12) === 1.0`; `Math.pow(2, 12/12) === 2.0`; `Math.pow(2, -12/12) === 0.5`; `Math.pow(2, 7/12)` ≈ 1.498307 (to 6 decimal places); `Math.pow(2, 0.5/12)` ≈ 1.029302 (cents). Create `src/tests/wav-writer.test.ts`: verify RIFF header bytes (first 4 = "RIFF", bytes 8-11 = "WAVE", bytes 12-15 = "fmt "); verify file size formula: 44 + (samples × channels × 2); verify PCM16 clamping: input 1.0 → output 32767; input -1.0 → output -32768; input 0.0 → output 0. Create `src/tests/opus-encoder.test.ts`: verify AudioEncoder accepts 'opus' codec string (mock AudioEncoder if needed); verify null fallback when AudioEncoder undefined. Create `src/tests/rb-worker.test.ts`: mock WebAssembly module with getBlockSize() returning 1024, setPitchScale() storing value, shift() returning input copy; verify INIT sets pitch, PROCESS returns same-length buffer. Use vitest. Must NOT test UI components; must NOT test actual audio quality.
  Parallelization: Wave 6 | Blocked by: 10,11 | Blocks: 13
  References:
  - [vitest docs](https://vitest.dev/guide/) — test runner configuration for Vite projects
  - [Pitch-to-ratio formula](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html) — `pow(2.0, S / 12.0)`
  - [WAV format spec](https://www-mmsp.ece.mcgill.ca/Documents/AudioFormats/WAV/WAV.html) — header byte offsets
  Acceptance criteria (agent-executable):
  - `npx vitest run` exits 0 with all tests passing
  - pitch-math: 6+ test cases, all pass to 6 decimal places
  - wav-writer: header structure tests, size formula, PCM16 clamping (3+ tests)
  - opus-encoder: codec acceptance test, null fallback test (2+ tests)
  - rb-worker: mock init/process tests (2+ tests)
  QA scenarios:
  - happy: `npx vitest run` → "15 tests passed" (or similar)
  - failure: intentionally wrong ratio (e.g. `Math.pow(2, 12/12) === 3.0`) → test fails with clear message: "expected 2.0, received 3.0"
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-12-pitch-transpose-extension.log
  Commit: Y | test(dsp): pitch math, WAV writer, Opus encoder, Worker correctness tests via vitest

- [x] 13. Edge/CWS 打包 + 授權文件 + README
  What to do / Must NOT do:
  Finalize `dist/manifest.json`: add `name` ("Pitch Transpose"), `description`, `icons` (16/48/128px — generate simple SVG icons); add `version` field ("1.0.0"). Create `LICENSE`: GPLv2+ for Rubber Band portions (with attribution: "Rubber Band Library © 2007-2024 Tim Bright / Breakfast Quay"), MIT for Signalsmith Stretch (© Geraint Luff / Signalsmith Audio), project MIT for custom code. Create `README.md`: installation instructions (clone, npm install, npm run build, load unpacked), usage instructions (open YouTube, click extension, adjust slider), feature list, license section, link to Rubber Band and Signalsmith Stretch repos. Ensure production build: no source maps (`build.sourcemap: false` in vite.config), minified JS. Create `.zip` of dist/ for store submission. Must NOT implement i18n; must NOT set up automated publishing; must NOT add analytics.
  Parallelization: Wave 6 | Blocked by: 12 | Blocks: 14
  References:
  - [Chrome Web Store listing requirements](https://developer.chrome.com/docs/webstore/publish) — name, description, icons, version
  - [GPLv2 license text](https://www.gnu.org/licenses/old-licenses/gpl-2.0.html) — required for Rubber Band portions
  - [Signalsmith Stretch LICENSE.txt](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/LICENSE.txt) — MIT, © Geraint Luff
  - [Rubber Band license](https://breakfastquay.com/rubberband/license.html) — GPLv2+ attribution requirements
  Acceptance criteria (agent-executable):
  - `dist/manifest.json` contains name, description, version, icons (3 sizes)
  - `LICENSE` contains three sections: GPLv2 (Rubber Band), MIT (Signalsmith), MIT (project)
  - `README.md` has: install steps, usage steps, feature list, license section
  - `npm run build` produces clean dist/ (no source maps, minified JS)
  - `zip -r dist.zip dist/` succeeds
  QA scenarios:
  - happy: load unpacked dist/ in Chrome → no errors; zip contains all required files
  - failure: missing icons → Chrome shows default puzzle piece; LICENSE missing GPL section → audit fails
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-13-pitch-transpose-extension.log
  Commit: Y | chore(release): CWS packaging, LICENSE (GPL+MIT), README with install/usage instructions

<!-- WAVE 7 — Phase B (sequential) -->

- [x] 14. RB LiveShifter 即時引擎替換（Phase B）
  What to do / Must NOT do:
  In AudioWorkletProcessor: replace Signalsmith Stretch instantiation with RubberBandLiveShifter WASM instantiation; same WASM binary as offline export (Todo 7). Implementation: load rubberband.wasm in AudioWorklet context (via Blob URL or fetch from extension path); call `init(44100, channels, pitchScale)` on capture start; in `process(input, output)`: accumulate input into ring buffer; when `getBlockSize()` samples available, call `shift(inputBlock, outputBlock)`; output from processed ring buffer. Preserve same MessagePort interface (SET_PITCH/SET_BYPASS) from Todo 6. Keep Signalsmith code in a separate module as fallback (e.g. `src/lib/dsp/signalsmith-fallback.ts`) so it can be toggled. Must NOT remove Signalsmith code (keep for A/B comparison in Todo 15); must NOT change popup UI or storage sync; must NOT alter offline export path.
  Parallelization: Wave 7 | Blocked by: 6,7,8 | Blocks: 15
  References:
  - [RubberBandLiveShifter](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html) — block-based API: `shift(const float*const* input, float*const* output)`, `getBlockSize()`, `getStartDelay()`
  - [Todo 8 rb-worker.ts](src/worker/rb-worker.ts) — reference for WASM loading and LiveShifter init pattern
  - [AudioWorkletProcessor.process MDN](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) — 128-frame blocks, must not allocate
  - [Signalsmith Stretch process pattern](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/web-wrapper.js) — ring buffer + block processing reference
  Acceptance criteria (agent-executable):
  - Audio passes through RubberBandLiveShifter in AudioWorklet
  - Setting semitones to +5 → audible pitch shift (same as Signalsmith did)
  - Setting semitones to -7 → audible pitch shift downward
  - Bypass toggle → audio returns to original pitch
  - Perceived latency <50ms (no more than Signalsmith)
  - No buffer underruns in 60s continuous playback (check via console timing)
  - Signalsmith fallback module still exists and is importable (not deleted)
  QA scenarios:
  - happy: play YouTube music → RB LiveShifter transposes +5 st; bypass → original; no clicks/glitches
  - failure: WASM load fails in AudioWorklet → fallback to Signalsmith (existing module), error logged; no silent failure
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-14-pitch-transpose-extension.log
  Commit: Y | feat(dsp): replace Signalsmith with RubberBandLiveShifter in AudioWorklet (Phase B)

- [x] 15. A/B 品質比對工具（隱藏 debug 模式）
  What to do / Must NOT do:
  Add hidden debug mode in popup: activated by holding Shift+click on bypass button (or keyboard shortcut). In debug mode: popup shows two buttons "A (Signalsmith)" and "B (RB LiveShifter)"; clicking toggles between engines in real-time by sending a `{type:'SET_ENGINE', engine:'signalsmith'|'rubberband'}` message to offscreen; offscreen swaps the active AudioWorklet processing path. Log A/B switch timestamps to console (`console.log('[A/B] Switched to X at T+Ns')`). Add a 50ms crossfade on switch to avoid clicks (gain ramp: current engine gain 1→0, new engine gain 0→1 over 50ms). Must NOT make A/B comparison visible in normal mode; must NOT implement automated quality scoring.
  Parallelization: Wave 7 | Blocked by: 14 | Blocks: F1–F4
  References:
  - [Web Audio GainNode](https://developer.mozilla.org/en-US/docs/Web/API/GainNode) — `gain.setValueAtTime` + `gain.linearRampToValueAtTime` for crossfade
  - [AudioWorklet gain parameter](https://developer.mozilla.org/en-US/docs/Web/API/AudioWorkletProcessor/process) — can apply gain ramp in process() via output scaling
  - [Todo 14 fallback structure](src/lib/dsp/) — both engines available, swappable via message
  Acceptance criteria (agent-executable):
  - Normal mode: Shift+click bypass → enters debug mode, popup shows A/B buttons
  - Click "A" → audio processes through Signalsmith; click "B" → audio processes through RB LiveShifter
  - Switch happens without clicks or gaps (50ms crossfade audible)
  - Console logs: `[A/B] Switched to rubberband at T+12.345s`
  - Exit debug mode: Shift+click again → returns to normal mode, A/B buttons hidden
  QA scenarios:
  - happy: enter debug → switch A↔B multiple times → no audio glitches, console logs present
  - failure: WASM not loaded for one engine → that engine button disabled, log warning, other engine still works
  - Evidence: .omo/evidence/ulw/<session>/<goalId>/a<attempt>/task-15-pitch-transpose-extension.log
  Commit: Y | feat(debug): hidden A/B comparison between Signalsmith and RubberBand LiveShifter

## Final verification wave
> Runs in parallel after ALL todos. ALL must APPROVE. Surface results and wait for the user's explicit okay before declaring complete.

- [x] F1. Plan compliance audit — verify every todo (1–15) is implemented and all acceptance criteria pass; check manifest.json has all required fields; confirm LICENSE contains GPLv2 (Rubber Band) + MIT (Signalsmith + project); confirm no source maps in production build
- [x] F2. Code quality review — TypeScript strict mode passes (`tsc --noEmit` exits 0); ESLint clean (no `any` types, no unused imports); all vitest tests pass; no `console.error` in happy-path code
- [ ] F3. Real manual QA — human listens to: YouTube playback with ±1, ±5, ±12 semitones (both directions); bypass comparison (A/B); file export: load a local .wav → export WAV + Opus → play both in VLC; check no audio glitches during 60s continuous playback at ±5 semitones; check popup slider responsiveness (no lag); check popup close/reopen state persistence
- [x] F4. Scope fidelity — confirm: no tempo control implemented; no region loop UI; no seek UI in extension; no stream recording/download feature; no local file player (export only); popup-only (no separate player page); WAV+Opus only (no MP3); Chrome+Edge only (no Firefox-specific code)

## Commit strategy
Each todo produces one atomic commit. Commit messages follow conventional commits:
- `feat(scope)`: new feature (ext, offscreen, capture, dsp, ui, state, worker, export, debug)
- `feat(wasm)`: WASM compilation
- `test(scope)`: test additions
- `chore(release)`: packaging, documentation
Final verification (F1-F4) produces no commits — they audit only.

## Success criteria
1. Extension loads in Chrome/Edge without errors; popup renders with slider + bypass
2. YouTube tab audio transposes ±12 semitones in real-time with no clicks/glitches
3. Local .wav file → export to WAV + Opus → both play correctly
4. All 15+ vitest tests pass
5. Phase B: RB LiveShifter produces comparable quality to Signalsmith in real-time
6. LICENSE correctly attributes Rubber Band (GPLv2+) and Signalsmith (MIT)
7. Human QA: pitch shift sounds natural (no phasiness, no formant distortion) at ±5 semitones on vocal, piano, drums tracks
