<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/repomesh/readme.png" width="400" alt="RepoMesh">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml/badge.svg" alt="Ledger CI"></a>
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml/badge.svg" alt="Registry CI"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Trust_Index-live-blue" alt="Trust Index"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Réseau de référentiels Synptic : registre immuable, manifestes des nœuds et système de notation pour la coordination distribuée des référentiels.

## Qu'est-ce que c'est ?

RepoMesh transforme une collection de référentiels en un réseau coopératif. Chaque référentiel est un **nœud** avec :

- Un **manifeste** (`node.json`) qui déclare ce qu'il fournit et ce qu'il consomme.
- Des **événements signés** diffusés vers un registre immuable.
- Un **registre** qui indexe tous les nœuds et leurs capacités.
- Un **profil** qui définit ce que signifie le terme "fiable".

Le réseau impose trois invariants :

1. **Sorties déterministes** : mêmes entrées, mêmes artefacts.
2. **Traçabilité vérifiable** : chaque version est signée et attestée.
3. **Contrats composables** : les interfaces sont versionnées et lisibles par machine.

## Démarrage rapide (1 commande + 2 secrets)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

Cela génère tout ce dont vous avez besoin :
- `node.json` : votre manifeste de nœud.
- `repomesh.profile.json` : votre profil choisi.
- `.github/workflows/repomesh-broadcast.yml` : flux de diffusion des versions.
- Paire de clés de signature Ed25519 (la clé privée reste locale).

