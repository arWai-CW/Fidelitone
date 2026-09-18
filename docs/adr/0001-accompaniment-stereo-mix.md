# 0001: 伴奏模式輸出改為立體聲求和 + 統一重導線

## 背景

原 ChannelMerger 左低右高造成頻譜分家；進伴奏時 gainB 殘留未斷（右聲道 highband×2 = +6dB 爆音）；重進疊加 limiter→destination edge。

## 決策

1. 統一重導線 `rewireGraph()` 先全斷再接
2. 以 175 Hz LR-4 crossover 分離 lowband/highband；lowband→DelayNode→mixBus、highband→Signalsmith Stretch→mixBus→limiter→destination
3. 對齊延遲常數 0.09s
4. limiter 放寬 -3dB/ratio8/knee4/attack3ms

## 為何不用 ChannelMerger 相加

ChannelMerger 只映射不求和——它把多個單聲道輸出映射到多聲道的不同聲道，不會將訊號混合。

## 為何先根治接線而非逐點 patch

殘留路徑是根因：gainB 殘留 + limiter edge 累積 + merger 分家，三者交互作用。逐點 patch 只能修一個，根治接線一次解決。
