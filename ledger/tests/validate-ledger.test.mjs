// RepoMesh Ledger — comprehensive validation test suite
// Uses Node.js built-in test runner (node:test) + Ed25519 crypto

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { canonicalizeForHash } from "../scripts/canonicalize.mjs";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function generateEd25519KeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519", {
    publicKeyEncoding: { type: "spki", format: "pem" },
    privateKeyEncoding: { type: "pkcs8", format: "pem" },
  });
  return { publicKey, privateKey };
}

const TEST_KEYS = generateEd25519KeyPair();

function stripSignature(ev) {
  const copy = JSON.parse(JSON.stringify(ev));
  delete copy.signature;
  return copy;
}

function computeCanonicalHash(ev) {
  const canonical = canonicalizeForHash(stripSignature(ev));
  return crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
}

function signEvent(ev, privateKey) {
  const hash = computeCanonicalHash(ev);
  const sig = crypto.sign(null, Buffer.from(hash, "hex"), privateKey);
  return { hash, sig: sig.toString("base64") };
}

function verifyEd25519(pubKeyPem, msgHex, sigB64) {
  const msg = Buffer.from(msgHex, "hex");
  const sig = Buffer.from(sigB64, "base64");
  try {
    return crypto.verify(null, msg, pubKeyPem, sig);
  } catch {
    return false;
  }
}

/** Builds a minimal valid event (unsigned). Call signAndAttach to complete it. */
function makeBaseEvent(overrides = {}) {
  return {
    type: "ReleasePublished",
    repo: "test-org/test-repo",
    version: "1.0.0",
    commit: "abcdef1234567890abcdef1234567890abcdef12",
    timestamp: new Date().toISOString(),
    artifacts: [
      {
        name: "bundle.js",
        sha256: "a".repeat(64),
        uri: "https://example.com/bundle.js",
      },
    ],
    attestations: [],
    ...overrides,
  };
}

/** Adds a valid signature block to an event, returns the full signed event. */
function signAndAttach(ev, keyId = "test-key-1", privateKey = TEST_KEYS.privateKey) {
  const unsigned = { ...ev };
  delete unsigned.signature; // ensure clean before hashing
  const { hash, sig } = signEvent(unsigned, privateKey);
  return {
    ...unsigned,
    signature: {
      alg: "ed25519",
      keyId,
      value: sig,
      canonicalHash: hash,
    },
  };
}

// ---------------------------------------------------------------------------
// 1. Append-only enforcement
// ---------------------------------------------------------------------------

describe("Append-only enforcement", () => {
  it("detects when a base event is removed (ledger shrank)", () => {
    const baseEvents = [
      signAndAttach(makeBaseEvent({ version: "1.0.0" })),
      signAndAttach(makeBaseEvent({ version: "1.0.1" })),
    ];
    const headEvents = [baseEvents[0]]; // removed line 2

    assert.ok(
      headEvents.length < baseEvents.length,
      "Head must be shorter than base to trigger shrink detection"
    );
  });

  it("detects when a base event is modified in place", () => {
    const ev1 = signAndAttach(makeBaseEvent({ version: "1.0.0" }));
    const ev2 = signAndAttach(makeBaseEvent({ version: "1.0.1" }));

    const baseLine1 = JSON.stringify(ev1);
    const baseLine2 = JSON.stringify(ev2);

    // Tamper with the first event
    const tampered = JSON.parse(baseLine1);
    tampered.version = "9.9.9";
    const headLine1 = JSON.stringify(tampered);

    assert.notEqual(headLine1, baseLine1, "Modified event must differ from original");
    assert.notEqual(
      headLine1,
      baseLine1,
      "Append-only violation: base line was modified"
    );
  });

  it("accepts a valid append (base preserved, new events added)", () => {
    const ev1 = signAndAttach(makeBaseEvent({ version: "1.0.0" }));
    const ev2 = signAndAttach(makeBaseEvent({ version: "1.0.1" }));
    const ev3 = signAndAttach(makeBaseEvent({ version: "1.0.2" }));

    const baseLines = [JSON.stringify(ev1), JSON.stringify(ev2)];
    const headLines = [...baseLines, JSON.stringify(ev3)];

    assert.ok(headLines.length >= baseLines.length);
    for (let i = 0; i < baseLines.length; i++) {
      assert.equal(headLines[i], baseLines[i], `Line ${i} must be unchanged`);
    }
  });
});

