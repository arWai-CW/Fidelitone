# Architecture decision records

One file per decision. Each records the situation, the choice, and — where it
matters — what was explicitly ruled out and why.

Two of these reverse an earlier decision. That is deliberate: a set of records
where everything was agreed to the first time is not a record of judgement.

| ADR | Status | Decision |
| --- | --- | --- |
| [0001](0001-accompaniment-stereo-mix.md) | accepted | Accompaniment output is a stereo **sum**, not a `ChannelMerger` — the merge node maps channels and does not sum them. Also where a residual +6 dB gain got root-caused. |
| [0002](0002-lowband-resampler-semantics.md) | accepted | Positive rate semantics for the lowband resampler, and why its timeline stays bounded in a live stream. |
| [0003](0003-architecture-modification-plan.md) | accepted | Splitting a 994-line offscreen file into modules with small interfaces — characterization tests first, then the split. |
| [0004](0004-per-page-memory-and-tab-follow.md) | accepted | Memory keyed by page **URL** rather than origin, and one atomic handover when the capture follows you. |
| [0005](0005-youtube-volume-and-loudness.md) | accepted, partly superseded | The YouTube volume panel, and the MAIN-world content script needed to reach a page-owned player API. |
| [0006](0006-remove-loudness-analysis.md) | accepted | **Reverses 0005.** The dB loudness analysis shipped, got used, and proved meaningless to users — so it was removed down to the code and the tests, and this record says why. |
| [0007](0007-single-pitch-engine.md) | accepted | **Removes the second engine.** Rubber Band was GPLv2+, was never used in the accompaniment path, and daily use had moved to the other one. Collapsing to one engine also collapsed the licence to a single permissive one — and forced the latency to actually be measured. |

Runtime results for these live in
[`../runtime-verification.md`](../runtime-verification.md).
