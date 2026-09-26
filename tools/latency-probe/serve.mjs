// Serves tools/latency-probe/ locally with the Signalsmith worklet staged
// alongside it. The same .mjs file is both the worklet module and the factory
// module, which is why only one file has to be staged.
//
//   npm run latency   →  http://localhost:8742/index.html
//
// Run from the repository root: `node tools/latency-probe/serve.mjs`.

import { createServer } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..", "..");
const vendor = join(here, "vendor");

const source = join(root, "node_modules", "signalsmith-stretch", "SignalsmithStretch.mjs");
if (!existsSync(source)) {
  console.error("signalsmith-stretch is not installed. Run `npm install` first.");
  process.exit(1);
}

mkdirSync(vendor, { recursive: true });
copyFileSync(source, join(vendor, "SignalsmithStretch.mjs"));

const TYPES = { ".html": "text/html; charset=utf-8", ".mjs": "text/javascript; charset=utf-8" };
const port = Number(process.env.PORT ?? 8742);

createServer((req, res) => {
  const name = req.url === "/" || req.url === "" ? "/index.html" : req.url.split("?")[0];
  const file = join(here, name);
  if (!file.startsWith(here) || !existsSync(file)) {
    res.writeHead(404).end("not found");
    return;
  }
  const ext = name.slice(name.lastIndexOf("."));
  res.writeHead(200, { "content-type": TYPES[ext] ?? "application/octet-stream" });
  res.end(readFileSync(file));
}).listen(port, () => {
  console.log(`Latency probe ready:  http://localhost:${port}/index.html`);
  console.log("Press measure. A click is required — browsers block audio without a gesture.");
});
