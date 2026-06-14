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

Réseau de référentiels syntropiques : registre en ajout uniquement, manifestes des nœuds et évaluation pour la coordination distribuée des référentiels.

## Qu'est-ce que c'est ?

RepoMesh transforme un ensemble de référentiels en un réseau coopératif. Chaque référentiel est un **nœud** avec :

- Un **manifeste** (`node.json`) qui déclare ce qu'il fournit et consomme
- Des **événements signés** diffusés vers un registre en ajout uniquement
- Un **registre** indexant tous les nœuds et leurs capacités
- Un **profil** définissant ce que signifie « terminé » pour la confiance

Le réseau applique trois invariants :

1. **Résultats déterministes** — mêmes entrées, mêmes artefacts
2. **Provenance vérifiable** — chaque version est signée et attestée
3. **Contrats composables** — les interfaces sont versionnées et lisibles par machine

## Démarrage rapide (1 commande + 2 secrets)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Cela génère tout ce dont vous avez besoin :
- `node.json` — votre manifeste de nœud
- `repomesh.profile.json` — votre profil choisi
- `.github/workflows/repomesh-broadcast.yml` — flux de travail de diffusion des versions
- Paire de clés de signature Ed25519 (la clé privée reste locale)

Ajoutez ensuite deux secrets à votre référentiel :
1. `REPOMESH_SIGNING_KEY` — votre clé privée au format PEM (affichée par la commande init)
2. `REPOMESH_LEDGER_TOKEN` — jeton PAT GitHub avec les autorisations `contents:write` et `pull-requests:write` sur ce référentiel

Publiez une version. La confiance converge automatiquement.

### Options de ligne de commande

Toutes les commandes acceptent : `--quiet`, `--verbose`, `--debug`, `--no-color`. La commande `init` prend également en charge l’option `--json` pour une sortie lisible par machine.

La complétion des commandes est disponible :

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Remplacements d’environnement

| Variable | Objectif |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Remplacer le point de terminaison du registre |
| `REPOMESH_MANIFESTS_URL` | Remplacer le point de terminaison des manifestes |
| `REPOMESH_FETCH_TIMEOUT` | Délai d’attente en ms |

### Profils

| Profil | Preuve | Vérifications d’assurance | Utilisation |
|---------|----------|-----------------|----------|
| `baseline` | Facultatif | Aucun requis | Outils internes, expériences |
| `open-source` | SBOM + provenance | Audit de licence + analyse de sécurité | Valeur par défaut pour OSS |
| `regulated` | SBOM + provenance | Licence + sécurité + reproductibilité | Essentiel pour la conformité |

### Vérifier la confiance

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Affiche le score d’intégrité, le score d’assurance et les recommandations tenant compte du profil.

### Remplacements

Personnalisation par référentiel sans créer de branches des vérificateurs :

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

## Adhésion manuelle (5 minutes)

### 1. Créez votre manifeste de nœud

Ajoutez `node.json` à la racine de votre référentiel :

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

Placez la clé publique au format PEM dans l’entrée « maintainers » de votre fichier `node.json`.
Stockez la clé privée en tant que secret du référentiel GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Enregistrez-vous auprès du réseau

Ouvrez une demande de tirage (PR) vers ce référentiel, en y ajoutant votre manifeste de nœud :

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Ajoutez le flux de travail de diffusion

Copiez `templates/repomesh-broadcast.yml` dans le dossier `.github/workflows/` de votre référentiel.
Définissez le secret `REPOMESH_LEDGER_TOKEN` (un jeton PAT précis avec les autorisations `contents:write` et `pull-requests:write` sur ce référentiel).

Chaque version diffusera désormais automatiquement un événement `ReleasePublished` signé vers le registre.

## Règles du registre

- **Ajout uniquement** — les lignes existantes sont immuables
- **Schéma valide** — chaque événement est validé par rapport à `schemas/event.schema.json`
- **Signature valide** — chaque événement est signé par un mainteneur de nœud enregistré
- **Unique** — aucune entrée en double `(référentiel, version, type)`
- **Horodatage correct** — pas plus d’une heure dans le futur ou d’un an dans le passé

## Types d’événements

Le registre émet actuellement les types d’événements « actifs » ci-dessous. Le reste sont « réservés / prévus » — le schéma les accepte, mais aucun nœud ne les émet encore. Nous les listons afin que la feuille de route soit visible sans impliquer une couverture qui n’existe pas (honnêteté en façade pour un produit de confiance).

**Actifs (émis aujourd’hui) :**

