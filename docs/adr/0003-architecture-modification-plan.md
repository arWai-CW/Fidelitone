# 0003: 架構深化修改計劃

Status: accepted

本 ADR 記錄 Fidelitone 的架構深化計劃：把重複的 implementation 集中、把過大的 shallow module 拆成有深度的 module，並讓測試直接跨過真實 interface。它不改變 `pitchScale`、175 Hz crossover、0.09 s alignment delay、Bypass、engine switching 或 capture lifecycle 的語意，只改變實現的 locality 和 test surface。

## 背景：目前問題

- 第一階段前，`src/offscreen/offscreen.ts` 與 `src/worker/rb-worker.ts` 各自實作 RubberBand LiveShifter 的 WASM load/init/process/delete 與 buffer/pointer 管理；這是兩個真實 adapter 共用同一套 implementation，當時卻重複兩份。
- `offscreen.ts` 的 baseline 是 994 行、43 個 module-level 變數；第一階段已抽出 message dispatch、engine routing 與 state vocabulary，但 graph lifecycle、伴奏模式與 capture handlers 仍在同一個 implementation。
- `src/popup/popup.ts` 的 baseline 是 758 行；第一階段已抽出 state transition module，但 DOM rendering、storage、runtime messaging 與 tooltip 仍耦合。
- `src/processors/crossover-processor.js` 與 `src/tests/crossover-filter.test.ts` 各自有一份 `computeButterworth`；測試驗證的是 copy，不是 production implementation。
- `src/processors/lowband-resampler.js` 與 `src/lib/dsp/true-peak-limiter.ts` 各自有一份 `cubicInterpolate`；同樣造成 test surface 與 implementation 分離。
- `src/lib/dsp/signalsmith-fallback.ts` 的 `setSignalsmithActive` 只有定義、沒有呼叫，是 dead export。
- `src/tests/rb-worker.test.ts` 仍用 mock protocol 模擬 worker，而不是直接測試 worker 的真實 implementation。
- 第一階段已補上 LiveShifter、popup state、offscreen message/routing 與 DSP math characterization tests；graph routing、engine switching、accompaniment transition 仍待第二階段直接覆蓋。

## 決策

1. **先抽出 RubberBand LiveShifter adapter**  
   把 WASM load、LiveShifter init、pitch update、block shift、buffer alloc/free 集中到一個 module。`offscreen.ts` 與 `rb-worker.ts` 都改成使用同一個 adapter。  
   這是 real seam：兩個 adapter 已經存在，且 implementation 完全重複。

2. **把 pure DSP math 變成 shared module**  
   把 `computeButterworth` 與 `cubicInterpolate` 放到同一個 shared module，讓 worklet 與 test 都 import 同一份 implementation。  
   這樣 test surface 才會直接命中 production implementation。

3. **拆分 `offscreen.ts` 的 responsibilities**  
   把 graph lifecycle、engine switching、accompaniment mode、capture state、message dispatch 拆成各自有明確 locality 的 module。  
   目標不是增加抽象，而是讓每個 module 的 interface 變小、implementation 變深。

4. **拆分 `popup.ts` 的 state / DOM / messaging**  
   把 popup state、DOM rendering、storage、runtime messaging、tooltip 分開。  
   讓 state transition 可以在不啟動 DOM 的情況下測試。

5. **移除 dead export**  
   刪除 `setSignalsmithActive`，除非未來出現第二個真實 caller。

6. **先補 characterization tests，再重構**  
   在改動前先把現有行為固定下來，尤其是 positive `pitchScale`、175 Hz LR-4 crossover、0.09 s alignment delay、Bypass、engine switching、capture lifecycle、popup state restore。

## 修改順序

1. [x] 補 characterization tests。
2. [x] 抽出 LiveShifter adapter。
3. [x] 抽出 shared DSP math module。
4. [x] 完整拆 `offscreen.ts`（已完成 message dispatch、engine routing、state vocabulary 的第一階段）。
5. [x] 拆出 popup state transition module。
6. [x] 刪除 dead export 與已無用途的 wrapper。

