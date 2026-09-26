# 0004: 依頁面 URL 記憶設定並跟隨分頁切換

Status: accepted — 已實作（修改順序 1–8 全部完成）

> **沿革**：本 ADR 原本把記憶單位定為 **origin**（scheme + host + port，原檔名 `0004-per-origin-site-memory-and-tab-follow.md`），並據此判定「同 origin 不同分頁 → 不鎖控制項」。2026-09-26 使用者實測兩個 YouTube 影片共用同一筆音高，需求確認為**依 URL 獨立設定**，於是記憶單位改為**頁面 URL**（含 query、不含 fragment），分歧鎖定改為一律以 URL 判定，origin 粒度的 `site:<origin>` 舊鍵直接刪除。決策 1、2、6、7、10、13 與 schema 已就地改寫為新事實；原 origin 版的完整論證保留在「沿革：origin → 頁面 URL」。

本 ADR 記錄 Fidelitone 的分頁跟隨與頁面狀態記憶：擷取來源自動跟到新的活動分頁，並套用該頁面 URL 上次用過的設定。它不改變 `pitchScale`、175 Hz crossover、0.09 s alignment delay、Bypass、engine switching 或 capture lifecycle 的既有語意，改變的是**設定的儲存粒度**、**擷取切換的執行位置**，以及**交接時的音訊連續性**。

「背景」章節描述的是**實作前**的程式碼狀態（對照 commit `e394944`），其中的行號在實作後已失效；實作期間的決策微調見「實作期修訂」。人工實測項目見 `docs/runtime-verification.md`。

## 背景：目前問題

- 擷取只綁定「按下連線那一刻」的活動分頁。`manifest.json` 沒有 `background`，全倉沒有任何 `chrome.tabs.onActivated` / `onUpdated` 處理（`src/popup/popup.ts:403` 是唯一會指定目標分頁的地方）。切換分頁後，擴充功能仍處理舊分頁，且使用者不會收到任何提示。
- `CaptureManager` 只有一條全域 capture（`src/offscreen/capture-manager.ts:16`），offscreen **不知道自己在擷取哪個分頁**：`START_CAPTURE` 只帶 `streamId`（`src/offscreen/offscreen-messages.ts:44-46`），`streamId` 用完即丟。
- 設定全是扁平全域 key（`src/popup/popup.ts:237-247`）：`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`、`snapToInteger`、`connected`。沒有任何 site／tab 命名空間，因此換網站會沿用上一站的音高與引擎。
- Chrome 的硬限制：`chrome.tabCapture.getMediaStreamId({ targetTabId })` 的目標分頁必須持有 tab-scoped 授權（`kTabCaptureForTab`），而該授權只在**使用者呼叫擴充功能**時發放（點擊 action 即可），並在跨 origin 導覽或關閉分頁時撤銷。純 `onActivated` 無法為從未呼叫過擴充功能的分頁取得擷取權。此限制決定了自動跟隨只能在「使用者曾經開啟過 popup 的分頁」之間運作。
- 程式碼事實（與 ADR-0003 的敘述有出入）：`OffscreenController.runTransition` / `transitionQueue`（`src/offscreen/offscreen-controller.ts:21,223-227`）**沒有任何 caller**，是 dead code。ADR-0003 宣稱 controller 已透過 `runTransition` 序列化 async 操作，實際上 `registerOffscreenMessages` 對每則訊息立即 dispatch（`src/offscreen/offscreen-messages.ts:84-86`）。現況安全只因為單一驅動者（popup）逐筆 `await`；一旦加入 service worker 與自動切換，`CaptureManager.start()` 的非 re-entrant 行為會讓兩次並發的 `START_CAPTURE` 互相 `stopStream()` 對方剛接上的 stream（`src/offscreen/capture-manager.ts:49-50,78`）。
- `handleCaptureEnded` 只修改 offscreen 本地欄位（`src/offscreen/capture-manager.ts:105-114`），offscreen 從未主動對外通知。`captureLost` 目前只有 popup 開啟時才看得到，service worker 無從得知。
- 交接必然出聲：被擷取的分頁由**我方 destination** 播出（`src/offscreen/graph-router.ts:60,71`；伴奏路徑為 `mixBus → limiter → destination`，`:103`），直到 `stopStream(oldStream)`（`src/offscreen/capture-manager.ts:78`）才解除瀏覽器靜音。因此「先送新站設定再換流」會讓**舊分頁用新站的音高／引擎狀態持續播出**整個交接窗口；反序則讓新分頁用舊設定開場。另外新分頁在 `getUserMedia` 成功前**不會被瀏覽器靜音**（`src/offscreen/capture-manager.ts:53-60`），這段窗口無法消除。

