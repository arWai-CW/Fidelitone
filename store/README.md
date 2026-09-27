# Chrome Web Store listing

Everything the store submission form needs, in one place. Character counts are
checked against the form's limits.

---

## Short description

>Limit: 132 characters.*

```
即時升 key／降 key 任何分頁正在播放的音訊，節奏不變。音訊全程留在你的瀏覽器，不上傳、不收集。
```

`51 / 132` — 81 characters of headroom.

Why this wording: it leads with the job, states the two facts a store visitor
actually needs (it does the job, it does not phone home), and claims nothing
about quality that belongs to the underlying library.

---

## Category and content

| Field | Value |
| --- | --- |
| Category | **Music and audio** (or Productivity — the store will re-file if it disagrees) |
| Language | Chinese (Traditional) — the listing copy is `zh-Hant`. The UI itself is localized (`zh-Hant` / `en` / `ja`) and follows the user's browser; the listing form has no language field beyond this one, so the other two are reached by localized store listings, not by this form. |
| Distribution | Global, but the listing copy is `zh-Hant`; add an English listing if you want reach |
| Manifest V3 | Yes |
| Single purpose | Transpose the pitch of audio playing in a browser tab, in real time, without changing tempo |

### Permission justifications

The store asks for these separately. Copy that answers the question rather than
restating the permission name:

| Permission | Justification to paste |
| --- | --- |
| `tabCapture` | Fidelitone's entire function is to process the audio of a tab the user selects. The user must invoke the extension on a tab before Chrome issues capture for it, and Chrome revokes it on cross-origin navigation or tab close. No tab is ever captured without an explicit user action. |
| `offscreen` | Chrome requires an offscreen document to host an `AudioContext`; the audio graph cannot run in a service worker or a popup because both are torn down. It holds no UI and makes no network requests. |
| `storage` | Remembers each page's pitch settings in `chrome.storage.local` so returning to a page restores them. Never `sync`, never transmitted. |
| `http://*/*`, `https://*/*` | Required to read the URL of the connected tab so settings can be remembered per page rather than per site. Does not grant any ability to read page content on unconnected sites. |
| Content script (YouTube only) | The optional YouTube volume panel writes the player volume through YouTube's own player API. Injected on `https://www.youtube.com/*` and nowhere else. |

---

## Screenshots

1280 × 800 each, in `store/`:

| File | What it shows |
| --- | --- |
| `store/01-immediate-transpose.png` | The core job: connected at +3 st, page memory active |
| `store/02-accompaniment-lowband.png` | Accompaniment mode — the 175 Hz crossover and the lowband resampler |
| `store/03-honest-state.png` | The audio is in another tab; the popup names it, offers to re-capture, and locks the settings |

These are the real built popup composited onto a 1280 × 800 frame — see
`npm run preview` for the states. The `chrome.*` APIs are mocked so the states
are reproducible; the UI is the shipped build.

**Icon:** the existing `icons/icon128.png` is 128 × 128, which is what the store
wants. **Small promo tile (440 × 280)** is required for at least one of your
listings; crop `store/01-immediate-transpose.png` or export a dedicated one.

---

## Detailed description

Paste into the store's description field. Markdown is not rendered, so this is
plain text with the line breaks the store preserves.

```
把正在播放的音訊升 key 或降 key，節奏不變。練唱、cover、KTV 跟唱時，
把伴奏調到自己的音域，不用重找另一個版本的音樂。

▍跟唱不斷線

每個頁面記住自己的移調量。YouTube 換到下一支影片、Spotify 換到下一首，
設定會自動跟著換歌套用——中途不用回去重新拖一次。

▍伴奏模式：低頻不糊

175Hz 以上的頻段走時域拉伸；175Hz 以下改用重取樣，讓低頻的所有泛音
一起移動。這樣 bass 和 kick 不會因為移調而糊掉或變薄。

這段低頻路徑是這個專案自己寫的，不是呼叫現成音訊函式庫。

▍介面會說實話

• 音訊在哪個分頁，介面直接指出來
• 引擎起不來時顯示「未處理」，不會留一個看起來能拖、其實沒反應的滑桿
• 工具列圖示顯示狀態：綠色是正在處理你看的分頁、橘色是音訊在別處、
  紅色是擷取中斷
• 處理延遲公開：目前約 100ms，這是實測出來的數字，不是估的

▍全部在本機

音訊不離開你的瀏覽器。沒有伺服器、沒有帳號、沒有分析工具。
唯一的對外連線是選用的 Google Fonts，擋掉也照常運作。

▍YouTube 音量控制

可以直接把 YouTube 播放器音量設成精確的百分比，500 毫秒漸變而不是跳變。
可以對著你保留的基準音量隨時套用，也可以一鍵淡出到靜音。

▍開源

MIT 授權，整個 repo 公開：架構決策記錄、實機驗證結果、量測工具都在裡面。
```

---

## Support and privacy URLs

Both are required before review, and both must resolve publicly.

| Field | URL |
| --- | --- |
| Homepage / support | `https://github.com/arWai-CW/fidelitone/issues` |
| Privacy policy | `https://github.com/arWai-CW/fidelitone/blob/main/PRIVACY.md` |

`PRIVACY.md` is written to stand alone as a policy page, not only as a repo
file. If you prefer a dedicated page, GitHub Pages works and the repo's
`docs/` already has the structure.

---

## Before you submit

- [ ] `manifest.json` version is bumped — the store rejects re-submissions of an
      unchanged version number
- [ ] Zip `dist/`, **not** the repo root. The zip must contain `manifest.json` at
      its root.
- [ ] `icons/icon16/48/128.png` are the real PNGs, not the SVGs
- [ ] Load the zip as an unpacked extension once before uploading, to confirm the
      zip layout is right
- [ ] Decide whether to submit with the current `http://*/*` host permissions or
      investigate narrowing them (see below)

### One thing worth deciding first

`http://*/*` and `https://*/*` are the permissions most likely to draw reviewer
attention, and the extension may not need both. It only ever captures tabs the
user explicitly points it at, and it needs the tab's URL only to key page
memory. Whether `activeTab` can replace the wildcard host permissions is worth
an afternoon of testing — it would make the permission story cleaner *and* the
privacy claim stronger, at the cost of some tab-URL visibility.

Do not guess at this. It changes capture behaviour, so it needs to be tested the
same way ADR-0007's list was: connect, follow, page memory, badge, divergence.
