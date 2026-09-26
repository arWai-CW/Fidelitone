// Builds a previewable copy of dist/ whose popup runs against mock-chrome.js,
// then serves it. The shim has to be a classic script that runs *before* the
// popup's module, so this patches a copy of popup.html rather than the build.
//
//   npm run preview   →  http://localhost:8743/popup.html
//
// States are selected by query string, documented at the top of mock-chrome.js.
// A few that map to the screenshots in docs/images/:
//
//   ?s=disconnected
//   ?s=connected&yt=1&pitch=3&mem=1
//   ?s=connected&yt=1&accom=1&pitch=-4&formant=1
//   ?s=connected&yt=1&dead=1&pitch=5
//   ?s=connected&yt=1&div=1&pitch=2
//
// Set the window to 400px wide to frame the popup; the popup is a fixed-width
// surface and anything wider is not a state users ever see.

import { createServer } from "node:http";
import { cpSync, existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, "..", "..", "dist");
const out = join(here, "preview");

if (!existsSync(join(dist, "popup.html"))) {
  console.error("dist/ is missing or empty. Run `npm run build` first.");
  process.exit(1);
}

cpSync(dist, out, { recursive: true });

// The shim must be a classic script and must run before the popup module, so it
// is injected ahead of the first <script type="module"> rather than deferred.
const popupPath = join(out, "popup.html");
const popup = readFileSync(popupPath, "utf8");
const patched = popup.replace(
  /<script type="module"/,
  '<script src="./mock-chrome.js"></script>\n\t\t<script type="module"',
);
if (patched === popup) {
  console.error("Could not find the popup module script in dist/popup.html.");
  process.exit(1);
}
writeFileSync(popupPath, patched);
writeFileSync(join(out, "mock-chrome.js"), readFileSync(join(here, "mock-chrome.js")));

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".wasm": "application/wasm",
  ".json": "application/json",
};
const port = Number(process.argv[2] ?? process.env.PORT ?? 8743);

createServer((req, res) => {
  const name = req.url === "/" || req.url === "" ? "/popup.html" : decodeURIComponent(req.url.split("?")[0]);
  const file = join(out, name);
  if (!file.startsWith(out) || !existsSync(file) || !statSync(file).isFile()) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = name.slice(name.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => {
  console.log(`Preview ready: http://localhost:${port}/popup.html`);
  console.log("States are selected by query string; see the top of mock-chrome.js.");
});