## 決策

1. **記憶單位採頁面 URL**（原：origin，改寫於 2026-09-26）

   鍵為 `pageKey(tab.url)`＝`origin + path + query`，**去掉 fragment**，寫入 `page:<url>`。
   - **query 要留**：`watch?v=a` 與 `watch?v=b` 是兩支影片，query 就是內容的身分，拿掉就回到「兩個影片共用一個音高」的原 bug。
   - **fragment 要去**：`#t=42`、`#details` 只代表頁內位置，留著會把同一頁分裂成多筆記錄。
   - **不採 per-tab**：分頁關閉即失效，違反「記憶」的目的。
   - **不採 origin**：同站的影片／歌曲共用一筆，正是本 ADR 被改寫的原因（見「沿革」）。

   代價是鍵數隨頁面數增長；記錄只在使用者真的調過參數時才寫入，且預設值回歸即刪鍵，`storage.local` 10 MB 配額綽綽有餘，因此不設 LRU 上限。

2. **記憶欄位與全域欄位分離**  
   依頁面 URL 記憶：`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`。`snapToInteger` 維持全域（純介面操作偏好，與網站無關）。`connected` 廢除——連線狀態一律以 offscreen 實際擷取為準，避免記憶旗標與事實分歧。

3. **稀疏儲存**  
   `chrome.storage.local` 只寫入與預設不同的欄位；使用者把某欄位調回預設即刪除該欄位，物件為空時 `chrome.storage.remove` 整個 key。讀取為 `PAGE_DEFAULTS` 與覆寫物件的 deep merge。稀疏讓「沒設定過的頁面」永遠等於乾淨預設，schema 不需要版本欄位。

4. **新頁面乾淨預設，預設引擎改為 Signalsmith Stretch**

   預設值：音高 0、旁路 off、Signalsmith Stretch、共振峰保護 off、伴奏模式 off、半音吸附開。Signalsmith 為懶初始化（`src/offscreen/engine-switching.ts:93`），初始化失敗時 `effectiveEngine()` 自動回落 RubberBand（`src/offscreen/audio-routing.ts:10`），因此此預設是安全的。需同步更新的預設點：`src/popup/popup-state.ts`、`src/popup/popup.ts`、新頁面 fallback。

5. **新增 background service worker，且它是擷取的唯一寫入者**  
   service worker 負責分頁監控、防抖、對帳、擷取切換與 badge。popup 不再直接送 `START_CAPTURE` / `STOP_CAPTURE`，改送 `REQUEST_CAPTURE { tabId }` / `RELEASE_CAPTURE` 並等待結果，避免兩個寫入者讓 service worker 的狀態鏡像漂移。

6. **切換觸發與條件**（已修訂：判定單位 origin → 頁面 URL）

   `tabs.onActivated`（含跨視窗，一律跟隨）與 `tabs.onUpdated` 都可觸發，統一 400 ms 防抖。`onUpdated` **同時看 `changeInfo.url` 與 `changeInfo.title`**：Chrome 對 `history.pushState` 的同文件導覽不一定提供 `url`，但頁面換標題時一定會給 `title`（YouTube 換影片即改 `document.title`）。listener 不信任 `changeInfo`，一律重新讀 `tab.url` 取得 `pageKey`，**只在 page key 真的改變時**才重套設定——因此同一頁的標題抖動零重送，換影片則換成該影片自己的記憶。目標分頁無 url、非 http(s)、或 `getMediaStreamId` 失敗（未授權）時，一律**保持現有擷取不中斷**。

