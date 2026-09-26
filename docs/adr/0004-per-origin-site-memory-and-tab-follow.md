# 0004: 依 origin 記憶設定並跟隨分頁切換

Status: accepted — 已實作（修改順序 1–8 全部完成）

本 ADR 記錄 Fidelitone 的分頁跟隨與網站狀態記憶：擷取來源自動跟到新的活動分頁，並套用該分頁所屬 origin 上次用過的設定。它不改變 `pitchScale`、175 Hz crossover、0.09 s alignment delay、Bypass、engine switching 或 capture lifecycle 的既有語意，改變的是**設定的儲存粒度**、**擷取切換的執行位置**，以及**交接時的音訊連續性**。

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

1. **記憶單位採 origin**  
   鍵為 `new URL(tab.url).origin`（含 scheme + host + port）。不採 hostname（http/https 會被合併）、不採完整 URL（同站不同影片會分裂成多筆記錄）、不採 per-tab（分頁關閉即失效，違反「記憶」的目的）。

2. **記憶欄位與全域欄位分離**  
   依 origin 記憶：`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`。`snapToInteger` 維持全域（純介面操作偏好，與網站無關）。`connected` 廢除——連線狀態一律以 offscreen 實際擷取為準，避免記憶旗標與事實分歧。

3. **稀疏儲存**  
   `chrome.storage.local` 只寫入與預設不同的欄位；使用者把某欄位調回預設即刪除該欄位，物件為空時 `chrome.storage.remove` 整個 key。讀取為 `DEFAULTS` 與覆寫物件的 deep merge。稀疏讓「沒設定過的站」永遠等於乾淨預設，schema 不需要版本欄位。

4. **新站乾淨預設，預設引擎改為 Signalsmith Stretch**  
   預設值：音高 0、旁路 off、Signalsmith Stretch、共振峰保護 off、伴奏模式 off、半音吸附開。Signalsmith 為懶初始化（`src/offscreen/engine-switching.ts:93`），初始化失敗時 `effectiveEngine()` 自動回落 RubberBand（`src/offscreen/audio-routing.ts:10`），因此此預設是安全的。需同步更新的預設點：`src/popup/popup-state.ts:31`、`src/popup/popup.ts:302`、新站 fallback。

5. **新增 background service worker，且它是擷取的唯一寫入者**  
   service worker 負責分頁監控、防抖、對帳、擷取切換與 badge。popup 不再直接送 `START_CAPTURE` / `STOP_CAPTURE`，改送 `REQUEST_CAPTURE { tabId }` / `RELEASE_CAPTURE` 並等待結果，避免兩個寫入者讓 service worker 的狀態鏡像漂移。

6. **切換觸發與條件**  
   `tabs.onActivated`（含跨視窗，一律跟隨）與 `tabs.onUpdated` 都可觸發，統一 400 ms 防抖。`onUpdated` **僅在 origin 真的改變時**才重套設定——history API 的同文件導覽（YouTube 換影片、Spotify 換歌）同樣會帶 url 觸發該事件，若照字面實作會造成設定重灌風暴。目標分頁無 url、非 http(s)、或 `getMediaStreamId` 失敗（未授權）時，一律**保持現有擷取不中斷**。

7. **切換是單一原子指令**  
   新增 `SWITCH_CAPTURE { streamId, tabId, origin, settings }`，由 offscreen 在 `runTransition` 佇列內一次完成整個交接。`SET_*` 保留給 popup 的即時編輯。理由：交接順序（淡出 → 套設定 → 換流 → 淡入）的不變式屬於「交接」這個動作，而非各個設定方法；寫成單一指令後該不變式無法被後人改壞。附帶活化了既有的 dead code `runTransition`，補上 ADR-0003 宣稱但實際缺失的序列化。

8. **新增輸出總閘（outputGain）**  
   `AudioGraph` 增加一個 master `outputGain`，置於引擎／limiter 之後、`ctx.destination` 之前；`graph-router.ts` 的 6 處 `ctx.destination`（`:46,60,71,74,88,103`）改接到它。交接時淡出 20–30 ms、換流完成後淡入，消除「舊分頁用新設定播出」與切換瞬間的雙聲。這是唯一同時解決兩者的方案；30 ms 淡出在聽覺上只是「換了一台」而非爆音。