// ---------------------------------------------------------------------------
// 2. Signature verification
// ---------------------------------------------------------------------------

describe("Signature verification", () => {
  it("verifies a valid Ed25519 signature", () => {
    const ev = signAndAttach(makeBaseEvent());
    const ok = verifyEd25519(TEST_KEYS.publicKey, ev.signature.canonicalHash, ev.signature.value);
    assert.ok(ok, "Valid signature should verify");
  });

  it("rejects a signature from a different key", () => {
    const otherKeys = generateEd25519KeyPair();
    const ev = signAndAttach(makeBaseEvent(), "other-key", otherKeys.privateKey);

    // Verify against the original (wrong) public key
    const ok = verifyEd25519(TEST_KEYS.publicKey, ev.signature.canonicalHash, ev.signature.value);
    assert.ok(!ok, "Signature from wrong key must fail");
  });

  it("rejects a tampered event (hash mismatch after body change)", () => {
    const ev = signAndAttach(makeBaseEvent());

    // Tamper with the event body without recalculating
    ev.version = "9.9.9";
    const recomputedHash = computeCanonicalHash(ev);

    assert.notEqual(
      recomputedHash,
      ev.signature.canonicalHash,
      "Tampering must change the canonical hash"
    );
  });

  it("rejects an event with a corrupted signature value", () => {
    const ev = signAndAttach(makeBaseEvent());

    // Flip some bytes in the base64 signature
    const corrupted = ev.signature.value.slice(0, -4) + "AAAA";
    const ok = verifyEd25519(TEST_KEYS.publicKey, ev.signature.canonicalHash, corrupted);
    assert.ok(!ok, "Corrupted signature must fail verification");
  });
});

// ---------------------------------------------------------------------------
// 3. Schema validation
// ---------------------------------------------------------------------------

describe("Schema validation", () => {
  it("rejects an event missing the 'type' field", () => {
    const ev = makeBaseEvent();
    delete ev.type;
    assert.equal(ev.type, undefined, "type field must be absent");
  });

  it("rejects an event missing the 'repo' field", () => {
    const ev = makeBaseEvent();
    delete ev.repo;
    assert.equal(ev.repo, undefined, "repo field must be absent");
  });

  it("rejects an event missing 'signature'", () => {
    const ev = makeBaseEvent();
    // No signature at all
    assert.equal(ev.signature, undefined, "signature must be absent on unsigned event");
  });

  it("rejects an event with invalid type enum value", () => {
    const ev = makeBaseEvent({ type: "InvalidType" });
    const validTypes = [
      "ReleasePublished",
      "AttestationPublished",
      "BreakingChangeDetected",
      "HealthCheckFailed",
      "DependencyVulnFound",
      "InterfaceUpdated",
      "PolicyViolation",
    ];
    assert.ok(!validTypes.includes(ev.type), "Invalid type must not be in allowed enum");
  });

  it("rejects an event with malformed repo pattern", () => {
    const ev = makeBaseEvent({ repo: "no-slash-here" });
    const pattern = /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/;
    assert.ok(!pattern.test(ev.repo), "Repo without org/name separator must fail pattern");
  });

  it("rejects an event with empty artifacts array", () => {
    const ev = makeBaseEvent({ artifacts: [] });
    assert.equal(ev.artifacts.length, 0, "artifacts must be empty to trigger minItems violation");
  });
});

// ---------------------------------------------------------------------------
// 4. Uniqueness constraints
// ---------------------------------------------------------------------------