7. **切換是單一原子指令**  
   新增 `SWITCH_CAPTURE { streamId, tabId, page, settings }`，由 offscreen 在 `runTransition` 佇列內一次完成整個交接。`SET_*` 保留給 popup 的即時編輯。理由：交接順序（淡出 → 套設定 → 換流 → 淡入）的不變式屬於「交接」這個動作，而非各個設定方法；寫成單一指令後該不變式無法被後人改壞。附帶活化了既有的 dead code `runTransition`，補上 ADR-0003 宣稱但實際缺失的序列化。

8. **新增輸出總閘（outputGain）**  
   `AudioGraph` 增加一個 master `outputGain`，置於引擎／limiter 之後、`ctx.destination` 之前；`graph-router.ts` 的 6 處 `ctx.destination`（`:46,60,71,74,88,103`）改接到它。交接時淡出 20–30 ms、換流完成後淡入，消除「舊分頁用新設定播出」與切換瞬間的雙聲。這是唯一同時解決兩者的方案；30 ms 淡出在聽覺上只是「換了一台」而非爆音。

9. **自動跟隨只在已有擷取的工作階段內生效**  
   沒有任何擷取在跑時，切分頁不主動連線。連線的觸發點維持「開啟 popup」（打開時若 offscreen 無擷取即連線目前分頁，失敗則顯示錯誤並維持未連線）。自動跟隨不是跨瀏覽器工作階段的恢復機制。

10. **設定分歧的處理拆成兩個條件**（已修訂：鎖定改以頁面 URL 判定）

    - `capturedPage !== activePage` → 鎖定所有控制項（`SET_*` 會寫到你聽不到的那一頁）。
    - `state.tabId !== currentTabId` → 顯示被擷取分頁標題與「改擷取此分頁」按鈕（音訊屬於別的分頁）。
    兩者分開：**同一個 URL 開在兩個分頁**時只出橫幅、不鎖（兩者共享同一筆記憶）；**同站的另一支影片**則是另一筆記憶，必須先「改擷取此分頁」才能編輯。原決策以 origin 判定、允許「同 origin 不同分頁可編輯」，其前提「同站設定本來就該共享」在 per-URL 記憶下已不存在（論證見「沿革」）。
    另外，service worker 的 400 ms 防抖讓「剛開 popup 就切分頁」的瞬間可能停在過期身分上，因此 popup 只在分歧狀態下以 600 ms 輪詢 `GET_STATE` 對齊身分，對齊即停止；輪詢期間不做 live 覆寫，避免使用者正在拖動的滑桿被跳值打斷。
    開啟 popup 這個動作本身就會授予該分頁授權，因此「改擷取此分頁」既是立即切換的按鈕，也讓該分頁從此納入自動切換範圍。

11. **Badge 四態**  
    未擷取＝無 badge；擷取中且為目前活動分頁＝綠色 `ON`；擷取中但為其他分頁＝橘色 `ON·`；`captureLost`＝紅色 `!`。圖示不變、不新增 icon 資產。狀態導出為純函式 `deriveBadge(...)` 以利測試。

12. **offscreen 對外推送 capture 事件**  
    新增 offscreen → service worker 的 `CAPTURE_EVENT { connected, captureLost, tabId, page }`，取代「只有 popup 開著時才知道中斷」的現況。service worker 的 `storage.session` 鏡像只是快取，**每次決策前先 `GET_STATE` 對帳**（service worker 可能被回收而 offscreen 仍在擷取）。

13. **升級清理為冪等惰性清理**（已修訂：多掃 `site:` 鍵）

    service worker 啟動時檢查一次並刪除：扁平的 `connected`、`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`，以及**所有 `site:<origin>` 粒度的舊記錄**——origin 對不上任何單一頁面，留著只會讓同站影片莫名繼承舊音高。**保留** `snapToInteger`。全鍵列舉以 `storage.session` 旗標擋住，每次瀏覽器工作階段只掃一次。不依賴 `onInstalled(reason: "update")`——unpacked 重載不一定觸發，且 service worker 閒置後不會重跑。

