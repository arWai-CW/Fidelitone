# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

主要使用者是**唱歌／練唱者**：在自己練唱、cover、KTV 場景下，把正在播放的伴奏或原曲升／降調來配合自己的音域。使用情境是「一邊聽一邊跟唱」，需要的是快速、可信的即時調整，而不是一次性的編輯。

公開發布後會面對陌生使用者，因此安裝門檻、權限說明與穩定度都屬產品品質的一部分。

## Product Purpose

Fidelitone 是一個 Chrome 擴充套件：即時移調任何 Chrome 分頁正在播放的音訊，且不改變節奏，讓使用者能跟唱。

成功的意思是：使用者打開 popup、連線音訊、調到合適的調，就能一路唱下去——中途換歌、換分頁都不需要重新設定。

## Positioning

核心定位是**演唱工作流的完整工具**：移調、伴奏模式、YouTube 音量控制在同一個 popup 裡完成跟唱準備，而不是單一功能的音高調整開關。

（次要支撐機制：頁面記憶 + 自動跟隨——每個 URL 各自的設定、切換分頁自動套用，換到另一首歌不需重調。這支撐「完整工作流」的體驗，但定位主軸是完整工具。）

## Operating Context

- 使用者在聽歌／練唱的當下操作 popup，操作次數要少、回饋要即時。
- 音訊來源是網頁播放器（YouTube、Spotify Web、SoundCloud 等），頁面結構與播放器 API 由第三方擁有，會變動。
- YouTube 面板依賴兩支 content script（ISOLATED + MAIN world）橋接頁面播放器 API；擴充功能重新載入後需重載分頁，這是使用者會遇到的實際流程。
- Chrome 對 tabCapture 的限制是使用情境的一部分：開啟 popup 才能取得該分頁的擷取權限、跨來源導覽會被撤銷。

## Capabilities and Constraints

- 即時移調 -12 至 +12 半音，保持原速；單一引擎 Signalsmith Stretch（WASM，本機處理，ADR-0007）。引擎起不來時圖退回直通路徑，介面以「信號路徑：未處理」誠實呈報。
- 伴奏模式：175 Hz 分頻，低頻段時間域 resampling 跟隨移調、高頻段走 Stretch。
- Bypass 純透傳路徑。
- 頁面記憶（`page:<url>`，稀疏儲存）+ 自動跟隨（400ms 防抖）。
- YouTube 頁面音量控制：全域基準音量、套用／淡出、500ms ramp。
- **信號路徑是唯讀讀數，不是可選清單**：ADR-0007 移除雙引擎後，popup 的「信號路徑」列只回報音訊目前實際走的路（`Signalsmith` / `伴奏` / `旁路` / `未處理`），使用者不能選。存在的理由是誠實——引擎未啟動時必須看得到音訊其實沒被處理。
- **同時只能擷取一個分頁**是 Chrome 的限制，屬產品事實：介面需誠實呈現（badge `ON` / `ON·` / `!`、分歧橫幅、改擷取按鈕），不隱藏、不假裝。
- **零外部服務**：音訊全程本機處理，不上傳、不依賴外部 API 或帳號。
- **介面語言為繁體中文**（`zh-Hant`）：popup 文案、CONTEXT.md 術語均為繁中；術語以 `CONTEXT.md` 為準（如「連線音訊」「頁面記憶」「輸出總閘」）。
- 授權組合固定：專案程式碼與 Signalsmith Stretch 皆為 MIT（見 `LICENSE`）——ADR-0007 移除 GPLv2+ 的 Rubber Band 後，整包為單一授權，這是發布時的合規事實。
- 技術事實：Chrome MV3，三 context（service worker / offscreen document / popup）加兩支 content script；`npm run build` 產出 `dist/` 後以 unpacked 載入。

## Brand Commitments

- **名稱固定為 Fidelitone。**
- 圖標（`icons/` 下現有 SVG/PNG）**可重新設計**，非約束。
- 未確立其他語氣、視覺或品牌資產約束。（使用者未提出任何 binding 的美學方向。）

## Evidence on Hand

- `README.md`：功能清單、badge 語意、per-page memory 行為、Chrome 限制的完整說明。
- `CONTEXT.md`：已確認的領域詞彙表（繁中術語與 Avoid 詞），是文案與設計的詞彙依據。
- `docs/adr/`：七份已接受的架構決策（伴奏立體聲混音、架構深化、per-page memory、YouTube 音量、移除 loudness 分析、單一移調引擎）。
- `src/popup/`：可運作的 popup 實作（`popup.html` / `popup.css` / `popup.ts`）——現行視覺系統的權威。
- `icons/`、`assets/`：現有圖示與按鈕 icon 資產。
- `src/tests/`：121 個 vitest 測試（15 檔），覆蓋 DSP、routing、popup state、capture lifecycle。

**不存在、不得捏造**：無使用者見證、無案例研究、無新聞報導、無 Chrome Web Store 上架素材（截圖、宣傳文案、評價）、無競品比較數據、無付費方案或定價。

## Product Principles

1. **跟唱不斷線**：換歌、換分頁、開關 popup 都不應讓使用者重新調一次設定。
2. **誠實呈現平台限制**：Chrome 給什麼權限就顯示什麼狀態，不用 UI 粉飾單擷取、權限撤銷等事實。
3. **本機、即時、可預期**：音訊不離開裝置，調整立即生效，交接與淡入淡出避免突兀聲響。
4. **詞彙一致**：介面文案以 CONTEXT.md 的繁中術語為準，同一概念永遠同一個詞。
5. **穩定勝過花俏**：音訊路徑與狀態同步的正確性優先於視覺表現。

## Accessibility & Inclusion

無產品特定的無障礙標準要求（已確認）。popup 現有實作已帶基本 `role` / `aria-live` 標記；維持基本鍵盤可操作與語意標記，不主動擴張至 WCAG 級別承諾。
