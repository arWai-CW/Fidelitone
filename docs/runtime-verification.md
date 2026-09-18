# Runtime verification notes

Date: 2026-09-17

## Automated checks

- `npm run typecheck` — passed.
- `npm test` — 8 test files and 45 tests passed.
- `npm run build` — passed.
- Generated worklet assets were present:
  - `dist/processors/crossover-processor.js`
  - `dist/processors/lowband-resampler.js`
  - `dist/processors/passthrough-processor.js`
  - `dist/processors/rubberband-processor.js`
  - `dist/processors/signalsmith-stretch.js`
- Generated worklet scripts passed `node --check`.
- `git diff --check` — passed.
- Built offscreen bundle contains the static Signalsmith module URL (`processors/signalsmith-stretch.js`). The remaining `blob:` text is RubberBand's Emscripten glue path normalization, not the Signalsmith worklet loader.
- Lowband stress coverage includes rates `0.5`, `1`, `1.5`, and `2`, stereo continuity, pitch updates, input-gap recovery, long-stream continuity, invalid-rate clamping, and bounded low-rate latency.

## Chrome runtime checks

A real Chrome extension session was exercised by loading `dist` as an unpacked extension. The popup attempted automatic tab capture, switched from `Connect` to `Disconnect` after capture, and returned to `Connect` after Disconnect. Signalsmith initialized without the prior blob worklet error.

Accompaniment mode also initialized successfully with RubberBand and Signalsmith active. The previous `Timed out waiting for INIT_OK` failure no longer occurred, and the resulting audio was reported as high quality without severe lowband gaps, clicks, or crackle during the runtime check.

The automated checks verify the static asset path, graph/state logic, and DSP continuity; the Chrome session confirms the extension lifecycle and audible accompaniment behavior end to end.

## Accompaniment INIT_OK timeout fix

Chrome reported `Timed out waiting for INIT_OK` while RubberBand and Signalsmith were already active. The crossover and lowband processors answer `INIT` correctly in an isolated worklet harness, so the failure is treated as an AudioWorklet startup/ACK timing issue under live engine load rather than a processor protocol defect.

The fix now:

- explicitly starts the worklet message port before registering the ACK listener;
- waits up to 10 seconds per accompaniment worklet;
- retries the idempotent `INIT` once after 250 ms if the first ACK is delayed or lost;
- includes the worklet name in timeout errors;
- gives the popup a 25-second window for `SET_ACCOMPANIMENT`, including automatic settings restoration.

Regression coverage is in `src/tests/worklet-message.test.ts`.
