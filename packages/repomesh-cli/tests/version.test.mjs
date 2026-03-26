import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(resolve(__dirname, "..", "package.json"), "utf8"));

describe("version consistency", () => {
  it("package.json version is semver", () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  });

  it("version is >= 1.0.0", () => {
    const major = parseInt(pkg.version.split(".")[0], 10);
    assert.ok(major >= 1, `Expected major >= 1, got ${major}`);
  });

  it("CHANGELOG.md contains current version", () => {
    const changelog = readFileSync(resolve(__dirname, "..", "CHANGELOG.md"), "utf8");
    assert.ok(changelog.includes(`[${pkg.version}]`), `CHANGELOG missing [${pkg.version}]`);
  });

  it("CLI reads version dynamically from package.json", () => {
    const cli = readFileSync(resolve(__dirname, "..", "src", "cli.mjs"), "utf8");
    assert.ok(cli.includes("pkg.version"), "CLI should use pkg.version");
  });

  it("CLI has --version flag via Commander", () => {
    const cli = readFileSync(resolve(__dirname, "..", "src", "cli.mjs"), "utf8");
    assert.ok(cli.includes(".version("), "CLI should call .version()");
    assert.ok(cli.includes("--cli-version"), "CLI should support --cli-version flag");
  });
});

describe("CLI smoke", () => {
  it("dist/cli.mjs exists", () => {
    const exists = readFileSync(resolve(__dirname, "..", "dist", "cli.mjs"), "utf8");
    assert.ok(exists.length > 0);
  });

  it("dist/cli.mjs has shebang", () => {
    const content = readFileSync(resolve(__dirname, "..", "dist", "cli.mjs"), "utf8");
    assert.ok(content.startsWith("#!/usr/bin/env node"), "Should have node shebang");
  });
});
