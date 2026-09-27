# 0008: popup 介面 i18n（en / zh-Hant / ja）

Status: accepted — 已實作

## 背景

popup 的介面語言一直是繁體中文（`PRODUCT.md` 原本直接寫死這條），所有使用者可見字串
散在兩個檔案裡：

- `src/popup/popup.html` —— 標題、`aria-label`、`data-tooltip`、靜態文案（~40 個）
- `src/popup/popup.ts` —— 連線四態、頁面記憶四態、信號路徑五態、旁路切換、YouTube
  面板、分歧橫幅、錯誤訊息（~45 個）

實際使用者是**唱歌／練唱者**，而唱歌這件事在粵語、日語、華語圈都一樣普及。
`store/README.md` 的 Language 欄位只能填一種語言，但那限制的是 **listing**，
不是介面——Chrome 商店同一個擴充套件可以只發一份 listing 讓全球使用者在
自己的瀏覽器語言下拿到介面。

真正的工程量不在翻譯，而在三件沒有人寫下來就會踩到的事：

1. **版面**：400px 固定寬度、`popup.css:21` 的字體堆疊、20 處 `letter-spacing`
   （0.16em / 0.2em）都是為繁中調的。
2. **字體**：`"Barlow Condensed", "Noto Sans TC"` 兩邊都不完整。Barlow Condensed
   沒有 CJK 與假名字形；Noto Sans TC 的漢字是**中文字形**，日文讀者一眼看得出來。
3. **缺 key 不會報錯**：這是三語言能不能長期維護的唯一關鍵。

## 決策

### 1. 型別化字典，單一真實來源

```
src/i18n/
  locales/zh-Hant.json    ← key 的唯一真實來源
  locales/en.json
  locales/ja.json
  catalog.ts              ← matchLocale / resolveLocale / interpolate / t（純函數）
  types.ts                ← MessageKey / CatalogShape
  dom.ts                  ← applyStaticMessages / applyDocumentLanguage
```

`zh-Hant.json` 定義 key 集合，`en.json` / `ja.json` 以 `CatalogShape` 對型，
**缺 key 是編譯錯誤**。孤兒 key（多出來的）TS 抓不到——JSON import 不是 fresh
object literal，不會觸發 excess property check——所以由
`src/tests/i18n-guard.test.ts` 補上。

### 2. 語系註冊表以「有字典」為準

`catalog.ts` 的 `DICTIONARIES` 這張 map 決定哪些語系可以被解析到。一個還沒有翻譯的
語系在**結構上**無法被 `resolveLocale` 解析到，不會出現「解析成 en 然後畫面全是 key」。
新增語系 = 加一個字典檔 + 加 map 一行。

### 3. 解析鏈：瀏覽偏好語言 → 瀏覽器介面語言 → `zh-Hant`

```
chrome.i18n.getAcceptLanguages()   → 第一個有字典的語言（Chrome 99+）
  ↓ 未命中
chrome.i18n.getUILanguage()
  ↓ 未命中
zh-Hant
```

`getAcceptLanguages()` 排在前面是刻意的：Chrome 設成英文、但瀏覽偏好含 `zh-TW` 的
繁中使用者（正是主要使用者群）會拿到繁中介面。反向排序只差一行，但會讓
「日文 Chrome ＋ 只 browsing 英文」的使用者拿到英文介面。**這個取捨是產品決定，
不是實作細節**，寫在 `catalog.ts` 的註解裡以免後人不知情地翻轉。

**預設落在 `zh-Hant`** 代表這次改動對現有使用者**純增量、零迴歸**。

### 4. 不做 `_locales`，因此不改 `manifest.json`

