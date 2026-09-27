#!/usr/bin/env node
// Renders the README figures: one hero and one per feature, in both README
// languages, at the same size and in the same visual language as the store
// screenshots in store/.
//
//   npm run shots                 # both languages
//   npm run shots -- hero         # one figure, both languages
//   npm run shots -- hero zh-Hant # one figure, one language
//
// Why these are generated rather than screenshotted by hand:
//
//   * The popup inside every figure is the real shipped build, running against
//     the mocked chrome.* API that tools/popup-preview/ already provides. Only
//     the extension API is fake; the UI is what users get. A re-implementation
//     of the slider in HTML would be a different picture from the product.
//   * The figures are magnified crops of that real popup, not redrawings. The
//     crop rectangle and zoom factor are declared below, so a UI change moves
//     the figure instead of silently desynchronising it.
//
// The figures are duplicated per language because the copy in them differs, but
// the popup inside them does not: the extension's UI is zh-Hant throughout, so
// an English figure still shows a Chinese interface. That is the product, not a
// translation bug, and pretending otherwise would mean not using the real UI.
//
// The grain is lifted out of the built popup CSS, so the frame's texture is
// literally the same bytes the extension ships. If the texture changes, the
// figures change with it.

import { execFileSync, spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "dist");
const preview = join(root, "tools", "popup-preview", "preview");
const outRoot = join(root, "docs", "images");

const CHROME_CANDIDATES = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  process.env.CHROME_PATH,
].filter(Boolean);

if (!existsSync(join(dist, "popup.html"))) {
  console.error("dist/ is missing or has not been built. Run `npm run build` first.");
  process.exit(1);
}

// The grain lives inlined in the built stylesheet. Pull the data URI back out so
// the frame and the popup share one texture instead of two that look alike.
function grainDataUri() {
  const cssDir = join(dist, "assets");
  const css = readdirSync(cssDir).find((f) => f.startsWith("popup-") && f.endsWith(".css"));
  if (!css) throw new Error("no built popup stylesheet in dist/assets/");
  const m = readFileSync(join(cssDir, css), "utf8").match(/url\((data:image\/png;base64,[^)]+)\)/);
  if (!m) throw new Error("no grain data URI in the built popup stylesheet");
  return m[1];
}

// ---------------------------------------------------------------------------
// copy

