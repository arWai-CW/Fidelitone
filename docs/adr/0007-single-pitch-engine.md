# 0007: 移除 RubberBand，改用單一移調引擎

Status: accepted — 已實作

## 背景

- 需求原文（實測回饋，2026-09-27）：「目前已經比較常使用 Signalsmith，整體品質都已經足夠好，RubberBand 可以刪除。」
- 專案原本是雙引擎 A/B 架構：Rubber Band（自編譯 WASM）與 Signalsmith Stretch（MIT）並存，popup 提供 radiogroup 讓使用者切換，`engine` 進了頁面記憶。使用者日常實際只用 Signalsmith。
- 移除的收益不只是一個下拉選項，而是**整個授權組合**：Rubber Band 是 GPLv2+，而它被 link 進同一個擴充套件產物，形成 combined work。原本的 `LICENSE` 因此必須把整包標為 GPLv2+，`README.md` 卻寫「Project code: MIT」——兩者互相矛盾，本身就是一個待修的合規缺陷。移除後專案回到純 MIT。
- 架構上這條路徑本來就沒被主流程用到：伴奏模式（ADR-0001）在 `popup.ts` 裡**完全鎖掉 RubberBand**（`accompanimentLocksRubberband`）。也就是說「低頻重取樣 ＋ 高頻時域拉伸」這條對跟唱最關鍵的路徑，從來沒有 involve 過 GPL 引擎。旗艦工作流的品質從來不是靠它。

## 決策

1. **刪除 RubberBand 與其全部周邊**
   - `src/lib/dsp/rubberband-live-shifter.ts`（WASM load / LiveShifter lifecycle / buffer ownership）
   - `src/processors/rubberband-processor.js`
   - `src/wasm/`（`rubberband.wasm` 468 KB、`build_wasm.sh`、`verify.mjs`）
   - `src/worker/rb-worker.ts`（ADR-0003 抽出 adapter 之後已無 caller，本來就是死碼）
   - 對應測試三個檔。
2. **`EngineSwitching` → `PitchEngine`**
   模組名稱原本描述的是「在兩個引擎間切換」，單一引擎後這個名稱是假的。新的 `PitchEngine` 只做真正剩下來的事：擁有一個 Signalsmith 節點、依它回報的 latency 排程 pitch 與 formant。
   - 移除 `setEngine` / `effectiveEngine` / `availability` / `setGains` / `crossfade`。
   - 移除 `audio-routing.ts`（`effectiveEngine` 與 `engineGainValues` 只為雙引擎存在）。
   - `initSignalsmith` → `ensureReady`（冪等，回傳 boolean，不再假設成功）。
3. **圖上砍掉 `gainA` / `gainB`**
   這兩顆交叉淡入用的 gain 在單一引擎下沒有作用，而 ADR-0001 的 +6dB 爆音根因正是「gain 殘留」。少一類節點就少一類殘留路徑。`rewire()` 現在無條件全斷再接。
4. **`routeFor` 回傳封閉集合，誠實回報失敗**
   `SignalRoute = "bypass" | "accompaniment" | "signalsmith" | "passthrough"`。引擎起不來時回報 `passthrough` 而不是假裝自己在處理音訊——這是 PRODUCT.md 原則 2 的直接應用。
5. **popup 的引擎清單改成唯讀讀數**
   兩顆引擎卡（`role="radiogroup"`）換成一列 `route-line`，顯示目前的信號路徑與一行說明。存在的理由是誠實：引擎沒起來時使用者看得到「未處理／移調引擎未啟動」，而不是對著一個沒有反應的滑桿猜。
6. **`engine` 從頁面記憶移除**
   `PageSettings` / `PAGE_DEFAULTS` / `PAGE_SETTING_KEYS` / `resolvePageSettings` / `diffAgainstDefaults` 全部不再認得這個欄位。舊記錄裡的 `engine` 欄位不會被讀取，`writePageSetting` 一旦重寫就自然消失。`LEGACY_SETTING_KEYS` 保留 `engine`，因為舊的 flat key 清理仍需要它。
7. **`SET_ENGINE` 訊息與 `resolveAvailableEngine` 一併刪除**
   fallback 的責任現在落在 `GraphRouter.connectRoute`：引擎不在就走 passthrough。缺引擎不再是一個會擋住 tab follow 的錯誤分支。
