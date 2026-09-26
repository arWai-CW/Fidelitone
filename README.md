# Fidelitone

Real-time audio pitch transposition for Chrome tabs.

Transpose the pitch of audio playing in any Chrome tab without affecting tempo.
Works with YouTube, Spotify Web, SoundCloud, and any other web audio source.


## Features

- Real-time pitch shifting with minimal latency
- Adjustable range: -12 to +12 semitones
- Preserves original tempo
- Per-page memory: every page URL keeps its own pitch, bypass, formant,
  accompaniment and engine settings (sparse — only non-default values are stored)
- Follows the tab you switch to, and applies that page's remembered settings
- Toolbar badge shows where the audio is coming from (`ON` / `ON·` / `!`)
- No external audio processing required
- Works on any website with audio playback


## Installation

### From Source

```bash
git clone https://github.com/your-username/pitch-transpose-extension.git
cd pitch-transpose-extension
npm install
npm run build
```

Then load the extension in Chrome:

1. Open `chrome://extensions/`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select the `dist/` folder


## Usage

1. Open a tab with audio (YouTube, Spotify Web, etc.)
2. Click the extension icon in the Chrome toolbar — this starts the capture and
   also grants Chrome the per-tab permission the capture needs
3. Adjust the pitch slider to shift audio up or down
4. Toggle bypass on/off with the power button
5. Switch to another tab: the capture follows it and that site's remembered
   settings are applied automatically

Toolbar badge states:

| Badge | Meaning |
| --- | --- |
| *(none)* | Nothing is being captured |
| green `ON` | Capturing the tab you are looking at |
| orange `ON·` | Capturing another tab (audio is not from the active tab) |
| red `!` | The capture was lost (tab closed or stream ended) |


## Per-page memory and tab following

Settings are remembered **per page URL** (`scheme + host + port + path + query`,
without the fragment), so `https://www.youtube.com/watch?v=abc` and
`https://www.youtube.com/watch?v=def` — same site, different videos — keep
independent pitches, while the very same URL opened in two tabs shares one record.

- Storage is sparse: only values that differ from the defaults are written, so a
  page you have never tweaked always comes back at `0 st` / Signalsmith / bypass
  off. Returning a value to its default deletes the field, and an all-default
  record deletes the key.
- `snapToInteger` is a global interface preference and is not remembered per page.
- Keys live in `chrome.storage.local` under `page:<url>`. Records written by the
  previous origin-based build (`site:<origin>`) are removed on upgrade — an origin
  maps onto no single page, and keeping one would let two videos share a pitch again.

What happens when you change tabs:

- While a capture is running, switching tabs moves the capture to the newly
  active tab (debounced 400 ms) and applies that page's settings. Switching to
  a tab that cannot be captured (Chrome pages, no permission, no audio host)
  **leaves the current capture untouched**.
- Navigating the captured tab to a different URL — another site, or another video
  on the same site — keeps the stream and re-reads settings for the new page.
  Re-touching the same page (a `#fragment` jump, a title-only update) re-sends
  nothing.
- If the audio belongs to another tab, the popup shows a banner with that tab's
  title and a **改擷取此分頁** button. Both tabs on the same URL: the banner shows
  and the controls stay editable, because they share one record. A different page:
  the controls are **locked** until you re-capture, because that record is not
  what you are hearing. While the service worker is still following the switch
  (400 ms), the popup refreshes its identity every 600 ms and unlocks itself.

### Limitations imposed by Chrome

- **A tab that never had the popup opened cannot be captured automatically.**
  Chrome only issues the tab-scoped capture permission when the user invokes the
  extension (clicking the icon), and revokes it on cross-origin navigation or
  tab close. For such a tab the badge turns `ON·` and the popup offers
  **改擷取此分頁** instead of switching on its own.
- **Only one tab can be captured at a time.** Switching away releases the
  previous tab, which then resumes playing its own original audio — so a silent
  tab makes the previous tab audible again. This is accepted behaviour of a
  single-capture extension; there is no silent-tab detection and no auto-switch-back.
- Auto-follow only works inside a session that already has a capture. Opening the
  popup while nothing is captured connects the active tab; it never starts a
  capture by itself when you are idle.


## Technical Details

This extension uses Chrome's Tab Capture API to capture audio from the active tab,
processes it through WebAssembly with the Signalsmith Stretch library, and outputs
the transposed audio via an offscreen document.

The extension is split into three contexts (see `docs/adr/`):

- **Background service worker** (`src/background/`) — the only writer for capture
  lifecycle. It watches `tabs.onActivated` / `tabs.onUpdated`, debounces follows,
  reconciles its cached session with the offscreen document, issues a single
  atomic `SWITCH_CAPTURE` handover, and owns the toolbar badge.
- **Offscreen document** (`src/offscreen/`) — owns the `AudioContext`, the DSP
  graph and the capture itself. All mutating messages are serialised through one
  transition queue, and a master output gate fades around each handover so the
  outgoing tab never plays with the incoming page's settings applied.
- **Popup** (`src/popup/`) — edits settings for the captured page and reports
  where the audio is actually coming from. It requests captures
  (`REQUEST_CAPTURE` / `RELEASE_CAPTURE`) rather than starting them.


## License

This project includes components under different licenses. See [LICENSE](LICENSE)
for full details.

- **Rubber Band Library**: GPLv2+ (Copyright (C) 2007-2024 Tim Bright / Breakfast Quay)
  - https://breakfastquay.com/rubberband/
- **Signalsmith Stretch**: MIT (Copyright (c) Geraint Luff / Signalsmith Audio)
  - https://github.com/Signalsmith-Audio/signalsmith-stretch
- **Project code**: MIT
