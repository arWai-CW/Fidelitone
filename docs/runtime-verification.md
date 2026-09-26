# Runtime verification notes

> Each dated section below is a snapshot taken when that ADR was implemented.
> Later ADRs supersede parts of them; the current automated-check state is the
> most recent section at the bottom of this file.

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

---

# ADR-0005 — YouTube 頁面音量與響度補正

Date: 2026-09-26

> **ADR-0006 修訂**：本區塊的響度分析／量測項目（量測、建議閉環、達上限、量測中切換、恢復基準）已全部失效——按鈕與顯示改版見文末 ADR-0006 區塊。

## Automated checks

- `npm run typecheck` — passed.
- `npm test` — 21 test files and 139 tests passed（`volume.test.ts` 含 `volumeDeltaPercent`；`loudness-meter.test.ts` 與 dB／建議測試已由 ADR-0006 移除；`page-settings.test.ts` 補 `isYouTubePage`；`offscreen-messages.test.ts` 曾補 `MEASURE_LOUDNESS` 與「不排隊」驗證，該協定已隨 ADR-0006 移除）。
- `npm run build` — passed；`dist/content.js`、`dist/content-main.js` 與 `dist/manifest.json` 的 `content_scripts` 均存在（兩筆：ISOLATED + `"world": "MAIN"`）。
- **兩支 content script 都必須是 classic script**：`grep -cE '(^|[^.[:alnum:]_])(import|export)[ {*]' dist/content.js` 與 `dist/content-main.js` 皆為 0。曾實測踩雷：content entry 走 vite 時，`src/lib/volume.ts` 被 popup 共用而抽成 ESM chunk，`content.js` 以 `import` 開頭 → 頁面拋 `SyntaxError: Cannot use import statement outside a module` → listener 從未註冊 → 面板只顯示「此頁面找不到影片」。修法為 `npm run content`（esbuild IIFE，兩個 entry 一次打包成自足檔），`vite.config` 的 `emptyOutDir: false` 以免把成品刪掉。
- `git diff --check` — passed.

## Chrome runtime checks

- [ ] **Popup 不再自動連線**：開 popup → header 顯示「尚未連線／按連線開始處理此分頁音訊」，分頁原音不中斷；按「連線音訊」才接管（一次空隙）。
- [ ] **非 YouTube 頁面**：`YouTube 音量` 面板常駐；基準音量可編輯可持久化，套用／淡出皆停用，提示「此面板僅適用於 YouTube（www.youtube.com）」。
- [ ] **YouTube 未連線**：套用與淡出可用（`<video>.volume` 確實改變、500ms 漸變無跳變）——ADR-0006 後面板完全不依賴連線。
- [ ] **基準持久化**：改基準 → 重開 popup 仍在（全域鍵 `youtubeBaseVolume`）；改回 100 → 該鍵被刪除；不隨分頁 URL 分裂。
- [ ] **不自動覆寫**：頁面載入、開 popup 都不會改 `<video>.volume`；只有按鈕會。
- [ ] **原生 UI 同步**：套用／淡出後，播放器右下音量條把手 `left` 與目前音量一致（vol% × 40px）；目標 >0 解除靜音時音量圖示同步；ramp 期間把手連續跟動。播放器尚未就緒（剛載入、剛 SPA 導覽）時退回直寫屬性，聲音仍會變但滑桿不動——屬預期降級。
- [ ] **跨 world 橋**：build → `chrome://extensions` 重載 → **重新載入 YouTube 分頁**（兩支腳本只在分頁載入時注入）→ 設定音量後滑桿跟動且無錯誤；跳過重新載入分頁 → 顯示「頁面音量控制未回應：重載擴充功能後，請重新載入此分頁」（MAIN 缺席的可見失敗，不是靜默失效）。
- [ ] **ramp 重定**：爬升中按「套用」另一值 → 舊 ramp 被取消、從當前值重新導向，不疊加、不跳回。
- [ ] **分歧鎖定**：音訊擷取在別的頁面時，面板仍作用於 popup 開啟的那個分頁（音量寫入不經擷取管線，不受分歧影響）。

---

# ADR-0006 — 移除響度分析，面板改用百分比與淡出

Date: 2026-09-26