14. **舊路徑必須移除而非擴充**  
    `restoreStoredSettings()`（`src/popup/popup.ts:323-347`）與 `applyStoredUi()`（`:293-307`）的舊 key 讀取、`syncConnectionState()` 與連線／斷線流程的 `connected` 寫入（`:467,417,450`）都要拆掉，否則讀不到值會靜默回落預設，出現難以追查的行為。

15. **切到無聲分頁照切**  
    無法預先知道分頁有無音訊，因此不做靜音偵測（會在影片暫停、靜音前奏時 flapping）。切到無聲分頁會讓原本的分頁解除擷取、恢復原音繼續播放——這是單一擷取的必然結果，明確接受，並寫入 README 與 popup 橫幅文案讓行為可預期。

## 訊號協定

```
popup  ──REQUEST_CAPTURE{tabId}──────────▶ service worker
popup  ──RELEASE_CAPTURE─────────────────▶ service worker
popup  ──SET_PITCH / SET_BYPASS / SET_FORMANTS / SET_ACCOMPANIMENT / SET_ENGINE ─▶ offscreen
popup  ──GET_STATE───────────────────────▶ offscreen（僅讀狀態）
SW     ──SWITCH_CAPTURE{streamId,tabId,page,settings}──▶ offscreen（唯一的擷取寫入）
SW     ──STOP_CAPTURE───────────────────▶ offscreen（由 RELEASE_CAPTURE 觸發）
SW     ──GET_STATE──────────────────────▶ offscreen（每次決策前對帳）
offscreen ──CAPTURE_EVENT{connected,captureLost,tabId,page}──▶ service worker
```

- `page` 一律是 `pageKey(tab.url)`（origin + path + query，無 fragment），三端同義。
- `streamId: string | null`——非 null 表示換流；`null` 表示**保留現有流、只重套設定與身分**（擷取分頁原地換頁面的情況）。兩者共用同一個交接入口，交接不變式只有一處可改壞。
- `GET_SITE_SETTINGS` 不設立：service worker 在切換時自行讀 `storage.local`，popup 也直接讀寫 `storage.local`（它持有該頁的完整快照並以稀疏形式寫回）。讓 popup 再繞一次 SW 只會多一輪來回，兩者讀的是同一份資料。
- `SET_*` 保留給 popup 的即時編輯；service worker 不使用它們，避免兩個寫入者把交接不變式切開。

`SWITCH_CAPTURE` 內部序列（原子，於 `runTransition` 佇列內）：
`預熱（伴奏 worklet／Signalsmith WASM，不改可聽路徑）` → `outputGain 淡出 25 ms` → `套用 settings` → `capture.start(streamId)`（沿用既有回滾）→ `outputGain 淡入` → 回報新 `tabId` / `page`。
任何一步失敗：回復上一份 settings、重新淡入、拋回錯誤 → service worker 維持舊擷取不動。

## 資料 schema

```
page:https://www.youtube.com/watch?v=abc → { "pitch": 3, "engine": "rubberband" }  只存非預設值
page:https://www.youtube.com/watch?v=def → （無鍵＝乾淨預設，與上一行各自獨立）
snapToInteger                             → true                                   全域，保留
chrome.storage.session                    → { capturedTabId, capturedPage,
                                              connected, captureLost }             service worker 鏡像（僅快取）
```

刪除鍵：`connected`、`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`，以及升級時全部 `site:<origin>`。

## 實作期修訂

實作時對既定決策的微調，附理由，避免文件與程式碼分歧：

