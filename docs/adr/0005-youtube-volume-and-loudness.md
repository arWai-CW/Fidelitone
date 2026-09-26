# 0005: YouTube 頁面音量控制與響度補正

Status: accepted — 已實作；功能 (2) 與部分面板設計已由 ADR-0006 翻案移除

本 ADR 記錄兩個新功能：(1) popup 新增 YouTube 專用的音量控制項——把影片音量設定到指定數值；(2) 對擷取中的分頁量測音量水平（RMS dBFS），低於 -14 dB 時提出補正建議。它同時**修訂 ADR-0004 的兩條既定設計**：「開啟 popup 即連線」與「不注入 content script」，兩處已就地改寫並回指本 ADR。

> **後續修訂（2026-09-26，實測回饋）**：功能 (2)「響度分析／補正」整體移除——實測後判斷 dB 讀數對使用者不可靠（「dB 也不太能作準」）。決策 4、5、6、7 與決策 8 的「恢復基準」按鈕、訊號協定的 `MEASURE_LOUDNESS`、實作位置的 `loudness-meter`、驗收清單的量測項目**全部失效**；面板的 dB 顯示改為百分比、套用改純 SVG 圖示按鈕。完整的移除清單與新面板設計見 **ADR-0006**。本 ADR 其餘內容（雙腳本 world 邊界、player API 同步、ramp、全局基準、popup 不自動連線）維持有效。

## 背景

- 需求原文：「音量設定到指定數值；偵測目前影片的音量水平(dBFS)，是否低於 -14dB，並提出數值音量補正建議」。
- Fidelitone 此前**没有任何頁面存取通路**：沒有 content script、沒有 `scripting` 權限，只有 `chrome.tabCapture` 的整頁混音流。音量無從設定。
- 音訊分析需要 PCM，而唯一的 PCM 來源是擷取流；`tabCapture` 一啟動就**接管分頁的原生輸出**（這是擴充功能能變調的前提）。因此「量測」與「連線」在架構上綁在一起：連線瞬間有一次音訊空隙，連線之後反覆量測零中斷。
- `CONTEXT.md` 已把「輸出總閘」明確標為 _與使用者音量無關_——新的使用者音量不能走 master gain，否則語意衝突。
- ADR-0004 的「明確不做」寫著「不注入 content script 暫停舊分頁的媒體播放」。那是針對**暫停播放**的禁令，不是全面禁令；本次為音量控制注入 content script，且依然**不碰播放狀態**。

## 決策

1. **操作對象是頁面播放器的音量，不是 DSP**（`src/content/content.ts` + `src/content/content-main.ts`）
   youtube.com/watch 的播放器就在主文件。改頁面自己的音量才是「YouTube 專用控制項」的語意，量測到的補正也直接反映在頁面本身的聲音上。走 DSP gain 會出現「音量條不動、只有經 Fidelitone 的聲音變」的分裂狀態，並與輸出總閘語意鄰近——排除。IFrame Player API 不適用（watch 頁播放器不是 iframe）——排除。

   **實測修訂（原生 UI 同步）**：初版直寫 `<video>.volume`，實測發現播放器右下的原生音量條與靜音圖示**不跟動**——它們反映 `#movie_player` 的內部狀態，不讀 `video.volume`。改為**優先走 player API**：`#movie_player` 上實測存在 `setVolume(v)`／`getVolume()`（0–100）與 `mute()`／`unMute()`／`isMuted()`。證據：`p.setVolume(30)` → `video.volume 0.3` 且把手 `left: 12px`（30% × 40px 行程）；反之 `v.muted = true` 後 `p.isMuted()` 仍為 `false`（圖示會顯示錯誤狀態）。所有寫入（含 ramp 每幀）統一經 `applyVolume`／`unmute` 兩個函式，API 不在時（播放器尚未就緒、無 `#movie_player` 的頁面）才退回直寫屬性。

