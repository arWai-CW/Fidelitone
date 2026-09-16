# Issues — pitch-transpose-extension

(none yet)

## [2026-09-16] Vite output path prefix
- Build output is `dist/src/offscreen/offscreen.html` not `dist/offscreen/offscreen.html`
- Manifest will need to reference `src/offscreen/offscreen.html` instead of `offscreen.html`
- Could be fixed with Vite plugin to flatten paths, or adjust manifest paths
