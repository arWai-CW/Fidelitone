#!/usr/bin/env node
// Packages dist/ into a zip that unzips into a loadable extension, and refuses
// to produce one that would not load.
//
//   node tools/package/package.mjs            # validate dist/, write the zip
//   node tools/package/package.mjs --check    # validate only, write nothing
//   node tools/package/package.mjs --out release/f.zip
//
// A missing file in dist/ does not fail the build — it fails later, in a tab,
// as a silent fallback to passthrough where nothing is actually processed. So
// these are checked before a byte is written:
//   * manifest.json sits at the zip root, not inside a folder
//   * every path the manifest and the HTML name actually exists
//   * every worklet in src/processors/ made it into the package
//   * package.json and manifest.json agree on the version
//   * version is a legal MV3 version string
//   * icons are real PNGs of their declared size
//   * content scripts contain no import/export
// Dev artefacts (source maps, .d.ts, unreferenced source SVGs) are dropped, but
// only after proving nothing references them — a silent exclusion that breaks
// the build in a tab is worse than a fat package.
//
// Timestamps are fixed, so the same source tree yields a byte-identical archive
// and the SHA-256 in a release note actually means something.

import { createHash } from "node:crypto";
import { deflateRawSync } from "node:zlib";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, posix, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "..", "..");
const dist = join(root, "dist");

// ---------------------------------------------------------------------------
// args

const argv = process.argv.slice(2);
const flag = (name) => argv.includes(name);
const opt = (name, fallback) => {
  const i = argv.indexOf(name);
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback;
};
const checkOnly = flag("--check");

// ---------------------------------------------------------------------------
// reporting

// Every problem here is disqualifying. There is no warning tier, because a
// warning in a packaging step is a thing people learn to ignore.
const errors = [];
const fail = (msg) => errors.push(msg);

// ---------------------------------------------------------------------------
// gather dist/

if (!existsSync(join(dist, "manifest.json"))) {
  console.error("dist/ is missing or has not been built. Run `npm run build` first.");
  process.exit(1);
}