1. **`GET_SITE_SETTINGS` 取消**（見「訊號協定」）。service worker 本來就必須自己讀 site 記憶（自動跟隨時沒有 popup 可問），popup 再繞一圈 SW 沒有額外一致性可言，反而多一輪來回。
2. **`SWITCH_CAPTURE.streamId` 可為 `null`**，用於「同分頁原地換頁面」的設定重套。原本協定假設每次交接都換流，但那會在 Chrome 撤銷授權後白費一次 `getMediaStreamId`。
3. **交接前增加預熱階段**：伴奏 worklet 與 Signalsmith WASM 在淡出前先建好（兩者都不改可聽路徑）。這是為了直接解決風險表最後一條「跨站切換成本」——若把 `setAccompaniment` 的初始化放在淡出後，關站→開站的 25 ms 閘門窗口會被拉長到數秒。
4. **引擎／伴奏的「可用性」失敗採降級而非中止**：`effectiveEngine()` 本來就會回落，用一個壞掉的 WASM 擋住分頁切換是本末倒置。只有拋出的錯誤（bypass 路由失敗等）才會回復 settings 並中止切換。
5. **`storage.session` 鏡像多存 `connected` / `captureLost`**：badge 必須在 popup 沒開的情況下顯示，光有 `tabId` / `page` 不足以導出四態。
6. **`TransitionQueue` 放在 `src/lib/transition-queue.ts`**（原計畫只給 offscreen 用）。service worker 也用同一個佇列把「跟隨、popup 請求、斷線」排成單一序列，否則快速切分頁時，排隊中的跟隨會被 `handoverInFlight` 直接丟棄，最終停在錯的分頁上。
7. **GET_STATE 不排隊**：對帳若排在 25 s 的伴奏指令後面，service worker 會拿到過期快照。所有變更類訊息排隊，唯獨狀態讀取直通。
8. **`onUpdated` 只監聽被擷取分頁**：其他分頁的導覽不會成為活動分頁（那由 `onActivated` 處理），監聽全數會造成不必要的重套排程；service worker 另在無鏡像時直接不排程，避免閒置時每次切頁都發一輪 `GET_STATE`。
9. **基線 `npm run typecheck` 本來就是紅的**（7 個既有測試型別錯誤，對照 commit `e394944` 重現）。已一併修正，因此「typecheck 通過」在本 ADR 是從紅轉綠，而非維持。
10. **記憶單位 origin → 頁面 URL**（2026-09-26，見開頭「沿革」）：`siteStorageKey(origin)` → `pageStorageKey(page)`、鍵前綴 `site:` → `page:`、身分欄位 `origin` → `page`（`CaptureTarget` / `CaptureEvent` / `CaptureState` / `CaptureSession` / `PopupState` 全端同步）、`originKey()` 刪除改由 `pageKey()` 負責（同時回傳不可擷取的 `null`），純函式模組 `src/lib/site-settings.ts` 更名 `src/lib/page-settings.ts`。`CaptureSkipReason` 的 `unsupported-origin` 隨之改名 `unsupported-url`。
11. **分歧鎖定改為一律以 URL 判定，並補 popup 身分輪詢**：`isSettingsLocked` / `showDivergenceBanner` 改為呼叫共用的 `isSettingsMismatch` / `isCrossTabCapture`，規則只有一處。popup 在分歧狀態下以 600 ms 輪詢 `GET_STATE`，對齊即停，修掉「service worker 400 ms 防抖期間 popup 顯示過期鎖定」的空窗。
12. **`onUpdated` 加上 `changeInfo.title` 觸發**：`chrome.tabs.onHistoryStateUpdated` 在 Chrome 不存在（只有 `webNavigation` 有，須另加權限），而同文件導覽不一定給 `changeInfo.url`。改為 url 或 title 任一變動即重讀 `tab.url` 重算 `pageKey`，是否真的重套由 page key 是否改變決定，不信任 `changeInfo`。
13. **舊 `site:<origin>` 鍵於升級時刪除**：origin 對不上任何單一頁面，保留 fallback 會讓「兩個影片共用同一音高」的症狀復發。全鍵列舉以 `storage.session` 旗標限制為每次工作階段一次。
14. **舊資料清理範圍擴大**：`cleanupLegacyKeys()` 由「只掃 6 個扁平鍵」改為「扁平鍵 + 全部 `site:` 鍵」，仍維持冪等、失敗只警告不阻擋啟動。

## 修改順序

