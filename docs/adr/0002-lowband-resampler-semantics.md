# 0002: 低頻段以 tape-speed resampling 跟隨主移調（正向速率語意）

## 背景

使用者規格 Q5/Q9 低頻避開 Phase Vocoder 用 resampling 跟隨移調；resampler 未接 SET_PITCH 且語意反轉、scale<1 越界 NaN。

## 決策

1. rate=pitchScale 正向加速讀取（>1 = 升音，不反轉）
2. 歷史 ring 跨 block 消費
3. rate<1 越界守衛 clamp
4. SET_PITCH 送同一 pitchScale、前端禁止反轉
5. 以 stereo 共用的低頻週期估計做 phase-locked timeline correction：rate>1 時向後跳整週期，rate<1 時向前跳整週期，避免 live stream 的 read cursor 追上寫入邊緣或累積無界延遲
6. 週期修正使用 128-sample 平滑交叉淡化；沒有可靠週期時保留既有速率並.fade，不讀取無效或 stale ring slot
7. 延遲上限由預緩衝、週期搜尋窗與交叉淡化共同界定，伴奏高頻軌沿用既有對齊預算

## 陷阱紀錄

反轉「修正」會讓低頻反向移調，正是本 ADR 要阻止的合理假說。

單純固定 read cursor 只是 time scaler：rate>1 會耗盡 live buffer，rate<1 會讓 ring 延遲無界成長。週期對齊修正必須與正向 rate 語意一起保留，不能用較大的 prebuffer 取代。
