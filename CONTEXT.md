# Fidelitone

Real-time audio pitch transposition for Chrome tabs.

**Connect**: 「已連線」狀態：擷取來源分頁音訊並經擴充套件接管播放。來源分頁一經擷取即被瀏覽器靜音（tabCapture 自動行為）。_Avoid_: 開始、播放、Capture（動詞）

**伴奏模式**: 並行移調模式：低頻段（0-175Hz）以時間域 resampling 變速讀取跟隨主移調，高頻段走 Signalsmith Stretch，兩段求和為完整立體聲輸出。_Avoid_: 伴唱模式、純伴奏、Bass mode

**Bypass**（旁路）: 繞過處理的純透傳路徑：擷取音訊不經移調直接複製輸出。_Avoid_: 直通、PASSTHROUGH、passthrough（那是引擎缺席時的 `passthrough` 路由，語意不同——直通的說法不該蓋掉「引擎沒起來」這個事實）

**破音**: 使用者對「持續沙沙/毛邊感」的主觀描述；診斷指向 Chrome tabCapture 傳輸層（bypass 純複製路徑亦復現），非擴充套件處理邏輯。_Avoid_: 雜訊、snow

**爆音**: 振幅暴衝/削波；已診斷為接線殘留路徑（高頻段雙重輸出 +6dB）與重複接線累積所致，屬可修 bug。_Avoid_: 破音、爆聲

**pitchScale**: 移調引擎的速率參數 = 2^(semitones/12)；>1 為升音。低頻 resampler 的讀取速率（rate）採同一數值、語意同向（不反轉）。_Avoid_: pitch factor、semitones（單位不同）

**lowband / highband**: 175Hz LR-4 分頻的兩段：lowband=0-175Hz（time-domain resampling 路徑）、highband=175Hz+（Signalsmith Stretch 路徑）。_Avoid_: 低頻軌、高頻段（中文詞彙混用）

**ACCOMPANIMENT_ALIGN_DELAY_S**: 伴奏模式中 lowband 路徑的人工延遲常數（0.09s 起跳），使低頻段與高頻路徑延遲對齊。_Avoid_: align delay、延遲常數

**頁面記憶**: 依頁面 URL（`pageKey`＝origin+path+query、去 fragment，鍵前綴 `page:`）分開儲存的設定記憶，稀疏存放：只記錄偏離乾淨預設的欄位，回到預設即刪除該欄位，全回預設即刪整個鍵。涵蓋 pitch、bypass、preserveFormants、accompanimentMode。_Avoid_: origin 記憶／site 設定（粒度太粗，同站兩支影片會互串）、per-tab 設定（同一 URL 開兩個分頁應共享同一筆）、全域設定（ADR-0003 以前的形態）

**信號路徑**: 擷取音訊目前實際行經的圖路徑，為封閉集合且唯讀：`signalsmith`（單一引擎移調）、`accompaniment`（lowband＋highband 立體聲求和）、`bypass`（未經處理的純透傳）、`passthrough`（引擎未啟動，圖退回直通＝**音訊其實沒有被處理**）。popup 的「信號路徑」列只回報它，不提供選擇（ADR-0007 移除雙引擎後已無可選）。_Avoid_: 處理引擎（已無選擇行為）、引擎（指已移除的雙引擎架構）、訊號鏈、pipeline 設定

**自動跟隨**: 活動分頁變更時，擷取來源自動改指向新的活動分頁並套用該頁面的記憶（400ms 防抖；同一頁導覽則不重套）。僅在已有擷取在跑的工作階段內生效。_Avoid_: 自動連線（無擷取時不觸發）、自動恢復、背景播放

**擷取分頁**: 目前被 tabCapture 擷取、由擴充功能輸出音訊的那一個分頁。offscreen 記錄其 tabId 與 page（頁面 URL）。_Avoid_: 目前分頁、作用中分頁（與活動分頁混淆）、目標分頁（指切換的對象）

**設定分歧**: 擷取分頁的 tabId 或 page 與目前活動分頁不一致的狀態。tabId 不同顯示分歧橫幅與「改擷取此分頁」；page 不同則額外鎖定控制項（同一 URL 開在兩個分頁時只出橫幅、不鎖）。popup 於分歧期間以 600ms 輪詢 `GET_STATE` 對齊身分，對齊即停。_Avoid_: 斷線（captureLost 是另一回事）、錯誤狀態、失去連線

