# Surface brief: Popup（src/popup/popup.html）

Scope: Chrome action popup 全面重規劃（結構＋視覺世界替換）。Visitor mode: **Operate**。

## Audience, job, action

- 唱歌／練唱者在跟唱中途打開 popup，幾秒內要完成：確認已連線＋調音高、確認頁面記憶已套用、（YouTube 上）微調頁面音量，然後回去唱。
- 主要動作：沿打孔軌拖曳/步進移調量；備選：bypass、引擎、共振峰、伴奏、基準音量。
- 成功：一眼可辨狀態、一次手勢到目標調、換歌不重調。

## Proof / content

- 狀態誠實呈現 Chrome 單擷取限制：尚未連線／連線中／已連線／擷取遺失／分歧＋鎖定（badge 語意、分歧橫幅、改擷取此分頁）。
- 術語與文案：繁中、以 CONTEXT.md 為準，不得改寫（連線音訊、頁面記憶、輸出總閘、基準音量…）。
- Craft bar：`.impeccable/worlds/cutting-bench-board.webp`、`cutting-bench-hero.webp`。

## Constraints

- 功能、訊息協定、storage 語意、manifest、background/offscreen/content 全部不動；320→**400px** 寬 popup 形式不變。
- 拉丁／數字＝壓縮無襯線全大寫＋表格數字；中文＝**Noto Sans TC**；字體走 **Google Fonts CDN**（維持現況，離線降級系統字）。
- 無障礙維持基本鍵盤可操作＋role/aria-live；狀態以記號＋文案雙重表達。
- 本機無影像生成 → **code-led** 建置（無 comp 輪）。
- 圖標重設計不在本範圍。

## Chosen direction & memorable moment

**電影剪接台 select rail**（challenger `operate-a-cutting-bench-select-rail`，seed `cc29af84`）。記憶點：沿打孔膠片軌刮擦——折角膠帶旗慣性滑動、咔噠吸附到半音格距，提交時橘色膠帶條一閃。

## Unresolved decisions

- 半音吸附關閉時的自由滑行與格距刻度的並存表現（建置時依手感定，記入 DESIGN.md）。
- popup-state 測試的 DOM 期望值需隨結構更新（行為契約不變）。
- 既有 icons/ 與新世界的相容性：圖示沿用、不做重設計。

## Direction contract

<!-- impeccable:direction-contract 1 -->

THESIS: 狀態用記號不用顏色、打孔軌本身就是音高刻度；拒絕本類擴充功能的預設排法——深色面板＋霓虹點綴＋波形/等化器＋滑桿堆疊（正是被淘汰的舊皮）。

OWN-WORLD: true black 底＋單一 grain orange #FF5A1F（直域三分之一）、粗顆粒 film grain、打孔白窗容納文案、charred/spool gray 層、一條打孔膠片軌橫貫固定高度、折角膠帶旗標記、grease 叉／打孔角記號、髮絲刻度、層級靠格數不靠字級；一個壓縮無襯線全大寫（拉丁）＋Noto Sans TC（中文）。

STORY: 使用者開 popup，先在軌上看見旗插在哪一格＝目前移調量與連線狀態，拖曳到自己的調，換歌後旗自動回到那首歌的頁面記憶位；錯誤與分歧用記號＋繁中文案誠實說明。

FIRST VIEWPORT: 400px 寬 popup：頂部打孔軌橫貫全寬（25 格半音刻度＋折角旗＋狀態文案在軌帶內）；緊接連線列，橘色膠帶條主按鈕「連線音訊」＋bypass 記號；中央音高讀數（+0.00 st，表格數字）與 ± 步進；信號路徑（引擎）與進階選項以「串在軌下的格」排列，進階選項掛在大頭針上收尾；YouTube 面板僅在 YouTube 出現。

FORM: 選定卡片＝film cutting bench select rail（catalog `operate-a-cutting-bench-select-rail`），種子鍵 `cc29af84`，kind challenger（本輪勝出）。

FINISH: unreviewed and undocumented is unfinished; this build ends with the finish review, the verdict, DESIGN.md, and every shipping raster carrying its provenance