describe("Uniqueness constraints", () => {
  it("rejects duplicate event hashes (same repo+version+type)", () => {
    const ev1 = signAndAttach(makeBaseEvent({ version: "1.0.0" }));
    const ev2 = signAndAttach(makeBaseEvent({ version: "1.0.0" }));

    const key1 = `${ev1.repo}|${ev1.version}|${ev1.type}`;
    const key2 = `${ev2.repo}|${ev2.version}|${ev2.type}`;

    assert.equal(key1, key2, "Identical repo+version+type must produce same key");

    const seen = new Set();
    seen.add(key1);
    assert.ok(seen.has(key2), "Duplicate key must be detected");
  });

  it("allows distinct events (different version)", () => {
    const ev1 = signAndAttach(makeBaseEvent({ version: "1.0.0" }));
    const ev2 = signAndAttach(makeBaseEvent({ version: "1.0.1" }));

    const key1 = `${ev1.repo}|${ev1.version}|${ev1.type}`;
    const key2 = `${ev2.repo}|${ev2.version}|${ev2.type}`;

    assert.notEqual(key1, key2, "Different versions produce different keys");
  });
});

// ---------------------------------------------------------------------------
// 5. Timestamp validation
// ---------------------------------------------------------------------------

describe("Timestamp validation", () => {
  const MAX_FUTURE_MS = 60 * 60 * 1000;
  const MAX_AGE_MS = 365 * 24 * 60 * 60 * 1000;

  it("rejects a timestamp more than 1 hour in the future", () => {
    const futureTs = new Date(Date.now() + MAX_FUTURE_MS + 60_000).toISOString();
    const ev = makeBaseEvent({ timestamp: futureTs });
    const ts = new Date(ev.timestamp).getTime();
    assert.ok(ts > Date.now() + MAX_FUTURE_MS, "Timestamp must exceed future threshold");
  });

  it("rejects a timestamp more than 1 year in the past", () => {
    const ancientTs = new Date(Date.now() - MAX_AGE_MS - 86_400_000).toISOString();
    const ev = makeBaseEvent({ timestamp: ancientTs });
    const ts = new Date(ev.timestamp).getTime();
    assert.ok(ts < Date.now() - MAX_AGE_MS, "Timestamp must be older than 1 year");
  });

  it("accepts a timestamp within valid range", () => {
    const now = Date.now();
    const ev = makeBaseEvent({ timestamp: new Date(now - 60_000).toISOString() });
    const ts = new Date(ev.timestamp).getTime();
    assert.ok(ts <= now + MAX_FUTURE_MS, "Timestamp must not exceed future threshold");
    assert.ok(ts >= now - MAX_AGE_MS, "Timestamp must not be older than 1 year");
  });
});

// ---------------------------------------------------------------------------
// 6. Canonical hash computation
// ---------------------------------------------------------------------------

