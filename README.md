# Fidelitone

Real-time audio pitch transposition for Chrome tabs.

Transpose the pitch of audio playing in any Chrome tab without affecting tempo.
Works with YouTube, Spotify Web, SoundCloud, and any other web audio source.


## Features

- Real-time pitch shifting with minimal latency
- Adjustable range: -12 to +12 semitones
- Preserves original tempo
- Per-tab audio capture
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
2. Click the extension icon in the Chrome toolbar
3. Adjust the pitch slider to shift audio up or down
4. Toggle the extension on/off with the switch


## Technical Details

This extension uses Chrome's Tab Capture API to capture audio from the active tab,
processes it through WebAssembly with the Signalsmith Stretch library, and outputs
the transposed audio via an offscreen document.


## License

This project includes components under different licenses. See [LICENSE](LICENSE)
for full details.

- **Rubber Band Library**: GPLv2+ (Copyright (C) 2007-2024 Tim Bright / Breakfast Quay)
  - https://breakfastquay.com/rubberband/
- **Signalsmith Stretch**: MIT (Copyright (c) Geraint Luff / Signalsmith Audio)
  - https://github.com/Signalsmith-Audio/signalsmith-stretch
- **Project code**: MIT
