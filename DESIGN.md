---
name: Fidelitone
description: 電影剪接台 select rail——true black 底＋單一 grain orange 的 Chrome 移調 popup 設計系統
colors:
  primary: "#ff5a1f"
  primary-deep: "#d94712"
  ground-ink: "#0a0a0a"
  surface-panel: "#121212"
  surface-charred: "#1a1a1a"
  spool: "#2e2e2e"
  punched-white: "#f2f2f2"
  paper-white: "#ffffff"
  text-2: "#a8a8a8"
  text-3: "#8d8d8d"
  on-orange-muted: "rgba(10, 10, 10, 0.72)"
typography:
  display:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "36px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.01em"
  headline:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "15.5px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.03em"
  title:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "0.14em"
  body:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.45
    letterSpacing: "normal"
  label:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "11.5px"
    fontWeight: 600
    lineHeight: 1.45
    letterSpacing: "0.2em"
  field-number:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "25px"
    fontWeight: 700
    lineHeight: 1.45
    letterSpacing: "normal"
  wordmark:
    fontFamily: "\"Barlow Condensed\", \"Noto Sans TC\", ui-sans-serif, sans-serif"
    fontSize: "17px"
    fontWeight: 700
    lineHeight: 1
    letterSpacing: "0.16em"
rounded:
  sm: "3px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ground-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "42px"
  button-primary-connected:
    backgroundColor: "{colors.punched-white}"
    textColor: "{colors.ground-ink}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "42px"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    padding: "0 16px"
    height: "44px"
  button-mark:
    backgroundColor: "transparent"
    textColor: "{colors.punched-white}"
    rounded: "{rounded.sm}"
    size: "42px"
  input-switch:
    backgroundColor: "{colors.ground-ink}"
    textColor: "{colors.ground-ink}"
    rounded: "{rounded.sm}"
    width: "38px"
    height: "21px"
  input-number:
    backgroundColor: "{colors.ground-ink}"
    textColor: "{colors.punched-white}"
    rounded: "{rounded.sm}"
    width: "78px"
    height: "44px"
  card-engine:
    backgroundColor: "{colors.ground-ink}"
    textColor: "{colors.punched-white}"
    rounded: "{rounded.sm}"
    padding: "11px 36px 11px 13px"
  card-engine-selected:
    backgroundColor: "{colors.punched-white}"
    textColor: "{colors.ground-ink}"
    rounded: "{rounded.sm}"
    padding: "11px 36px 11px 13px"
  banner-punched:
    backgroundColor: "{colors.punched-white}"
    textColor: "{colors.ground-ink}"
    padding: "11px 16px 12px 42px"
  banner-divergence:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.ground-ink}"
    padding: "11px 16px"
---

# Design System: Fidelitone

## Overview

**Creative North Star: "電影剪接台 select rail（The Cutting Bench Select Rail）"**

Fidelitone 的 popup 是一台口袋大小的電影剪接台：true black（#0a0a0a）台面，頂端一條打孔膠片軌橫貫 400px 固定寬的畫面，台面上唯一的彩色是 grain orange（#ff5a1f）。密度高、全平面、以「格」分層——每個功能區是串在軌下的一條 strip，靠 1px 髮絲線與底色差分隔，不靠卡片浮起。使用者在跟唱中途打開它，幾秒內看完狀態、把折角膠帶旗拖到自己的調，然後關掉；所以視覺必須一眼可辨、一次手勢到位。

這個世界明確拒絕本類擴充功能的預設排法：深色面板＋霓虹點綴＋波形／等化器視覺＋滑桿堆疊（那正是被淘汰的舊皮）。沒有裝飾性波形、沒有色相分類的狀態燈、沒有第二種彩色。狀態一律用記號＋繁中文案雙重表達：grease 叉＝cut／無效、打孔角＝鎖定、虛線＝pending、反白＝selected／live。

質地來自題材本身：`src/popup/grain.png` 是本機以 ffmpeg `nullsrc + geq random` 產生的 film-grain raster（無外部影像依賴），以 `overlay` 混色鋪在膠片條上；打孔孔洞、格距與半音刻度用 repeating gradients 畫出——那是剪接台上的量測工具，屬世界原生幾何，不是裝飾條紋。記憶點在軌上：沿打孔膠片軌刮擦，折角膠帶旗慣性滑動、吸附到半音格距，提交時橘色膠帶條一閃（320ms brightness flash）。