1. [x] 新增純函式模組 `src/lib/page-settings.ts`（原名 `site-settings.ts`）：`pageKey`、`pageStorageKey`、`resolvePageSettings`、`diffAgainstDefaults`、`planTabActivation`、`isSettingsMismatch`、`deriveBadge`，以及對應測試。
2. [x] 接上訊息序列化（活化 `runTransition`）並補序列化測試。
3. [x] offscreen：新增 `SWITCH_CAPTURE` 原子指令、記錄 `tabId`/`page`、`GET_STATE` 回傳之、新增 `CAPTURE_EVENT` 推送。
4. [x] `AudioGraph` 新增 `outputGain`，`graph-router.ts` 6 處 destination 改接。
5. [x] 新增 `src/background/`：分頁監控、400 ms 防抖、`GET_STATE` 對帳、擷取切換、badge、冪等惰性清理。
6. [x] `manifest.json` 新增 `background.service_worker`，`vite.config.ts` 新增第三個 entry。
7. [x] popup：頁面 URL 記憶 UI、live 覆寫條件、分歧橫幅與「改擷取此分頁」按鈕、預設引擎改 Signalsmith、移除全部舊路徑。
8. [x] 文件：`CONTEXT.md` 新增詞彙、README 說明；origin → 頁面 URL 的改寫一併回填。

## 驗收標準

前 9 項需實機驗證（Chrome 擴充功能載入 `dist/`），項目與結果回填 `docs/runtime-verification.md`；最後一項已由自動檢查覆蓋：

- [ ] 某頁調到 +3 st（RubberBand）→ 切到另一站 → 自動套乾淨預設（0 st、Signalsmith）→ 切回 → 恢復 +3 st，全程只有一條 capture。
- [ ] **同網域兩支影片各自記憶**（本 ADR 被改寫的起因）：YouTube 影片 A 調 +3 → 切到影片 B → B 為 0 → 回 A → 恢復 +3；同一影片換 fragment（`#t=`）仍讀得到原記錄。
- [ ] 交接瞬間沒有「用錯設定」的殘留音；新分頁在 `getUserMedia` 完成前的原音窗口實測 ≤400 ms（實測值回填 `docs/runtime-verification.md`）。
- [ ] 從未開過 popup 的分頁：切過去時不中斷既有擷取、badge 轉 `ON·`、popup 出現「改擷取此分頁」→ 點擊後立即切換成功且控制項解鎖。
- [ ] 擷取中分頁內導覽（換站、同站換影片、SPA `pushState`）：擷取不中斷、設定改讀**新頁面**的記憶；**同一頁的 url／title 抖動不重送任何 `SET_*`**（offscreen console 驗證）。
- [ ] 快速 Ctrl+Tab 連切 5 次只發生一次切換；並發的 `REQUEST_CAPTURE` 與自動切換不產生殘留 stream。
- [ ] 關閉被擷取分頁 → 紅色 `!`，且由 `CAPTURE_EVENT` 觸發（不依賴 popup 開啟）。
- [ ] 分歧鎖定：同一 URL 開在兩個分頁 → 橫幅顯示、控制項**不鎖**；同站的另一支影片 → 橫幅與控制項**皆出現**，需先「改擷取此分頁」才解鎖（popup 600 ms 輪詢會在跟隨完成後自行解鎖）。
- [ ] 某頁調回預設 → 該 `page:` key 被刪除；升級後舊 6 個扁平鍵與全部 `site:<origin>` 鍵消失、`snapToInteger` 保留。
- [x] `npm test`、`npm run typecheck`、`npm run build` 通過，既有 81 個測試無回歸——靜音修復後為 125 題，URL 記憶改寫後為 130 題（20 個檔案）；基線 81 題的標題逐題比對後**無任何缺失**。`typecheck` 於基線本為紅（7 個既有測試型別錯誤），已一併修正。

## 明確不做

- 不改變 ADR-0001 的 stereo sum 與統一重導線決策。
- 不改變 ADR-0002 的 positive rate semantics 與 bounded live timeline。
- 不支援多分頁同時擷取；擷取永遠只有一條，目標只有目前活動分頁。
- 不注入 content script 暫停舊分頁的媒體播放。
- 不新增 `"tabs"`、`"notifications"`、`"webNavigation"` 權限；讀 `tab.url` 沿用既有 `host_permissions`。
- 不使用 `chrome.storage.sync`；`storage.local` 預設 10 MB 配額對稀疏記錄綽綽有餘。
- 不在瀏覽器重啟後恢復擷取。
- 不做靜音偵測或自動切回。
- 不依每一次 `onUpdated` 觸發盲目重套：僅在重讀出的 page key 改變時重套。
- 不替 URL 記憶設 LRU 上限或淘汰策略（只在使用者調過參數時寫入，增長速度不足以成為問題）。
- 不剔除追蹤參數（`utm_*`、`si`、`pp` 等）：同頁的「分享連結」與「站內點開」會是兩筆記錄，這是刻意換來的零維護代價。