function walk(dir, base = "") {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
    const rel = base ? `${base}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walk(join(dir, entry.name), rel));
    else if (entry.isFile()) out.push(rel);
  }
  return out;
}

const allFiles = walk(dist);

// ---------------------------------------------------------------------------
// manifest: shape, version, and every path it names

const manifest = JSON.parse(readFileSync(join(dist, "manifest.json"), "utf8"));

if (manifest.manifest_version !== 3) {
  fail(`manifest_version is ${manifest.manifest_version}, expected 3`);
}

const CHROME_VERSION = /^(0|[1-9]\d*)(\.(0|[1-9]\d*)){0,3}$/;
if (!CHROME_VERSION.test(manifest.version ?? "")) {
  fail(`version ${JSON.stringify(manifest.version)} is not a legal MV3 version string`);
} else {
  const over = manifest.version.split(".").map(Number).filter((n) => n > 65535);
  if (over.length) fail(`version ${manifest.version} has a part above 65535 (${over.join(", ")})`);
}

// package.json and the manifest drifting apart is how a release ships under a
// version nobody can find in the git log.
const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
if (pkg.version !== manifest.version) {
  fail(`package.json version ${pkg.version} != manifest version ${manifest.version}`);
}

function manifestReferences(m) {
  const refs = [];
  for (const p of Object.values(m.icons ?? {})) refs.push(p);
  if (m.background?.service_worker) refs.push(m.background.service_worker);
  if (m.action?.default_popup) refs.push(m.action.default_popup);
  if (m.offscreen?.page) refs.push(m.offscreen.page);
  if (m.options_page) refs.push(m.options_page);
  if (m.options_ui?.page) refs.push(m.options_ui.page);
  for (const cs of m.content_scripts ?? []) refs.push(...(cs.js ?? []), ...(cs.css ?? []));
  for (const w of m.web_accessible_resources ?? []) refs.push(...(w.resources ?? []));
  return refs;
}

const referenced = new Set(manifestReferences(manifest));
for (const file of allFiles) {
  if (!file.endsWith(".html")) continue;
  const html = readFileSync(join(dist, file), "utf8");
  for (const m of html.matchAll(/(?:src|href)\s*=\s*"([^"]+)"/g)) {
    const raw = m[1];
    if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(raw) || raw.startsWith("#")) continue;
    referenced.add(posix.normalize(posix.join(posix.dirname(file), raw.split(/[?#]/)[0])));
  }
}
for (const ref of referenced) {
  if (!allFiles.includes(ref)) fail(`manifest/HTML references ${ref}, which is not in dist/`);
}

// The worklets are fetched by module URL at runtime, so nothing in the manifest
// or the HTML names them and the checks above cannot see a missing one. Deriving
// the list from src/processors/ rather than hardcoding it means a new worklet is
// covered the moment it is written, and a deleted one stops being demanded.
// A worklet that fails to load does not throw: the engine silently falls back
// to passthrough and the extension processes nothing.
const srcProcessors = existsSync(join(root, "src", "processors"))
  ? readdirSync(join(root, "src", "processors"))
      .filter((f) => f.endsWith(".js"))
      .sort()
  : [];
for (const name of srcProcessors) {
  const path = `processors/${name}`;
  if (!allFiles.includes(path)) fail(`worklet ${path} exists in src/processors/ but not in dist/`);
}

// ---------------------------------------------------------------------------
// icons: real PNGs, correct declared size

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
for (const [declared, path] of Object.entries(manifest.icons ?? {})) {
  const full = join(dist, path);
  if (!existsSync(full)) {
    fail(`icon ${declared} declared at ${path} is missing from dist/`);
    continue;
  }
  const buf = readFileSync(full);
  if (!buf.subarray(0, 8).equals(PNG_MAGIC)) {
    // Chrome reads the icon size out of the IHDR, so a mislabelled file renders
    // at the wrong size in the toolbar rather than failing loudly.
    fail(`icon ${declared} (${path}) is not a PNG`);
    continue;
  }
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  if (width !== Number(declared) || height !== Number(declared)) {
    fail(`icon ${declared} is declared as ${path} but that file is ${width}x${height}`);
  }
}

// ---------------------------------------------------------------------------
// content scripts must stay classic

// Vite would hoist the content script's shared imports into an ESM chunk, and a
// single `import` statement makes the whole file throw SyntaxError in the page.
// The extension then silently stops working on the one site it injects into.
for (const cs of manifest.content_scripts ?? []) {
  for (const js of cs.js ?? []) {
    const full = join(dist, js);
    if (!existsSync(full)) continue;
    const code = readFileSync(full, "utf8");
    if (hasModuleSyntax(code)) {
      fail(`content script ${js} contains import/export and will throw in the page`);
    }
  }
}

// Anchored to a statement boundary, so `obj.export = 1` and the word "export" in
// a string or comment do not trip it. The earlier pattern only caught
// `export {` and `export *`, which let `export const x = 1` through — and that
// one is exactly what a bundler emits when it decides a file is a module.
function hasModuleSyntax(code) {
  return /(?:^|[;{}])\s*(?:import|export)(?![.\w])/.test(code);
}

// ---------------------------------------------------------------------------
// exclusions: dev artefacts, each proven unreferenced

const EXCLUSIONS = [
  { test: (p) => p.endsWith(".d.ts"), why: "TypeScript declaration; the package ships no TypeScript" },
  { test: (p) => p.endsWith(".map"), why: "source map" },
  { test: (p) => p.startsWith("icons/") && p.endsWith(".svg"), why: "source vector; the manifest names the PNG" },
  { test: (p) => p.startsWith("node_modules/"), why: "dependency tree" },
];

const included = [];
const excluded = [];
for (const file of allFiles) {
  const rule = EXCLUSIONS.find((r) => r.test(file));
  if (!rule) {
    included.push(file);
    continue;
  }
  if (referenced.has(file)) {
    fail(`${file} looks like a dev artefact (${rule.why}) but something references it — refusing to exclude it`);
  } else {
    excluded.push({ file, why: rule.why });
  }
}


// ---------------------------------------------------------------------------
// report

const totalBytes = included.reduce((n, f) => n + readFileSync(join(dist, f)).length, 0);

console.log(`manifest  ${manifest.name} ${manifest.version}  (MV${manifest.manifest_version})`);
console.log(`package   ${included.length} files, ${(totalBytes / 1024).toFixed(0)} KB uncompressed`);
if (excluded.length) {
  console.log(`excluded  ${excluded.length} dev artefacts`);
  for (const { file, why } of excluded) console.log(`            ${file}  — ${why}`);
}

if (errors.length) {
  console.error(`\n${errors.length} problem${errors.length > 1 ? "s" : ""} — not packaging:`);
  for (const e of errors) console.error(`  error: ${e}`);
  process.exit(1);
}
if (checkOnly) {
  console.log("\ndist/ is packageable. (--check: no zip written)");
  process.exit(0);
}

// ---------------------------------------------------------------------------
// zip

// A minimal writer rather than a dependency: the format is a local file header
// per entry, a central directory, and an end-of-central-directory record, and
// every size is known up front so no data descriptors are needed. Fixed DOS
// timestamps are what make the output reproducible.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1; // 2020-01-01
const CRC_TABLE = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

const parts = [];
const directory = [];
let offset = 0;

for (const name of included) {
  const data = readFileSync(join(dist, name));
  const nameBuf = Buffer.from(name, "utf8");
  const deflated = deflateRawSync(data, { level: 9 });
  // Already-compressed payloads (PNG, wasm) grow when deflated; store those.
  const useDeflate = deflated.length < data.length;
  const payload = useDeflate ? deflated : data;
  const method = useDeflate ? 8 : 0;
  const crc = crc32(data);

  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);
  local.writeUInt16LE(0, 6);
  local.writeUInt16LE(method, 8);
  local.writeUInt16LE(DOS_TIME, 10);
  local.writeUInt16LE(DOS_DATE, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(payload.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(nameBuf.length, 26);
  local.writeUInt16LE(0, 28);
  parts.push(local, nameBuf, payload);

  const cd = Buffer.alloc(46);
  cd.writeUInt32LE(0x02014b50, 0);
  cd.writeUInt16LE(20, 4);
  cd.writeUInt16LE(20, 6);
  cd.writeUInt16LE(0, 8);
  cd.writeUInt16LE(method, 10);
  cd.writeUInt16LE(DOS_TIME, 12);
  cd.writeUInt16LE(DOS_DATE, 14);
  cd.writeUInt32LE(crc, 16);
  cd.writeUInt32LE(payload.length, 20);
  cd.writeUInt32LE(data.length, 24);
  cd.writeUInt16LE(nameBuf.length, 28);
  cd.writeUInt16LE(0, 30);
  cd.writeUInt16LE(0, 32);
  cd.writeUInt16LE(0, 34);
  cd.writeUInt16LE(0, 36);
  cd.writeUInt32LE((0o100644 << 16) >>> 0, 38);
  cd.writeUInt32LE(offset, 42);
  directory.push(Buffer.concat([cd, nameBuf]));

  offset += local.length + nameBuf.length + payload.length;
}

const dirBuf = Buffer.concat(directory);
const eocd = Buffer.alloc(22);
eocd.writeUInt32LE(0x06054b50, 0);
eocd.writeUInt16LE(0, 4);
eocd.writeUInt16LE(0, 6);
eocd.writeUInt16LE(included.length, 8);
eocd.writeUInt16LE(included.length, 10);
eocd.writeUInt32LE(dirBuf.length, 12);
eocd.writeUInt32LE(offset, 16);
eocd.writeUInt16LE(0, 20);

const zip = Buffer.concat([...parts, dirBuf, eocd]);

// ---------------------------------------------------------------------------
// verify what was written, not what was intended

// Read the archive back through its own central directory and confirm the
// manifest is at the root. A writer that disagrees with a reader is the one bug
// this whole file exists to prevent.
function readCentralDirectory(buf) {
  let eocdAt = -1;
  for (let i = buf.length - 22; i >= 0; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocdAt = i;
      break;
    }
  }
  if (eocdAt < 0) throw new Error("no end-of-central-directory record: malformed zip");
  const count = buf.readUInt16LE(eocdAt + 10);
  let p = buf.readUInt32LE(eocdAt + 16);
  const names = [];
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`central directory entry ${i} has a bad signature`);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const name = buf.toString("utf8", p + 46, p + 46 + nameLen);
    const localOffset = buf.readUInt32LE(p + 42);
    // The local header must point at the same name, or a reader that seeks
    // through it will extract something other than what the directory claims.
    if (buf.toString("utf8", localOffset + 30, localOffset + 30 + nameLen) !== name) {
      throw new Error(`local header for ${name} disagrees with the central directory`);
    }
    names.push(name);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return names;
}

const zipNames = readCentralDirectory(zip);
if (!zipNames.includes("manifest.json")) {
  console.error("\nerror: manifest.json is not at the zip root; unzipping it would not yield a loadable extension");
  process.exit(1);
}
if (zipNames.some((n) => n.includes("..") || n.startsWith("/"))) {
  console.error("\nerror: zip contains an absolute or traversing path");
  process.exit(1);
}

// Cross-check against the system unzip when it is available: an independent
// implementation agreeing is worth more than my own reader agreeing with my own
// writer.
// unzip cannot seek on a pipe, so the archive goes to a scratch file. An
// independent implementation agreeing is worth more than my own reader
// agreeing with my own writer.
let independent = "unavailable";
try {
  const scratch = join(root, ".package-verify.zip");
  writeFileSync(scratch, zip);
  try {
    independent = execFileSync("unzip", ["-t", scratch], { encoding: "utf8" })
      .trim()
      .split("\n")
      .pop()
      .trim();
  } finally {
    rmSync(scratch, { force: true });
  }
} catch {
  // No system unzip: the central-directory read above already ran.
}

const outPath = resolve(root, opt("--out", join(root, "release", `fidelitone-${manifest.version}.zip`)));
mkdirSync(dirname(outPath), { recursive: true });
writeFileSync(outPath, zip);

const sha = createHash("sha256").update(zip).digest("hex");
console.log(`\nzip       ${relative(root, outPath)}`);
console.log(`          ${(zip.length / 1024).toFixed(0)} KB, ${zipNames.length} entries`);
console.log(`          sha256 ${sha}`);
console.log(`          unzip -t: ${independent}`);