9. **自動跟隨只在已有擷取的工作階段內生效**  
   沒有任何擷取在跑時，切分頁不主動連線。連線的觸發點維持「開啟 popup」（打開時若 offscreen 無擷取即連線目前分頁，失敗則顯示錯誤並維持未連線）。自動跟隨不是跨瀏覽器工作階段的恢復機制。

10. **設定分歧的處理拆成兩個條件**  
    - `state.origin !== currentOrigin` → 鎖定所有控制項（`SET_*` 會打到別的站）。
    - `state.tabId !== currentTabId` → 顯示被擷取分頁標題與「改擷取此分頁」按鈕（音訊屬於別的分頁）。
    兩者分開，才能讓「同 origin 不同分頁」只出橫幅、不鎖控制項——因為同站設定本來就該共享，鎖住等於強迫使用者為調另一個分頁的音高而多做一次重新擷取。
    開啟 popup 這個動作本身就會授予該分頁授權，因此「改擷取此分頁」既是立即切換的按鈕，也讓該分頁從此納入自動切換範圍。

11. **Badge 四態**  
    未擷取＝無 badge；擷取中且為目前活動分頁＝綠色 `ON`；擷取中但為其他分頁＝橘色 `ON·`；`captureLost`＝紅色 `!`。圖示不變、不新增 icon 資產。狀態導出為純函式 `deriveBadge(...)` 以利測試。

12. **offscreen 對外推送 capture 事件**  
    新增 offscreen → service worker 的 `CAPTURE_EVENT { connected, captureLost, tabId, origin }`，取代「只有 popup 開著時才知道中斷」的現況。service worker 的 `storage.session` 鏡像只是快取，**每次決策前先 `GET_STATE` 對帳**（service worker 可能被回收而 offscreen 仍在擷取）。

13. **升級清理為冪等惰性清理**  
    service worker 啟動時 `storage.get(LEGACY_KEYS)`，存在才 `remove`。不依賴 `onInstalled(reason: "update")`——unpacked 重載不一定觸發，且 service worker 閒置後不會重跑。刪除 `connected`、`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`；**保留** `snapToInteger`。

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
SW     ──SWITCH_CAPTURE{streamId,tabId,origin,settings}──▶ offscreen（唯一的擷取寫入）
SW     ──STOP_CAPTURE───────────────────▶ offscreen（由 RELEASE_CAPTURE 觸發）
SW     ──GET_STATE──────────────────────▶ offscreen（每次決策前對帳）
offscreen ──CAPTURE_EVENT{connected,captureLost,tabId,origin}──▶ service worker
```

- `streamId: string | null`——非 null 表示換流；`null` 表示**保留現有流、只重套設定與身分**（擷取分頁原地換 origin 的情況）。兩者共用同一個交接入口，交接不變式只有一處可改壞。
- `GET_SITE_SETTINGS` 不設立：service worker 在切換時自行讀 `storage.local`，popup 也直接讀寫 `storage.local`（它持有該 origin 的完整快照並以稀疏形式寫回）。讓 popup 再繞一次 SW 只會多一輪來回，兩者讀的是同一份資料。
- `SET_*` 保留給 popup 的即時編輯；service worker 不使用它們，避免兩個寫入者把交接不變式切開。

`SWITCH_CAPTURE` 內部序列（原子，於 `runTransition` 佇列內）：
`預熱（伴奏 worklet／Signalsmith WASM，不改可聽路徑）` → `outputGain 淡出 25 ms` → `套用 settings` → `capture.start(streamId)`（沿用既有回滾）→ `outputGain 淡入` → 回報新 `tabId` / `origin`。
任何一步失敗：回復上一份 settings、重新淡入、拋回錯誤 → service worker 維持舊擷取不動。

## 資料 schema

```
site:https://www.youtube.com → { "pitch": 3, "engine": "rubberband" }   只存非預設值
snapToInteger                 → true                                       全域，保留
chrome.storage.session        → { capturedTabId, capturedOrigin,
                                  connected, captureLost }                 service worker 鏡像（僅快取）
