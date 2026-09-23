<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.md">English</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Réseau de dépôts syntropique : registre en ajout uniquement, manifestes de nœuds et évaluation pour la coordination distribuée des dépôts.

## Qu'est-ce que c'est ?

RepoMesh transforme un ensemble de dépôts en un réseau coopératif. Chaque dépôt est un **nœud** avec :

- Un **manifeste** (`node.json`) qui déclare ce qu'il fournit et consomme
- Des **événements signés** diffusés vers un registre en ajout uniquement
- Un **registre** qui indexe tous les nœuds et leurs capacités
- Un **profil** qui définit ce que signifie « terminé » pour la confiance

Aujourd'hui, une organisation GitHub, mcp-tool-shop-org, gère le journal, les attestations, la vérification des politiques et l'ancre XRPL. Six nœuds enregistrés ne font pas six opérateurs. Un témoin indépendant serait une partie que cette organisation ne gère pas.

Le réseau applique trois invariants :

1. **Résultats déterministes** : mêmes entrées, mêmes artefacts
2. **Provenance vérifiable** : chaque version est signée et attestée
3. **Contrats composables** : les interfaces sont versionnées et lisibles par machine

## Démarrage rapide (1 commande + 2 secrets)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Cela génère tout ce dont vous avez besoin :
- `node.json` : votre manifeste de nœud
- `repomesh.profile.json` : votre profil choisi
- `.github/workflows/repomesh-broadcast.yml` : flux de travail de diffusion des versions
- Paire de clés de signature Ed25519 (la clé privée reste locale)

Ajoutez ensuite deux secrets à votre dépôt :
1. `REPOMESH_SIGNING_KEY` : votre clé privée au format PEM (affichée par init)
2. `REPOMESH_LEDGER_TOKEN` : PAT GitHub avec `contents:write` + `pull-requests:write` sur ce dépôt

Publiez une version. La confiance converge automatiquement.

### Options de ligne de commande

Toutes les commandes acceptent : `--quiet`, `--verbose`, `--debug`, `--no-color`. La commande `init` prend également en charge `--json` pour une sortie lisible par machine.

Les complétions de shell sont disponibles :

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Remplacements d'environnement

| Variable | Objectif |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Remplacer le point de terminaison du registre |
| `REPOMESH_MANIFESTS_URL` | Remplacer le point de terminaison des manifestes |
| `REPOMESH_FETCH_TIMEOUT` | Délai d'attente en ms |

### Profils

| Profil | Preuve | Vérifications d'assurance | Utiliser quand |
|---------|----------|-----------------|----------|
| `baseline` | Facultatif | Aucun requis | Outils internes, expériences |
| `open-source` | SBOM + provenance | Audit de licence + analyse de sécurité | Valeur par défaut pour OSS |
| `regulated` | SBOM + provenance | Licence + sécurité + reproductibilité | Essentiel pour la conformité |

### Vérifier la confiance

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Affiche le score d'intégrité, le score d'assurance et les recommandations tenant compte du profil.

### Remplacements

Personnalisation par dépôt sans forker les vérificateurs :

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
  verifiers/                  # Independent verifier nodes, operated by the same organization today
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

## Adhésion manuelle (5 minutes)

