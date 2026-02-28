#!/usr/bin/env bash
# RepoMesh verify script — runs validation + build pipeline.
# Exit 0 = all green, non-zero = failure.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== Validate ledger ==="
node ledger/scripts/validate-ledger.mjs

echo "=== Build anchors index ==="
node registry/scripts/build-anchors.mjs

echo "=== Build badges ==="
node registry/scripts/build-badges.mjs

echo "=== Build snippets ==="
node registry/scripts/build-snippets.mjs

echo "=== Build metrics ==="
node pages/build-metrics.mjs

echo "=== Build timeline ==="
node pages/build-timeline.mjs

echo "=== Build pages ==="
node pages/build-pages.mjs

echo "=== Verify trust (all tracked repos) ==="
for repo in $(node -e "const t=JSON.parse(require('fs').readFileSync('registry/trust.json','utf8'));[...new Set(t.map(r=>r.repo))].forEach(r=>console.log(r))"); do
  echo "  Checking $repo..."
  node registry/scripts/verify-trust.mjs --repo "$repo"
done

echo ""
echo "All checks passed."
