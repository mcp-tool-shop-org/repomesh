# Scorecard

> Score a repo before remediation. Fill this out first, then use SHIP_GATE.md to fix.

**Repo:** mcp-tool-shop-org/repomesh
**Date:** 2026-02-28
**Type tags:** `[all]` `[cli]` `[complex]`

## Pre-Remediation Assessment

| Category | Score | Notes |
|----------|-------|-------|
| A. Security | 6/10 | SECURITY.md was template; no threat model in README; no telemetry statement |
| B. Error Handling | 5/10 | CLI printed raw stacks on unhandled errors; exit codes only 0/1 |
| C. Operator Docs | 7/10 | README comprehensive; CHANGELOG empty template; handbook exists |
| D. Shipping Hygiene | 3/10 | No verify script; no version tags; deps vendored but no audit |
| E. Identity (soft) | 10/10 | Logo, translations, landing page, metadata all complete |
| **Overall** | **31/50** | |

## Key Gaps

1. SECURITY.md was boilerplate — no RepoMesh-specific scope or threat model
2. No verify script — no single-command validation pipeline
3. CLI error handling exposed raw stacks without --debug
4. CHANGELOG.md was empty template
5. No git tags or version tracking

## Remediation Priority

| Priority | Item | Estimated effort |
|----------|------|-----------------|
| 1 | Fill SECURITY.md + README threat model | 10 min |
| 2 | Create verify script + fix CLI errors | 10 min |
| 3 | Fill CHANGELOG + version bump to v1.0.0 | 5 min |

## Post-Remediation

| Category | Before | After |
|----------|--------|-------|
| A. Security | 6/10 | 10/10 |
| B. Error Handling | 5/10 | 9/10 |
| C. Operator Docs | 7/10 | 10/10 |
| D. Shipping Hygiene | 3/10 | 9/10 |
| E. Identity (soft) | 10/10 | 10/10 |
| **Overall** | **31/50** | **48/50** |