2. **manifest 明文注入，不新增權限——兩支腳本、兩個 world**
   `content_scripts` 有兩筆，皆 `matches: ["https://www.youtube.com/*"]`、`run_at: "document_idle"`：
   `{ js: ["content.js"] }`（ISOLATED，預設）與 `{ js: ["content-main.js"], world: "MAIN" }`。host permission 本來就全域，不需 `scripting`；明文注入沒有「尚未注入完成」的時序競態。popup 端的閘門 `isYouTubePage()` 必須**逐字對齊** manifest（含 `https:`），否則按鈕會亮著卻沒人聽。

   **實測修訂（world 邊界 → 單支腳本不成立）**：content script 預設在 ISOLATED world，**DOM 共享、頁面 JS 定義的物件不共享**。CDP 建 isolated world 實測：`#movie_player` 是同一顆 DOM（`ctor: HTMLDivElement`）、`video.volume`／把手 `style` 都讀得到，但 `typeof setVolume === "undefined"`。於是「優先走 player API」會**靜默退回直寫**——音量變、原生 UI 不動（第三次實測回報的症狀）。改為雙職分工：
   - `content.js`（ISOLATED）：擁有 `chrome.runtime`（`tabs.sendMessage` 只送得到這裡）、DOM 讀取（GET）、把寫入指令轉送出去並等 ack；
   - `content-main.js`（MAIN）：持有 ramp 與**所有寫入**——這是唯一看得見 player API 的地方。MAIN world 腳本**沒有擴充 API**，所以轉送層無法省略。

   兩者以 `window.postMessage` + ack 串接（channel `fidelitone-youtube-volume`，跨 world 雙向送達與真實成品已實測：30 → `left: 12px`、45 → `left: 18px`、ack `ok:true` 回到 isolated）。MAIN 逾時 1 秒未 ack → 面板回「頁面音量控制未回應」，不靜默假裝成功。頁面可 spoof 兩向訊息（文件明示此風險），但代價只是頁面改自己的音量——它本來就能改。

3. **開啟 popup 不再自動連線**（修訂 ADR-0004 決策 9）
   「連線」鈕成為唯一入口。popup 打開完全不動音訊：不重接管、不套用頁面記憶的音高。要變調、要量測，都由使用者明確按下去——那次音訊接管的**時機因此完全由使用者掌控**。已在既有副本（`connectionDetailFor`、popup 預設文案、README）同步改寫。

4. **量測掛 source 分支（引擎前）**
   `LoudnessMeter` 的 AnalyserNode 掛在擷取來源上、引擎與 limiter 之前，量到的是「頁面送出來的響度」。補正的對象是頁面音量，就必須在頁面音訊進入 DSP 之前量；掛輸出端會被引擎增益、limiter、伴奏混音干擾，補正變成追著自己的 DSP 尾巴跑。
   AnalyserNode 之後接一顆 `gain = 0` 才接 destination：確保它在主動處理（Web Audio 只對連到 destination 的節點跑），又不貢獻任何聲音。

5. **指標是短時 RMS，門檻硬編 -14 dB**
   需求語境的 -14 是響度標準（LUFS）的數字，用短時 RMS 平均最貼近且實作可行；峰值（sample peak）比平均響 10–15 dB，不是同一把尺；真 LUFS 實作過重。**不做設定項**——需求只給了一個數字，可調門檻會連帶牽出 UI、預設值、storage 三個額外面積。
   注意量制差異：這是 **dBFS 的 RMS 近似，不是 LUFS**，寫進 CONTEXT.md 詞條避免誤稱。

6. **按需單次量測，固定 5 秒，需連線**
   不做常駐監測（儀表板）——那會要求 AnalyserNode 常駐與輪詢，資源與架構成本都不成比例。5 秒取樣足以平均，又不拖垮「套用 → 驗證」的回饋循環。
   量測的 PCM 只存在於擷取流，因此**分頁需連線擷取中**，否則停用按鈕並提示「請先連線」。不為一個輔助讀數複製整套擷取生命週期（與 ADR-0004 的單一擷取設計衝突）。
   **音量套用／恢復不依賴連線**——content script 與擷取無關，未連線也能設定。

7. **補正的數學與上限**
   `建議值 = 10^((-14 - 目前dB)/20) × 目前音量`，起點是**目前音量**（量測對象就是現狀，從基準起算會在現值 ≠ 基準時給出錯誤答案），四捨五入到整數、截斷在 100。100 仍不足時標示「已達上限，需靠外部／系統音量補足」。目前音量為 0 或已達標 → 不給建議。
   「套用建議」後**自動重新量測一次**，讓面板數字直接變成套用後的結果（套用 → 驗證閉環）。重測前等 600 ms 讓 ramp 走完，避免窗口開在爬升中。

8. **補正是暫時偏離，不是新基準**
   面板顯示「已偏離基準 ±x.x dB」與「恢復基準」按鈕。不寫入基準、不做 popup 關閉自動恢復——音量被程式默默改掉是最招人厭的行為，恢復必須由使用者按下。

9. **所有音量變更一律 500 ms dB-線性 ramp，retarget**
   套用基準、套用補正、恢復基準三者共用一條路徑（統一規則最好記也好測）。dB-線性（`from × (to/from)^t`）讓感知速度均勻；任一端為 0 時退回線性（對數無法到達靜音）。ramp 進行中收到新指令 → 取消舊的、從**當前實際值**重新導向，永遠只有一條 ramp，最後的指令贏。
   `requestAnimationFrame` 步進，每幀經 `applyVolume` 寫入（player API 優先、取整數 %——原生滑桿只有 1% 解析度；`AudioParam` 的 ramp API 不適用於頁面音量）。