**輸出總閘**: 置於引擎／limiter 之後、AudioContext destination 之前的 master gain。分頁交接時淡出 20–30ms 避免用錯設定播出，切換完成後淡入。_Avoid_: limiter、master volume、總音量（與使用者音量無關；使用者音量見「頁面音量」）

**移調引擎**: 唯一的 pitch-shift 節點：一個 Signalsmith Stretch worklet，由 `PitchEngine` 擁有。ADR-0007 移除了 Rubber Band 與 A/B 切換，所以「引擎」在介面上不可選；使用者能選的是旁路與伴奏模式。_Avoid_: 處理引擎（介面上是唯讀讀數）、雙引擎、A/B 切換、engines（已不存在）

**頁面音量**: 使用者看得到的那個音量：YouTube watch 頁播放器的音量，介面刻度 0–100（面板全程用百分比表達），由 manifest 注入的**兩支** content script 操作——ISOLATED 腳本（`content.js`）負責 popup 訊息與 DOM 讀取，MAIN world 腳本（`content-main.js`）持有 ramp 與所有寫入（頁面 JS 定義的 `setVolume` 在 ISOLATED world 讀作 undefined），兩者以 `postMessage` + ack 串接。寫入**優先走 player API**（`#movie_player.setVolume/unMute`），讓原生音量條與靜音圖示同步；API 不在時才退回直寫 `<video>.volume`。任何變更（套用／淡出）一律 500ms ramp、新指令重定目標（最後指令贏），且只在按鈕觸發時寫入——頁面載入與開 popup 都不覆寫。存的是**全域基準** `youtubeBaseVolume`（不進 per-URL 記憶）。_Avoid_: master gain、輸出總閘（是 DSP 的事）、總音量、直寫 `video.volume`／`video.muted`（音量條與靜音圖示會脫節）

**基準音量**: 全域鍵 `youtubeBaseVolume`（0–100，預設 100，等於預設即刪鍵，類同 `snapToInteger`）。目前音量偏離基準時，面板以「比基準高/低 x%」提示（百分比相對基準、四捨五入，0 即「與基準一致」），按「套用」寫回基準；「淡出」只把音量漸降到 0，不動基準。popup 關閉不會自動改音量。_Avoid_: per-URL 音量、自動恢復、隱形改音量

## 三語對照

介面支援 `zh-Hant` / `en` / `ja`（ADR-0008）。譯者與譯審依此表；**`_Avoid_` 欄的告誡同樣適用於英日文**，例如「不要用 passthrough 說法蓋掉引擎沒起來這個事實」在英文裡一樣成立。每個概念的 key 見 `src/i18n/locales/zh-Hant.json`（key 的唯一真實來源）。

| 概念 | zh-Hant | en | ja |
| --- | --- | --- | --- |
| 連線音訊 | 連線音訊 | Connect audio | 音声を接続 |
| 擷取分頁 | 擷取分頁 | captured tab | キャプチャ中のタブ |
| 活動分頁 | 活動分頁 | active tab | アクティブなタブ |
| 頁面記憶 | 頁面記憶 | page memory | ページメモリ |
| 設定分歧 | 設定分歧 | settings divergence | 設定の乖離 |
| 自動跟隨 | 自動跟隨 | tab follow | 自動追従 |
| 信號路徑 | 信號路徑 | signal path | 信号パス |
| 移調引擎 | 移調引擎 | pitch engine | ピッチエンジン |
| 伴奏模式 | 伴奏模式 | accompaniment mode | 伴奏モード |
| 旁路 | 旁路 | bypass | バイパス |
| 基準音量 | 基準音量 | base volume | 基準音量 |
| 頁面音量 | 頁面音量 | page volume | ページ音量 |
| 共振峰保護 | 共振峰保護 | formant protection | フォルマント保護 |
| 半音吸附 | 半音吸附 | snap to semitone | 半音にスナップ |
| 半音 | 半音 | semitone | 半音 |
| 淡出 | 淡出 | fade out | フェードアウト |

**英文的動詞選擇**：`已連線` 用 Connect，不用 Start 或 Capture——`CONTEXT.md` 對「連線」的 `_Avoid_` 同樣約束英文。中文「擷取」在英文是 capture（名詞 the captured tab、動詞 capture this tab），與「連線」是兩個不同的動作，不要互相替換。

**單複數**：只有 `pitch.valueAriaText` 需要處理——英文 `1 semitone` / `N semitones`，中日文不變化。catalog 用 `{one, other}` 表示，缺 `one` 時回落 `other`。
