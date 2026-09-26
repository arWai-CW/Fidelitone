# Fidelitone

Real-time audio pitch transposition for Chrome tabs.

**Connect**: 「已連線」狀態：擷取來源分頁音訊並經擴充套件接管播放。來源分頁一經擷取即被瀏覽器靜音（tabCapture 自動行為）。_Avoid_: 開始、播放、Capture（動詞）

**伴奏模式**: 並行移調模式：低頻段（0-175Hz）以時間域 resampling 變速讀取跟隨主移調，高頻段走 Signalsmith Stretch，兩段求和為完整立體聲輸出。_Avoid_: 伴唱模式、純伴奏、Bass mode

**Bypass**: 繞過處理的純透傳路徑：擷取音訊不經移調直接複製輸出。_Avoid_: 直通、PASSTHROUGH

**破音**: 使用者對「持續沙沙/毛邊感」的主觀描述；診斷指向 Chrome tabCapture 傳輸層（bypass 純複製路徑亦復現），非擴充套件處理邏輯。_Avoid_: 雜訊、snow

**爆音**: 振幅暴衝/削波；已診斷為接線殘留路徑（高頻段雙重輸出 +6dB）與重複接線累積所致，屬可修 bug。_Avoid_: 破音、爆聲

**pitchScale**: 主移調引擎的速率參數 = 2^(semitones/12)；>1 為升音。低頻 resampler 的讀取速率（rate）採同一數值、語意同向（不反轉）。_Avoid_: pitch factor、semitones（單位不同）

**lowband / highband**: 175Hz LR-4 分頻的兩段：lowband=0-175Hz（time-domain resampling 路徑）、highband=175Hz+（Signalsmith Stretch 路徑）。_Avoid_: 低頻軌、高頻段（中文詞彙混用）

**ACCOMPANIMENT_ALIGN_DELAY_S**: 伴奏模式中 lowband 路徑的人工延遲常數（0.09s 起跳），使低頻段與高頻路徑延遲對齊。_Avoid_: align delay、延遲常數

**origin 記憶**: 依 origin（scheme+host+port）分開儲存的設定記憶，稀疏存放：只記錄偏離乾淨預設的欄位，回到預設即刪除該欄位。涵蓋 pitch、bypass、preserveFormants、accompanimentMode、engine。_Avoid_: 每頁設定、per-tab 設定、站台設定（粒度混淆）、全域設定（ADR-0003 以前的形態）

**自動跟隨**: 活動分頁變更時，擷取來源自動改指向新的活動分頁並套用該 origin 的記憶。僅在已有擷取在跑的工作階段內生效。_Avoid_: 自動連線（無擷取時不觸發）、自動恢復、背景播放

**擷取分頁**: 目前被 tabCapture 擷取、由擴充功能輸出音訊的那一個分頁。offscreen 記錄其 tabId 與 origin。_Avoid_: 目前分頁、作用中分頁（與活動分頁混淆）、目標分頁（指切換的對象）

**設定分歧**: 擷取分頁的 tabId 或 origin 與目前活動分頁不一致的狀態。tabId 不同顯示分歧橫幅與「改擷取此分頁」；origin 不同則額外鎖定控制項。_Avoid_: 斷線（captureLost 是另一回事）、錯誤狀態、失去連線

**輸出總閘**: 置於引擎／limiter 之後、AudioContext destination 之前的 master gain。分頁交接時淡出 20–30ms 避免用錯設定播出，切換完成後淡入。_Avoid_: limiter、master volume、總音量（與使用者音量無關）