## Automated checks

- `npm run typecheck` — passed.
- `npm test` — 21 test files and 139 tests passed（`loudness-meter.test.ts` 整檔刪除；`volume.test.ts` 移除 dB／建議區塊、新增 `volumeDeltaPercent`；`offscreen-messages.test.ts` 移除「loudness measurement」）。
- `npm run build` — passed；`dist/content.js` 與 `dist/content-main.js` 仍為 classic script（`grep -cE '(^|[^.[:alnum:]_])(import|export)[ {*]'` 皆為 0）。
- 殘留掃描：`src/`、`manifest.json` 無 `loudness`／`MEASURE_LOUDNESS`／`analyzeBtn`／`volumeRestoreBtn`／`volumeBaseDb` 引用（popup 註解中的脈絡提及除外）。
- `git diff --check` — passed.

## Chrome runtime checks

- [ ] **`%` 後綴**：基準音量輸入框右側顯示 `%`（不再是 `0.0 dB`）；改輸入值不影響該符號。
- [ ] **套用為圖示**：套用按鈕是勾選 SVG（無文字），滑過顯示 tooltip「套用基準音量」；點擊後原生音量條與靜音圖示同步（功能與原本一致）。
- [ ] **淡出**：按「淡出」→ 音量 500ms 漸降到 0、原生把手滑到 0；基準值不變（重開 popup 基準仍是原值）；偏離提示顯示「目前音量為 0」。
- [ ] **百分比偏離**：基準 100、套用 80 → 提示「目前音量比基準低 20%」；套用回 100 → 「目前音量與基準一致」；基準 50、套用 60 → 「目前音量比基準高 20%」。
- [ ] **面板離線可用且置頂**：`YouTube 音量` 面板在 header 下方、連線列之前（`reveal-delay-1`）；未連線狀態下套用／淡出直接生效（無「按連線後即可分析」之類提示）。
- [ ] **分析不復存在**：面板無「響度分析」區塊與「分析音量水平」按鈕；popup 程式碼不發送 `MEASURE_LOUDNESS`（offscreen 收到也回 error）。
- [ ] **連線功能未受影響**：移除 source 分支 tap 後，連線、切 bypass／伴奏／引擎、自動跟隨音訊皆正常（無多餘接線）。（「引擎」切換已由 ADR-0007 移除。）

---

# ADR-0007 — 單一移調引擎（移除 RubberBand）

Date: 2026-09-27

## Automated checks

- `npm run typecheck` — passed.
- `npm test` — **15 test files and 121 tests passed**（139 → 121：刪除 `rubberband-live-shifter.test.ts`、`rb-worker.test.ts`、`engine-switching.test.ts`、`audio-routing.test.ts`、`opus-encoder.test.ts`、`wav-writer.test.ts` 六檔；`graph-router.test.ts` 改寫，`offscreen-state.test.ts`／`popup-state.test.ts`／`page-settings.test.ts`／`offscreen-messages.test.ts`／`capture-session.test.ts`／`accompaniment.test.ts` 隨介面收斂調整；新增引擎缺席時的 passthrough fallback 與 `routeFor` 回報 `passthrough` 的驗證）。
- `npm run build` — passed。`dist/` 由 876 KB 降至 **392 KB**（`src/wasm/rubberband.wasm` 468 KB 移除）。
- `dist/processors/` 僅剩 `crossover-processor.js`、`lowband-resampler.js`、`passthrough-processor.js`、`signalsmith-stretch.js`。
- 殘留掃描：`grep -ri "rubberband" src/ dist/ manifest.json package.json` **無結果**；`docs/` 僅 ADR-0003 與 ADR-0007 的歷史記錄提及。
- 授權：`LICENSE` 為 MIT 全文，第三方元件僅 Signalsmith Stretch（MIT）；`README.md` 的 GPL 段落已移除。
- 死碼移除（無任何 production importer，ADR-0006 同一原則）：`src/lib/opus-encoder.ts`、`src/lib/wav-writer.ts`、`src/worker/rb-worker.ts`。
- `manifest.json` 的 CSP 仍需 `'wasm-unsafe-eval'`——Signalsmith Stretch 自帶 WASM。
- `git diff --check` — passed.
- 新增 CI：`.github/workflows/ci.yml` 跑 typecheck / test / build，並斷言兩支 content script 仍是 classic script（無 `import`／`export`）且 `dist/` 產物齊全。