10. **基準音量是全域設定，不是 per-page 記憶**
    使用者要的是一個「穩定的數值」：`youtubeBaseVolume`（0–100，預設 100）進 `GLOBAL_SETTING_KEYS`，**不進** `PageSettings`。它是介面偏好而非影片屬性，與 `snapToInteger` 同類。補正在此之上做暫時偏離。
    數字輸入框顯示/編輯的就是基準；旁邊另顯示 `<video>` 現值（兩者可能不同——你在 YouTube 原生滑桿調過）。**不做自動套用**：頁面載入、popup 開啟都不主動覆寫 `<video>`，只有按下按鈕才會。

11. **`MEASURE_LOUDNESS` 不排隊**
    `GET_STATE` 已因「對帳必須立即回答」而繞過 `runTransition`；量測是同一類（唯讀、不改狀態），但理由不同：**5 秒的窗口不能把所有 `SET_*` 排在後面**。listener 對這兩類走直通，其餘照舊序列化。

12. **暫停／靜音／音量 0 時不給建議**
    這三種狀態量到的都是垃圾（或一片寂靜），給出的「建議 100」只會誤導。分析前先讀 `<video>` 狀態，不符條件就顯示原因、不顯示建議。

13. **設定音量 > 0 時解除靜音**
    跟 YouTube 自己的音量滑桿一致：明確要求一個可聽的音量，就代表想聽到聲音。目標為 0 則保留靜音狀態。

## 訊號協定（本 ADR 新增）

```
popup ──MEASURE_LOUDNESS{durationMs}──▶ offscreen（不排隊；回 { dbfs, durationMs }）
popup ──YT_VOLUME_GET─────────────────▶ content.js / ISOLATED（tabs.sendMessage；直接讀 DOM，回 volume/muted/paused）
popup ──YT_VOLUME_SET{value}──────────▶ content.js / ISOLATED（同上；轉送 ↓，等 ack 後回覆）
content.js / ISOLATED ──postMessage VOLUME_SET{id,value}──▶ content-main.js / MAIN（啟動 500 ms ramp）
content-main.js / MAIN ──postMessage VOLUME_ACK{id,ok,error}──▶ content.js（逾時 1 秒未到 → 回錯誤）
```

- `MEASURE_LOUDNESS` 是唯讀量測，**不屬於 `SET_*`**，service worker 不使用它。
- 音量訊息走 `tabs.sendMessage`（只送得到 ISOLATED 內容指令），與 `runtime.sendMessage`（送不到 content script）互不相干；ISOLATED→MAIN 是 `window.postMessage`（MAIN 沒有擴充 API）。
- 跨 world 橋的 channel 是 `fidelitone-youtube-volume`，須同時過 `event.source === window` 與 channel 檢查；防不住有心頁面 spoof，見決策 2。
- 量測需要連線；連線相關的失敗一律回 `{ ok: false, error }`，由 popup 顯示。

## 資料 schema

```
youtubeBaseVolume → 80      全域（GLOBAL_SETTING_KEYS），等於預設 100 即刪鍵
```

其餘不落盤：量測結果、建議值、目前影片音量都是觀測值，popup 關閉即消失。

## 實作位置

| 區塊 | 檔案 |
| --- | --- |
| 純函式（clamp／dB 換算／補正／ramp） | `src/lib/volume.ts` |
| 全域鍵與 `isYouTubePage` | `src/lib/page-settings.ts` |
| content script（ISOLATED：popup 訊息、DOM 讀取、寫入轉送＋ack 等待） | `src/content/content.ts` |
| content script（MAIN world：ramp 與所有寫入、player API） | `src/content/content-main.ts` |
| 量測（AnalyserNode + RMS 累積） | `src/offscreen/loudness-meter.ts` |
| source 分支的 tap 重接 | `src/offscreen/graph-router.ts` |
| `measureLoudness`、取消時機 | `src/offscreen/offscreen-controller.ts` |
| 訊息分發（直通不排隊） | `src/offscreen/offscreen-messages.ts` |
| 面板與流程 | `src/popup/popup.html` / `popup.ts` / `popup.css` |
| 建置與注入 | `package.json` 的 `content` 腳本（esbuild IIFE → `dist/content.js` + `dist/content-main.js`，各為自足 classic script）、`manifest.json`（兩筆，後者 `"world": "MAIN"`）、`vite.config.ts`（刻意**不含** content entry，見註） |

取消量測的時機：`switchCapture`（窗口不跨兩支影片）、`teardownGraph`（擷取停止）。source 被 `rewire()` 斷線時由 `GraphRouter.connectSource` 自動重接 tap，避免量測後半段讀到寂靜。

## 修訂的既有決策

