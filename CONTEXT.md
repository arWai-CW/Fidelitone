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
