# Privacy Policy

**Fidelitone does not collect, transmit, sell, or share any data. There is no
server. There is no analytics. There is no account.**

Last updated: 2026-09-27

## What stays on your device

Everything Fidelitone does happens locally in your browser:

- **Audio.** Audio from a tab you explicitly connect is captured through
  Chrome's Tab Capture API, processed by WebAssembly inside the extension, and
  played back through your speakers. Audio samples are never written to disk,
  never uploaded, and never leave the browser process. The extension contains
  no network request code of any kind.
- **Your settings.** Pitch, bypass, formant and accompaniment settings are
  stored per page URL in `chrome.storage.local`, on your device. A page you
  have never adjusted is never written at all. The YouTube baseline volume and
  the semitone-snap preference are stored globally, also on your device.
- **Fonts.** The popup loads Barlow Condensed and Noto Sans TC from Google
  Fonts. This is the only network request the extension makes, it happens when
  the popup opens, and it discloses your IP address and User-Agent to Google in
  the ordinary way any web font does. If you would rather it did not, block
  `fonts.googleapis.com` and `fonts.gstatic.com`; the popup falls back to
  system fonts and remains fully functional.

Nothing is transmitted. You can verify this rather than take our word for it:
the extension ships as a single unpacked directory, and searching `src/` for
`fetch`, `XMLHttpRequest`, `WebSocket`, or `sendBeacon` returns no network call
outside the font stylesheet.

## Permissions, and why each one is needed

| Permission | Why |
| --- | --- |
| `tabCapture` | This is the extension's entire purpose: to take the audio of a tab you choose and process it. Chrome only issues this for a tab after you interact with the extension, and revokes it on cross-origin navigation or when the tab closes. Fidelitone never captures a tab you did not point it at. |
| `offscreen` | Chrome requires an offscreen document to own an `AudioContext`. The audio graph cannot live in a service worker or a popup, both of which are torn down. |
| `storage` | To remember each page's settings on your device. `chrome.storage.local`, never `sync`. |
| `http://*/*`, `https://*/*` | To read the URL of the tab you connected, so settings can be remembered per page. It does **not** grant the extension any ability to read page content on sites you have not connected. |
| Content script on `https://www.youtube.com/*` only | For the YouTube volume panel, which writes the player volume. Two scripts are injected there: one reads the DOM, one owns the writes. They are never injected anywhere else. |

## What the extension does not do

- It does not read, store, or transmit the content of pages.
- It does not inject anything outside `youtube.com`.
- It does not phone home, check for updates, or open any network connection
  other than the two Google Fonts hosts listed above.
- It is not monetised. There is no paid tier, no trial, and no upsell.

## Children

Fidelitone is a local audio utility and collects nothing, so it collects
nothing from anyone, including children.

## Contact

Fidelitone is open source: https://github.com/arWai-CW/fidelitone

If you have a privacy question or believe this policy is inaccurate, open an
issue on the repository. That is the fastest route to a human.

## Changes

If this policy ever changes, the change will be committed to this file in the
repository with its history visible, and the "Last updated" date above will
change. Because there is no data to migrate and no service to notify, a policy
change cannot affect anything you have already stored.