const TEXT = {
  en: {
    hero: { tagline: "Shift any tab 12 semitones up or down — tempo untouched" },
    transpose: {
      kicker: "PITCH",
      heading: "Time-domain,<br />not a phase vocoder",
      body: [
        "The smearing you get at large transpositions is what phase vocoders do. This engine is time-domain: it overlaps waveforms instead of reassembling phases, so −12 and +12 are the same quality.",
        "The tempo never moves, and the output latency measures about 100 ms.",
      ],
      note:
        "The stretcher itself is Signalsmith Stretch (MIT). What this project wrote is the crossover, the routing, the per-page memory and the whole signal path.",
    },
    accompaniment: {
      kicker: "ACCOMPANIMENT MODE",
      heading: "The low band is<br />resampled, not stretched",
      body: [
        "Above 175 Hz the signal is stretched as usual. Below it, resampling moves every harmonic of a bass note or a kick drum together, instead of thinning them out.",
        "The signal-path readout names the route that is actually running.",
      ],
      note: "That low band is written here: a bounded, phase-locked WSOLA/PSOLA resampler.",
    },
    memory: {
      kicker: "MEMORY + TAB FOLLOW",
      heading: "New track, no re-tuning.<br />New tab, no drop-out.",
      body: [
        "Every page URL keeps its own transposition. Move to the next video on YouTube and it is already applied — no going back to drag the slider again.",
        "Move to another tab and the capture goes with you. When the audio lands somewhere else, the interface says so.",
      ],
      captions: ["Audio being processed", "The audio lives in another tab"],
    },
  },
  "zh-Hant": {
    hero: { tagline: "即時移調 −12 ~ +12 半音，節奏不變" },
    transpose: {
      kicker: "移調",
      heading: "時域拉伸，<br />不是相位聲碼器",
      body: [
        "大範圍移調最常見的糊化來自相位聲碼器。這個引擎走 time-domain，用波形疊加而不是相位重組，−12 和 +12 是同一個品質。",
        "節奏完全不動，輸出延遲約 100ms，這是量出來的數字。",
      ],
      note: "拉伸核心是 Signalsmith Stretch（MIT）。這個專案做的是分頻、路由、頁面記憶與整條訊號路徑。",
    },
    accompaniment: {
      kicker: "伴奏模式",
      heading: "低頻重取樣，<br />不是拉長",
      body: [
        "175 Hz 以上照常時域拉伸；175 Hz 以下改用重取樣，讓 bass 和 kick 的所有泛音一起移動，而不是被拉糊或變薄。",
        "信號路徑會直接寫出現在走哪一條。",
      ],
      note: "這條低頻路徑是這個專案自己寫的：bounded、phase-locked 的 WSOLA/PSOLA resampler。",
    },
    memory: {
      kicker: "記憶 ＋ 跟隨分頁",
      heading: "換歌不重調，<br />換分頁不斷線",
      body: [
        "每個頁面 URL 記住自己的移調量。YouTube 換到下一支影片，設定自動套用，中途不用回去重拖一次。",
        "移到另一個分頁，擷取跟著走；音訊跑到別頁時，介面會直接說出來。",
      ],
      captions: ["正在處理的音訊", "音訊跑到別的分頁"],
    },
  },
};

// ---------------------------------------------------------------------------
// figures
//
// crop = [x, y, w, h] in popup pixels; the popup is a fixed 400px surface.
// scale is the magnification. A figure is a magnified crop, not a redrawing.

const POPUP_W = 400;
const POPUP_H = 1000;

const FIGURES = [
  {
    name: "hero",
    width: 1280,
    height: 620,
    render: () => `
      <div class="stack">
        <h1 class="wordmark"><i class="tick"></i>Fidelitone</h1>
        <div class="zoom" style="${zoom(0, 46, 400, 139, 2.2)}">
          <iframe src="/popup.html?s=connected&yt=1&pitch=3&mem=1" title=""></iframe>
        </div>
        <p class="tagline"></p>
      </div>`,
  },
  {
    name: "transpose",
    width: 1280,
    height: 800,
    render: () => `
      <div class="cols">
        ${copy()}
        <div class="stack">
          <div class="zoom" style="${zoom(0, 46, 400, 386, 1.36)}">
            <iframe src="/popup.html?s=connected&yt=1&pitch=-7&mem=1" title=""></iframe>
          </div>
        </div>
      </div>`,
  },
  {
    name: "accompaniment",
    width: 1280,
    height: 800,
    render: () => `
      <div class="cols">
        ${copy()}
        <div class="stack">
          <div class="zoom" style="${zoom(0, 427, 400, 102, 1.36)}">
            <iframe src="/popup.html?s=connected&yt=1&accom=1&pitch=-4&mem=1&formant=1" title=""></iframe>
          </div>
          <div class="zoom" style="${zoom(0, 699, 400, 199, 1.36)}">
            <iframe src="/popup.html?s=connected&yt=1&accom=1&pitch=-4&mem=1&formant=1" title=""></iframe>
          </div>
        </div>
      </div>`,
  },
  {
    name: "memory",
    width: 1280,
    height: 800,
    render: () => `
      <div class="rows">
        <div class="split">
          <div class="copy tight">
            <p class="kicker"><i class="tick"></i></p>
            <h2></h2>
          </div>
          <div class="copy tight body-col">
            <p class="body"></p>
            <p class="body"></p>
          </div>
        </div>
        <div class="stack pair">
          <figure class="pane">
            <div class="zoom" style="${zoom(0, 46, 400, 327, 0.98)}">
              <iframe src="/popup.html?s=connected&yt=1&pitch=2&mem=1" title=""></iframe>
            </div>
            <figcaption></figcaption>
          </figure>
          <figure class="pane">
            <div class="zoom" style="${zoom(0, 46, 400, 332, 0.98)}">
              <iframe src="/popup.html?s=connected&yt=1&div=1&pitch=2&mem=1" title=""></iframe>
            </div>
            <figcaption></figcaption>
          </figure>
        </div>
      </div>`,
  },
];