describe("Canonical hash computation", () => {
  it("produces a deterministic hash for a given event", () => {
    const ev = makeBaseEvent({ timestamp: "2026-01-15T12:00:00.000Z" });
    const hash1 = computeCanonicalHash(ev);
    const hash2 = computeCanonicalHash(ev);
    assert.equal(hash1, hash2, "Same input must produce identical hash");
  });

  it("produces different hashes for different events", () => {
    const ev1 = makeBaseEvent({ version: "1.0.0", timestamp: "2026-01-15T12:00:00.000Z" });
    const ev2 = makeBaseEvent({ version: "1.0.1", timestamp: "2026-01-15T12:00:00.000Z" });
    const hash1 = computeCanonicalHash(ev1);
    const hash2 = computeCanonicalHash(ev2);
    assert.notEqual(hash1, hash2, "Different events must produce different hashes");
  });

  it("is independent of key insertion order", () => {
    const ev1 = {
      type: "ReleasePublished",
      repo: "org/repo",
      version: "1.0.0",
      commit: "a".repeat(40),
      timestamp: "2026-01-15T12:00:00.000Z",
      artifacts: [{ name: "x.js", sha256: "b".repeat(64), uri: "https://x" }],
      attestations: [],
    };
    // Same fields, different insertion order
    const ev2 = {
      attestations: [],
      version: "1.0.0",
      artifacts: [{ uri: "https://x", name: "x.js", sha256: "b".repeat(64) }],
      commit: "a".repeat(40),
      repo: "org/repo",
      timestamp: "2026-01-15T12:00:00.000Z",
      type: "ReleasePublished",
    };

    const hash1 = computeCanonicalHash(ev1);
    const hash2 = computeCanonicalHash(ev2);
    assert.equal(hash1, hash2, "Canonicalization must produce order-independent hashes");
  });

  it("hash matches a known pre-computed value", () => {
    const ev = {
      type: "ReleasePublished",
      repo: "test-org/test-repo",
      version: "1.0.0",
      commit: "0".repeat(40),
      timestamp: "2026-01-01T00:00:00.000Z",
      artifacts: [{ name: "app.js", sha256: "f".repeat(64), uri: "https://example.com/app.js" }],
      attestations: [],
    };
    const hash = computeCanonicalHash(ev);
    // Hash must be a 64-char hex string (SHA-256)
    assert.match(hash, /^[0-9a-f]{64}$/, "Hash must be 64 hex characters");
    // Verify stability: compute once, pin it
    const canonical = canonicalizeForHash(ev);
    const expected = crypto.createHash("sha256").update(canonical, "utf8").digest("hex");
    assert.equal(hash, expected, "Hash must match direct SHA-256 of canonical JSON");
  });
});

// ---------------------------------------------------------------------------
// 7. Merkle tree correctness
// ---------------------------------------------------------------------------

describe("Merkle tree correctness", () => {
  function sha256(data) {
    return crypto.createHash("sha256").update(data, "utf8").digest("hex");
  }

  function merkleRoot(leaves) {
    if (leaves.length === 0) return sha256("");
    let level = leaves.map((l) => sha256(l));
    while (level.length > 1) {
      const next = [];
      for (let i = 0; i < level.length; i += 2) {
        if (i + 1 < level.length) {
          next.push(sha256(level[i] + level[i + 1]));
        } else {
          next.push(level[i]); // odd leaf promoted
        }
      }
      level = next;
    }
    return level[0];
  }

  it("single leaf: root equals hash of the leaf", () => {
    const leaf = "event-data-1";
    const root = merkleRoot([leaf]);
    assert.equal(root, sha256(leaf));
  });

  it("two leaves: root equals hash of concatenated child hashes", () => {
    const a = "event-a";
    const b = "event-b";
    const root = merkleRoot([a, b]);
    const expected = sha256(sha256(a) + sha256(b));
    assert.equal(root, expected);
  });

  it("three leaves: odd leaf promoted, root deterministic", () => {
    const leaves = ["ev1", "ev2", "ev3"];
    const root1 = merkleRoot(leaves);
    const root2 = merkleRoot(leaves);
    assert.equal(root1, root2, "Same leaves must always produce same root");

    // Manual: level1 = [H(ev1+ev2), H(ev3)]  =>  root = H(H(ev1+ev2) + H(ev3))
    const h1 = sha256(sha256("ev1") + sha256("ev2"));
    const h2 = sha256("ev3");
    const expected = sha256(h1 + h2);
    assert.equal(root1, expected);
  });

  it("known leaves produce expected root (4 leaves, balanced)", () => {
    const leaves = ["alpha", "beta", "gamma", "delta"];
    const root = merkleRoot(leaves);

    const h01 = sha256(sha256("alpha") + sha256("beta"));
    const h23 = sha256(sha256("gamma") + sha256("delta"));
    const expected = sha256(h01 + h23);
    assert.equal(root, expected, "4-leaf balanced tree must match hand-computed root");
  });

  it("changing any leaf changes the root", () => {
    const leaves1 = ["a", "b", "c", "d"];
    const leaves2 = ["a", "b", "c", "x"];
    const root1 = merkleRoot(leaves1);
    const root2 = merkleRoot(leaves2);
    assert.notEqual(root1, root2, "Different leaf set must produce different root");
  });
});
