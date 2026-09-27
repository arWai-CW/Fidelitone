# Popup 介面 i18n 計劃

目標：把目前寫死在 `src/popup/` 的繁中介面變成三語（`en` / `zh-Hant` / `ja`），
並且**在不做任何回歸的前提下**達成——現有使用者看到的畫面一個字都不變。

Status: 全部階段完成 — 決策已記錄於 [ADR-0008](adr/0008-popup-i18n.md)

---

## 0. 階段 1 實作後的兩項發現

這兩點是實作過程中撞出來的，會影響後續階段的做法。

### 0.1 `data-i18n` 會刪掉子元素

`applyStaticMessages` 用 `textContent` 套用文案，所以 **`data-i18n` 只能放在內容純粹是文字的
元素上**。六顆圖示按鈕（`connectBtn`、`bypassBtn`、`pitchDown`、`pitchUp`、
`pitchReset`、`volumeApplyBtn`）的內容是 `<svg>`，最初誤用了 `data-i18n` 來帶
tooltip 文案，結果啟動時圖示被整個文字取代——`connectBtn` 從 126x42 縮成 96x42，
六顆圖示全部消失。

修正：新增 `data-i18n-tooltip` 對應 `data-tooltip` 屬性，四種屬性分工固定為

| 屬性 | 寫入目標 | 可用於含子元素的元素 |
| --- | --- | --- |
| `data-i18n` | `textContent` | 否 |
| `data-i18n-aria` | `aria-label` | 是 |
| `data-i18n-title` | `title` | 是 |
| `data-i18n-tooltip` | `data-tooltip` | 是 |

這個規則要有測試守著（見 §7 階段 5），否則下一次加按鈕會再犯。

### 0.2 PNG 位元組比較不是版面迴歸的判準

階段 1 的驗收原本打算用「新舊建置截圖比對是否位元組相同」。實測發現**同一份建置
截兩次也會不同**（`connected` 與 `lost` 兩個狀態），差異只有個位數位元組，
來自抗鋸齒／次像素光柵化。

真正有效的判準是 **DOM 幾何比對**：逐元素比對文字節點、`aria-label`、
`data-tooltip`、`aria-valuetext` 與 `getBoundingClientRect()` 的座標與尺寸。
以此為準，階段 1 的五個狀態全部零差異。

連帶影響：`tools/readme-shots` 目前只輸出圖片、不比對，維持現狀即可；
但若日後要加視覺迴歸閘，**必須用 DOM 幾何或帶容差的像素比對**，不能直接比對位元組。

---

## 1. 範圍

**這一版做**：popup 介面的全部使用者可見文案與無障礙標記（約 85 個 key）。

**這一版不做**：

| 不做 | 理由 |
| --- | --- |
| `manifest.json` 的 `name` / `description` / `action.default_title` | 需要 `_locales`；見 §3.3 |
| Chrome Web Store listing 文案 | 目前 listing 本來就是繁中，影響有限 |
| content script 內的字串 | 兩支 script 都不產生使用者可見文案 |
| Toolbar badge（`ON` / `ON·` / `!`） | 狀態記號不是文案，見 §4.3 |
| 使用者手動切換語言 | 見 §3.2 |

---

## 2. 現況盤點

### 2.1 字串位置

| 檔案 | 內容 | 約略數量 |
| --- | --- | --- |
| `src/popup/popup.html` | 標題、`aria-label`、`data-tooltip`、靜態文案、`st` 單位字面 | ~40 |
| `src/popup/popup.ts` | 連線四態、頁面記憶四態、信號路徑五態、旁路切換、YouTube 面板、分歧橫幅、錯誤訊息 | ~45 |
| `src/popup/popup-state.ts` | `formatSemitones`、半音單位 | ~2 |

### 2.2 已有的封閉集合結構（改動時要保留形狀）

這三處是 `Record<State, string>`，不是散落的 if/else。翻譯後必須維持「以 key 為索引」
的結構，這樣新增一個狀態會變成**編譯期缺 key 錯誤**而不是執行期漏字串。

- `MEMORY_COPY`（`popup.ts:232`）— 4 態
- `ROUTE_COPY`（`popup.ts:508`）— 5 態 × 2 欄
- `connectionDetailFor()`（`popup.ts:169`）— 4 態

