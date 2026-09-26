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

---

# ADR-0004 — per-page (URL) memory and tab follow

Date: 2026-09-26

## Automated checks

- `npm run typecheck` — passed. (The pre-change baseline at commit `e394944` was **failing** with 7 type errors, all in test files; they were fixed as part of this work.)
- `npm test` — 20 test files and 130 tests passed (81 baseline → 123 with ADR-0004 → 125 with the output-gate silence fix → 130 after the origin → page-URL memory rewrite).
- `npm run build` — passed; `dist/background.js` emitted at a stable (unhashed) path because `manifest.json` references it, and it imports `./assets/page-settings-*.js` relative to `dist/`.
- `dist/manifest.json` contains `"background": { "service_worker": "background.js", "type": "module" }`.
- Baseline regression check: the 81 test titles present at `e394944` were compared title-by-title against the current run — **none missing**.
- New coverage: `page-settings.test.ts` (page-URL keying incl. query kept / fragment dropped, separate records for two videos on one site, legacy `site:` key detection, sparse storage, `planTabActivation`, divergence, `deriveBadge`), `output-gate.test.ts` (ramp scheduling / early dispose), `capture-session.test.ts` (service-worker mirror reducer → badge), plus serialization and atomic-handover cases in `offscreen-messages.test.ts`.

## Chrome runtime checks — pending

Load `dist` as an unpacked extension and walk the ADR-0004 acceptance list. Record the measured numbers here.

- [ ] **Per-page memory round trip**: page A → +3 st / RubberBand → switch to page B → clean defaults (0 st, Signalsmith) → switch back to A → +3 st restored. Confirm exactly one capture stream existed throughout (`chrome://media-internals` or `chrome://webrtc-internals`).
- [ ] **Two videos on one site stay independent** (the rewrite that motivated the page-URL change): YouTube video A at +3 st → switch to video B (`?v=` differs) → B comes back at 0 st → back to A → +3 st. Also confirm a `#fragment` jump inside video A still reads A's record.
- [ ] **Handover window**: measure the gap between the outgoing tab being released and the incoming tab's audio reaching full level. Target: original-audio leak ≤ 400 ms. Also confirm no audible "old tab playing with the new page's settings" and no double-audio during the fade. Record the ms value in the table below.
- [ ] **Unauthorized tab**: with a capture running on page A, switch to a tab that never had the popup opened → capture must not be interrupted, badge must turn `ON·`, popup must show the captured tab's title and **改擷取此分頁** → clicking it captures the active tab and unlocks the controls.
- [ ] **Page change in the captured tab**: follow an in-page link to a different URL (cross-site **or** same-site, e.g. the next YouTube video / Spotify track) → capture survives and settings are re-read for the new page. Re-touching the same page (fragment jump, title-only update) must send **zero** `SET_*` messages (verify in the offscreen console).
- [ ] **Rapid switching**: 5 × Ctrl+Tab in quick succession → a single handover; concurrently fire `REQUEST_CAPTURE` from the popup → no leftover stream, final state matches the last intent.
- [ ] **Capture lost**: close the captured tab → badge turns red `!` with no popup open (driven by `CAPTURE_EVENT`).
- [ ] **Divergence locking**: same URL in two tabs → banner shown, controls **not** locked. A different page (same site, other video) → banner shown and controls **locked**; the popup polls every 600 ms and unlocks itself once the service worker's 400 ms follow lands on your tab.
- [ ] **Sparse storage**: return every value to its default on a page → the `page:<url>` key disappears. After upgrading from a pre-ADR-0004 build, the 6 flat keys **and every `site:<origin>` key** are gone and `snapToInteger` survives.

### Handover measurements

| Scenario | Debounce | `getUserMedia` | Gate fade | Total (reported as handover window) |
| --- | --- | --- | --- | --- |
| Same URL, other tab | — | ms | ms | ms |
| Same site, other video (`?v=` differs) | 400 ms | ms | ms | ms |
| Cross-site switch, engine only | 400 ms | ms | ms | ms |
| Cross-site switch, accompaniment on → off | 400 ms | ms | ms | ms |

### Observations to confirm or refute

- Does `chrome.tabCapture.getMediaStreamId({ targetTabId })` work when called from the background service worker? (If not: fall back to the documented degradation — the SW only records intent in `storage.session` and the popup/offscreen issues the stream.)
- Is background-tab audio throttled or muted by Chrome while another tab is active?
- Does the capture stream survive a same-tab navigation, or does `captureLost` fire first? (Both paths are implemented; the log line to look for is `[offscreen] Capture → <page URL>` vs `CAPTURE_EVENT … captureLost: true`.)