| Type | Quand |
|------|------|
| `ReleasePublished` | Une nouvelle version est publiée |
| `AttestationPublished` | Un attestataire vérifie une version |
| `ledger.anchor` | Le nœud d’ancrage scelle une partition (racine Merkle + mémorandum XRPL) |
| `attestation.dispute` | Un nœud de confiance conteste une attestation (rétrograde le verdict) |
| `KeyRotation` | Une clé de mainteneur est transmise à un successeur (prospectif — les signatures passées restent valides) |
| `KeyRevocation` | Une clé de mainteneur est révoquée (compromission = invalidité rétroactive, RFC 5280) |

**Réservés / prévus (pas encore émis) :**

| Type | Signification prévue |
|------|------------------|
| `BreakingChangeDetected` | Une modification importante est introduite |
| `HealthCheckFailed` | Un nœud échoue à ses propres contrôles d’intégrité |
| `DependencyVulnFound` | Une vulnérabilité est détectée dans les dépendances |
| `InterfaceUpdated` | Un schéma d’interface change |
| `PolicyViolation` | Une politique de réseau est violée |

## Rotation et révocation des clés

Les clés des mainteneurs ont un cycle de vie. Une clé peut être **transmise** à un successeur ou **révoquée**, et la vérification tient compte du temps : une signature est considérée comme fiable uniquement si la clé était valide au moment de la signature — l’heure de fermeture de l’ancre XRPL, le même horloge de confiance que le registre utilise déjà.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotation régulière** est *prospective* : les anciennes signatures de la clé retirée restent valides ; elle cesse simplement de signer les nouvelles versions.
- Le **compromis** est *rétroactif* (RFC 5280 §5.3.2) : toute signature dont l’horodatage vérifiable est antérieur ou égal à la date d’invalidité est rejetée, et une signature dont il ne peut être prouvé qu’elle est antérieure à cette date est également rejetée.
- Une clé qui ne contient **aucun** champ de cycle de vie bénéficie d’une disposition transitoire (toujours valide), les nœuds existants vérifient donc sans modification.
- Les révocations sont signées via des événements `KeyRevocation` ; un nœud à clé unique dont la seule clé est compromise est restauré par un nœud de **gouvernance** (`trustedPolicy`) qui signe la révocation. Les nœuds critiques pour la confiance doivent enregistrer **au moins 2 clés** (TUF §6.1).
- Même en cas de falsification du fichier `node.json`, une révocation est réappliquée à partir des événements signés et ancrés sur XRPL ; un manifeste tronqué ne peut pas restaurer une clé révoquée. Voir le [modèle de menace](docs/threat-model.md) pour définir la limite (vérifier par rapport au registre canonique ; utiliser `--anchored` pour les vérifications sensibles à la révocation).

## Types de nœuds

| Type | Rôle |
|------|------|
| `registry` | Indexe les nœuds et leurs capacités |
| `attestor` | Vérifie les affirmations (versions, conformité) |
| `policy` | Applique les règles (notation, contrôle d’accès) |
| `oracle` | Fournit des données externes |
| `compute` | Effectue des tâches (transformations, constructions) |
| `settlement` | Finalise l’état |
| `governance` | Prend des décisions |
| `identity` | Émet/vérifie les informations d’identification |

## Vérification publique

N’importe qui peut vérifier une version avec une seule commande — **aucune copie n’est requise**, l’interface de ligne de commande récupère le registre public pour vous :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Cela vérifie :
1. L’événement `ReleasePublished` existe et est signé (Ed25519) par une clé enregistrée dans le fichier `node.json` **du dépôt en question** — une clé enregistrée dans un autre dépôt ne peut pas la valider.
2. Le profil de confiance du dépôt est satisfait : chaque attestation requise par le profil (SBOM, provenance, licence, sécurité) est présente, signée par un attesteur de confiance, et son dernier résultat est `pass`, avec au moins un attesteur **indépendant**. Une version qui ne contient qu’une auto-signature et aucune attestation indépendante affiche `NON VÉRIFIÉE`, jamais `PASS`.
3. Avec `--anchored` : la racine Merkle de la partition est recalculée et comparée au manifeste, et — lorsque le réseau est accessible — la transaction XRPL en chaîne est récupérée et validée (`validated` + `tesSUCCESS`, le compte signataire figure dans la liste blanche des ancres de confiance, et le mémo en chaîne est lié à la racine/au hachage du manifeste local/au nombre). Hors ligne, elle affiche `XRPL NON vérifié` plutôt qu’une transaction falsifiée ; `--anchored` strict échoue alors (utilisez `--anchored-or-local` pour accepter un manifeste vérifié localement sans preuve en chaîne).

Pour les contrôles CI, choisissez un format de sortie avec `--format <text|json|sarif|markdown>` (`--json` est un alias pour `--format json`) :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Le **code de retour** est dérivé du verdict à trois états, ce qui permet à une étape CI d’en tenir compte directement :

