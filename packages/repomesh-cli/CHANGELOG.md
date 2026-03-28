# Changelog

## [1.1.0] - 2026-03-28

### Security
- Eliminated all command injection vectors (execSync → execFileSync with array args)
- Path traversal prevention on all user-controlled paths (resolve + startsWith)
- ReDoS-safe JSON extraction (regex replaced with lastIndexOf + slice)
- Added .gitignore entries for PEM key files
- CI workflows: explicit permissions, separated git commit/push steps

### Added
- `--quiet`, `--verbose`, `--debug`, `--no-color` global CLI flags
- `--json` output for `init` command
- `repomesh completion bash|zsh` for shell completion
- Env var overrides: `REPOMESH_LEDGER_URL`, `REPOMESH_MANIFESTS_URL`, `REPOMESH_FETCH_TIMEOUT`
- Attestor `--dry-run` flag
- Security verifier config file (`verifiers/security/config.json`)
- Profile override validation (prevents weakening regulated profiles)
- 58 tests across 3 suites (20 CLI + 27 ledger + 11 tools)

### Improved
- All JSON.parse calls wrapped in try-catch with descriptive errors
- Network retry feedback visible to users (not just debug mode)
- Progress indicators for all multi-step operations
- Actionable error hints (suggests next steps, not just failure messages)
- Fresh repo detection in `doctor` command
- Timeouts on XRPL (60s), HTTP (configurable), git clone (30s)
- Signal handlers for temp directory cleanup
- GitHub API retry with exponential backoff

## [1.0.0] - 2026-02-28

### Added

- `verify-release` — verify any release's trust chain from anywhere (no clone required)
- `verify-anchor` — verify XRPL anchor transactions
- `init` — one-command onboarding for repos joining the network
- `doctor` — diagnose a local repo's RepoMesh integration
- Remote verification via raw GitHub URLs (standalone mode)
- Local file access when run inside a RepoMesh checkout (dev mode)
- Packaged schemas, profiles, and workflow templates