Ensuite, ajoutez deux secrets à votre référentiel :
1. `REPOMESH_SIGNING_KEY` : votre clé privée au format PEM (affichée lors de l'initialisation).
2. `REPOMESH_LEDGER_TOKEN` : jeton PAT GitHub avec les autorisations `contents:write` et `pull-requests:write` pour ce référentiel.

Effectuez une nouvelle version. La confiance converge automatiquement.

### Profils

| Profil | Preuves | Vérifications de sécurité | Quand utiliser |
|---------|----------|-----------------|----------|
| `baseline` | Optionnel | Aucun requis | Outils internes, expérimentations |
| `open-source` | SBOM + traçabilité | Audit de licences + analyse de sécurité | Par défaut pour les logiciels open source |
| `regulated` | SBOM + traçabilité | Licences + sécurité + reproductibilité | Critique pour la conformité |

### Vérifier la confiance

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Affiche le score d'intégrité, le score de sécurité et les recommandations spécifiques au profil.

### Surcharges

Personnalisation au niveau du référentiel sans forker les vérificateurs :

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Structure du référentiel

```
repomesh/
  profiles/                   # Trust profiles (baseline, open-source, regulated)
  schemas/                    # Source of truth for all schemas
  ledger/                     # Append-only signed event log
    events/events.jsonl       # The ledger itself
    nodes/                    # Registered node manifests + profiles
    scripts/                  # Validation + verification tooling
  attestor/                   # Universal attestor (sbom, provenance, sig chain)
  verifiers/                  # Independent verifier nodes
    license/                  # License compliance scanner
    security/                 # Vulnerability scanner (OSV.dev)
  anchor/xrpl/               # XRPL anchoring (Merkle roots + testnet posting)
    manifests/                # Committed partition manifests (append-only)
    scripts/                  # compute-root, post-anchor, verify-anchor
  policy/                     # Network policy checks (semver, hash uniqueness)
  registry/                   # Network index (auto-generated from ledger)
    nodes.json                # All registered nodes
    trust.json                # Trust scores per release (integrity + assurance)
    anchors.json              # Anchor index (partitions + release anchoring)
    badges/                   # SVG trust badges per repo
    snippets/                 # Markdown verification snippets per repo
  pages/                      # Static site generator (GitHub Pages)
  docs/                       # Public verification docs
  tools/                      # Developer UX tools
    repomesh.mjs              # CLI entrypoint
  templates/                  # Workflow templates for joining
```

## Rejoindre manuellement (5 minutes)

### 1. Créez votre manifeste de nœud

Ajoutez `node.json` à la racine de votre référentiel :

```json
{
  "id": "your-org/your-repo",
  "kind": "compute",
  "description": "What your repo does",
  "provides": ["your.capability.v1"],
  "consumes": [],
  "interfaces": [
    { "name": "your-interface", "version": "v1", "schemaPath": "./schemas/your.v1.json" }
  ],
  "invariants": {
    "deterministicBuild": true,
    "signedReleases": true,
    "semver": true,
    "changelog": true
  },
  "maintainers": [
    { "name": "your-name", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Générez une paire de clés de signature

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Placez la clé publique au format PEM dans la section "maintainers" de votre `node.json`.
Stockez la clé privée en tant que secret du référentiel GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Enregistrez-vous auprès du réseau

Ouvrez une demande de tirage (PR) vers ce référentiel en ajoutant votre manifeste de nœud :

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Ajoutez le flux de diffusion

Copiez `templates/repomesh-broadcast.yml` dans le dossier `.github/workflows/` de votre référentiel.
Définissez le secret `REPOMESH_LEDGER_TOKEN` (un jeton PAT avec les autorisations `contents:write` et `pull-requests:write` pour ce référentiel).

Chaque version diffusera désormais automatiquement un événement signé `ReleasePublished` vers le registre.

## Règles du registre

- **Uniquement ajoutable** : les lignes existantes sont immuables.
- **Conforme au schéma** : chaque événement est validé par rapport à `schemas/event.schema.json`.
- **Signature valide** : chaque événement est signé par un mainteneur de nœud enregistré.
- **Unique** : pas d'entrées dupliquées `(référentiel, version, type)`.
- **Horodatage cohérent** : pas plus d'une heure dans le futur ou un an dans le passé.

## Types d'événements

| Type | Quand |
|------|------|
| `ReleasePublished` | Une nouvelle version est publiée. |
| `AttestationPublished` | Un vérificateur atteste d'une version. |
| `BreakingChangeDetected` | Une modification incompatible est introduite. |
| `HealthCheckFailed` | Un nœud échoue à ses propres vérifications de santé. |
| `DependencyVulnFound` | Une vulnérabilité est détectée dans les dépendances. |
| `InterfaceUpdated` | Un schéma d'interface change. |
| `PolicyViolation` | Une politique réseau est violée. |

## Types de nœuds

| Type | Rôle |
|------|------|
| `registry` | Indexe les nœuds et les capacités. |
| `attestor` | Vérifie les affirmations (construction, conformité). |
| `policy` | Applique les règles (notation, contrôle). |
| `oracle` | Fournit des données externes. |
| `compute` | Effectue des tâches (transformations, constructions). |
| `settlement` | Finalise l'état. |
| `governance` | Prend des décisions. |
| `identity` | Émet/vérifie les identifiants. |

## Vérification publique

N'importe qui peut vérifier une version avec une seule commande :

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Cela vérifie :
1. L'événement de publication existe et la signature est valide (Ed25519).
2. Toutes les attestations sont présentes et signées (SBOM, provenance, licence, sécurité).
3. La publication est incluse dans une partition Merkle ancrée à XRPL.

Pour les contrôles CI, utilisez `--json` :

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

Consultez [docs/verification.md](docs/verification.md) pour le guide de vérification complet, le modèle de menace et les concepts clés.

### Badges de confiance

Les dépôts peuvent intégrer des badges de confiance provenant du registre :

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiance et vérification

### Vérifier une version

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attester une version

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Vérifications : `sbom.present`, `provenance.present`, `signature.chain`.

### Exécuter les vérificateurs

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### Exécuter les contrôles de conformité

```bash
node policy/scripts/check-policy.mjs
```

Vérifications : monotonicité de la version sémantique, unicité du hachage des artefacts, capacités requises.

## Licence

MIT.

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>.