### 1. Créez votre manifeste de nœud

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` affiche la clé publique + un `keyId` prêt à être ajouté à l'entrée de vos `node.json` mainteneurs, et
écrit la clé privée (mode 0600) uniquement à l'endroit que vous indiquez avec `--out` — jamais dans un chemin suivi. Stockez-la comme un
secret de dépôt GitHub (`REPOMESH_SIGNING_KEY`). (Équivalent manuellement : `openssl genpkey -algorithm ED25519 ...`.)

> **Enregistrez ≥2 clés pour un nœud essentiel pour la confiance** (TUF §6.1) : une seule clé ne peut pas signer sa propre
> révocation en cas de compromission. `repomesh init --second-key` enregistre un deuxième mainteneur distinct afin qu'une
> clé puisse révoquer l'autre — `init` avertit lorsqu'un nœud n'a qu'une seule clé active.

### 3. Enregistrez-vous auprès du réseau

Ouvrez une PR vers ce dépôt en y ajoutant votre manifeste de nœud :

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Ajoutez le flux de travail de diffusion

Copiez `templates/repomesh-broadcast.yml` dans le `.github/workflows/` de votre dépôt.
Définissez le secret `REPOMESH_LEDGER_TOKEN` (un PAT précis avec les autorisations suivantes : contents:write + pull-requests:write sur ce dépôt).

Chaque version diffusera désormais automatiquement un événement `ReleasePublished` signé vers le registre.

## Règles du registre

- **Ajout uniquement** : les lignes existantes sont immuables
- **Valide par rapport au schéma** : chaque événement est validé par rapport à `schemas/event.schema.json`
- **Signature valide** : chaque événement est signé par un mainteneur de nœud enregistré
- **Unique** : pas d'entrées `(repo, version, type)` en double
- **Horodatage correct** : pas plus d'une heure dans le futur ou d'un an dans le passé

## Types d'événements

Le registre émet actuellement les types d'événements **actifs** ci-dessous. Le reste sont **réservés / prévus** — le
schéma les accepte, mais aucun nœud ne les émet encore. Nous les listons afin que la feuille de route soit visible sans
impliquer une couverture qui n'existe pas (honnêteté de façade pour un produit de confiance).

**Actifs (émis aujourd'hui) :**

| Type | Quand |
|------|------|
| `ReleasePublished` | Une nouvelle version est publiée |
| `AttestationPublished` | Un attestateur vérifie une version |
| `ledger.anchor` | Le nœud d'ancre scelle une partition (racine Merkle + mémorandum XRPL) |
| `attestation.dispute` | Un nœud de confiance conteste une attestation (rétrograde le verdict) |
| `KeyRotation` | Une clé de mainteneur est tournée vers un successeur (prospectif — les signatures passées restent valides) |
| `KeyRevocation` | Une clé de mainteneur est révoquée (compromission = invalidité rétroactive, RFC 5280) |

**Réservés / prévus (pas encore émis) :**

| Type | Signification prévue |
|------|------------------|
| `BreakingChangeDetected` | Un changement incompatible est introduit |
| `HealthCheckFailed` | Un nœud échoue à ses propres vérifications de santé |
| `DependencyVulnFound` | Une vulnérabilité est détectée dans les dépendances |
| `InterfaceUpdated` | Un schéma d'interface change |
| `PolicyViolation` | Une politique de réseau est violée |

## Rotation et révocation des clés

Les clés de mainteneur ont un cycle de vie. Une clé peut être **tournée** vers un successeur ou **révoquée**, et
la vérification est **consciente du temps** : une signature est approuvée uniquement si la clé était valide au moment de la signature — le temps de clôture XRPL, la même horloge de confiance que le registre utilise déjà.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotation régulière** est *prospective* : les signatures antérieures de la clé retirée restent valides ; elle cesse simplement de signer les nouvelles versions.
- La **compromission** est *rétroactive* (RFC 5280 §5.3.2) : toute signature dont la date d'ancrage vérifiable est antérieure ou égale à la date d'invalidation est rejetée, et une signature dont il ne peut être prouvé qu'elle est antérieure à cette date est également rejetée.
- Une clé qui ne contient **aucun** champ de cycle de vie est considérée comme existante (toujours valide), de sorte que les nœuds existants effectuent une vérification sans modification.
- Les révocations sont des événements signés `KeyRevocation` ; un nœud à clé unique dont la seule clé est compromise est restauré par un nœud de **gouvernance** (`trustedPolicy`) qui signe la révocation. Les nœuds critiques pour la confiance doivent enregistrer **≥2 clés** (TUF §6.1).
- Même en cas de falsification `node.json`, une révocation est réappliquée à partir des événements signés et ancrés sur XRPL : un manifeste tronqué ne peut pas réactiver une clé révoquée. Voir le [modèle de menace](docs/threat-model.md) pour connaître les limites (vérifier par rapport au registre canonique ; utiliser `--anchored` pour les vérifications sensibles aux révocations).

## Types de nœuds

| Type | Rôle |
|------|------|
| `registry` | Indexe les nœuds et leurs capacités |
| `attestor` | Vérifie les revendications (versions, conformité) |
| `policy` | Applique les règles (notation, filtrage) |
| `oracle` | Fournit des données externes |
| `compute` | Effectue des tâches (transformations, constructions) |
| `settlement` | Finalise l'état |
| `governance` | Prend des décisions |
| `identity` | Émet/vérifie les informations d'identification |

## Extension du réseau : le contrat du plugin de vérification

De nouveaux **types de vérifications** et de **nœuds de vérification** sont ajoutés en modifiant les données, et non le code. Le registre des types de vérifications, les pondérations de notation et les autorisations des types de nœuds sont stockés dans
[`verifier.policy.json`](verifier.policy.json) (validé par un schéma, en cas d'échec, le système se ferme). L'ajout d'une vérification (par exemple, `sast.scan`) consiste en une modification de politique d'environ 6 lignes + un `node.json`, qui est examinée dans une demande de fusion (PR) ; aucune modification du code n'est nécessaire.

La seule règle invariable : **enregistré ≠ approuvé**. L'enregistrement permet à une vérification de participer ; l'approbation nécessite toujours un consensus de l'ensemble approuvé. Guide complet :
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Vérification publique

N'importe qui peut vérifier une version avec une seule commande ; **aucun clonage n'est requis**, l'interface de ligne de commande (CLI) récupère le registre public pour vous :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Cette opération vérifie :
1. L'événement `ReleasePublished` existe et est signé (Ed25519) par une clé enregistrée pour le **dépôt** `node.json` en question : une clé enregistrée pour un dépôt différent ne peut pas la valider.
2. Le profil de confiance du dépôt est satisfait : chaque attestation requise par le profil (SBOM, provenance, licence, sécurité) est présente, signée par un attestataire approuvé, et son dernier résultat est `pass`, avec au moins un attestataire **indépendant**. Une version contenant uniquement une auto-signature et aucune attestation indépendante signale `UNVERIFIED`, et jamais `PASS`.
3. Avec `--anchored` : la racine de Merkle de la partition est recalculée et comparée au manifeste, et — lorsque le réseau est accessible — la transaction XRPL en chaîne est récupérée et validée (`validated` + `tesSUCCESS`, le compte de signature figure dans la liste blanche des ancres approuvées, et le mémo en chaîne est lié à la racine/au hachage du manifeste/au nombre local). Hors ligne, elle signale `XRPL NOT verified` au lieu d'une transaction falsifiée ; une vérification stricte `--anchored` échoue alors (utilisez `--anchored-or-local` pour accepter un manifeste vérifié localement sans la preuve en chaîne).

Pour les validations CI, choisissez un format de sortie avec `--format <text|json|sarif|markdown>` (`--json` est un alias pour `--format json`) :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Le **code de sortie** est dérivé du verdict à trois états, de sorte qu'une étape CI peut le prendre en compte directement :

| Sortie | Verdict | Signification |
|------|---------|---------|
| `0` | PASS | Authentique et assuré (ou NON VÉRIFIÉ lorsque cela est autorisé par `--fail-on=fail`). |
| `1` | FAIL | Échec critique : signature falsifiée/provenant d'un mauvais dépôt, attestataire non autorisé ou une vérification requise a échoué. |
| `3` | UNVERIFIED | Échec mineur : pas encore ancré, pas de témoin indépendant ou une vérification requise manquante. |
| `2` | — | Erreur d'utilisation ou plantage interne. |

### Conteneur

La même CLI est publiée sous forme de `ghcr.io/mcp-tool-shop-org/repomesh`, avec la version npm et le hachage Git. L'image s'exécute en tant qu'utilisateur non root. Elle ne contient pas de clé de portefeuille.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

La publication d'une ancre est une commande distincte. `XRPL_SEED` est transmis au moment de l'exécution :

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

Le flux de travail quotidien crée cette image à partir de la copie et la publie. Le réseau dans `anchor/xrpl/config.json` est toujours le testnet. Une publication sur le réseau principal attend un compte financé dont l'adresse classique est ajoutée à la liste blanche fournie dans une version de la CLI. Cette liste blanche est un plafond : une configuration récupérée peut supprimer un compte, mais ne peut pas en ajouter un.

`--fail-on <fail\|unverified>` définit le niveau de rigueur. Par défaut, `unverified` échoue à la fois sur FAIL et sur UNVERIFIED ; `--fail-on=fail` permet à UNVERIFIED de passer (code de sortie 0, avec un avertissement) pour une adoption en mode avertissement.

Vérifiez un ensemble complet en une seule opération de chargement du registre avec `verify-all`, et vérifiez hors ligne par rapport à un clone local avec `--local` :

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Intégrez-le dans CI** avec l'action composite fournie : voir
[Utilisation de l'action GitHub](docs/verification.md#using-the-github-action) :

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Voir [docs/verification.md](docs/verification.md) pour le guide de vérification complet, le modèle de menace et les concepts clés.

### Utilisez-le comme une bibliothèque

Le moteur de vérification est exporté sous forme d'une API programmatique stable : intégrez-le dans vos propres outils au lieu d'exécuter des commandes via la CLI :

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Point de terminaison de l'état du réseau

Le tableau de bord publie un [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) lisible par machine pour une interrogation externe : fraîcheur du registre (avec un signal de registre gelé), nombre de verdicts de confiance, partitions ancrées par rapport aux partitions en attente, et un résumé `ok`/`degraded` avec les raisons.

### Badges de confiance

Les dépôts peuvent intégrer des badges de confiance du registre :

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiance et vérification

### Vérifier une version

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attester une version

> L’attestation et l’exécution des vérificateurs sont des tâches **d’opérateur** qui agissent sur une copie de ce registre, elles sont donc exécutées à partir d’une copie de travail. La vérification d’une version ne nécessite pas l’utilisation de la commande `npx` ci-dessus.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Vérifications : `sbom.present`, `provenance.present`, `signature.chain`

### Exécuter les vérificateurs

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Les seuils de vérification de sécurité (nombre maximal de CVE, niveaux de gravité autorisés) sont configurés via `verifiers/security/config.json`.

### Exécuter les vérifications de conformité

```bash
node policy/scripts/check-policy.mjs
```

Vérifications : monotonicité semver, unicité du hachage des artefacts, capacités requises.

## Sécurité et modèle de menace

RepoMesh interagit avec les **événements du registre** (JSON signé), les **manifestes de nœud** (clés publiques + capacités), les **index du registre** (scores de confiance générés automatiquement) et le **testnet XRPL** (transactions d’ancrage). Il n’interagit **pas** avec le code source du référentiel des membres, les clés privées, les informations d’identification des utilisateurs ou les données de navigation. Les clés de signature privées ne quittent jamais l’environnement d’exécution CI. L’accès au réseau est limité à l’API GitHub (création de PR), au testnet XRPL (ancrage) et à OSV.dev (recherche de vulnérabilités). **Aucune télémétrie** n’est collectée ni envoyée : pas d’analyse, pas de rapports d’erreurs, pas de communication vers un serveur distant. Consultez [SECURITY.md](SECURITY.md) pour connaître la portée complète, les autorisations requises et le processus de signalement des vulnérabilités, ainsi que le [modèle de menace](docs/threat-model.md) pour connaître la limite de confiance du cycle de vie des clés (pourquoi l’authenticité de `node.json` dépend de sa source et pourquoi la vérification sensible à la révocation doit utiliser `--anchored`).

Renforcement de la sécurité :

- Les appels de sous-processus qui interpolent des données variables utilisent `execFileSync` avec des arguments de tableau ; les appels `execSync` restants utilisent des chaînes de commandes statiques et constantes, ce qui évite les vecteurs d’injection de code shell.
- Le JSON du registre et du registre est analysé dans `try`/`catch` avec des erreurs structurées et numérotées ; une ligne malformée est ignorée et signalée, ce qui évite que l’outil ne plante avec une pile d’erreurs brute.
- Le parcours de fichiers est empêché dans toutes les opérations sur les fichiers (résolution + vérification des limites).
- Analyse sécurisée contre ReDoS dans tous les cas (pas d’expressions régulières non bornées).
- Les clés privées PEM sont exclues via `.gitignore`, ne sont jamais imprimées dans stdout ou les journaux CI, et sont écrites avec des autorisations réservées au propriétaire (`0600`).

## Tests

L’ensemble complet de tests `node --test` couvre les signatures Ed25519, la validation du schéma, l’intégrité de l’arbre de Merkle (v1 + RFC-6962 v2), les invariants d’ajout uniquement, la prévention du parcours de fichiers, la vérification de l’ancrage, la liste d’autorisation des vérificateurs de confiance et la validation des entrées dans les couches CLI, registre, ancrage, vérificateur et outils.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Le nombre de tests augmente à mesure que de nouveaux ensembles de tests sont ajoutés ; exécutez la commande ci-dessus pour obtenir le nombre total actuel au lieu de vous fier à un nombre qui devient obsolète.

## Licence

MIT

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