```

刪除鍵：`connected`、`pitch`、`bypass`、`preserveFormants`、`accompanimentMode`、`engine`

## 實作期修訂

實作時對既定決策的微調，附理由，避免文件與程式碼分歧：

1. **`GET_SITE_SETTINGS` 取消**（見「訊號協定」）。service worker 本來就必須自己讀 site 記憶（自動跟隨時沒有 popup 可問），popup 再繞一圈 SW 沒有額外一致性可言，反而多一輪來回。
2. **`SWITCH_CAPTURE.streamId` 可為 `null`**，用於「同分頁原地換 origin」的設定重套。原本協定假設每次交接都換流，但那會在 Chrome 撤銷授權後白費一次 `getMediaStreamId`。
3. **交接前增加預熱階段**：伴奏 worklet 與 Signalsmith WASM 在淡出前先建好（兩者都不改可聽路徑）。這是為了直接解決風險表最後一條「跨站切換成本」——若把 `setAccompaniment` 的初始化放在淡出後，關站→開站的 25 ms 閘門窗口會被拉長到數秒。
4. **引擎／伴奏的「可用性」失敗採降級而非中止**：`effectiveEngine()` 本來就會回落，用一個壞掉的 WASM 擋住分頁切換是本末倒置。只有拋出的錯誤（bypass 路由失敗等）才會回復 settings 並中止切換。
5. **`storage.session` 鏡像多存 `connected` / `captureLost`**：badge 必須在 popup 沒開的情況下顯示，光有 `tabId` / `origin` 不足以導出四態。
6. **`TransitionQueue` 放在 `src/lib/transition-queue.ts`**（原計畫只給 offscreen 用）。service worker 也用同一個佇列把「跟隨、popup 請求、斷線」排成單一序列，否則快速切分頁時，排隊中的跟隨會被 `handoverInFlight` 直接丟棄，最終停在錯的分頁上。
7. **GET_STATE 不排隊**：對帳若排在 25 s 的伴奏指令後面，service worker 會拿到過期快照。所有變更類訊息排隊，唯獨狀態讀取直通。
8. **`onUpdated` 只監聽被擷取分頁**：其他分頁的導覽不會成為活動分頁（那由 `onActivated` 處理），監聽全數會造成不必要的重套排程；service worker 另在無鏡像時直接不排程，避免閒置時每次切頁都發一輪 `GET_STATE`。
9. **基線 `npm run typecheck` 本來就是紅的**（7 個既有測試型別錯誤，對照 commit `e394944` 重現）。已一併修正，因此「typecheck 通過」在本 ADR 是從紅轉綠，而非維持。

## 修改順序

1. [x] 新增純函式模組 `src/lib/site-settings.ts`：`originKey`、`resolveSiteSettings`、`diffAgainstDefaults`、`planTabActivation`、`deriveBadge`，以及對應測試。
2. [x] 接上訊息序列化（活化 `runTransition`）並補序列化測試。
3. [x] offscreen：新增 `SWITCH_CAPTURE` 原子指令、記錄 `tabId`/`origin`、`GET_STATE` 回傳之、新增 `CAPTURE_EVENT` 推送。
4. [x] `AudioGraph` 新增 `outputGain`，`graph-router.ts` 6 處 destination 改接。
5. [x] 新增 `src/background/`：分頁監控、400 ms 防抖、`GET_STATE` 對帳、擷取切換、badge、冪等惰性清理。
6. [x] `manifest.json` 新增 `background.service_worker`，`vite.config.ts` 新增第三個 entry。
7. [x] popup：origin 記憶 UI、live 覆寫條件、分歧橫幅與「改擷取此分頁」按鈕、預設引擎改 Signalsmith、移除全部舊路徑。
8. [x] 文件：`CONTEXT.md` 新增詞彙、README 說明。

## 驗收標準

前 8 項需實機驗證（Chrome 擴充功能載入 `dist/`），項目與結果回填 `docs/runtime-verification.md`；最後一項已由自動檢查覆蓋：

- [ ] 某站調到 +3 st（RubberBand）→ 切到另一站 → 自動套乾淨預設（0 st、Signalsmith）→ 切回 → 恢復 +3 st，全程只有一條 capture。
- [ ] 交接瞬間沒有「用錯設定」的殘留音；新分頁在 `getUserMedia` 完成前的原音窗口實測 ≤400 ms（實測值回填 `docs/runtime-verification.md`）。
- [ ] 從未開過 popup 的分頁：切過去時不中斷既有擷取、badge 轉 `ON·`、popup 出現「改擷取此分頁」→ 點擊後立即切換成功且控制項解鎖。
- [ ] 擷取中分頁內點連結換 origin：擷取不中斷、設定改讀新 origin；**同站換影片（SPA）不重送任何 `SET_*`**。
- [ ] 快速 Ctrl+Tab 連切 5 次只發生一次切換；並發的 `REQUEST_CAPTURE` 與自動切換不產生殘留 stream。
- [ ] 關閉被擷取分頁 → 紅色 `!`，且由 `CAPTURE_EVENT` 觸發（不依賴 popup 開啟）。
- [ ] 同 origin 不同分頁：控制項不鎖、橫幅顯示。
- [ ] 某站調回預設 → 該 `site:` key 被刪除；升級後舊 6 鍵消失、`snapToInteger` 保留。
- [x] `npm test`、`npm run typecheck`、`npm run build` 通過，既有 81 個測試無回歸——現為 123 題（20 個檔案）；基線 81 題的標題逐題比對後**無任何缺失**。`typecheck` 於基線本為紅（7 個既有測試型別錯誤），已一併修正。

## 明確不做

- 不改變 ADR-0001 的 stereo sum 與統一重導線決策。
- 不改變 ADR-0002 的 positive rate semantics 與 bounded live timeline。
- 不支援多分頁同時擷取；擷取永遠只有一條，目標只有目前活動分頁。
- 不注入 content script 暫停舊分頁的媒體播放。
- 不新增 `"tabs"`、`"notifications"` 權限；讀 `tab.url` 沿用既有 `host_permissions`。
- 不使用 `chrome.storage.sync`；`storage.local` 預設 10 MB 配額對稀疏記錄綽綽有餘。
- 不在瀏覽器重啟後恢復擷取。
- 不做靜音偵測或自動切回。
- 不依 `onUpdated` 的 url 變動重套設定（僅 origin 改變時重套）。

## 風險與取捨

- **`getMediaStreamId` 於 service worker 內呼叫的穩定性**：文件未標示此 API 為 foreground-only，現行 manifest 也未宣告 `activeTab` 卻能擷取活動分頁（可推論點擊 action 即發放 tab-scoped 授權），但仍需實機驗證。降級方案：service worker 只偵測分頁變化並把意圖寫入 `storage.session`，由 popup 或 offscreen 觸發取流。
- **交接窗口長度**：`getUserMedia` 實測常見 100–400 ms，新分頁在此期間以原音播出且我方仍在播舊分頁的處理音。輸出總閘只能消除我方側的瑕疵，無法消除瀏覽器尚未接管前的原音。若實測 >400 ms，需回頭檢討防抖值。
- **背景分頁音訊是否被節流**：官方文件未確認，僅社群來源有「切走後可能靜音」的說法。列為實測觀察項，不預先設計緩解。
- **未授權分頁的自動跟隨缺口**：從未開過 popup 的分頁無法被自動擷取。使用者需先在該分頁開一次 popup。這是 Chrome 授權模型的限制，不可由擴充功能繞過；README 必須說明。
- **跨站切換成本**：某站伴奏開、另一站關時，`setAccompaniment(false)` 會 `accompaniment.reset()`（`src/offscreen/accompaniment.ts:182`），下次需重建 worklet 節點。模組已快取，實測成本為數十毫秒量級；若交接窗口因此變長，應在交接前先完成 graph 準備而非在淡出後才初始化。→ **已依此建議在實作中加入預熱階段**（見「實作期修訂」第 3 條），淡出窗口只涵蓋狀態翻轉與換流。
- **序列化帶來的排隊延遲**：啟用 `runTransition` 後，漫長的 `SET_ACCOMPANIMENT`（worklet 初始化，popup 端逾時設定為 25 s，`src/popup/popup.ts:35`）會阻塞後續擷取指令。`SWITCH_CAPTURE` 把交接包成單一指令正是為了讓這類逾時不會落在交接關鍵路徑上。
