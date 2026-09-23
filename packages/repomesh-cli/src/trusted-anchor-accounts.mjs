// Shipped XRPL anchor allowlist. One array, two names, so the in-repo verifier and the
// published CLI cannot drift. Config may drop an account. Config may not add one.
export const BUNDLED_TRUSTED_ANCHOR_ACCOUNTS = Object.freeze([
  "rJmh6kBzcaAPdiQNMCxS3i548fn95ByN8W",
]);

export const BUNDLED_TRUSTED_ACCOUNTS = BUNDLED_TRUSTED_ANCHOR_ACCOUNTS;

// Warn when a connected rippled reports an older build. Not a submit refusal:
// public clusters can trail a release by a few days. xrpl.js 5 still connects.
export const XRPLD_WARN_FLOOR = "3.4.0";

export function resolveTrustedAnchorAccounts(config) {
  const configured = config?.trustedAnchorAccounts;
  if (!Array.isArray(configured)) return new Set(BUNDLED_TRUSTED_ANCHOR_ACCOUNTS);
  const allowed = new Set(configured);
  return new Set(BUNDLED_TRUSTED_ANCHOR_ACCOUNTS.filter((account) => allowed.has(account)));
}

export function compareRippledBuild(version, floor = XRPLD_WARN_FLOOR) {
  const parse = (value) => {
    const match = String(value ?? "").match(/(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
  };
  const got = parse(version);
  const want = parse(floor);
  if (!got || !want) return null;
  for (let i = 0; i < 3; i++) {
    if (got[i] !== want[i]) return got[i] < want[i] ? -1 : 1;
  }
  return 0;
}

export function rippledBuildWarning(buildVersion, floor = XRPLD_WARN_FLOOR) {
  if (buildVersion == null || buildVersion === "") return null;
  const cmp = compareRippledBuild(buildVersion, floor);
  if (cmp === null) {
    return `rippled build_version ${buildVersion} is not a numeric version; RepoMesh floor is ${floor}`;
  }
  if (cmp < 0) return `rippled ${buildVersion} is below the RepoMesh floor ${floor}`;
  return null;
}

// Log the connected rippled build on stderr. Returns the warning text, or null.
export function noteRippledBuild(client, floor = XRPLD_WARN_FLOOR) {
  const build = client?.buildVersion;
  if (build == null || build === "") return null;
  const warning = rippledBuildWarning(build, floor);
  if (warning) console.error(`  Warning: ${warning}`);
  else console.error(`  rippled ${build}`);
  return warning;
}
