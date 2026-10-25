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

Publiez le grand livre et l’horloge de confiance ancrée sur XRPL pour un réseau de référentiels : événements signés, manifestes de nœuds et vérification. Séparez-le du magasin d’événements d’Attestia.

## Place dans le système

Attestia, Cognate et RepoMesh sont trois produits.

**RepoMesh** est le réseau de publication : événements signés, manifestes de nœuds et horloge de confiance ancrée sur XRPL. Il conserve son propre grand livre RFC 6962.

**Attestia** prouve qu’un événement, une transaction ou une transition d’état s’est produit, et lie cette preuve à une chaîne. Le domaine qu’il prend en charge est la vérité financière : coffre-fort personnel, trésorerie d’organisation et registre. Ses preuves Merkle ne sont pas ce grand livre.

**Cognate** est le domaine de gouvernance de l’IA sur le magasin d’événements d’Attestia et les preuves Merkle. Il appelle RepoMesh lorsqu’il a besoin qu’une publication soit vérifiée. Il ne conserve pas un deuxième magasin d’événements et n’utilise pas l’arbre Merkle d’Attestia pour ce réseau.

## Quoi de neuf dans les versions 2.4 et 2.5 ?

**Version 2.5.0.**

- **2.5.0 : l’ancrage de la publication échoue en cas de non-respect des conditions.** `post-anchor.mjs` refuse de publier et n’ouvre aucune connexion, à moins que la configuration n’indique `testnet` et que l’URL WebSocket soit un point de terminaison de testnet connu. Une simple variable d’environnement ne peut pas modifier la publication vers le réseau principal. Voir [Ancrage XRPL (protection du testnet)](#ancrage-xrpl-testnet-guard).
- **2.5.0 : une porte de test obligatoire.** Chaque demande de fusion exécute les 9 suites `node --test` avec un seuil de couverture de ligne et une production `npm audit` à `high`. `validate-ledger` et `test` sont des vérifications obligatoires sur `main`, et `registry-ci.yml` ne s’exécute désormais qu’après que `ledger-ci` a réussi sur `main`.
- **2.4.0 : exécution des attestations à partir de Cognate.** Le grand livre accepte trois nouveaux types d’attestation, `run.preregistered`, `run.outcome` et `cognate.root.anchored`, chacun avec un hachage `sha256` et un URI `urn:cognate:...`. Seul un nœud `governance` sur `trustedAttestors` et `trustedRunAttestors` (aujourd’hui, `mcp-tool-shop-org/cognate`) peut les signer, et il ne peut signer rien d’autre. Chaque `run.outcome` doit faire référence à un événement `run.preregistered` déjà présent dans le grand livre.
- **2.4.0 : le contrat de signature est vérifié.** Une signature Ed25519 doit porter sur les 32 octets bruts de `canonicalHash`. Le validateur rejette une signature effectuée sur le texte JSON canonique ou sur la chaîne hexadécimale de 64 caractères.

Consultez [CHANGELOG.md](CHANGELOG.md) pour obtenir la liste complète.

## Qu’est-ce que c’est ?

RepoMesh transforme un ensemble de référentiels en un réseau coopératif. Chaque référentiel est un **nœud** avec :

- Un **manifeste** (`node.json`) qui déclare ce qu’il fournit et consomme
- Des **événements signés** diffusés vers un grand livre en annexe uniquement
- Un **registre** qui indexe tous les nœuds et toutes les capacités
- Un **profil** qui définit ce que signifie « terminé » pour la confiance

Aujourd’hui, une organisation GitHub, mcp-tool-shop-org, exploite le journal, les attestateurs, la vérification des politiques et l’ancrage XRPL. Sept nœuds enregistrés ne font pas sept opérateurs. Un témoin indépendant serait une partie que cette organisation n’exploite pas.

Le réseau applique trois invariants :

1. **Sorties déterministes** — mêmes entrées, mêmes artefacts
2. **Provenance vérifiable** — chaque publication est signée et attestée
3. **Contrats composables** — les interfaces sont versionnées et lisibles par machine

## Démarrage rapide (1 commande + 2 secrets)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Cela génère tout ce dont vous avez besoin :
- `node.json` — votre manifeste de nœud
- `repomesh.profile.json` — votre profil choisi
- `.github/workflows/repomesh-broadcast.yml` — flux de travail de diffusion de la publication
- Ed25519 paire de clés de signature (la clé privée reste locale)

Ajoutez ensuite deux secrets à votre référentiel :
1. `REPOMESH_SIGNING_KEY` — votre clé privée PEM (affichée par init)
2. `REPOMESH_LEDGER_TOKEN` — PAT GitHub avec `contents:write` + `pull-requests:write` sur ce référentiel

Effectuez une publication. La confiance converge automatiquement.

### Options de ligne de commande

Toutes les commandes acceptent : `--quiet`, `--verbose`, `--debug`, `--no-color`. La commande `init` prend également en charge `--json` pour une sortie lisible par machine.

Les complétions de shell sont disponibles :

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Remplacements d’environnement

| Variable | Objectif |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Remplacer le point de terminaison du grand livre |
| `REPOMESH_MANIFESTS_URL` | Remplacer le point de terminaison des manifestes |
| `REPOMESH_FETCH_TIMEOUT` | Délai d’attente en ms |

### Profils

| Profil | Preuve | Vérifications d’assurance | Utiliser quand |
|---------|----------|-----------------|----------|
| `baseline` | Facultatif | Aucun requis | Outils internes, expériences |
| `open-source` | SBOM + provenance | Audit de licence + analyse de sécurité | Par défaut pour OSS |
| `regulated` | SBOM + provenance | Licence + sécurité + reproductibilité | Essentiel pour la conformité |

### Vérifier la confiance

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Affiche le score d’intégrité, le score d’assurance et les recommandations tenant compte du profil.

### Remplacements

Personnalisation par référentiel sans forker les vérificateurs :

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

## Adhésion manuelle (5 minutes)

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
    { "name": "your-name", "contact": "https://github.com/your-org", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Générez une paire de clés de signature

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` affiche la clé publique + une `keyId` prête à être ajoutée à votre entrée des mainteneurs `node.json`, et
écrit la clé privée (mode 0600) uniquement à l’endroit que vous indiquez avec `--out` — jamais dans un chemin suivi. Stockez-la comme un secret de référentiel GitHub (`REPOMESH_SIGNING_KEY`). (Équivalent manuellement : `openssl genpkey -algorithm ED25519 ...`.)

> **Enregistrez ≥ 2 clés pour un nœud essentiel pour la confiance** (TUF § 6.1) : une seule clé ne peut pas signer sa propre révocation en cas de compromission. `repomesh init --second-key` enregistre un deuxième mainteneur distinct afin qu’une clé puisse révoquer l’autre — `init` avertit lorsqu’un nœud n’a qu’une seule clé active.

### 3. Enregistrez-vous auprès du réseau

Ouvrez une PR vers ce référentiel en ajoutant votre manifeste de nœud :

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Ajoutez le flux de travail de diffusion

Copiez `templates/repomesh-broadcast.yml` dans le `.github/workflows/` de votre référentiel.
Définissez le secret `REPOMESH_LEDGER_TOKEN` (un PAT précis avec les autorisations : write sur le contenu + pull-requests:write sur ce référentiel).

Chaque publication diffusera désormais automatiquement un événement `ReleasePublished` signé vers le grand livre.

## Règles du grand livre

- **Ajout uniquement** : les lignes existantes sont immuables.
- **Conforme au schéma** : chaque événement est validé par rapport à `schemas/event.schema.json`.
- **Signature valide** : chaque événement est signé par un mainteneur de nœud enregistré.
- **Unique** : aucune entrée `(repo, version, type)` en double.
- **Horodatage correct** : pas plus d’une heure dans le futur ou d’un an dans le passé.

## Types d’événements

Le registre émet actuellement les types d’événements **actifs** suivants. Le reste est **réservé / prévu** : le schéma les accepte, mais aucun nœud ne les émet encore. Nous les listons afin que la feuille de route soit visible sans impliquer une couverture qui n’existe pas (transparence totale pour un produit de confiance).

**Actifs (émis aujourd’hui) :**

| Type | Quand |
|------|------|
| `ReleasePublished` | Une nouvelle version est publiée. |
| `AttestationPublished` | Un attestateur vérifie une publication. |
| `ledger.anchor` | Le nœud d’ancrage scelle une partition (racine Merkle + mémorandum XRPL). |
| `attestation.dispute` | Un nœud de confiance conteste une attestation (rétrograde le verdict). |
| `KeyRotation` | Une clé de mainteneur est remplacée par une clé de successeur (prospectif : les signatures passées restent valides). |
| `KeyRevocation` | Une clé de mainteneur est révoquée (compromission = invalidité rétroactive, RFC 5280). |

`AttestationPublished` contient également les attestations d’exécution de Cognate (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, depuis la version 2.4.0), signées uniquement par son nœud `governance`.

**Réservé / prévu (pas encore émis) :**

| Type | Signification prévue |
|------|------------------|
| `BreakingChangeDetected` | Une modification importante est introduite. |
| `HealthCheckFailed` | Un nœud échoue à ses propres contrôles d’intégrité. |
| `DependencyVulnFound` | Une vulnérabilité est détectée dans les dépendances. |
| `InterfaceUpdated` | Un schéma d’interface est modifié. |
| `PolicyViolation` | Une politique de réseau est violée. `policy/scripts/check-policy.mjs` peut créer et signer une politique ; aucune n’est encore présente dans le registre. |

## Rotation et révocation des clés

Les clés de mainteneur ont un cycle de vie. Une clé peut être **rotative** vers un successeur ou **révoquée**, et la vérification est **consciente du temps** : une signature est considérée comme fiable uniquement si la clé était valide au moment de la signature (l’heure de fermeture de l’ancre XRPL, la même horloge de confiance que le registre utilise déjà).

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotation de routine** est *prospective* : les signatures passées de la clé retirée restent valides ; elle cesse simplement de signer les nouvelles publications.
- La **compromission** est *rétroactive* (RFC 5280, section 5.3.2) : toute signature dont le temps d’ancrage prouvable est à ou après la date d’invalidité est rejetée, et une signature dont il ne peut être prouvé qu’elle est antérieure à cette date est également rejetée.
- Une clé **sans** champs de cycle de vie est maintenue (toujours valide), de sorte que les nœuds existants effectuent une vérification sans modification.
- Les révocations sont des événements `KeyRevocation` signés ; un nœud à clé unique dont la seule clé est compromise est restauré par un nœud de **gouvernance** (`trustedPolicy`) qui signe la révocation. Les nœuds essentiels pour la confiance doivent enregistrer **≥ 2 clés** (TUF, section 6.1).
- Même en cas de manipulation de `node.json`, une révocation est réimposée à partir des événements signés et ancrés dans XRPL : un manifeste tronqué ne peut pas réactiver une clé révoquée. Voir le [modèle de menace](docs/threat-model.md) pour la limite (vérifier par rapport au registre canonique ; utiliser `--anchored` pour les vérifications sensibles à la révocation).

## Types de nœuds

| Type | Rôle |
|------|------|
| `registry` | Indexe les nœuds et leurs capacités |
| `attestor` | Vérifie les revendications (création, conformité) |
| `policy` | Applique les règles (notation, contrôle) |
| `oracle` | Fournit des données externes |
| `compute` | Effectue des tâches (transformations, création) |
| `settlement` | Finalise l’état |
| `governance` | Prend des décisions ; depuis la version 2.4.0, signe les attestations d’exécution de Cognate et rien d’autre. |
| `identity` | Émet/vérifie les informations d’identification |

## Extension du réseau : le contrat de plugin de vérification

De nouveaux **types de vérification** et de **nœuds de vérification** sont ajoutés en modifiant les données, et non le code. Le registre des types de vérification, les pondérations de notation et les autorisations des types de nœuds sont stockés dans [`verifier.policy.json`](verifier.policy.json) (validé par le schéma, échec en cas d’erreur). L’ajout d’une vérification (par exemple, `sast.scan`) consiste en une modification de politique d’environ 6 lignes + un `node.json`, examinée dans une demande de fusion : aucune modification du code.

La seule invariant : **enregistré ≠ fiable**. L’enregistrement permet à une vérification de participer ; le crédit nécessite toujours un consensus de l’ensemble de confiance. Guide complet : [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Vérification publique

N’importe qui peut vérifier une publication avec une seule commande : **aucune copie n’est requise**, l’interface de ligne de commande récupère le registre public pour vous :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Cela vérifie :
1. L’événement `ReleasePublished` existe et est signé (Ed25519) par une clé enregistrée pour **ce dépôt** `node.json` : une clé enregistrée pour un dépôt différent ne peut pas la valider.
2. Le profil de confiance du dépôt est satisfait : chaque attestation requise par le profil (SBOM, provenance, licence, sécurité) est présente, signée par un attestateur de confiance, et son dernier résultat est `pass`, avec au moins un attestateur **indépendant**. Une publication avec uniquement une auto-signature et aucune attestation indépendante signale `UNVERIFIED`, jamais `PASS`.
3. Avec `--anchored` : la racine Merkle de la partition est recalculée et mise en correspondance avec le manifeste, et, lorsque le réseau est accessible, la transaction XRPL en chaîne est récupérée et validée (`validated` + `tesSUCCESS`, le compte de signature figure dans la liste autorisée des ancres de confiance, et le mémorandum en chaîne est lié à la racine/au hachage du manifeste/au nombre local). Hors ligne, elle signale `XRPL NOT verified` au lieu d’une transaction fictive ; une vérification stricte `--anchored` échoue alors (utiliser `--anchored-or-local` pour accepter un manifeste vérifié localement sans la preuve en chaîne).

Pour les contrôles CI, choisissez un format de sortie avec `--format <text|json|sarif|markdown>` (`--json` est un alias pour `--format json`) :

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Le **code de sortie** est dérivé du verdict à trois états, de sorte qu’une étape CI peut le contrôler directement :

| Sortie | Verdict | Signification |
|------|---------|---------|
| `0` | PASS | Authentique et assuré (ou NON VÉRIFIÉ lorsque cela est autorisé par `--fail-on=fail`). |
| `1` | FAIL | Échec critique : signature falsifiée/provenant du mauvais dépôt, attestateur non autorisé ou une vérification requise a échoué. |
| `3` | NON VÉRIFIÉ | Échec mineur : pas encore ancré, pas de témoin indépendant ou une vérification requise manquante. |
| `2` | — | Erreur d’utilisation ou plantage interne. |

### Conteneur

La même interface de ligne de commande est publiée sous la forme de `ghcr.io/mcp-tool-shop-org/repomesh`, avec l’étiquette de la version npm et le hachage Git. L’image s’exécute en tant qu’utilisateur non root. Elle ne contient pas de clé privée de portefeuille.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

La publication d’une ancre est une commande distincte. `XRPL_SEED` est transmis lors de l’exécution :

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

Le flux de travail quotidien crée cette image à partir de l’extraction et la publie.

### Ancrage XRPL (Testnet Guard)

L’ancrage dans `anchor/xrpl/config.json` est **uniquement pour le testnet** (`"network": "testnet"`). `anchor/xrpl/scripts/post-anchor.mjs` applique une protection de point de terminaison de type « échec par défaut » (`assertPostingEndpoint`) avant de valider `XRPL_SEED` ou de construire une `xrpl.Client` :

- **Vérification par défaut du testnet :** la publication est refusée (code de sortie différent de zéro, aucun socket ouvert) sauf si `config.network === "testnet"` **et** l’URL résolue WebSocket (`process.env.XRPL_WS_URL || config.rippledUrl`) se trouvent dans `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`). Définir `XRPL_WS_URL` sur une URL du mainnet ou inconnue est immédiatement refusé avec un message indiquant à la fois le réseau résolu et l’URL résolue.
- **Activation du mainnet (désactivée) :** une variable d’environnement seule ne peut jamais modifier la publication pour le mainnet. L’activation du mainnet nécessite un commit examiné dans `anchor/xrpl/config.json` définissant `"network": "mainnet"`, `"allowMainnetPosting": true` et `"mainnetAllowedEndpoints": ["wss://..."]`, contenant le point de terminaison cible `wss://`, après avoir ajouté l’adresse classique financée du mainnet à la limite supérieure de la liste d’autorisation fournie (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`). Cette liste d’autorisation est une limite supérieure : une configuration récupérée peut supprimer un compte, mais ne peut pas en ajouter un.

`--fail-on <fail\|unverified>` définit le niveau de rigueur. Par défaut, `unverified` échoue à la fois sur FAIL et
UNVERIFIED ; `--fail-on=fail` autorise UNVERIFIED à passer (code de sortie 0, avec un avertissement) pour une adoption en mode avertissement.

Vérifiez un ensemble complet en une seule opération de chargement du registre avec `verify-all`, et vérifiez hors ligne par rapport à un clone local avec `--local` :

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Intégrez-le dans CI** avec l’action composite fournie ; voir
[Utilisation de l’action GitHub](docs/verification.md#using-the-github-action) :

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Voir [docs/verification.md](docs/verification.md) pour le guide complet de vérification, le modèle de menace et les concepts clés.

### Utilisez-le comme une bibliothèque

Le moteur de vérification est exporté sous la forme d’une API programmatique stable ; intégrez-le dans vos propres outils au lieu d’utiliser l’interface de ligne de commande.

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Point de terminaison d’état du réseau

Le tableau de bord publie un fichier lisible par machine [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
pour un sondage externe : fraîcheur du registre (avec un signal de registre gelé), nombre de verdicts de confiance, partitions ancrées par rapport aux
partitions en attente, et un rollup `ok`/`degraded` avec les raisons.

### Badges de confiance

Les dépôts peuvent intégrer des badges de confiance du registre :

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiance et vérification

### Vérifiez une version

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestez une version

> L’attestation et l’exécution des vérificateurs sont des tâches **d’opérateur** qui agissent sur un clone de ce registre, elles s’exécutent donc à partir d’une extraction. La vérification d’une version ne le fait pas ; utilisez la commande `npx` ci-dessus.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Vérifications : `sbom.present`, `provenance.present`, `signature.chain`

### Exécutez les vérificateurs

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Les seuils de vérification de sécurité (nombre maximal de CVE, sévérités autorisées) sont configurés via `verifiers/security/config.json`.

### Exécutez les vérifications de stratégie

```bash
node policy/scripts/check-policy.mjs
```

Vérifications : monotonicité semver, unicité du hachage de l’artefact, capacités requises.

## Sécurité et modèle de menace

RepoMesh touche aux **événements du registre** (JSON signé), aux **manifestes de nœud** (clés publiques + capacités), aux **index du registre** (scores de confiance générés automatiquement) et au **testnet XRPL** (transactions d’ancrage ; la publication refuse tout point de terminaison qui n’est pas un point de terminaison de testnet connu). Il ne touche **pas** au code source du dépôt des membres, aux clés privées, aux informations d’identification des utilisateurs ou aux données de navigation. Les clés de signature privées ne quittent jamais l’exécuteur CI. L’accès au réseau est limité à l’API GitHub (création de PR), au testnet XRPL (ancrage) et à OSV.dev (recherches de vulnérabilités). **Aucune télémétrie** n’est collectée ou envoyée : aucune analyse, aucun rapport d’erreur, aucune communication vers le domicile. Voir [SECURITY.md](SECURITY.md) pour la portée complète, les autorisations requises et le processus de signalement des vulnérabilités, et le [modèle de menace](docs/threat-model.md) pour la limite de confiance du cycle de vie des clés (pourquoi l’authenticité de `node.json` dépend de sa source, et pourquoi la vérification sensible à la révocation doit utiliser `--anchored`).

Renforcement :

- Les appels de sous-processus qui interpolent des données variables utilisent `execFileSync` avec des arguments de tableau ; les appels `execSync` restants utilisent des chaînes de commandes statiques et constantes ; il n’y a pas de vecteurs d’injection de shell.
- Le JSON du registre et du registre est analysé dans `try`/`catch` avec des erreurs structurées et numérotées ; une ligne malformée est ignorée et affichée, elle ne fait jamais planter l’outil avec une pile brute.
- La traversée de chemin est empêchée dans toutes les opérations de fichiers (résolution + vérification de limite).
- Analyse ReDoS-safe dans tout le code (pas d’expression régulière non délimitée).
- Les clés privées PEM sont exclues via `.gitignore`, elles ne sont jamais imprimées sur stdout ou dans les journaux CI, et sont écrites avec des autorisations d’accès uniquement pour le propriétaire (`0600`).

## Tests

L’ensemble complet `node --test` couvre Ed25519 signatures, la validation du schéma, l’intégrité de l’arbre de Merkle (v1 + RFC-6962 v2), les invariants d’ajout uniquement, la prévention de la traversée de chemin, l’ancrage
vérification, la liste d’autorisation de l’attestateur de confiance et la validation des entrées dans les couches CLI, registre,
ancrage, vérificateur et outils.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Le nombre de tests augmente à mesure que des suites sont ajoutées ; exécutez la commande ci-dessus pour obtenir le total actuel au lieu de vous fier à un nombre qui devient obsolète.

CI exécute les 9 mêmes suites sur chaque demande d’extraction (`ledger-ci.yml`, la vérification `test` requise), avec
`--experimental-test-coverage` et un seuil de couverture de ligne (`--test-coverage-lines=57`), puis
`npm audit --audit-level=high --omit=dev` pour la racine, `anchor/xrpl` et `ledger`.

## Licence

MIT

---

Créé par <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