### 2.3 現有的翻譯相關資產

- `tools/readme-shots/shots.mjs` 已有 per-locale 的 `TEXT` 結構（`shots.mjs:65`），
  但 `shots.mjs:20-23` 明文斷言「the extension's UI is zh-Hant throughout」——
  改完之後這段註解變成假話，見 §5.5。
- `tools/popup-preview/mock-chrome.js` 已 mock `chrome.storage.local`（`mock-chrome.js:138`），
  可以直接支撐固定語系的預覽。
- `tools/package/package.mjs` 已建立「用證明取代假設」的防線（引用完整性、worklet
  存在性、content script 無 module 語法）。任何新產物都必須進這條防線。
- `tsconfig.json` 已開 `resolveJsonModule`，JSON 字典可直接取得字面型別。
- 16 個 vitest 檔全部跑在 `node` 環境（`vite.config.ts:89`，未設 `environment`），
  無 jsdom。i18n 層必須維持純函數以沿用這套基礎設施。

---

## 3. 已確認的決策

### 3.1 訊息來源：型別化字典

`src/i18n/locales/*.json` 為單一真實來源，`zh-Hant.json` 定義 key 集合，
`en.json` / `ja.json` 以 `Record<MessageKey, string>` 型別約束 → **缺 key 是編譯錯誤**。

**排除的方案**：純 `_locales` + `chrome.i18n`。理由是它只有 `$1` 位置參數、沒有具名
插值、沒有單複數、缺 key 回空字串而非報錯，而且 popup 與 manifest 會變成兩套翻譯來源。

### 3.2 語系選擇：跟隨瀏覽器，預設回落 `zh-Hant`

沒有 options page，popup 內也不加語言控制（不改動視覺設計）。解析鏈：

```
chrome.i18n.getAcceptLanguages()   → 第一個有字典的語言
  ↓ 未命中
chrome.i18n.getUILanguage()        → 有字典就用
  ↓ 未命中
zh-Hant                            → 預設
```

`getAcceptLanguages()`（Chrome 99+，回傳 Promise）排在 `getUILanguage()` 之前是
刻意的：對一個把擴充功能介面當成「工具」的人，瀏覽語言通常比瀏覽器 chrome 語言更準確
地代表他要的介面語言。反向排序只差一行，但會讓「日文 Chrome ＋ 只 browsing 英文」的
使用者拿到英文介面。

預設落在 `zh-Hant` 意味著這次改動對現有使用者**純增量、零迴歸**——這是
`PRODUCT.md:44` 現況的正確繼承。

**已知缺口**：Chrome 設成英文、且瀏覽偏好不含 CJK 的繁中使用者會拿到英文介面。
解決它需要手動覆寫（options page 或 popup 內控制），已列為後續。

### 3.3 `_locales` 生成延後

