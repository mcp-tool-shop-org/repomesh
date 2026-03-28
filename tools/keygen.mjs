#!/usr/bin/env node
// RepoMesh Key Generator — Ed25519 keypair generation using openssl.
//
// Usage:
//   node keygen.mjs --output-dir ./repomesh-keys/org-repo
//
// Generates:
//   private.pem — Ed25519 private key (NEVER commit this)
//   public.pem  — Ed25519 public key (goes in node.json)

import fs from "node:fs";
import path from "node:path";
import { execSync, execFileSync } from "node:child_process";

export function generateKeypair(outputDir) {
  // Check openssl is available
  try {
    const ver = execSync("openssl version", { stdio: "pipe", encoding: "utf8" }).trim();
    console.error(`Using ${ver}`);
  } catch {
    console.error("\u274C openssl not found. Install OpenSSL:");
    console.error("  Windows: winget install ShiningLight.OpenSSL");
    console.error("  macOS:   brew install openssl");
    console.error("  Linux:   sudo apt install openssl");
    console.error("\nOr generate keys manually:");
    console.error("  openssl genpkey -algorithm ED25519 -out private.pem");
    console.error("  openssl pkey -in private.pem -pubout -out public.pem");
    return null;
  }

  fs.mkdirSync(outputDir, { recursive: true });

  const privatePath = path.join(outputDir, "private.pem");
  const publicPath = path.join(outputDir, "public.pem");

  // Don't overwrite existing keys
  if (fs.existsSync(privatePath)) {
    console.log(`\u26A0\uFE0F Keys already exist at ${outputDir}`);
    return {
      privatePath,
      publicPath,
      publicKeyPem: fs.readFileSync(publicPath, "utf8").trim()
    };
  }

  try {
    execFileSync('openssl', ['genpkey', '-algorithm', 'ED25519', '-out', privatePath], { stdio: "pipe" });
    execFileSync('openssl', ['pkey', '-in', privatePath, '-pubout', '-out', publicPath], { stdio: "pipe" });
  } catch (e) {
    console.error(`\u274C Key generation failed: ${e.message}`);
    // Clean up partial files
    try { fs.unlinkSync(privatePath); } catch {}
    try { fs.unlinkSync(publicPath); } catch {}
    return null;
  }

  const publicKeyPem = fs.readFileSync(publicPath, "utf8").trim();

  console.log(`\u2705 Ed25519 keypair generated:`);
  console.log(`  Private: ${privatePath}`);
  console.log(`  Public:  ${publicPath}`);

  return { privatePath, publicPath, publicKeyPem };
}

// CLI entrypoint
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(import.meta.filename)) {
  const args = process.argv.slice(2);
  const outIdx = args.indexOf("--output-dir");
  const outputDir = outIdx !== -1 ? args[outIdx + 1] : "./repomesh-keys";

  const result = generateKeypair(outputDir);
  if (!result) process.exit(1);

  console.log(`\nPublic key PEM (for node.json):\n${result.publicKeyPem}`);
}