## 驗收標準

- [x] `offscreen.ts` 與 `rb-worker.ts` 不再各自維護一套 LiveShifter WASM lifecycle。
- [x] `computeButterworth` 與 `cubicInterpolate` 只有一份 implementation，且測試直接 import 它。
- [x] `offscreen.ts` 不再同時承擔 graph lifecycle、engine switching、accompaniment、capture state、message dispatch。
- [x] popup state transition 可在不依賴 DOM 的情況下測試。
- [x] `setSignalsmithActive` 已移除。
- [x] 既有音訊語意不變：positive `pitchScale`、175 Hz LR-4 crossover、0.09 s alignment delay、Bypass、engine switching、capture lifecycle。
- [x] 不新增 runtime dependency。

## 已完成的第一階段

- 新增 `RubberBandLiveShifter` shared adapter，統一 offscreen 與 worker 的 WASM load、LiveShifter lifecycle、pitch/formant control、buffer ownership 與 cleanup。
- 新增 shared DSP math module；Butterworth、cubic interpolation 與 pitch-scale math 都由 worklet/production code 與 characterization tests 直接 import。
- 抽出 popup state module、offscreen message dispatch module、offscreen engine routing module，以及 shared capture-state vocabulary。
- 移除沒有 caller 的 `setSignalsmithActive`。
- 新增 LiveShifter、popup state、offscreen message/routing、DSP math characterization coverage。
- `npm test`、`npm run typecheck`、`npm run build` 均通過。
- 視覺報告已開啟：`/tmp/architecture-review-20260919-214538.html`。

## 已完成的第二階段

- 將 `offscreen.ts` 的殘餘責任拆成五個專注 module：
  - `audio-graph.ts` — AudioContext、passthrough、LiveShifter/RubberBand lifecycle、圖表初始化與拆除。
  - `engine-switching.ts` — A/B 引擎選取、Signalsmith init、跨語速交叉淡入、pitch/formant 同步。
  - `accompaniment.ts` — 伴奏圖形節點、crossover/resampler/limiter 初始化、相位對齊 delay、mixBus。
  - `capture-manager.ts` — 麥克風擷取 lifecycle、stream/source 管理、capture-lost 標記。
  - `graph-router.ts` — 物理接線（bypass / 伴奏 / 單引擎 / fallback）與 rewiring。
- `offscreen.ts` 僅剩 composition root：實例化各 module、註冊訊息派發、啟動初始圖表。
- `OffscreenController` 匯整所有 state 並透過 `runTransition` 序列化 async 操作，保留既有 ordering 假設。
- 新增 characterization tests：
  - `engine-switching.test.ts` — same-engine re-route、crossfade、rollback、unavailable engine。
  - `graph-router.test.ts` — bypass、伴奏、單引擎、fallback 路由。
  - `accompaniment.test.ts` — init success/failure、ensureEnabled 冪等、reset/deactivate。
  - `capture-manager.test.ts` — capture start/stop、accompaniment 失敗回滾、不同 stream ended。
- `npm test`、`npm run typecheck`、`npm run build` 均通過（共 81 測試）。

## 明確不做

- 不改變 ADR-0001 的 stereo sum 與統一重導線決策。
- 不改變 ADR-0002 的 positive rate semantics 與 bounded live timeline。
- 不換掉 RubberBand 或 Signalsmith。
- 不把只有一個 caller 的地方硬拆成新 seam。

## 風險與取捨

- 拆 module 會增加文件數量與 seam 數量；只有當 locality 或 leverage 明確提升時才保留。
- `offscreen.ts` 的 graph state 有隱性 ordering 假設，重構前必須先用 characterization tests 固定行為。
- Worklet 與 MV3 CSP 限制意味著 shared module 必須保持靜態可載入，不能引入 blob URL 或新的 runtime dependency。
- popup 的 storage 與 runtime messaging 有時序耦合，拆分時要保留既有重連與 restore 行為。