**Key Characteristics:**

- 一條打孔膠片軌＝音高刻度；折角膠帶旗標記目前移調量，刻度、旗、切格、讀數共用同一條定位式。
- 單一 grain orange；狀態靠記號（grease 叉、打孔角、虛線、反白）＋文案，不靠色相。
- 打孔白窗（punched-white 底＋ground-ink 字）容納錯誤、tooltip 與 selected／live 反白。
- 條帶式堆疊版面，1px 髮絲分隔，圓角一律 3px；陰影只給有實體的零件（旗、針、tooltip）。
- 一個壓縮無襯線（Barlow Condensed，全大寫＋寬字距）＋ Noto Sans TC；所有數字 tabular-nums。

## Colors

台面上只有一種彩色：橘色是唯一的行動／進行中訊號，其餘全是黑—灰的層級。

### Primary

- **Grain Orange** (#ff5a1f): 唯一的墨色。用在主按鈕膠帶條、section 標題（h2）、focus ring、折角旗、開關勾選、連線中狀態與文案、分歧橫幅、膠片條連線後的點亮、滑鼠 hover 的邊框與圖示。直向約三分之一的面積是它的上限，稀有即是強度。
- **Deep Orange** (#d94712): 橘色的按壓態——膠帶條 hover、膠帶圖示 hover；也做折角旗 104deg 折面的暗面（64% 之後）。

### Neutral

- **Bench Ink** (#0a0a0a): 台面底（html/body）、切格 cut-cell、輸入框底、開關底、引擎卡底；同時是白窗與橘底上的文字色（on-orange 同值）。
- **Panel** (#121212): 條帶（strip）與軌的底色，比台面高一階。
- **Charred** (#1a1a1a): 膠片條的靜止底色、鎖定引擎卡的底色——比 panel 暗、比 ink 亮。
- **Spool** (#2e2e2e): 1px 邊框、髮絲分隔線（hairline 同值）、停用底色、次要刻度線、捲動條 thumb。
- **Punched White** (#f2f2f2): 打孔白窗的窗底，也是主要文字色（--text 同值）——同一個白既是字也是窗；用在錯誤橫幅、tooltip、選取卡、連線中的主按鈕反白。
- **Paper White** (#ffffff): 反白主按鈕的 hover。
- **Text-2** (#a8a8a8): 次要說明文字（helper、desc、記憶文案、面板註記）。
- **Text-3** (#8d8d8d): 三級文字（刻度標籤、單位、group 標籤、停用標示）；也是最淺的「可以當文字用」的灰。
- **On-orange Muted** (rgba(10, 10, 10, 0.72)): 白窗／反白卡上的次行文字（錯誤 recovery、選取卡的 desc）。

### Named Rules

**The Single-Ink Rule.** 整個系統只允許一種彩色 grain orange。狀態用記號＋繁中文案表達，永遠不新增色相；橘色一出現就代表「可操作」或「正在發生」。

**The Punched-Window Rule.** 打孔白窗（punched-white 底＋ground-ink 字）只給緊急或正在生效的內容：錯誤橫幅、tooltip、selected／live 反白。它是台面上唯一的「挖開」動作，濫用即失效。

**The Contrast Floor.** text-2（#a8a8a8）與 text-3（#8d8d8d）在 #0a0a0a／#121212 底上都 ≥4.5:1（finish review 實測）。text-3 是文字的下限；更淺的灰只做線條、刻度與邊框，不做文字；在色底上以該色的 ink 濃淡調出次級文字，不用灰。

## Typography

**Display Font:** Barlow Condensed（fallback `Noto Sans TC` → `ui-sans-serif, sans-serif`）——Google Fonts CDN 載入 400/500/600/700，離線降級系統字。
**Body Font:** 同一條 stack（`--font`）：拉丁字形走 Barlow Condensed，中文字形由 Noto Sans TC 接手，無第二個 body 家族。
**Label/Mono Font:** 沒有獨立 mono；所有數字以 `font-variant-numeric: tabular-nums` 取表格數字。

**Character:** 一個壓縮無襯線貫穿全站。拉丁標籤全大寫＋寬字距，像剪接台金屬件上的刻印；中文靠字重與字距分層。層級靠格數（strip 的位置與分隔）不靠字級，字級跳動很小。

### Hierarchy

- **Display** (700, 36px, line-height 1): 音高讀數 `+0.00 st`，全站唯一的展示級；右側單位 `st` 為 16px/600/0.1em（text-3），tabular-nums。
- **Field Number** (700, 25px, tabular-nums): 基準音量輸入框裡的數字——Display 之下、Headline 之上的專用級；右接的 `%` 為 17px/600（text-3）。
- **Headline** (600, 15.5px, letter-spacing 0.03em): 連線列主文案（「等待開始」），punched-white。
- **Title** (700, 13px, letter-spacing 0.14em): section 標題（h2：音高、信號路徑、進階選項…），一律 grain orange。
- **Body** (400, 14px, line-height 1.45): popup 預設文字；說明行降一級到 12.5px（option-helper、engine-desc、panel-note、記憶文案 12.5px/500/0.04em）。
- **Label** (600, 11.5px, letter-spacing 0.2em): 組標籤（處理引擎、基準音量）；刻度標籤 11px/600/0.04em（tabular-nums）；wordmark 17px/700/0.16em 全大寫。

### Named Rules

**The Tabular Rule.** 任何會跳動的數字（音高讀數、音量、刻度、百分比）一律 tabular-nums，讀數改變時不推擠版面。

**The Caps-and-Tracking Rule.** 拉丁標籤全大寫、字距 ≥0.04em（wordmark 0.16em、group 標籤 0.2em）；中文標題用字重 700＋0.14em 字距取得同一種刻印感，不靠放大字級。字距全程為正，不使用負字距。

## Layout

popup 固定 400px 寬（形式約束，非可變項）：沒有 breakpoint，寬度不響應；內容超過高度時由 popup 本身垂直捲動，捲動條 10px、thumb 為 spool 底＋3px ink 內框、hover 轉橘，軌道為 ink——瀏覽器表面同樣吃 palette。

版面是垂直堆疊的條帶（strip），自上而下：bench header（13px 16px 11px，wordmark＋分頁標題，底 1px 髮絲）→ 打孔軌（狀態列 12px 0 4px → 46px 刻度區 → 48px 膠片條）→ 連線列 → 頁面記憶列 → 錯誤橫幅／分歧橫幅（條件出現）→ 音高 → 信號路徑 →（YouTube 面板，僅 YouTube 出現）→ 進階選項（兩支大頭針收尾）。

節奏：條帶 padding 16px、條帶間 1px hairline（#2e2e2e）分隔、組內 gap 8–14px、列 padding 11–12px、標籤與控件 9px、strip-head 下距 12px。進階選項列以 1px 虛線（spool）分隔、最後一條去掉虛線並收 padding。

軌內對齊：刻度、折角旗、切格、隱形 range slider 全部以同一條定位式落點——`calc(var(--pitch-pct) * (100% - 16px) + 8px)`（thumb 寬 16px 補償兩端）；膠片條的上下打孔與刻度共用同一原點，所以孔洞與格線永遠對齊。25 格半音以兩層 repeating gradients 畫出（major 每 4 格、minor 每格）。

### Named Rules

**The One-Rail Rule.** 所有與「目前移調量」有關的表現（刻度、折角旗、切格、讀數）都掛在同一條軌、同一條定位式上；不另開第二個滑桿、不用第二個進度表示。

## Elevation & Depth

預設全平面：層級靠 1px 髮絲線與底色階（ink #0a0a0a → panel #121212 → charred #1a1a1a）分離，不用陰影堆疊、不用玻璃或模糊。陰影只給「真的放在台面上的零件」，且一律帶偏移與柔化的實體投影。

### Shadow Vocabulary

- **Flag lift** (`filter: drop-shadow(0 2px 3px rgba(0, 0, 0, 0.6))`): 折角膠帶旗浮在膠片條上的唯一投影。
- **Pin lift** (`box-shadow: 0 2px 4px rgba(0, 0, 0, 0.65)`): 大頭針把進階選項「釘」在台面上。
- **Tooltip lift** (`box-shadow: 0 4px 14px rgba(0, 0, 0, 0.55)`): 唯一的浮層（tooltip）投影。

### Named Rules

**The Hairline Rule.** 分隔一律 1px 髮絲線，宣告層級只用 border 或陰影其一。陰影只准給有實體的零件（旗、針、tooltip），一律偏移＋柔化；不做裝飾性光暈、不做零偏移色暈、不做硬偏移方塊陰影。

## Shapes

圓角一律 3px（按鈕、卡、開關、輸入框、tooltip）；唯一的圓是大頭針（50%，13px）。卡不是通用的 12–16px 圓角卡，而是剪接台上的「格」：1px spool 邊框、3px 圓角、ink 底。邊框 1px spool；focus 為 2px orange outline（offset 2px；軌的 focus-within offset 3px）；連線遺失態的主按鈕用 inset 1.5px orange。

幾何母題是「打孔」：

- **Punched corner**: 16px／14px 的 clip-path 三角，蓋在被鎖定的區塊與卡的右上角＝locked。
- **Punched dots**: 半徑 1.7px 的實心硬邊圓點（radial-gradient），沿膠帶條左右 6px 內側成列、沿引擎卡右緣成列＝撕齒邊；停用時換成 text-3，遺失時換成 orange。
- **Perforation**: 膠片條上下緣 7px 高的長孔（repeating-linear-gradient，9px 實／9px 空），與半音刻度雙層線（major 每 4 格 15px 高、minor 每格 8px 高）同源。
- **Folded pennant**: 折角旗 `clip-path: polygon(0 0, 100% 0, 100% 68%, 50% 100%, 0 68%)`，104deg 兩段漸層（64% 處轉暗）做折面；頁面記憶的 pennant 記號同形（12×14）。
- **Dashed**: 虛線＝pending——待套用的記憶記號（stroke-dasharray 2.6 2）、連線中的方框（3 2.5）、進階選項列 1px dashed 分隔。
- **Grease cross**: 2.6px 線寬、-7deg 旋轉的叉＝cut／invalid／旁路啟用。

### Named Rules

**The Mark Rule.** 狀態由記號＋文案雙重表達，永不以色相分類：實心＝live、虛線＝pending、grease 叉＝cut／無效、打孔角＝locked、反白＝selected／live。

**The Perforation Rule.** repeating gradients 只用來畫這個世界自己的量測與膠片幾何——半音刻度、格距分隔、膠片打孔、撕齒孔列（finish review 已認可其為世界原生主幾何）。它們是量測工具與材料邊緣，不是裝飾條紋。

## Components

### Buttons

主按鈕家族是「膠帶條」：矩形、3px 圓角、無 icon-only 花紋，靠實色與打孔邊傳達材質。

- **Tape Button（連線音訊）**: 42px 高、padding 0 16px、radius 3px、grain orange 底＋ground-ink 字、15px/700/0.07em，左右各一列 punched dots（距邊 6px）。icon 15px。
  - **Hover / Active**: 底轉 primary-deep（140ms snap-ease），按下 translateY(1px)（90ms linear）。
  - **Disabled**: spool 底＋text-3 字、punch dots 轉 text-3、cursor default。
  - **Connecting（busy）**: power icon 換成虛線圓並 900ms 旋轉。
  - **Connected（反白）**: punched-white 底、hover 轉 paper-white——連線中＝live＝反白。
  - **Lost**: ink 底＋orange 字＋inset 1.5px orange 邊、punch dots 轉 orange（打孔點用實心硬邊，不做漸隱光暈）。
- **Mark Button（bypass）**: 42×42、透明底、1px spool 邊、radius 3px、圖示 punched-white。Hover 轉 orange（邊框＋圖示）。Pressed＝反白（punched-white 底、ink 字、圖示降到 0.4 好讓 grease 叉浮出）＋ -7deg grease 叉。Disabled: opacity 0.45、cursor default。
- **Step Buttons（±／重設）**: 34×34、透明底、1px spool、radius 3px；hover orange；disabled 字轉 spool、邊轉 charred。重設鈕以 4px 左外距分組。
- **Tape Icon（套用基準音量）**: 44×44、orange 底＋ink 字、radius 3px、勾選圖示 19px；hover primary-deep；disabled spool／text-3。
- **Ghost Button（淡出）**: 44px 高、透明底、1px orange 邊、orange 字、15px/600/0.08em；hover 填滿 orange 轉 ink 字；disabled text-3＋spool 邊。
- **Divergence Action（改擷取此分頁）**: 32px 高、padding 0 13px、ink 底＋punched-white 字、radius 3px；hover 轉 charred。

### Switches（半音吸附、共振峰保護、伴奏模式）

38×21、radius 3px、ink 底＋1px spool 邊；鈕 14×15、text-2。Checked：底與邊轉 orange、鈕轉 ground-ink 並 translateX(17px)（160ms snap-ease）。Focus-visible（藏起來的 checkbox）：鈕外 2px orange outline＋offset 2px。Disabled：switch opacity 0.5、cursor 箭頭。整列 label 可點，列 padding 11px 0、gap 11px。

### Cards / Containers（strip 與引擎卡）

- **Strip（條帶）**: radius 0（全寬矩形）、panel 底、padding 16px、底 1px hairline；無陰影。區塊標題 h2（title 規格、orange）。
- **Engine Card（信號路徑）**: ink 底、1px spool、radius 3px、padding 11px 36px 11px 13px、右緣一列 punched dots；name 15px/700/0.06em 全大寫，desc 12.5px text-2。Hover 邊轉 orange。
  - **Selected（is-selected）**: 整卡反白——punched-white 底、ink 字、desc 轉 on-orange-muted、punch dots 轉 ink。反白＝selected／live。
  - **Disabled**: 底與邊轉 charred、cursor default——**不吃整體 opacity**，以免底色逼近反白、搶走「反白＝live」的語意。
  - **Disabled + Selected**: 仍反白，但右上角打一個 14px punched corner（panel 底三角），讓「鎖定」不被反白冒充、對比也完整保留。

### Inputs / Fields

- **Volume Number**: 78×44、ink 底、1px spool、radius 3px、25px/700 tabular-nums 居中；focus 邊轉 orange＋2px orange outline（offset 1px）；spin button opacity 0.45。右接 `%`（17px/600/text-3）。
- **Range（軌上的音高滑桿）**: 視覺上不可見——slider 覆蓋整段 `.rail-track`（46px 刻度區＋48px 膠片條，共 94px），不只刻度區：點膠片條任一處即可直接拖動（native 軌面點擊即跳值並續拖），thumb 透明、游標 grab／grabbing；整個 `.rail-track` 在 focus-within 時套 2px orange outline（offset 3px）；disabled 時 not-allowed。水平範圍與刻度完全同寬（thumb 16px 補償兩端），加高不改變取值幾何；刻度、旗、切格才是它的視覺本體。

### Navigation / 狀態列

- **Rail Status**: 14px 記號＋13.5px/600/0.08em 文案，gap 9px。記號依 `data-connection-state` 切換：disconnected＝空心方框（text-3）、connecting＝虛線方框 1.4s 旋轉、connected＝實心方框 orange、lost＝orange grease 叉；文案在 connecting 時轉 orange。
- **Memory Strip**: 14px pennant 記號＋12.5px/500/0.04em 文案（text-2），底 panel、padding 9px 16px。pending＝虛線 pennant（text-3）、saved＝實心 pennant（orange）、none＝空心方框（text-3）、locked＝grease 叉（orange）。

### Signature: 打孔軌（Rail）

一條 400px 全寬的軌：狀態列 → 46px 刻度區（雙層 repeating gradients 刻度＋五個 tabular 刻度標籤 −12/−6/0/+6/+12＋折角旗）→ 48px 膠片條（charred 底、grain.png overlay 混色、上下 7px 打孔、24 格分隔線、跟著 `--pitch-pct` 移動的 ink 色 cut-cell）。連線後整條膠片條轉 orange（260ms）；連線中橘色光帶 1.1s 掃過；提交時 320ms brightness(2)→1 的膠帶一閃；鎖定時右上角 16px 打孔角、膠片條退回 charred。旗：17×40、clip-path 折角、104deg 漸層折面、drop-shadow、`left` 以 120ms snap-ease 吸附。

### Error / Alerts

- **Punched Window（錯誤橫幅）**: punched-white 底＋ink 字、padding 11px 16px 12px 42px、左側 16px grease 叉（ink）內縮 16px；主文案 13.5px/600、recovery 12.5px/400 on-orange-muted——錯誤寫出問題與補救。`role="alert"`＋`aria-live="assertive"`。
- **Divergence Banner**: 全寬 orange 底＋ink 字、padding 11px 16px、copy 13.5px/600 flex 1，右接 ink 底的動作鈕。
- **Tooltip**: fixed、punched-white 底＋ink 字、padding 6px 10px、radius 3px、max-width 240px、12.5px/600/0.04em、0.4s 內 opacity 過場，唯一帶 0 4px 14px 投影的浮層。

### Motion

統一 `--snap-ease: cubic-bezier(0.32, 0.72, 0, 1)`（吸附手感）：旗 120ms、切格 180ms、按鈕邊框與底色 140ms、開關 160ms、膠片條底色 260ms；按壓位移 90ms linear。編排過的記憶點只有兩個：提交的膠帶一閃（320ms ease-out brightness）與連線中的光帶掃描（1.1s linear）＋記號旋轉。`prefers-reduced-motion: reduce` 時關閉掃描、旋轉、閃光，以及旗／切格／開關／按鈕的過場。

## Do's and Don'ts

### Do:

- **Do** 用記號＋繁中文案雙重表達狀態：實心＝live、虛線＝pending、grease 叉＝cut／invalid、打孔角＝locked、反白＝selected／live（**The Mark Rule**）。
- **Do** 只用 grain orange #ff5a1f 一種彩色，並讓它維持稀缺（**The Single-Ink Rule**）；hover 深化到 #d94712，pressed 用 translateY(1px)。
- **Do** 把緊急／生效中的內容放進打孔白窗（#f2f2f2 底＋#0a0a0a 字）（**The Punched-Window Rule**）。
- **Do** 讓 text-2（#a8a8a8）／text-3（#8d8d8d）在 ink／panel 底上保持 ≥4.5:1；色底上的次級文字用該色的 ink 濃淡調，不用灰（**The Contrast Floor**）。
- **Do** 所有會跳動的數字用 tabular-nums（**The Tabular Rule**）；拉丁標籤全大寫＋字距 ≥0.04em（**The Caps-and-Tracking Rule**）。
- **Do** 分隔用 1px 髮絲線，圓角用 3px，陰影只給旗／針／tooltip 且帶偏移與柔化（**The Hairline Rule**）。
- **Do** 用 repeating gradients 畫半音刻度、格距、膠片打孔與撕齒孔列——這個世界的量測工具與材料邊緣（**The Perforation Rule**）。
- **Do** 把刻度、旗、切格、讀數掛在同一條軌的同一條定位式上（**The One-Rail Rule**）。
- **Do** 保留瀏覽器表面的設計：選取反白（orange 底＋ink 字）、focus ring（2px orange＋offset）、捲動條（spool thumb＋ink 內框）、tabular 數字。

### Don't:

- **Don't** 用色相表達狀態或分類內容——不新增第二種彩色、不做霓虹點綴、不做狀態色燈。
- **Don't** 對鎖定／停用的卡施加整體 opacity：底色會逼近反白、對比會掉，且「反白＝live」的語意被偷走；改用 charred 底＋打孔角（見 engine card disabled）。
- **Don't** 做裝飾性深度：零偏移色暈、硬偏移方塊陰影、玻璃模糊都不屬於這個台面；陰影只給有實體的零件。
- **Don't** 把字級當層級——同一條 strip 內用字重、字距與位置分層（**The Caps-and-Tracking Rule**）；不用負字距。
- **Don't** 拿波形、等化器、滑桿堆疊或任何通用「音訊擴充功能」預設件當裝飾；本世界的量測件是刻度與打孔。
- **Don't** 加第二個移調入口（第二個滑桿、第二個進度條）——移調只活在那條軌上（**The One-Rail Rule**）。
- **Don't** 引入外部影像或系統 display face：質地用本機 grain.png 與向量幾何，字體走 Barlow Condensed＋Noto Sans TC（CDN，離線降級）。
