#!/usr/bin/env node
// Build script: copy src/ to dist/ (plain .mjs, no compilation needed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.resolve(__dirname, "..");
const SRC = path.join(PKG_ROOT, "src");
const DIST = path.join(PKG_ROOT, "dist");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

// Clean dist/
if (fs.existsSync(DIST)) fs.rmSync(DIST, { recursive: true });

// Copy src/ -> dist/
copyDir(SRC, DIST);

console.log("Build complete: src/ -> dist/");