| Sortie | Verdict | Signification |
|------|---------|---------|
| `0` | PASS | Authentique et confirmé (ou NON VÉRIFIÉ lorsque cela est assoupli par `--fail-on=fail`). |
| `1` | FAIL | Échec critique — signature falsifiée/provenant d’un mauvais dépôt, attesteur non autorisé ou une vérification requise a échoué. |
| `3` | NON VÉRIFIÉ | Modéré — pas encore ancré, aucun témoin indépendant ou une vérification requise manquante. |
| `2` | — | Erreur d’utilisation ou plantage interne. |

`--fail-on <fail|unverified>` définit le niveau de rigueur. Par défaut, `unverified` échoue à la fois sur FAIL et NON VÉRIFIÉ ; `--fail-on=fail` permet à NON VÉRIFIÉ de passer (code de retour 0, avec un avertissement) pour une adoption en mode d’avertissement.

Vérifiez un ensemble complet en une seule fois en chargeant le registre avec `verify-all`, et vérifiez hors ligne par rapport à une copie locale avec `--local` :

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Intégrez-le dans CI** avec l’action composite fournie — voir [Utilisation de l’action GitHub](docs/verification.md#using-the-github-action) :

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Voir [docs/verification.md](docs/verification.md) pour le guide complet de vérification, le modèle de menace et les concepts clés.

### Badges de confiance

Les dépôts peuvent intégrer des badges de confiance du registre :

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

### Attester d’une version

> L’attestation et l’exécution des vérificateurs sont des tâches de l’**opérateur** qui agissent sur une copie de ce registre, elles s’exécutent donc à partir d’un point de contrôle. La vérification d’une version ne le fait pas — utilisez la commande `npx` ci-dessus.

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

Les seuils des vérificateurs de sécurité (nombre maximal de CVE, sévérités autorisées) sont configurés via `verifiers/security/config.json`.

### Exécuter les contrôles de stratégie

```bash
node policy/scripts/check-policy.mjs
```

Vérifications : monotonicité semver, unicité du hachage des artefacts, capacités requises.

## Sécurité et modèle de menace

RepoMesh interagit avec les **événements du registre** (JSON signés), les **manifestes des nœuds** (clés publiques + capacités), les **index du registre** (scores de confiance générés automatiquement) et le **testnet XRPL** (transactions d’ancrage). Il n’interagit **pas** avec le code source des dépôts membres, les clés privées, les informations d’identification des utilisateurs ou les données de navigation. Les clés de signature privées ne quittent jamais l’environnement d’exécution CI. L’accès au réseau est limité à l’API GitHub (création de PR), au testnet XRPL (ancrage) et à OSV.dev (recherche de vulnérabilités). **Aucune télémétrie** n’est collectée ou envoyée — aucune analyse, aucun rapport d’erreur, aucune communication vers le domicile. Voir [SECURITY.md](SECURITY.md) pour la portée complète, les autorisations requises et le processus de signalement des vulnérabilités, ainsi que le [modèle de menace](docs/threat-model.md) pour la limite du cycle de vie des clés (pourquoi l’authenticité de `node.json` dépend de sa source, et pourquoi la vérification sensible à la révocation doit utiliser `--anchored`).

Renforcement :

- Les appels de processus enfant qui interpolent des données variables utilisent `execFileSync` avec des arguments sous forme de tableau ; les autres appels à `execSync` utilisent des chaînes de commandes statiques et constantes, ce qui élimine tout risque d’injection de code via le shell.
- Le fichier JSON du grand livre et du registre est analysé dans un bloc `try`/`catch`, avec des messages d’erreur structurés et numérotés par ligne ; une ligne malformée est ignorée et signalée, ce qui évite que l’outil ne plante en affichant une trace d’exécution brute.
- La navigation dans les répertoires est bloquée pour toutes les opérations sur les fichiers (résolution + vérification des limites).
- L’analyse est sécurisée contre les attaques ReDoS (aucune expression régulière non bornée).
- Les clés privées PEM sont exclues via le fichier `.gitignore`, ne sont jamais affichées dans la sortie standard ou dans les journaux CI, et sont écrites avec des permissions limitées à l’utilisateur (`0600`).

## Tests / Essais

L’ensemble complet de tests `node --test` couvre les signatures Ed25519, la validation du schéma, l’intégrité de l’arbre de Merkle (v1 + RFC-6962 v2), les invariants d’ajout uniquement, la prévention des traversées de chemins, la vérification des ancres, la liste blanche des entités d’attestation fiables et la validation des entrées dans toutes les couches : l’interface en ligne de commande (CLI), le registre, l’ancre, le vérificateur et les outils.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Le nombre de tests augmente au fur et à mesure que de nouveaux ensembles de tests sont ajoutés ; exécutez la commande ci-dessus pour obtenir le nombre total actuel, plutôt que de vous fier à un chiffre qui risque de devenir obsolète.

## Licence

MIT (Massachusetts Institute of Technology)

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
