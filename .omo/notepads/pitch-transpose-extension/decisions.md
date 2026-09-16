# Decisions — pitch-transpose-extension

## [2026-09-16] Project start
- WAV + Opus only (no MP3 — Chrome WebCodecs lacks MP3 encoder)
- Popup-only UI (no separate player page)
- GPLv2+ licensing for Rubber Band portions, MIT for Signalsmith + custom code
- Signalsmith for Phase A realtime, Rubber Band LiveShifter for Phase B
- Emscripten single-translation-unit build for RB WASM (ref: Daninet/rubberband-wasm)
- No tempo/speed control, no region loop, no stream recording, no local file player