8. **授權回到純 MIT**：`LICENSE` 改為 MIT 全文，第三方元件只剩 Signalsmith Stretch（MIT）。`README.md` 刪掉 GPL 段落。

## 為什麼不是「保留 GPL 開源」

GPL 不禁止開源，這條路是合法的。但對這個專案它是淨損失：
- 整包被迫 GPLv2+，`README.md` 原本的 MIT 宣告就是錯的；未來想授權或賣也做不到（得另外向 Breakfast Quay 買商業授權）。
- 保留一個日常不用的引擎，代價是 468 KB 的 GPL binary、一份無法重現的 Emscripten build（`build_wasm.sh` 寫死了 `/Volumes/MP44L/Git/Fidelitone` 與 `/tmp/rubberband-v4.0.0`）、一個預設值互相矛盾的 bug（`page-settings.ts` 的 `DEFAULT_ENGINE = "signalsmith"` 對上 `engine-switching.ts` 的 `_activeEngine = "rubberband"`）、以及一整組只有為了選引擎才存在的 state 與訊息。
- 開源籌碼來自「我怎麼做決定」，不來自 bundle 裡有什麼。ADRs 與 `CONTEXT.md` 才是可被第三方檢視的資產，而它們與授權無關。

## 明確不做

- 不保留 hidden flag 或 build-time 開關來把 RubberBand 藏起來——ADR-0006 已定調「不把功能藏起來保留程式碼」。
- 不為了「萬一訊號複雜」而保留第二引擎。使用者的實測回饋是唯一依據。
- 不動 175 Hz crossover、0.09 s 對齊延遲、limiter 參數、per-page 記憶粒度或 tab follow 語意。

## 驗收

- `npm run typecheck`、`npm test`（121 tests / 15 files）、`npm run build` 全綠。
- `dist/` 876 KB → 392 KB；`dist/processors/` 只剩 crossover、lowband-resampler、passthrough、signalsmith。
- `grep -ri "rubberband" src/ dist/ manifest.json` 無結果（`docs/` 的歷史 ADR 記錄除外）。
- 移除的測試檔三個：`rubberband-live-shifter.test.ts`、`rb-worker.test.ts`、`engine-switching.test.ts`；另刪兩個與本 ADR 無關的死碼測試（見下）。
- 死碼一併移除（無任何 production importer，ADR-0006 同一原則）：`src/lib/opus-encoder.ts`、`src/lib/wav-writer.ts` 與其測試。
- `GraphRouter` 新增測試涵蓋引擎缺席時的 passthrough fallback，以及 `routeFor` 在引擎未啟動時回報 `passthrough`。
- 實機（待驗）：開啟 YouTube、連線音訊、拖移調軌、確認「信號路徑」顯示 `Signalsmith`；開伴奏模式確認顯示 `伴奏`；開旁路確認顯示 `旁路`。

## 連帶的量測：引擎延遲

移除雙引擎後原本缺一個公開數據（引擎延遲）。新增 `tools/latency-probe`（`npm run latency`）量到了，結果是 **100 ms**（出貨設定 `blockMs 80 / intervalMs 20 / splitComputation: true`），且 `node.latency()` 的自報值與獨立量測值完全一致。完整表格與方法見 `docs/runtime-verification.md`。

兩個後果：

1. `README.md` 的「minimal latency」是錯的——已改成引用量測值。100 ms 對跟唱夠用（你是在開始前調，不是唱到一半調），但它不是監聽級的 pitch shifter。
2. **`ACCOMPANIMENT_ALIGN_DELAY_S = 0.09` 現在有了解釋**：它是引擎 100 ms 减去低頻路徑自身約 10 ms 的差值。這兩個常數分處不同檔案、沒有任何機制維護其關聯——所以兩處都補上了警示註解，改 `blockMs` 必須重新推導對齊值，否則低頻與 175Hz 以上會相位錯開（可聽見的 comb filtering）。

順帶記錄一個失敗的方法：`OfflineAudioContext` **不能用**於此函式庫。它的 worklet 靠 `port.postMessage` 握手 resolve `factory()`，而 offline render 會在主 thread 有機會處理訊息之前就跑完，節點永遠不初始化、render 出來是靜音。這是量測前先試的路徑，失敗後才改用即時 tap。