查證結果（[Chrome i18n API reference](https://developer.chrome.com/docs/extensions/reference/api/i18n)）：

- `chrome.i18n.getUILanguage()` **不依賴** `_locales`。文件約束是單向的——
  「If an extension has a /_locales directory, the manifest must define
  `default_locale`」——是 `_locales` 要求 `default_locale`，不是反過來。
- 因此 v1 **不寫 `_locales`、不動 `manifest.json`**。沒有 `_locales` 時加
  `default_locale` 反而是錯的。

§3.1 選的機制沒有被推翻：型別化字典仍是單一真實來源，`_locales` 只是「manifest
本地化」那一步才需要的產物，屆時由同一份字典在 build 時生成，零回頭修改。
`vite.config.ts` 的 `flatHtmlOutput` plugin 可先留位。

---

## 4. 字串處理方式

### 4.1 分類

| 類別 | 處理 | 例 |
| --- | --- | --- |
| 純文案 | 直接 `t()` | `半音吸附`、`信號路徑`、`進階選項` |
| 狀態變體 | 巢狀 key，維持 `Record<State, ...>` 形狀 | `connection.connected.headline` |
| 含插值 | 具名參數，不用字串拼接 | `divergence.text`（tab 標題）、`volume.deviation`（±N%） |
| 數字／單位 | `Intl.NumberFormat` | `aria.pitchValue`、`st` 字面 |

### 4.2 靜態 HTML 與執行期字串

- `popup.html` 的靜態文案改 `data-i18n` 屬性，由 popup 初始化時統一套用。
- `aria-label` / `data-tooltip` 改 `data-i18n-aria` / `data-i18n` 分流。
- `popup.ts` 的執行期字串（含會變的 `aria-label`）直接呼叫 `t()`。

### 4.3 不翻譯的東西

- **Toolbar badge** `ON` / `ON·` / `!`（`src/lib/page-settings.ts:232`）——狀態記號，
  popup 圖例負責解釋。維持原樣。
- **`Signalsmith`** ——技術名。
- **`Fidelitone`** ——品牌字。但 `.wordmark` 的 `text-transform: uppercase`
  對 CJK 是 no-op、對英文會改變字寬，需納入版面審計。

---

## 5. 風險與對策

這裡是主要工作量。翻譯本身是機械的，以下四項才是會決定成敗的。

### 5.1 版面：固定 400px 面板

`body { width: 400px }`（`popup.css:37`）。英文句子普遍比中文長 1.5–2 倍，
面板高度會改變——而設計語言是「一台剪接台」，不是「一個會長高的清單」。

需逐字串量測三語言折行結果，重點：

- `.option-helper` ——「保持人聲/樂器音色特徵…」是全文最長的說明字串
- `.memory-text` ——`頁面記憶 · 依頁面 URL 分開保存 · 連線後套用`
- `.connection-strip` 的 headline / detail
- `.tab-title` ——`max-width: 216px` + `nowrap` + `ellipsis`（`popup.css:94-104`），
  英文 tab 標題被截斷的機率顯著上升

### 5.2 字體：現有堆疊兩邊都不完整

`popup.css:21`：
```css
--font: "Barlow Condensed", "Noto Sans TC", ui-sans-serif, sans-serif;
```

- Barlow Condensed 無 CJK 與假名字形
- Noto Sans TC 不含日文漢字與假名的正確字形

日文會掉進 `ui-sans-serif` 系統回退，字重與字寬和面板其他部分不一致。英文字面
（`st`、`+0.00`）走 Barlow Condensed，與中文 fallback 並存會出現兩套字寬混排。

需 per-locale 堆疊（ja 需 Noto Sans JP），由 `html[lang]` 驅動。

### 5.3 字距：為繁中調的

面板有約 20 處 `letter-spacing`（0.16em / 0.2em / 0.14em 等）與 2 處
`text-transform: uppercase`。這在 CJK 上是設計，在日文假名上會把字打散；
英文 uppercase 會改變字寬，進而影響 `.route-line` 的排版節奏。

需 `:lang()` / `[lang]` 覆寫。字距過大的 `.block-label`（`popup.css:912`，0.2em）
與 `.wordmark`（`popup.css:89`，0.16em）優先。

### 5.4 錯誤訊息混源

`popup.ts` 收到的是 service worker / offscreen / content script 產生的**英文純字串**，
以及 `chrome.runtime.lastError` 的原文。

`describeMissingReceiver()`（`popup.ts:733`）比對的是英文原文
`Receiving end does not exist`——**這段比對必須留在英文側**，只有輸出本地化。
把它一併翻譯會讓比對永遠失配。

v1 範圍內維持原文 + 本地化前綴。擴充功能自產的錯誤改傳錯誤碼列為後續。

### 5.5 連帶受影響：`tools/readme-shots`

`shots.mjs:20-23` 有一段註明記斷「the extension's UI is zh-Hant throughout」，
並據此產生逐語系的 README 圖。改完之後這段註解變成假話，且英文 README 會出現
「UI 語言取決於瀏覽器」的圖——不可重現。

最小修法：讓 preview 端固定語系（`mock-chrome.js` 已 mock `storage.local`，
加一個 `uiLanguage` 即可），維持圖片可重現。範圍小但必須做。

**已解決。** `mock-chrome.js` 新增 `chrome.i18n` 的 `getUILanguage()` 與
`getAcceptLanguages()`，由 `?lang=<tag>`（搭配 `accept=1`）驅動，預設 `zh-TW`。

`shots.mjs` 以 `POPUP_LANG` 這張 per-locale 表把六個 iframe 的語系釘住
（`en` → `en-US`、`zh-Hant` → `zh-TW`），`FIGURES[].render(locale)` 接收語系參數。
**每份 README 配自己語言的介面**——英文版圖片配中文介面，等於給讀者一張他看不懂的
語言的截圖。

原本預期要重量裁切矩形，實測**不必**：英文與繁中的每一個段落邊界 y 座標完全相同
（header `0..50`、rail `50..180`、connection strip `180..257`、memory strip
`257..295`、pitch `295..431`、signal `431..529`、volume `529..703`、
options `703..898`；divergence 狀態同理）。那 18px 的高度差只出現在
`disconnected`，而四張圖都沒用到它。`shots.mjs` 裡已註明這個前提：一旦某個翻譯
改變段落高度，裁切框就會失效。

### 5.6 `html lang`

`popup.html:2` 寫死 `lang="zh-Hant"`，要改為執行期設定
`document.documentElement.lang = resolvedLocale`，同時驅動 `:lang()` 與 `Intl` 預設。

---

## 6. 檔案形狀

```
src/i18n/
  locales/zh-Hant.json    ← 現有繁中逐字搬入，key 的唯一真實來源
  locales/en.json
  locales/ja.json
  catalog.ts              ← matchLocale() / resolveLocale() / interpolate() / t()
  types.ts                ← MessageKey（由 zh-Hant 反推的深層路徑聯集）/ Dictionary
  dom.ts                  ← applyStaticMessages() / applyDocumentLanguage()
src/popup/popup.html      ← 靜態字串改 data-i18n 系列屬性
src/popup/popup.ts        ← 執行期字串改 t("key", {...})
src/popup/popup.css       ← per-locale 字體／字距／換行（階段 2）
src/tests/i18n.test.ts    ← 純 node，無 jsdom
```

`catalog.ts` 維持純函數（無 DOM、無 `chrome.*`），才能在既有的 node 測試環境驗證；
唯一碰文件的地方獨立放在 `dom.ts`。

**語系註冊表以「有字典」為準。** `DICTIONARIES` 這張 map 決定哪些語系可以被解析到，
所以一個還沒有翻譯的語系在結構上就無法被解析到——不會出現「解析成 en 然後畫面
全是 key」這種情況。階段 3 只需加兩行。

**`en.json` / `ja.json` 的型別約束**是 `CatalogShape`：巢狀結構必須與 `zh-Hant.json`
完全一致，葉節點是 `string`。少一個 key 是編譯錯誤。多出來的 key 不會被 TS 抓到
（JSON import 不是 fresh literal），要靠階段 5 的孤兒 key 測試補。

---

## 7. 階段與驗收

順序刻意把**版面風險（階段 2）排在翻譯（階段 3）之前**：反過來會在譯完三語言後才
發現版面撐不住，那時要改的是文案而不是 CSS，成本高一個量級。

| # | 內容 | 驗收標準 | 結果 |
| --- | --- | --- | --- |
| 1 | catalog 骨架 + `zh-Hant.json` 逐字搬入，popup 全改吃 `t()` | **DOM 幾何零差異**（見 §0.2）；`typecheck` 綠 | ✅ 見 §0.1、§0.2 |
| 2 | `resolveLocale()` + `documentElement.lang` + per-locale 字體／字距／換行 | 三語言下逐面板 DOM 幾何比對無溢出、無截斷 | ✅ 18 種組合零溢出零截斷 |
| 3 | `en.json` / `ja.json` 翻譯 + `CONTEXT.md` 三語術語對照表 | 術語 Avoid 清單同步翻譯；對照表隨 ADR 一併提交 | ✅ 對照表見 `CONTEXT.md` |
| 4 | 數字／單位格式化（`formatSemitones`、`aria-valuetext`、`st` 字面） | 三語系的符號、千分位、正負號一致 | ✅ 見 §0.3 |
| 5 | 測試：`i18n.test.ts` + `i18n-guard.test.ts` | 故意塞硬編字串／孤兒 key／過期 fallback／圖示按鈕加 `data-i18n` 都會紅 | ✅ 四條規則皆驗證過會紅 |
| 6 | `readme-shots` 固定語系、`PRODUCT.md`、`store/README.md`、ADR-0008 | 截圖可重現；文件不再斷言 UI 語言 | ✅ `POPUP_LANG` per-locale，英文圖已重出 |

### 0.3 補充：數字格式化與單複數

`Intl.NumberFormat` 搭配 `signDisplay: "always"` 在三個 locale 都輸出與原本手寫拼接
**完全相同**的字串（實測逐值比對，連 ASCII `-` 而非 U+2212 都一致）。所以階段 4
對繁中是零視覺變更。

只有 `pitch.valueAriaText` 需要單複數：英文 `1 semitone` / `N semitones`，中日文不變化。
catalog 因此允許葉節點是 `{one?, other}`，並由 `t()` 傳 `count` 觸發 `Intl.PluralRules`。
已驗證中日文條目保持純字串、`count` 對它們沒有影響。

### 0.4 殘餘：日文面板高度

| 狀態 | zh-Hant | en | ja |
| --- | --- | --- | --- |
| disconnected | 724 | 742 | 742 |
| connected | 898 | 898 | 898 |
| accompaniment | 898 | 898 | 920 |
| lost | 898 | 898 | 920 |
| divergence | 978 | 978 | 1016 |
| bypass | 898 | 898 | 898 |

過程中確實有一次版面崩壞：日文 headline 最初寫「音声チャンネルが開きました」，
面板從 898 長到 939。縮短文案後 `connected` 回到 898，與中英文完全一致。
殘餘的 +22 / +38px 是日文句子較長所致，全部落在彈性高度的 strip 內，零溢出零截斷。
為了讓數字歸零而把日文砍到讀不懂是錯的取捨，故保留。

### 0.5 計劃預期但實作後未成立的一項

§5.3 預期 20 處 `letter-spacing`（最高 0.2em）會讓日文假名打散，需要 per-locale 覆寫。
**實測三語言截圖後沒有這個問題**——0.2em 的間距在假名上仍可讀，英文在 Barlow Condensed
下反而是刻意的字距風格。因此**沒有加任何字距覆寫**。計劃預測錯了，就不該為了照計畫
而製造一批沒有視覺根據的 CSS。

### 階段 5 的兩條防線

1. **`i18n.test.ts`** ——插值、解析鏈回落、缺 key 報錯。
2. **硬編字串掃描測試** ——grep `popup.html` / `popup.ts` 不得出現未經 catalog 的
   使用者可見字串。這條是防止三語言退化成三份各自腐化的 HTML 的唯一靠山，
   與 `package.mjs` 的「用證明取代假設」同一路數。

---

## 8. 術語對照（`CONTEXT.md` 的延伸）

`CONTEXT.md` 是繁中詞彙表，每個詞帶 `_Avoid_` 清單。三語翻譯必須一併產出對照表，
否則譯者會重蹈「直通 vs 旁路」的覆轍。以下為起點，翻譯階段確認：

| zh-Hant | en | ja |
| --- | --- | --- |
| 連線音訊 | Connect audio | 音声を接続 |
| 擷取分頁 | captured tab | キャプチャ中のタブ |
| 頁面記憶 | page memory | ページメモリ |
| 設定分歧 | settings divergence | 設定の乖離 |
| 自動跟隨 | tab follow | 自動追従 |
| 信號路徑 | signal path | 信号パス |
| 移調引擎 | pitch engine | ピッチエンジン |
| 伴奏模式 | accompaniment mode | 伴奏モード |
| 旁路 | bypass | バイパス |
| 基準音量 | base volume | 基準音量 |
| 頁面音量 | page volume | ページ音量 |
| 共振峰保護 | formant protection | フォルマント保護 |
| 半音吸附 | snap to semitone | 半音スナップ |

**Avoid 清單也要翻譯**——「不要寫成直通的說法不該蓋掉引擎沒起來這個事實」這種
告誡對譯者同樣成立。

---

## 9. 後續（不在本計劃）

- manifest 三欄本地化 + `_locales` 由字典生成 + `package.mjs` 補檢查
- 錯誤碼化（`SET_PITCH` 等回傳 code 而非英文字串）
- 使用者手動切換語言（options page）
- 擴充套件自帶字型，移除對 Google Fonts 的執行期依賴（`popup.html:10-13`）
