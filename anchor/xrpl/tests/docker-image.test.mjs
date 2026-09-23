import { describe, it } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const dockerfile = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "..", "Dockerfile"), "utf8");

describe("anchor image", () => {
  it("runs as node 22, not root, and does not bake a seed", () => {
    assert.match(dockerfile, /FROM node:22-bookworm-slim/);
    assert.match(dockerfile, /^USER node$/m);
    assert.doesNotMatch(dockerfile, /ARG\s+XRPL_SEED/);
    assert.doesNotMatch(dockerfile, /ENV\s+XRPL_SEED/);
    assert.match(dockerfile, /packages\/repomesh-cli\/dist\/cli\.mjs/);
  });
});
