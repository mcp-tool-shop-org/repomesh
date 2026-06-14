<p align="center">
  <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
</p>

<p align="center">
  <img src="https://raw.githubusercontent.com/mcp-tool-shop-org/brand/main/logos/repomesh/readme.png" width="500" alt="RepoMesh">
</p>

<p align="center">
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/ledger-ci.yml/badge.svg" alt="Ledger CI"></a>
  <a href="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml"><img src="https://github.com/mcp-tool-shop-org/repomesh/actions/workflows/registry-ci.yml/badge.svg" alt="Registry CI"></a>
  <a href="https://www.npmjs.com/package/@mcptoolshop/repomesh"><img src="https://img.shields.io/npm/v/@mcptoolshop/repomesh" alt="npm version"></a>
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT License"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Trust_Index-live-blue" alt="Trust Index"></a>
  <a href="https://mcp-tool-shop-org.github.io/repomesh/"><img src="https://img.shields.io/badge/Landing_Page-live-blue" alt="Landing Page"></a>
</p>

Réseau de dépôts syntropique — registre à ajout uniquement, manifests de nœud et notation pour la coordination de dépôts distribués.

## Qu'est-ce que c'est ?

RepoMesh transforme une collection de dépôts en un réseau coopératif. Chaque dépôt est un **nœud** avec :

- Un **manifeste** (`node.json`) déclarant ce qu'il fournit et consomme
- Des **événements signés** diffusés sur un registre à ajout uniquement
- Un **registre** indexant tous les nœuds et capacités
- Un **profil** définissant ce que "terminé" signifie pour la confiance

Le réseau applique trois invariants :

1. **Sorties déterministes** — mêmes entrées, mêmes artefacts
2. **Provenance vérifiable** — chaque version est signée et attestée
3. **Contrats composables** — les interfaces sont versionnées et lisibles par machine

## Démarrage rapide (1 commande + 2 secrets)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Ceci génère tout ce dont vous avez besoin :
- `node.json` — votre manifeste de nœud
- `repomesh.profile.json` — votre profil choisi
- `.github/workflows/repomesh-broadcast.yml` — workflow de diffusion de version
- Paire de clés de signature Ed25519 (la clé privée reste locale)

Ensuite, ajoutez deux secrets à votre dépôt :
1. `REPOMESH_SIGNING_KEY` — votre clé privée PEM (affichée par init)
2. `REPOMESH_LEDGER_TOKEN` — jeton d'accès personnel (PAT) GitHub avec les permissions `contents:write` + `pull-requests:write` sur ce dépôt

Créez une version. La confiance converge automatiquement.

### Options de la ligne de commande

Toutes les commandes acceptent : `--quiet`, `--verbose`, `--debug`, `--no-color`. La commande `init` prend également en charge `--json` pour une sortie lisible par machine.

Les complétions pour le shell sont disponibles :

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Substitutions d'environnement

| Variable | Objectif |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Remplacer le point de terminaison du registre |
| `REPOMESH_MANIFESTS_URL` | Remplacer le point de terminaison des manifests |
| `REPOMESH_FETCH_TIMEOUT` | Délai d'attente de récupération en ms |

### Profils

| Profil | Preuves | Contrôles d'assurance | À utiliser quand |
|---------|----------|-----------------|----------|
| `baseline` | Optionnel | Aucune requise | Outils internes, expérimentations |
| `open-source` | SBOM + provenance | Audit de licence + analyse de sécurité | Par défaut pour les logiciels open source |
| `regulated` | SBOM + provenance | Licence + sécurité + reproductibilité | Critique pour la conformité |

### Vérifier la confiance

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Affiche le score d'intégrité, le score d'assurance, et des recommandations adaptées au profil.

### Surcharges

Personnalisation par dépôt sans avoir à forker les vérificateurs :

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Structure du dépôt

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

## Intégration manuelle (5 minutes)

### 1. Créez le manifeste de votre nœud

Ajoutez `node.json` à la racine de votre dépôt :

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

Placez la clé publique PEM dans l'entrée `maintainers` de votre `node.json`.
Stockez la clé privée en tant que secret de dépôt GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Enregistrez-vous au réseau

Ouvrez une Pull Request (PR) sur ce dépôt pour y ajouter le manifeste de votre nœud :

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Ajoutez le workflow de diffusion

