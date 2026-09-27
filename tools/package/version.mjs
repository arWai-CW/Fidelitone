#!/usr/bin/env node
// Prints the version, or exits non-zero if package.json and manifest.json
// disagree — the two are edited by hand in different files, and a release
// workflow that reads one of them while the other says something else will
// happily tag a version that does not exist.
//
//   node tools/package/version.mjs

import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (p) => JSON.parse(readFileSync(resolve(root, p), "utf8"));

const pkg = read("package.json");
const manifest = read("manifest.json");

if (pkg.version !== manifest.version) {
  console.error(
    `version mismatch: package.json ${pkg.version} vs manifest.json ${manifest.version}`,
  );
  process.exit(1);
}

console.log(pkg.version);