[Chrome i18n 文件](https://developer.chrome.com/docs/extensions/reference/api/i18n)的約束是
單向的：「If an extension has a /_locales directory, the manifest must define
`default_locale`」——是 `_locales` 要求 `default_locale`，不是反過來。
`getUILanguage()` 與 `getAcceptLanguages()` 在沒有 `_locales` 時照樣可用。

所以本 ADR 範圍內**不產生 `_locales`、不動 `manifest.json`**（沒有 `_locales` 時
加 `default_locale` 反而是錯的）。manifest 三欄與商店 listing 的本地化留待後續，
屆時 `_locales` 由同一份字典在 build 時生成，單一真實來源不變。

### 5. 明確排除：純 `chrome.i18n`

`chrome.i18n` 只有 `$1` 位置參數、沒有具名插值、沒有單複數、**缺 key 回空字串而非
報錯**，而且 manifest 與 popup 會變成兩套翻譯來源。一個回空字串的介面是除錯不出來的
介面。三個 locale 的維護成本遠低於那個風險。

### 6. 四種標記屬性分工

`popup.html` 的靜態文案帶 catalog key，並**保留繁中原文作為 script 執行前的
fallback**（面板要完整，不能先閃一格空白）。啟動時 `applyStaticMessages` 覆蓋。

| 屬性 | 寫入目標 | 可用於含子元素的元素 |
| --- | --- | --- |
| `data-i18n` | `textContent` | **否** |
| `data-i18n-aria` | `aria-label` | 是 |
| `data-i18n-title` | `title` | 是 |
| `data-i18n-tooltip` | `data-tooltip` | 是 |

`data-i18n` 只能用在內容純粹是文字的元素上。六顆圖示按鈕最初誤用了它來帶 tooltip，
結果啟動時 `<svg>` 被文字取代、`connectBtn` 從 126x42 縮成 96x42——**這個 bug 是靠
截圖比對抓到的，型別檢查完全無感**。現在有測試守著。

### 7. 數字與單位走 `Intl`

`formatSemitones` 改為接受一個 formatter，popup 傳 `t.formatNumber`。三個 locale 的
`Intl.NumberFormat` 搭配 `signDisplay: "always"` 都輸出與原本手寫拼接**完全相同**的
字串（含 ASCII `-`，非 U+2212），有測試逐值釘住。`aria-valuetext` 帶 `count` 參數，
英文因此能說 `1 semitone`，中日文不變化。

### 8. 錯誤訊息維持現狀，範圍明確

v1 維持「擴充功能自產的錯誤是英文純字串」。`describeMissingReceiver()` 比對的是
Chrome 自己的 `runtime.lastError` 原文（`Receiving end does not exist`），**那段比對
必須留在英文側**，只有輸出本地化——把它翻譯會讓比對在每個非英文語系都失配。
錯誤碼化列為後續。

## 為什麼版面風險要在翻譯之前處理

計劃把 per-locale 版面工作排在翻譯之前。反過來的話會在譯完三語言後才發現面板撐不住，
那時要改的是文案而不是 CSS，成本高一個量級。實測結果也證實這個順序是對的：日文
headline 最初寫成「音声チャンネルが開きました」，面板從 898px 長到 939px，連線帶整個
失卻節奏；把文案縮短後回到 898px，與中英文**完全一致**。

## 實測：三語言版面

六個狀態 × 三個語言 = 18 種組合，**零溢出、零截斷**。面板高度：

| 狀態 | zh-Hant | en | ja |
| --- | --- | --- | --- |
| disconnected | 724 | 742 | 742 |
| connected | 898 | 898 | 898 |
| accompaniment | 898 | 898 | 920 |
| lost | 898 | 898 | 920 |
| divergence | 978 | 978 | 1016 |
| bypass | 898 | 898 | 898 |

殘餘差異是日文句子較長造成的 **+22 / +38px**，全部落在彈性高度的 strip 內，
不造成溢出也不造成截斷。為了讓數字歸零而把日文砍到讀不懂，是錯的取捨。

## 兩個關於「驗收」的事實

1. **PNG 位元組比較不是版面迴歸判準。** 同一份建置截兩次也會差幾個位元組（抗鋸齒）。
   有效判準是 DOM 幾何比對：逐元素比對文字節點、aria／tooltip 屬性與
   `getBoundingClientRect()`。階段 1 據此確認零差異。日後若要加視覺迴歸閘，
   必須用幾何或帶容差的像素比對。
2. **硬編字串是三語言退化成三份各自腐化的 HTML 的唯一入口。**
   `i18n-guard.test.ts` 掃描 `popup.ts` 不得出現 CJK 字串常數（註解除外），
   並驗證每個 `data-i18n*` 的 key 存在、HTML fallback 等於 catalog 值。
   四條規則都經過「故意弄壞 → 測試變紅」驗證。

## 明確不做

- **使用者手動切換語言**。要嘛加 options page（manifest 目前沒有 `options_page`，
  等於新增一個頁面與建置入口），要嘛在 400px 面板加一個語言控制（改動視覺設計）。
  v1 兩者都不做。已知缺口：Chrome 與瀏覽偏好都不含 CJK 的繁中使用者會拿到英文介面。
- **`_locales` 與 manifest 本地化**（§4）。
- **錯誤碼化**（§8）。
- **擴充套件自帶字型**。目前仍依賴 Google Fonts；中日文都是 unicode-range
  子集，只下載文案實際觸及的子集，但這仍是唯一的對外連線。
- **Toolbar badge 本地化**。`ON` / `ON·` / `!` 是狀態記號不是文案，popup 圖例負責解釋。
- **`Signalsmith` 與 `Fidelitone`**。技術名與品牌名，三語一致。

## 後續

1. `CONTEXT.md` 三語對照表（已隨本 ADR 提交）
2. manifest 三欄本地化 + `_locales` 由字典生成 + `package.mjs` 補檢查
3. 錯誤碼化
4. options page 語言覆寫
5. 內建字型，移除對 Google Fonts 的執行期依賴