Copiez `templates/repomesh-broadcast.yml` dans le répertoire `.github/workflows/` de votre dépôt.
Définissez le secret `REPOMESH_LEDGER_TOKEN` (un PAT à accès granulaire avec les permissions `contents:write` + `pull-requests:write` sur ce dépôt).

Chaque version diffusera désormais automatiquement un événement `ReleasePublished` signé sur le registre.

## Règles du registre

- **Ajout uniquement** — les lignes existantes sont immuables
- **Valide selon le schéma** — chaque événement est validé par rapport à `schemas/event.schema.json`
- **Signature valide** — chaque événement est signé par un responsable de nœud enregistré
- **Unique** — aucune entrée en double `(repo, version, type)`
- **Horodatage cohérent** — pas plus d'une heure dans le futur ou d'un an dans le passé

## Types d'événements

Le registre émet actuellement les types d'événements **actifs** ci-dessous. Les autres sont **réservés / planifiés** — le schéma les accepte, mais aucun nœud ne les émet encore. Nous les listons afin que la feuille de route soit visible sans impliquer une couverture qui n'existe pas (transparence pour un produit de confiance).

**Actifs (émis aujourd'hui) :**

| Type | Quand |
|------|------|
| `ReleasePublished` | Une nouvelle version est publiée |
| `AttestationPublished` | Un attestateur vérifie une publication |
| `ledger.anchor` | Le nœud d'ancrage scelle une partition (racine de Merkle + mémo XRPL) |
| `attestation.dispute` | Un nœud de confiance conteste une attestation (abaisse le verdict) |

**Réservés / planifiés (non encore émis) :**

| Type | Signification prévue |
|------|------------------|
| `BreakingChangeDetected` | Une rupture de compatibilité est introduite |
| `HealthCheckFailed` | Un nœud échoue à ses propres vérifications d'état |
| `DependencyVulnFound` | Une vulnérabilité est trouvée dans les dépendances |
| `InterfaceUpdated` | Un schéma d'interface change |
| `PolicyViolation` | Une stratégie réseau est violée |

## Types de nœuds

| Type | Rôle |
|------|------|
| `registry` | Indexe les nœuds et les capacités |
| `attestor` | Vérifie les assertions (builds, conformité) |
| `policy` | Applique les règles (scoring, filtrage) |
| `oracle` | Fournit des données externes |
| `compute` | Effectue le travail (transformations, builds) |
| `settlement` | Finalise l'état |
| `governance` | Prend les décisions |
| `identity` | Émet/vérifie les informations d'identification |

## Vérification publique

N'importe qui peut vérifier une publication avec une seule commande — **aucun clonage requis**, l'interface de ligne de commande récupère le registre public pour vous :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Ceci vérifie :
1. L'événement `ReleasePublished` existe et est signé (Ed25519) par une clé enregistrée dans le `node.json` **propre à ce dépôt** — une clé enregistrée dans un dépôt différent ne peut pas le valider.
2. Le profil de confiance du dépôt est satisfait : chaque attestation requise par le profil (SBOM, provenance, licence, sécurité) est présente, signée par un attestateur de confiance, et son dernier résultat est `pass` (succès), avec au moins un attestateur **indépendant**. Une publication avec uniquement une auto-signature et aucune attestation indépendante est signalée comme `UNVERIFIED` (non vérifiée), jamais `PASS` (succès).
3. Avec `--anchored` : la racine de Merkle de la partition est recalculée et correspond au manifeste, et — lorsque le réseau est accessible — la transaction XRPL on-chain est récupérée et vérifiée (`validated` + `tesSUCCESS`, le compte signataire est dans la liste d'autorisation des ancres de confiance, et le mémo on-chain est lié à la racine locale / au hachage du manifeste / au nombre). Hors ligne, il signale `XRPL NOT verified` (XRPL non vérifiée) plutôt qu'une fausse transaction ; le mode strict `--anchored` échoue alors (utilisez `--anchored-or-local` pour accepter un manifeste vérifié localement sans la preuve on-chain).

Pour les portails CI, choisissez un format de sortie avec `--format <text|json|sarif|markdown>` (`--json` est un alias pour `--format json`) :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Le **code de sortie** est dérivé du verdict à trois états, une étape CI peut donc l'utiliser directement comme porte :

| Code de sortie | Verdict | Signification |
|------|---------|---------|
| `0` | PASS | Authentique et garanti (ou UNVERIFIED si assoupli par `--fail-on=fail`). |
| `1` | FAIL | Échec critique — signature falsifiée/provenant d'un mauvais dépôt, attestateur non autorisé, ou une vérification requise a échoué. |
| `3` | UNVERIFIED | Doux — non encore ancré, aucun témoin indépendant, ou une vérification requise manquante. |
| `2` | — | Erreur d'utilisation ou plantage interne. |

`--fail-on <fail\|unverified>` définit le niveau de rigueur. Par défaut, `unverified` échoue pour FAIL et UNVERIFIED ; `--fail-on=fail` laisse passer UNVERIFIED (code de sortie 0, avec un avertissement) pour une adoption (du produit) en mode avertissement.

Vérifiez un lot entier en un seul chargement du registre avec `verify-all`, et vérifiez hors ligne sur un clone local avec `--local` :

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Intégrez-le dans un portail CI** avec l'action composite fournie — voir [Utilisation de l'action GitHub](docs/verification.md#using-the-github-action) :

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Voir [docs/verification.md](docs/verification.md) pour le guide de vérification complet, le modèle de menace et les concepts clés.

### Badges de confiance

Les dépôts peuvent intégrer des badges de confiance du registre :

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiance et Vérification

### Vérifier une version

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attester une version

> L'attestation et l'exécution des vérificateurs sont des tâches d'**opérateur** qui agissent sur un clone de ce registre, elles s'exécutent donc à partir d'un checkout. La vérification d'une version ne le fait pas — utilisez la commande `npx` ci-dessus.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Vérifications : `sbom.present`, `provenance.present`, `signature.chain`

### Exécuter les vérificateurs

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Les seuils du vérificateur de sécurité (CVEs max, sévérités autorisées) sont pilotés par configuration via `verifiers/security/config.json`.

### Exécuter les vérifications de politique

```bash
node policy/scripts/check-policy.mjs
```

Vérifications : monotonie semver, unicité du hachage d'artefact, capacités requises.

## Sécurité et Modèle de Menace

RepoMesh touche les **événements du registre** (JSON signé), les **manifestes de nœud** (clés publiques + capacités), les **index du registre** (scores de confiance auto-générés) et le **testnet XRPL** (transactions d'ancrage). Il ne touche **pas** le code source des dépôts membres, les clés privées, les identifiants utilisateur ou les données de navigation. Les clés de signature privées ne quittent jamais le runner CI. L'accès réseau est limité à l'API GitHub (création de PR), au testnet XRPL (ancrage) et à OSV.dev (recherches de vulnérabilités). **Aucune télémétrie** n'est collectée ou envoyée — zéro analytique, zéro rapport de plantage, zéro retour à la maison. Voir [SECURITY.md](SECURITY.md) pour l'étendue complète, les permissions requises et le processus de signalement de vulnérabilités.

Durcissement :

- Les appels de processus enfant qui interpolent des données variables utilisent `execFileSync` avec des arguments de tableau ; les appels `execSync` restants utilisent des chaînes de commande statiques et constantes — aucun vecteur d'injection de shell.
- Le JSON du registre et du registre est analysé à l'intérieur de `try`/`catch` avec des erreurs structurées et numérotées par ligne ; une ligne malformée est ignorée et signalée, ne plante jamais l'outil avec une pile brute.
- La traversée de chemin est empêchée sur toutes les opérations de fichier (résolution + vérification de limite).
- Analyse sécurisée contre les ReDoS tout au long (pas de regex non borné).
- Les clés privées PEM sont exclues via `.gitignore`, jamais imprimées sur stdout ou les logs CI, et écrites avec des permissions propriétaire uniquement (`0600`).

## Tests

La suite complète `node --test` couvre les signatures Ed25519, la validation de schéma, l'intégrité de l'arbre de Merkle (v1 + RFC-6962 v2), les invariants d'ajout uniquement, la prévention de traversée de chemin, la vérification d'ancrage, la liste d'autorisation des attestateurs de confiance, et la validation d'entrée à travers les couches CLI, registre, ancre, vérificateur et outils.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Le nombre de tests augmente à mesure que des suites sont ajoutées — exécutez la commande ci-dessus pour le total actuel plutôt que de vous fier à un nombre qui devient obsolète.

## Licence

MIT

---

Développé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
