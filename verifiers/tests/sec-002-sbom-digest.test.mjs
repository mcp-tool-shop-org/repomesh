// SEC-002 / D6 — fetch-sbom must hash the RAW fetched bytes and bind trust to the committed sha256.
// A missing OR mismatched digest -> bound:false, so the caller refuses to certify (warn/fail, no
// presence points). A matching digest -> bound:true.

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

import { fetchCycloneDxComponentsBound } from "../lib/fetch-sbom.mjs";

const SBOM_BYTES = Buffer.from(JSON.stringify({
  bomFormat: "CycloneDX",
  components: [
    { name: "left-pad", version: "1.0.0", purl: "pkg:npm/left-pad@1.0.0", licenses: [{ license: { id: "MIT" } }] },
  ],
}), "utf8");
const SBOM_SHA256 = crypto.createHash("sha256").update(SBOM_BYTES).digest("hex");

// Inject a global fetch that returns our fixed bytes. fetch-sbom.mjs uses the global `fetch`.
function withMockFetch(bytes, fn) {
  const orig = globalThis.fetch;
  globalThis.fetch = async () => ({
    ok: true,
    status: 200,
    statusText: "OK",
    arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  });
  return Promise.resolve(fn()).finally(() => { globalThis.fetch = orig; });
}

describe("SEC-002 SBOM digest binding", () => {
  it("bound:true when the committed sha256 matches the fetched RAW bytes", async () => {
    await withMockFetch(SBOM_BYTES, async () => {
      const { components, sha256, digestStatus } =
        await fetchCycloneDxComponentsBound("https://example.com/sbom.json", SBOM_SHA256);
      assert.equal(sha256, SBOM_SHA256, "digest must be computed from raw bytes");
      assert.equal(digestStatus.bound, true);
      assert.equal(components.length, 1);
      assert.equal(components[0].name, "left-pad");
    });
  });

  it("bound:false reason=mismatch when committed sha256 does not match", async () => {
    await withMockFetch(SBOM_BYTES, async () => {
      const { digestStatus } =
        await fetchCycloneDxComponentsBound("https://example.com/sbom.json", "0".repeat(64));
      assert.equal(digestStatus.bound, false);
      assert.equal(digestStatus.reason, "mismatch");
      assert.equal(digestStatus.actual, SBOM_SHA256);
    });
  });

  it("bound:false reason=missing when the attestation carries no sha256 (grandfathered)", async () => {
    await withMockFetch(SBOM_BYTES, async () => {
      const { digestStatus } =
        await fetchCycloneDxComponentsBound("https://example.com/sbom.json", undefined);
      assert.equal(digestStatus.bound, false);
      assert.equal(digestStatus.reason, "missing");
    });
  });

  it("hashes RAW bytes, not a re-serialized object (whitespace-sensitive)", async () => {
    // Same JSON value, different byte layout -> different digest -> must NOT be bound to the
    // canonical digest. Proves we hash what came off the wire, not JSON.stringify(parsed).
    const reformatted = Buffer.from(JSON.stringify(JSON.parse(SBOM_BYTES.toString()), null, 2), "utf8");
    assert.notDeepEqual(reformatted, SBOM_BYTES);
    await withMockFetch(reformatted, async () => {
      const { digestStatus } =
        await fetchCycloneDxComponentsBound("https://example.com/sbom.json", SBOM_SHA256);
      assert.equal(digestStatus.bound, false, "re-serialized bytes must not match the canonical-bytes digest");
    });
  });
});