## 風險與取捨

- **`getMediaStreamId` 於 service worker 內呼叫的穩定性**：文件未標示此 API 為 foreground-only，現行 manifest 也未宣告 `activeTab` 卻能擷取活動分頁（可推論點擊 action 即發放 tab-scoped 授權），但仍需實機驗證。降級方案：service worker 只偵測分頁變化並把意圖寫入 `storage.session`，由 popup 或 offscreen 觸發取流。
- **交接窗口長度**：`getUserMedia` 實測常見 100–400 ms，新分頁在此期間以原音播出且我方仍在播舊分頁的處理音。輸出總閘只能消除我方側的瑕疵，無法消除瀏覽器尚未接管前的原音。若實測 >400 ms，需回頭檢討防抖值。
- **背景分頁音訊是否被節流**：官方文件未確認，僅社群來源有「切走後可能靜音」的說法。列為實測觀察項，不預先設計緩解。
- **未授權分頁的自動跟隨缺口**：從未開過 popup 的分頁無法被自動擷取。使用者需先在該分頁開一次 popup。這是 Chrome 授權模型的限制，不可由擴充功能繞過；README 必須說明。
- **跨站切換成本**：某站伴奏開、另一站關時，`setAccompaniment(false)` 會 `accompaniment.reset()`（`src/offscreen/accompaniment.ts:182`），下次需重建 worklet 節點。模組已快取，實測成本為數十毫秒量級；若交接窗口因此變長，應在交接前先完成 graph 準備而非在淡出後才初始化。→ **已依此建議在實作中加入預熱階段**（見「實作期修訂」第 3 條），淡出窗口只涵蓋狀態翻轉與換流。
- **序列化帶來的排隊延遲**：啟用 `runTransition` 後，漫長的 `SET_ACCOMPANIMENT`（worklet 初始化，popup 端逾時設定為 25 s，`src/popup/popup.ts:35`）會阻塞後續擷取指令。`SWITCH_CAPTURE` 把交接包成單一指令正是為了讓這類逾時不會落在交接關鍵路徑上。

## 沿革：origin → 頁面 URL

本 ADR 於 2026-09-26 變更記憶單位。原始決策的論證原文保留在這裡，作為「當時為什麼選 origin」與「後來為什麼推翻」的對照。

**原決策 1（origin）**

> 記憶單位採 origin：鍵為 `new URL(tab.url).origin`（含 scheme + host + port）。不採 hostname（http/https 會被合併）、不採完整 URL（同站不同影片會分裂成多筆記錄）、不採 per-tab（分頁關閉即失效，違反「記憶」的目的）。

**原決策 10 的推論**

> 兩者分開，才能讓「同 origin 不同分頁」只出橫幅、不鎖控制項——因為同站設定本來就該共享，鎖住等於強迫使用者為調另一個分頁的音高而多做一次重新擷取。

**推翻的理由**：「不採完整 URL（同站不同影片會分裂成多筆記錄）」當時被列為缺點，實際上正是需求本身。使用者以兩個 YouTube 影片實測，發現 `https://www.youtube.com/watch?v=A` 與 `https://www.youtube.com/watch?v=B` 共用同一筆音高，需求確認為**依 URL 獨立設定**——「分裂成多筆」由缺陷變成正確行為。原決策 10 的前提「同站設定本來就該共享」同時失效，分歧鎖定改為一律以 URL 判定。

受影響的決策：1、2、6、7、10、13（已就地改寫）；受影響的程式碼：`src/lib/page-settings.ts`（原 `site-settings.ts`）與全端的 `origin` 身分欄位（統一改名 `page`）；受影響的使用者文件：README、`CONTEXT.md` 詞條、`docs/runtime-verification.md` 實測清單。