- **ADR-0004 決策 9**（「連線的觸發點維持『開啟 popup』」）→ 改為手動連線，已在原檔就地改寫。
- **ADR-0004 明確不做**（「不注入 content script 暫停舊分頁的媒體播放」）→ 暫停禁令**維持**；content script 本身不再是禁忌，已就地加註。

## 明確不做

- **不做免連線量測**：曾評估由 content script 對 `<video>` 開 `MediaElementSource` 分析（零接管），但媒體跨來源（`*.googlevideo.com`）的 CORS 靜音風險未經實證，且接管本質上無法繞過。決策為維持連線版本；日後若要翻案，先做跨來源可行性實測。
- **不做 `<script>` 標籤動態注入**：YouTube 頁面啟用了 Trusted Types（實測 `script.src` 指派直接被拒），動態注入必然碰壁；manifest 的 `world: "MAIN"` 由瀏覽器注入檔案本身，而我們的 MAIN 腳本不碰任何受 CSP／TT 管轄的 sink（無 `eval`、無 HTML 字串）。
- 不做持續監測／音量儀表。
- 門檻不做設定項（硬編 -14 dB）。
- 音量不進 per-URL 頁面記憶（只有全域基準）。
- 不自動套用任何音量（含補正——需手動按「套用建議」）。
- 不代管播放器的其他 UI（播放鍵、播放速度、字幕、全螢幕）；音量相關的 UI——滑桿把手與靜音圖示——已同步（見決策 1 實測修訂），同步粒度即滑桿本身的 1%。
- 不做廣告／非影片音訊的排除：量測對象是分頁混音，廣告算在內。

## 驗收標準

自動化部分已由 `npm test`（現 139 tests；量測相關測試已隨 ADR-0006 移除）／`typecheck`／`build` 覆蓋；實機項目回填 `docs/runtime-verification.md`。標「已失效」者由 ADR-0006 區塊取代。

- [ ] 開啟 popup：**不**自動連線、不接管音訊，連線鈕是唯一入口。
- [ ] 非 YouTube 頁面：基準音量可編輯，套用／淡出停用並顯示原因（原「分析停用」已失效——ADR-0006）。
- [ ] YouTube 頁面未連線：套用與淡出可用（音量真的改變）；面板不依賴連線（原「分析停用提示」已失效——ADR-0006）。
- [ ] 設定基準 → 換瀏覽器重開 → 基準仍在（全域鍵）；改回 100 → 鍵被刪除。
- [ ] **（已失效——ADR-0006 移除）** 分析：連線後按分析，5 秒後顯示 dBFS；低於 -14 顯示建議值與 +x.x dB；高於等於 -14 顯示達標。
- [ ] **（已失效——ADR-0006 移除）** 影片暫停／靜音／音量 0 → 分析停用或提示，不出現垃圾建議。
- [ ] **（已失效——ADR-0006 移除）** 套用建議 → 音量平滑爬升（500 ms、無跳變）→ 自動重新量測，數字更新。
- [ ] **（已失效——ADR-0006 移除）** 恢復基準 → 平滑回到基準，偏離提示歸零（現為「淡出」，見 ADR-0006）。
- [ ] **原生 UI 同步**：套用／淡出後，播放器右下音量條把手位置與目前音量一致（`left` = vol% × 40px）；目標 >0 解除靜音時音量圖示同步顯示非靜音；ramp 期間把手連續跟動。
- [ ] **橋接健在**：兩支 content script（`content.js` ISOLATED + `content-main.js` MAIN）都已注入（build → 重載擴充 → **重新載入分頁**）→ 設定音量無錯誤且滑桿跟動；若 MAIN 缺席（未重載分頁），面板顯示「頁面音量控制未回應」而非靜默失效。
- [ ] 量測期間切換 bypass／引擎 → 量測結果不變為 -100 dBFS（tap 重接生效）。
- [ ] 量測期間切分頁 → 量測以錯誤結束，不出現跨影片的平均值。

## 風險與取捨

- **量測的是分頁混音**：自動播放的廣告、其他來源的聲音都算進去。要排除就必須走跨來源分析路徑（見「明確不做」第一條），代價遠大於收益。
- **接管空隙**：連線瞬間仍有一次音訊空隙（stream 接手 + 25 ms gate fade-in），本 ADR 只把它的**時機**交還給使用者，沒有消除它。
- **SPA 換影片後不重套**：`<video>` 元素在 YouTube SPA 導覽間是同一顆，`volume` 會跟著留著；我們刻意不做背景重套（決策 10），所以換片後顯示的是元素現值，按「套用」才會寫回基準。
- **ramp 中的量測**：套用後立刻量測會讀到爬升中的值，已用 600 ms 等待緩解；若日後 ramp 時長可調，這個常數要跟著走。
