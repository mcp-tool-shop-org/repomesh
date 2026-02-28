# Ship Gate

> No repo is "done" until every applicable line is checked.
> Copy this into your repo root. Check items off per-release.

**Tags:** `[all]` every repo · `[npm]` `[pypi]` `[vsix]` `[desktop]` `[container]` published artifacts · `[mcp]` MCP servers · `[cli]` CLI tools

---

## A. Security Baseline

- [x] `[all]` SECURITY.md exists (report email, supported versions, response timeline) (2026-02-28)
- [x] `[all]` README includes threat model paragraph (data touched, data NOT touched, permissions required) (2026-02-28)
- [x] `[all]` No secrets, tokens, or credentials in source or diagnostics output (2026-02-28)
- [x] `[all]` No telemetry by default — state it explicitly even if obvious (2026-02-28)

### Default safety posture

- [ ] `[cli|mcp|desktop]` SKIP: CLI has no destructive actions (init creates files, verify-release is read-only)
- [ ] `[cli|mcp|desktop]` SKIP: file operations stay within the repo working directory
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server

## B. Error Handling

- [x] `[all]` Errors follow the Structured Error Shape: `code`, `message`, `hint`, `cause?`, `retryable?` (2026-02-28)
- [x] `[cli]` Exit codes: 0 ok · 1 user error · 2 runtime error · 3 partial success (2026-02-28)
- [x] `[cli]` No raw stack traces without `--debug` (2026-02-28)
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[mcp]` SKIP: not an MCP server
- [ ] `[desktop]` SKIP: not a desktop app
- [ ] `[vscode]` SKIP: not a VS Code extension

## C. Operator Docs

- [x] `[all]` README is current: what it does, install, usage, supported platforms + runtime versions (2026-02-28)
- [x] `[all]` CHANGELOG.md (Keep a Changelog format) (2026-02-28)
- [x] `[all]` LICENSE file present and repo states support status (2026-02-28)
- [x] `[cli]` `--help` output accurate for all commands and flags (2026-02-28)
- [ ] `[cli|mcp|desktop]` SKIP: simple CLI with no configurable logging levels; errors go to stderr, output to stdout
- [ ] `[mcp]` SKIP: not an MCP server
- [x] `[complex]` HANDBOOK.md: daily ops, warn/critical response, recovery procedures (2026-02-28)

## D. Shipping Hygiene

- [x] `[all]` `verify` script exists (test + build + smoke in one command) (2026-02-28)
- [x] `[all]` Version in manifest matches git tag (2026-02-28)
- [ ] `[all]` SKIP: dependencies are vendored in ledger/node_modules (no external registry)
- [ ] `[all]` SKIP: vendored dependencies are pinned by lockfile
- [ ] `[npm]` SKIP: not published to npm
- [ ] `[npm]` SKIP: not published to npm
- [ ] `[npm]` SKIP: not published to npm
- [ ] `[vsix]` SKIP: not a VS Code extension
- [ ] `[desktop]` SKIP: not a desktop app

## E. Identity (soft gate — does not block ship)

- [x] `[all]` Logo in README header (2026-02-28)
- [x] `[all]` Translations (polyglot-mcp, 8 languages) (2026-02-28)
- [x] `[org]` Landing page (@mcptoolshop/site-theme) (2026-02-28)
- [x] `[all]` GitHub repo metadata: description, homepage, topics (2026-02-28)

---

## Gate Rules

**Hard gate (A–D):** Must pass before any version is tagged or published.
If a section doesn't apply, mark `SKIP:` with justification — don't leave it unchecked.

**Soft gate (E):** Should be done. Product ships without it, but isn't "whole."

**Checking off:**
```
- [x] `[all]` SECURITY.md exists (2026-02-27)
```

**Skipping:**
```
- [ ] `[pypi]` SKIP: not a Python project
```