function zoom(x, y, w, h, scale) {
  return [
    `width:${Math.round(w * scale)}px`,
    `height:${Math.round(h * scale)}px`,
    `--left:${-x * scale}px`,
    `--top:${-y * scale}px`,
    `--scale:${scale}`,
  ].join(";");
}

function copy() {
  return `
    <div class="copy">
      <p class="kicker"><i class="tick"></i></p>
      <h2></h2>
      <p class="body"></p>
      <p class="body"></p>
      <p class="note"></p>
    </div>`;
}

// ---------------------------------------------------------------------------
// template

function page({ width, height, body, grain }) {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<title>figure</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@400;500;600;700&family=Noto+Sans+TC:wght@400;500;700&display=swap" rel="stylesheet" />
<style>
  :root {
    --ink: #0a0a0a;
    --panel: #121212;
    --charred: #1a1a1a;
    --spool: #2e2e2e;
    --white: #f2f2f2;
    --text-2: #a8a8a8;
    --text-3: #8d8d8d;
    --orange: #ff5a1f;
    --grain: url("${grain}");
    --font: "Barlow Condensed", "Noto Sans TC", ui-sans-serif, sans-serif;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; padding: 0; }
  body {
    width: ${width}px;
    height: ${height}px;
    overflow: hidden;
    background-color: var(--ink);
    background-image: radial-gradient(118% 86% at 62% 8%, rgba(255, 90, 31, 0.13), transparent 62%);
    color: var(--white);
    font-family: var(--font);
    -webkit-font-smoothing: antialiased;
    position: relative;
  }
  /* The same grain the popup's film strip uses, over the whole figure. */
  body::after {
    content: "";
    position: absolute;
    inset: 0;
    background-image: var(--grain);
    background-size: 180px 180px;
    opacity: 0.07;
    mix-blend-mode: overlay;
    pointer-events: none;
  }
  .stage { position: relative; z-index: 1; width: 100%; height: 100%; }

  .tick {
    display: inline-block;
    width: 8px;
    background: var(--orange);
    margin-right: 16px;
    vertical-align: 0.06em;
  }

  /* hero ------------------------------------------------------------- */
  .stack {
    height: 100%;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 34px;
  }
  .wordmark {
    margin: 0;
    font-size: 118px;
    font-weight: 700;
    line-height: 1;
    letter-spacing: 0.16em;
    text-indent: 0.16em;
    color: var(--white);
  }
  .tagline {
    margin: 0;
    font-size: 27px;
    font-weight: 400;
    line-height: 1.5;
    color: var(--text-2);
    letter-spacing: 0.02em;
    text-align: center;
  }

  /* feature figures --------------------------------------------------- */
  .cols {
    height: 100%;
    display: grid;
    grid-template-columns: 1fr auto;
    align-items: center;
    gap: 56px;
    padding: 0 76px;
  }
  .stack.pair { flex-direction: row; align-items: flex-start; justify-content: center; gap: 34px; }

  /* The two-tab figure reads as a sequence, so it runs top to bottom: the claim
     across the top, the two states it refers to underneath. */
  .rows {
    height: 100%;
    display: grid;
    grid-template-rows: auto 1fr;
    gap: 40px;
    padding: 56px 76px 52px;
  }
  .split {
    display: grid;
    grid-template-columns: 510px 1fr;
    gap: 64px;
    align-items: start;
  }
  .copy.tight h2 { margin-bottom: 0; }
  .copy.tight .kicker { margin-bottom: 16px; }
  .body-col { max-width: 620px; }
  .pane { margin: 0; display: flex; flex-direction: column; gap: 13px; }
  .pane figcaption {
    font-family: "Noto Sans TC", var(--font);
    font-size: 16px;
    line-height: 1.4;
    color: var(--text-3);
    letter-spacing: 0.04em;
  }

  .copy { max-width: 560px; }
  .kicker {
    margin: 0 0 18px;
    font-family: "Noto Sans TC", var(--font);
    font-size: 15px;
    font-weight: 500;
    line-height: 1;
    color: var(--orange);
    letter-spacing: 0.14em;
  }
  .copy h2 {
    margin: 0 0 30px;
    font-size: 54px;
    font-weight: 700;
    line-height: 1.16;
    letter-spacing: 0.01em;
    color: var(--white);
  }
  .body {
    margin: 0 0 20px;
    font-family: "Noto Sans TC", var(--font);
    font-size: 20px;
    font-weight: 400;
    line-height: 1.75;
    color: var(--text-2);
  }
  .note {
    margin: 30px 0 0;
    padding-left: 16px;
    border-left: 2px solid var(--spool);
    font-family: "Noto Sans TC", var(--font);
    font-size: 15px;
    line-height: 1.7;
    color: var(--text-3);
  }

  /* the magnified crop of the real popup */
  .zoom {
    position: relative;
    overflow: hidden;
    border-radius: 3px;
    outline: 1px solid rgba(242, 242, 242, 0.16);
    box-shadow: 0 24px 60px rgba(0, 0, 0, 0.55), 0 0 0 7px rgba(10, 10, 10, 0.6);
    background: var(--ink);
  }
  .zoom iframe {
    position: absolute;
    left: var(--left);
    top: var(--top);
    width: ${POPUP_W}px;
    height: ${POPUP_H}px;
    border: 0;
    transform: scale(var(--scale));
    transform-origin: 0 0;
  }
</style>
</head>
<body><div class="stage">${body}</div></body>
</html>
`;
}

// ---------------------------------------------------------------------------
// fill in the locale's copy

// The templates above carry empty elements on purpose: each locale supplies its
// own text, and anything left empty is a bug rather than a blank to fill in
// later, so it fails the run.

function fill(fig, t) {
  let html = fig.render();
  const sub = (from, to) => {
    if (!html.includes(from)) throw new Error(`${fig.name}: nothing matches ${from}`);
    html = html.replace(from, to);
  };
  const kicker = (to) => sub('<i class="tick"></i></p>', `<i class="tick"></i>${to}</p>`);

  if (fig.name === "hero") {
    sub('<p class="tagline"></p>', `<p class="tagline">${t.tagline}</p>`);
  } else if (fig.name === "transpose" || fig.name === "accompaniment") {
    kicker(t.kicker);
    sub("<h2></h2>", `<h2>${t.heading}</h2>`);
    sub('<p class="body"></p>', `<p class="body">${t.body[0]}</p>`);
    sub('<p class="body"></p>', `<p class="body">${t.body[1]}</p>`);
    sub('<p class="note"></p>', `<p class="note">${t.note}</p>`);
  } else if (fig.name === "memory") {
    kicker(t.kicker);
    sub("<h2></h2>", `<h2>${t.heading}</h2>`);
    sub('<p class="body"></p>', `<p class="body">${t.body[0]}</p>`);
    sub('<p class="body"></p>', `<p class="body">${t.body[1]}</p>`);
    sub("<figcaption></figcaption>", `<figcaption>${t.captions[0]}</figcaption>`);
    sub("<figcaption></figcaption>", `<figcaption>${t.captions[1]}</figcaption>`);
  } else {
    throw new Error(`${fig.name}: no copy filler`);
  }

  // Any element the locale failed to fill is a hole in the figure, not a blank
  // to be filled in later.
  const empty = html.match(/<(?:h2|p|figcaption)[^>]*>\s+<\/|<(?:h2|p|figcaption)[^>]*><\//);
  if (empty) throw new Error(`${fig.name}: copy left empty — ${empty.join(" ")}`);
  return html;
}

// ---------------------------------------------------------------------------
// render

const chrome = CHROME_CANDIDATES.find((p) => existsSync(p));
if (!chrome) {
  console.error("No Chrome found. Set CHROME_PATH to a Chrome or Chromium binary.");
  process.exit(1);
}

// The frames are written into the preview directory because they iframe
// /popup.html, which only the preview server serves. The server is started here
// and stopped at the end, so regenerating the figures is one command instead of
// two terminals.
mkdirSync(preview, { recursive: true });
mkdirSync(outRoot, { recursive: true });

const grain = grainDataUri();
const port = Number(process.env.PORT ?? 8743);
const base = `http://localhost:${port}`;

async function reachable() {
  try {
    const r = await fetch(`${base}/popup.html`, { signal: AbortSignal.timeout(700) });
    return r.ok;
  } catch {
    return false;
  }
}

let server;
if (await reachable()) {
  console.log(`using the preview server already on ${port}`);
} else {
  server = spawn(process.execPath, [join(root, "tools", "popup-preview", "serve.mjs"), String(port)], {
    stdio: ["ignore", "ignore", "ignore"],
  });
  // Unreferenced so a forgotten server never keeps this process alive; the kill
  // at the end of the run is what actually stops it.
  server.unref();
  for (let i = 0; i < 40 && !(await reachable()); i++) await new Promise((r) => setTimeout(r, 100));
  if (!(await reachable())) {
    server.kill();
    console.error(`the preview server never came up on ${port}`);
    process.exit(1);
  }
  console.log(`started the preview server on ${port}`);
}

const locales = Object.keys(TEXT);
const args = process.argv.slice(2);
const wantFig = args.filter((a) => !locales.includes(a));
const wantLocales = args.filter((a) => locales.includes(a));
const figures = wantFig.length ? FIGURES.filter((f) => wantFig.includes(f.name)) : FIGURES;
const langs = wantLocales.length ? wantLocales : locales;

if (!figures.length) {
  console.error(`no figure matches ${wantFig.join(", ")}`);
  process.exit(1);
}

for (const fig of figures) {
  for (const locale of langs) {
    const dir = locale === "en" ? outRoot : join(outRoot, locale);
    mkdirSync(dir, { recursive: true });

    const slug = locale === "en" ? fig.name : `${fig.name}.${locale}`;
    const frame = join(preview, `frame-${slug}.html`);
    writeFileSync(frame, page({ ...fig, body: fill(fig, TEXT[locale][fig.name]), grain }));

    const shot = join(preview, `frame-${slug}.png`);
    rmSync(shot, { force: true });
    execFileSync(
      chrome,
      [
        "--headless",
        "--disable-gpu",
        "--hide-scrollbars",
        "--force-device-scale-factor=1",
        // Fonts come from Google Fonts; the popup does the same and falls back if
        // they are blocked. The budget lets them land before the shot is taken.
        "--virtual-time-budget=8000",
        `--window-size=${fig.width},${fig.height}`,
        `--screenshot=${shot}`,
        `${base}/frame-${slug}.html`,
      ],
      { stdio: ["ignore", "ignore", "pipe"] },
    );

    if (!existsSync(shot)) {
      console.error(`${slug}: Chrome wrote no file`);
      process.exit(1);
    }
    const dest = join(dir, `readme-${slug}.png`);
    copyFileSync(shot, dest);
    console.log(`${dest.replace(root + "/", "")}  ${fig.width}x${fig.height}`);
  }
}

server?.kill();