## Chrome runtime checks — pending

Load `dist` as an unpacked extension and walk the list below. Record the results here.

- [ ] **信號路徑讀數**：連線 YouTube 音訊 → 「信號路徑」顯示 `Signalsmith`／「即時移調，節奏不變」；拖動打孔軌到 +3 st，音高改變而節奏不變，讀數即時更新。
- [ ] **伴奏模式**：開啟後「信號路徑」轉為 `伴奏`；低頻（bass／kick）確實跟著移調，無爆音、無低頻缺口。這條路徑從未 involve RubberBand，行為應與移除前一致。
- [ ] **旁路**：開啟後顯示 `旁路`；bypass 按鈕呈 grease 叉；音訊為原始未處理輸出。
- [ ] **共振峰保護**：開啟後人聲音色不隨移調改變（Signalsmith 的 `formantCompensation`，非移除前的 RubberBand 路徑）。
- [ ] **未連線**：顯示 `待命`／「尚未連線」。
- [ ] **引擎未啟動的誠實呈現**：若可製造引擎初始化失敗（例如阻擋 `processors/signalsmith-stretch.js`），應顯示 `未處理`／「移調引擎未啟動，音訊直接通過」且記號為橘色 grease 叉，而不是假裝在處理。
- [ ] **handover 交接**：切換分頁後輸出總閘淡出淡入無爆音，且新分頁的頁面記憶正確套用。
- [ ] **舊記錄相容**：從移除前的版本升級，既有 `page:<url>` 記錄裡殘留的 `engine` 欄位不造成錯誤，且任一設定變更後該欄位消失。
- [ ] **延遲量測**：量一次 Signalsmith 的實際輸出延遲（`node.latency()`），記錄在 README——這是移除雙引擎後唯一還缺的公開數據。

## Latency measurement

Measured with `tools/latency-probe` (`npm run latency`), Chromium, 48 kHz, a
tap worklet timestamping the impulse's arrival. The impulse is started at a
time chosen independently of the number being checked, so the measurement does
not inherit `latency()`.

| configuration | `node.latency()` | measured |
| --- | --- | --- |
| `blockMs 80 / intervalMs 20 / splitComputation: true` (shipping) | 100.0 ms | 100.0 ms |
| `blockMs 80 / intervalMs 20 / splitComputation: false` | 80.0 ms | 80.0 ms |
| `blockMs 40 / intervalMs 10 / splitComputation: true` | 50.0 ms | 50.0 ms |
| `blockMs 20 / intervalMs 5 / splitComputation: true` | 25.0 ms | 25.0 ms |
| `blockMs 160 / intervalMs 40 / splitComputation: true` | 200.0 ms | 200.0 ms |

Platform buffering on the same machine: `baseLatency` 5.33 ms, `outputLatency`
16.00 ms. tabCapture's input buffering is not documented by Chrome and is not
included; an end-to-end figure needs acoustic A/B measurement against a loopback
capture, which this repo does not attempt.

Method notes:

- **Offline rendering does not work for this library.** Its worklet resolves
  `factory()` from a `port.postMessage` handshake, and an `OfflineAudioContext`
  renders to completion before the main thread can service that message, so the
  node never initialises and the render comes back silent. This was tried first
  and abandoned; the realtime tap replaced it.
- `splitComputation: true` costs 20 ms. It spreads the stretcher's work across
  render quanta, which is why the shipping configuration carries it.
- Latency is linear in `blockMs`. Halving it halves the delay.

Consequences recorded in code and docs:

- `README.md` no longer claims "minimal latency"; it quotes 100 ms.
- `ACCOMPANIMENT_ALIGN_DELAY_S = 0.09` is now explained: the engine's 100 ms
  minus the lowband path's own ~10 ms. The two constants are in different files
  with nothing enforcing the relationship, so both sites now carry a comment
  warning that changing `blockMs` requires re-deriving the alignment.

Not evaluated: whether a lower-latency configuration sounds acceptable. That
needs a listening test, so the shipping configuration is unchanged.
