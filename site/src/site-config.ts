import type { SiteConfig } from '@mcptoolshop/site-theme';
import stats from './stats.json';

export const config: SiteConfig = {
  title: 'RepoMesh',
  description: 'Syntropic repo network — append-only ledger, signed events, multi-dimensional trust scoring, and XRPL anchoring for distributed repo coordination.',
  logoBadge: 'RM',
  brandName: 'RepoMesh',
  repoUrl: 'https://github.com/mcp-tool-shop-org/repomesh',
  footerText: 'MIT Licensed — built by <a href="https://mcp-tool-shop.github.io/" style="color:var(--color-muted);text-decoration:underline">MCP Tool Shop</a>',

  hero: {
    badge: 'Open source',
    headline: 'Trust infrastructure',
    headlineAccent: 'for repo networks.',
    description: 'Append-only ledger, signed events, multi-dimensional trust scoring, and XRPL anchoring. Every release is verifiable. Every attestation is signed. Every score is earned.<br><a href="repos/" style="color:var(--color-accent);text-decoration:underline">Browse Trust Index</a> · <a href="health/" style="color:var(--color-accent);text-decoration:underline">Network Health</a> · <a href="anchors/" style="color:var(--color-accent);text-decoration:underline">Anchor Explorer</a>',
    primaryCta: { href: '#quick-start', label: 'Get started' },
    secondaryCta: { href: '#network', label: 'Live network' },
    previews: [
      { label: 'Join', code: 'node tools/repomesh.mjs init --repo your-org/your-repo' },
      { label: 'Verify', code: 'node tools/repomesh.mjs verify-release --repo org/repo --version 1.0.0 --anchored' },
      { label: 'Score', code: 'node registry/scripts/verify-trust.mjs --repo org/repo' },
    ],
  },

  sections: [
    {
      kind: 'features',
      id: 'how-it-works',
      title: 'How It Works',
      subtitle: 'Four layers of trust, each independently verifiable.',
      features: [
        { title: 'Signed Ledger', desc: 'Every event is Ed25519-signed by a registered node. Append-only. Schema-validated. Tamper-evident.' },
        { title: 'Independent Verifiers', desc: 'License audits, security scans, and reproducibility checks run by separate attestor nodes with consensus scoring.' },
        { title: 'XRPL Anchoring', desc: 'Merkle roots of ledger partitions are posted to the XRP Ledger testnet. Cryptographic proof that history wasn\'t rewritten.' },
      ],
    },
    {
      kind: 'data-table',
      id: 'trust-profiles',
      title: 'Trust Profiles',
      subtitle: 'Choose the level of evidence your project needs.',
      columns: ['Profile', 'Evidence', 'Assurance Checks', 'Use When'],
      rows: [
        ['baseline', 'Optional', 'None required', 'Internal tools, experiments'],
        ['open-source', 'SBOM + provenance', 'License + security', 'Default for OSS'],
        ['regulated', 'SBOM + provenance', 'License + security + repro', 'Compliance-critical'],
      ],
    },
    {
      kind: 'code-cards',
      id: 'quick-start',
      title: 'Quick Start',
      cards: [
        {
          title: '1. Initialize your node',
          code: `# generates node.json, profile, workflow, and signing keypair
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source`,
        },
        {
          title: '2. Add two secrets and release',
          code: `# add to your repo settings:
#   REPOMESH_SIGNING_KEY  — your private key PEM
#   REPOMESH_LEDGER_TOKEN — PAT with contents:write + pull-requests:write

# cut a release — trust converges automatically
gh release create v1.0.0 --generate-notes`,
        },
      ],
    },
    {
      kind: 'features',
      id: 'verification',
      title: 'Verification',
      subtitle: 'Every claim is checkable. No trust required.',
      features: [
        { title: 'Release Verification', desc: 'Verify any release with one command: signature, attestations, and XRPL anchor inclusion.' },
        { title: 'Trust Badges', desc: 'Embed integrity, assurance, and anchored badges in your README. Scores update automatically.' },
        { title: 'CI Gates', desc: 'Use --json output to gate deployments on trust scores. Zero dependencies beyond Node.js.' },
      ],
    },
    {
      kind: 'data-table',
      id: 'network',
      title: 'Live Network',
      subtitle: 'Real-time stats from the registry, updated on every push.',
      columns: ['Metric', 'Value'],
      rows: [
        ['Registered nodes', String(stats.nodeCount)],
        ['Tracked repos', String(stats.repoCount)],
        ['Verified releases', String(stats.releaseCount)],
        ['Independent verifiers', String(stats.verifierCount)],
        ['XRPL partitions', String(stats.partitionCount)],
        ['Anchor coverage', `${stats.anchorCoverage}%`],
        ['Latest release', stats.latestRelease ? `${stats.latestRelease.repo}@${stats.latestRelease.version} — Integrity ${stats.latestRelease.integrity}/100, Assurance ${stats.latestRelease.assurance}/100` : 'None'],
      ],
    },
  ],
};
