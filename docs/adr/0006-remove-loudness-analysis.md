# 0006: 移除響度分析，面板改用百分比與淡出

Status: accepted — 已實作

## 背景

- 需求原文（實測回饋，2026-09-26）：「實際使用之後，響度分析可以移除；dB 也不太能作準；基準音量後面可以加入一個 %，比較易懂；套用改成 SVG 樣式；恢復基準因為準備移除，改成淡出。」
- ADR-0005 把「量測 dBFS、低於 -14 dB 給補正建議」定為功能 (2)，核心是 5 秒 RMS 量測與硬編門檻。實際用過之後的判斷是：**dB 讀數對使用者沒有意義**（不能作準），圍繞它建的整個分析面積（量測儀表、建議值、套用閉環、連線依賴）因此失去存在理由。
- 設計語意也確認過：「淡出」＝功能改成音量淡出到 0（不是按鈕淡化、也不是文字動畫）；「SVG 樣式」＝純圖示按鈕；dB 顯示的處理＝**全改 % 語言**；移除程度＝**徹底移除**（UI＋程式碼＋測試＋ADR 記錄翻案）。

## 決策

1. **響度分析整套移除（翻案 ADR-0005 功能 (2)）**
   移除清單：
   - UI：popup 的「響度分析」區塊（`分析音量水平`、狀態、讀數、建議值、`套用建議`）與相關 CSS（`.loudness-*`、`.action-button-grow`）。
   - 程式碼：`src/offscreen/loudness-meter.ts`（整檔）、`OffscreenController.measureLoudness`、`offscreen-messages` 的 `MEASURE_LOUDNESS` 分支與 `MESSAGE_TYPES` 項目、`OffscreenMessageResponse.dbfs/durationMs`。
   - 量測掛載：`GraphRouter` 的 `getAnalysisTap` 參數與 `connectSource` 的 tap 重接、controller 建構時的 `LoudnessMeter` 實例與切換／拆除時的 `cancel`。
   - 純函式與常數：`volume.ts` 的 `volumeToDb`、`dbToVolume`、`amplitudeToDbfs`、`suggestVolume`、`VolumeSuggestion`、`LOUDNESS_TARGET_DB`、`DBFS_FLOOR`。
   - popup 狀態與流程：`loudnessState`、`analyzing`、`analysisAvailable()`、`runLoudnessAnalysis()`、`renderLoudness()`、`ANALYZE_DURATION_MS`／`MEASURE_TIMEOUT_MS`／`VOLUME_RAMP_MS`（重量倒數計時）。
   - `YT_VOLUME_GET` 回應的 `paused` 欄位（只為分析把關存在）。
   - 測試：`src/tests/loudness-meter.test.ts`（整檔）、`volume.test.ts` 的 dB／建議區塊、`offscreen-messages.test.ts` 的「loudness measurement」describe。
   - `CONTEXT.md` 詞條「響度補正」。

2. **面板不再依賴連線，並上移到 popup 最上方**
   分析是面板唯一需要即時訊號的功能；移除後，套用／淡出純屬 content script 的 DOM 與 player API 操作——**未連線也完全可用**。因此面板從 `main` 底部搬到 **header 下方、連線列之前**（`reveal-delay-1`，其餘區塊依序遞延），理由是「可以不打開變調功能使用」的區塊不該排在變調控制之後。提示文字改為只報面板自身的狀態（非 YouTube／找不到影片／靜音），不再出現「按連線後即可分析」等連線語。

3. **dB 顯示全改百分比**
   - 基準音量輸入框後綴 `%`（取代原 `0.0 dB` 的 `volumeBaseDb` span，改為靜態 `volume-percent`）。
   - 偏離提示由「已偏離基準 +3.2 dB」改為「目前音量比基準高/低 x%」；計算走新的純函式 `volumeDeltaPercent(current, base)`＝相對基準的百分比差四捨五入到整數（0 即「目前音量與基準一致」），base 為 0 或非有限輸入回報 0（呼叫端另行提示）。
   - 理由：百分比就是滑桿刻度本身說的語言，不需要換算。

4. **套用改純 SVG 圖示按鈕**
   `套用` 文字按鈕 → `icon-button` + 勾選 SVG（`viewBox 0 0 24 24`、stroke 2.5 round），`aria-label` 與 `data-tooltip` 均為「套用基準音量」；CSS 用 `.volume-apply` 縮到 34px 以配合輸入列高度。功能不變（寫入基準、500ms ramp、可取消靜音）。

5. **恢復基準 → 淡出**
   按鈕改名「淡出」（`volumeFadeBtn`），功能改成 `setYoutubeVolume(0)`：同一條 500ms ramp 把音量漸降到 0，不動基準值、不改靜音狀態。回到基準的路徑＝按套用（套用就是寫入基準）。偏離提示此時顯示「目前音量為 0」。

## 明確不做

- **不把分析藏起來保留程式碼**——選的是徹底移除，之後要回頭只能重寫（有 ADR-0005/0006 兩份記錄可依）。
- **不做百分比以外的第二套單位**（dB 不再出現在面板任何角落）。
- **淡出不做淡入按鈕**——升到基準就是套用，一個方向一個按鈕。

## 驗收

- `npm run typecheck`、`npm test`（139 tests / 21 files）、`npm run build` 全綠；`dist/content*.js` 仍為 classic script（無 `import`/`export`）。
- 殘留掃描：`src/` 與 `manifest.json` 無 `loudness`／`MEASURE_LOUDNESS`／`analyzeBtn` 等引用（含註解脈絡除外）。
- 實機：基準音量後有 `%`；套用為勾選圖示（tooltip 正常）；「淡出」把原生音量條漸拉到 0；偏離提示為「目前音量比基準低 x%」；面板在**未連線**狀態可套用／淡出；「分析音量水平」不存在。
- 連結（25 題共識中的實作後修訂 ADR-0005-01 內容、雙腳本、player API 同步）維持不變。
