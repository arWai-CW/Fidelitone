---
slug: pitch-transpose-extension
status: drafting
intent: clear
review_required: false
pending-action: write .omo/plans/pitch-transpose-extension.md
approach: <fill: the approach you intend to plan>
---

# Draft: pitch-transpose-extension

## Components (topology ledger)
| id | outcome (one line) | status | evidence path |
|----|--------------------|--------|---------------|
| C1 | 音訊來源與載入：能取得並解碼待轉調的音訊檔案 | active | pending user decision on scope |
| C2 | 即時預覽引擎：Signalsmith Stretch 在 AudioWorklet 內做 ±12 半音即時轉調 | active | [signalsmith-stretch repo](https://github.com/Signalsmith-Audio/signalsmith-stretch) |
| C3 | 播放控制：pitch/bypass/A-B/loop/seek 控制面 | active | pending user decision |
| C4 | 離線匯出引擎：高品質離線渲染 + 格式封裝 | active | pending user decision on lib + format |
| C5 | 擴充功能外殼 + UI：MV3 擴充、UI 頁面、CSP/WASM 整合 | active | [Chrome MV3 CSP](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security) |
| C6 | 打包與發布：授權清理、商店打包、測試策略 | active | pending user decision |

## Open assumptions (announced defaults)
| assumption | adopted default | rationale | reversible? |
|-----------|----------------|-----------|-------------|
| 構建工具 | TypeScript + Vite | 需要型別安全處理 WASM binding，Vite 做 extension bundling 成熟 | 是，可換 |
| MV3 CSP | `script-src 'self' 'wasm-unsafe-eval'; worker-src 'self'` | Signalsmith Stretch 不需要 SharedArrayBuffer | 是 |
| AudioWorklet 載入方式 | Signalsmith 內建 Blob URL 方案可直接在 extension 頁面運作 | 官方 demo 已驗證 | 是 |
| 離線匯出格式（若無 MP3） | WAV 保底 + WebCodecs Opus 或 AAC | Chrome 不支援 mp3 編碼（見 findings） | 是，可用 lamejs 加回 mp3 |

## Findings (cited)

### Signalsmith Stretch
- npm `signalsmith-stretch` v1.0.0, MIT license (Geraint Luff)
  - Source: [package.json](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/package.json)
- WASM binary **embedded inside JS file** — no separate .wasm file needed
- 實例化：`let stretch = await SignalsmithStretch(audioContext)` → returns `AudioWorkletNode`
- Pitch 設定：`stretch.schedule({semitones: -5, rate: 1, tonalityHz: 8000, output: ctx.currentTime + 0.1})`
  - Source: [release README](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/release/README.md)
- **不使用 SharedArrayBuffer** — 用 MessagePort 通訊（verified in web-wrapper.js）
- 支援任何 sample rate（44100/48000 皆可）
  - Source: [web-wrapper.js](https://github.com/Signalsmith-Audio/signalsmith-stretch/blob/main/web/web-wrapper.js)

### Rubber Band
- v4.0 released 25 Oct 2024，新增 `RubberBandLiveShifter` API（pitch-only, 低延遲）
  - Source: [breakfastquay.com](https://breakfastquay.com/rubberband)
- API: `RubberBandLiveShifter(sampleRate, channels, options)` → `.setPitchScale(pow(2, semitones/12))` → `.shift(input, output)`
  - Source: [Class Reference](https://breakfastquay.com/rubberband/code-doc/classRubberBand_1_1RubberBandLiveShifter.html)
- Daninet/rubberband-wasm **停在 v3.3.0**，最後 commit 2023，不含 v4.0 API
  - Source: [build.sh](https://github.com/Daninet/rubberband-wasm/blob/master/build.sh)
- **Chrome Web Store 需商業授權 £590+**（GPL 不允許 CWS 分發）
  - Source: [breakfastquay.com/license](https://breakfastquay.com/rubberband/license.html), [commercial pricing](https://breakfastquay.com/technology/license.html)
- v4.0 WASM 編譯：需自行 Emscripten 編譯（Meson build + KissFFT/Speex，單線程，無 SIMD）
  - Source: [COMPILING.md](https://github.com/breakfastquay/rubberband/blob/default/COMPILING.md), [Daninet build.sh](https://github.com/Daninet/rubberband-wasm/blob/master/build.sh)

### Chrome Extension MV3
- WASM 支援：`wasm-unsafe-eval` CSP（Chrome 102+）
  - Source: [developer.chrome.com](https://developer.chrome.com/docs/extensions/develop/migrate/improve-security)
- Extension pages = secure contexts → Web Audio / AudioWorklet / WASM 全部可用
- AudioWorklet 模組可用 Blob URL 或 `chrome.runtime.getURL()` 載入
- **不需 COOP/COEP**（無 SharedArrayBuffer）
- DedicatedWorker 可做離線 WASM 渲染
- Offscreen Document 支援 AudioWorklet（reason: `AUDIO_PLAYBACK`）
  - Source: [chrome.offscreen](https://developer.chrome.com/docs/extensions/reference/api/offscreen)

### 跨來源音訊捕捉
- `MediaElementAudioSourceNode` 在跨來源媒體上 **輸出靜音**（CORS tainting）
  - Source: [Web Audio spec](https://webaudio.github.io/web-audio-api/#MediaElementAudioSourceOptions-security)
- tabCapture 可行：`getMediaStreamId()` → `getUserMedia({chromeMediaSource:"tab"})` → offscreen document
  - Source: [tabCapture docs](https://developer.chrome.com/docs/extensions/reference/api/tabCapture)
- ⚠️ 若 v1 只支援本機檔案，此問題不影響

### 離線匯出
- Chrome WebCodecs **不支援 MP3 編碼**（僅 Opus + AAC）
  - Source: [MDN WebCodecs](https://developer.mozilla.org/en-US/docs/Web/API/WebCodecs_API)
- FLAC 編碼尚未在 Chrome 實作
- WAV via 手動 PCM 寫入：最通用的離線匯出方案
- AudioEncoder 可在 offscreen document / extension page 使用，不可在 service worker

## Decisions (with rationale)
| decision | value | rationale |
|----------|-------|-----------|
| C1 音訊來源 | tabCapture 串流捕捉（主要）+ 本機檔案選檔（僅離線匯出，無播放器） | 用戶：串流是主要目的；Q9=b。`MediaElementAudioSourceNode` 對跨來源媒體輸出靜音（findings），串流唯一路徑 = tabCapture → offscreen document |
| C2 即時引擎 | MVP：Signalsmith Stretch（MIT, AudioWorklet）；**最終目標：遷移至 Rubber Band v4.0 `RubberBandLiveShifter` 即時處理** | 用戶：「最終目標是使用 Rubber Band 做即時處理+處理檔案」。RB 即時可行性：LiveShifter 為低延遲 block 處理 API（findings）。MVP 用 Signalsmith 因零整合成本 |
| Q2 授權 | 開源專案 | GPLv2+ 可用於 CWS 串流情境（附公開 repo 連結）；iOS/macOS App Store 限制不適用 |
| Q3 技術棧 | TypeScript + Vite + vanilla DOM | MV3 + bundler 標準做法 |
| Q4 控制面 | 連續滑桿含 cents 微調；transpose 調整；不含 tempo；bypass = A/B 等效 | 大綱要求 A/B，popup 用 bypass 切換達成 |
| Q5 匯出格式 | WAV + Opus | Chrome WebCodecs 內建 Opus；無 lamejs |
| Q6 UI 表面 | popup only，目標 = YouTube 使用者 | YouTube 原生控制負責 seek/全曲 loop |
| Q7 瀏覽器 | Chrome + Edge | Chromium 近零成本 |
| Q8 測試 | 自動化核心測試（pitch 數學/WAV 封裝/chunk 連續性）+ 人工聆聽終驗 | — |
| Q9 本機檔案 | 僅供離線匯出（popup 選檔 → 背景 RB 高品質渲染 → WAV/Opus 下載）；無播放器 | 保住 RB 離線引擎目標，維持 popup-only |
| Q10 串流錄製 | 不做錄製功能 | 用戶 Q10=c。匯出僅檔案路徑 |
| Q11 區域 loop | 不做 | 用戶 Q11=b。YouTube 原生全曲 loop 覆蓋 |

## 階段藍圖（用戶最終目標）
- **Phase A（MVP）**：tabCapture 串流 + Signalsmith 即時轉調；本機檔案 → Rubber Band（WASM）離線匯出 WAV/Opus
- **Phase B（最終）**：Rubber Band v4.0 `RubberBandLiveShifter` 取代 Signalsmith 成為即時引擎（同一 WASM 二進位複用離線渲染路徑）；即時 + 檔案處理統一由 RB 處理
- RB→WASM 編譯工作落在 Phase A（離線匯出需要），Phase B 只需在 AudioWorklet 內換 API 呼叫

## Scope IN
- tabCapture 串流即時轉調（±12 半音、連續滑桿含 cents、bypass/A-B）
- 本機檔案離線匯出（Rubber Band WASM → WAV/Opus 下載）
- MV3 擴充：popup + offscreen document（常駐音訊引擎）+ service worker
- 開源授權合規（GPL 附 repo 連結）、自動化測試 + 人工聆聽 QA

## Scope OUT (Must NOT have)
- tempo/變速控制（Q4）
- 區域 loop UI、seek UI（YouTube 原生）
- 串流錄製/下載（Q10=c）
- 本機檔案播放器（Q9=b）
- 大型 UI 頁面（Q6=a popup only）
- 第三方 mp3 編碼庫（Q5 選 WebCodecs Opus）

## Open questions
全部已回答（Round 1 + Round 2）。無剩餘阻塞分叉。

## Approval gate
status: approved
<!-- When exploration is exhausted and unknowns are answered, set status: awaiting-approval. -->
<!-- That durable record is the loop guard: on a later turn read it and resume at the gate instead of re-running exploration. -->
<!-- Round 2 pending: Q9 本機檔案去留 / Q10 串流錄製 / Q11 區域 loop -->
<!-- 2026-09-16: Round 1+2 全部回答，無剩餘分叉。 -->
<!-- 2026-09-16: 用戶批准。計劃已寫入 .omo/plans/pitch-transpose-extension.md（15 implementation + 4 final verification） -->
