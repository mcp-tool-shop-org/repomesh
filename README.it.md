<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
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

Rete di repository sinergici: registro a sola aggiunta, manifest dei nodi e sistema di valutazione per il coordinamento distribuito dei repository.

## Cos'è questo?

RepoMesh trasforma una collezione di repository in una rete collaborativa. Ogni repository è un **nodo** con:

- Un **manifest** (`node.json`) che dichiara cosa fornisce e cosa consuma.
- **Eventi firmati** trasmessi a un registro a sola aggiunta.
- Un **registro** che indicizza tutti i nodi e le loro capacità.
- Un **profilo** che definisce cosa significa "completato" in termini di affidabilità.

La rete impone tre principi fondamentali:

1. **Output deterministici** — stessi input, stessi risultati.
2. **Provenienza verificabile** — ogni rilascio è firmato e attestato.
3. **Contratti componibili** — le interfacce sono versionate e leggibili dalle macchine.

## Guida rapida (1 comando + 2 segreti)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

Questo genera tutto ciò di cui hai bisogno:
- `node.json` — il manifest del tuo nodo.
- `repomesh.profile.json` — il profilo scelto.
- `.github/workflows/repomesh-broadcast.yml` — il flusso di lavoro per la trasmissione dei rilasci.
- Coppia di chiavi di firma Ed25519 (la chiave privata rimane locale).

Quindi, aggiungi due segreti al tuo repository:
1. `REPOMESH_SIGNING_KEY` — la tua chiave privata in formato PEM (stampata durante l'inizializzazione).
2. `REPOMESH_LEDGER_TOKEN` — un token PAT di GitHub con le autorizzazioni `contents:write` e `pull-requests:write` su questo repository.

Effettua un rilascio. L'affidabilità converge automaticamente.

### Profili

| Profilo | Prove | Controlli di affidabilità | Quando utilizzarlo |
|---------|----------|-----------------|----------|
| `baseline` | Opzionale | Nessuno richiesto | Strumenti interni, esperimenti |
| `open-source` | SBOM + provenienza | Controllo delle licenze + scansione di sicurezza | Predefinito per progetti open source |
| `regulated` | SBOM + provenienza | Licenza + sicurezza + riproducibilità | Critico per la conformità |

### Verifica dell'affidabilità

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra il punteggio di integrità, il punteggio di affidabilità e raccomandazioni specifiche per il profilo.

### Sovrascritture

Personalizzazione specifica per repository senza dover modificare i vericatori:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Struttura del repository

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

## Adesione manuale (5 minuti)

### 1. Crea il manifest del tuo nodo

Aggiungi `node.json` alla radice del tuo repository:

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

### 2. Genera una coppia di chiavi di firma

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Inserisci la chiave pubblica in formato PEM nella sezione "maintainers" del tuo `node.json`.
Conserva la chiave privata come segreto del repository GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Registrati nella rete

Apri una pull request a questo repository aggiungendo il manifest del tuo nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Aggiungi il flusso di lavoro di trasmissione

Copia `templates/repomesh-broadcast.yml` nella cartella `.github/workflows/` del tuo repository.
Imposta il segreto `REPOMESH_LEDGER_TOKEN` (un token PAT con le autorizzazioni `contents:write` e `pull-requests:write` su questo repository).

Ogni rilascio trasmetterà automaticamente un evento firmato `ReleasePublished` al registro.

## Regole del registro

- **A sola aggiunta** — le righe esistenti sono immutabili.
- **Con schema valido** — ogni evento deve essere conforme allo schema `schemas/event.schema.json`.
- **Con firma valida** — ogni evento è firmato da un manutentore del nodo registrato.
- **Univoco** — non sono ammesse voci duplicate `(repository, versione, tipo)`.
- **Con timestamp valido** — non deve essere più di 1 ora nel futuro o 1 anno nel passato.

## Tipi di eventi

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Viene rilasciata una nuova versione. |
| `AttestationPublished` | Un attestatore verifica un rilascio. |
| `BreakingChangeDetected` | Viene introdotta una modifica incompatibile. |
| `HealthCheckFailed` | Un nodo fallisce i propri controlli di integrità. |
| `DependencyVulnFound` | Viene rilevata una vulnerabilità nelle dipendenze. |
| `InterfaceUpdated` | Lo schema di un'interfaccia cambia. |
| `PolicyViolation` | Viene violata una policy di rete. |

## Tipi di nodi

| Tipo | Ruolo |
|------|------|
| `registry` | Indica i nodi e le loro capacità. |
| `attestor` | Verifica le dichiarazioni (costruzioni, conformità). |
| `policy` | Applica le regole (valutazione, controllo). |
| `oracle` | Fornisce dati esterni. |
| `compute` | Esegue attività (trasformazioni, costruzioni). |
| `settlement` | Finalizza lo stato. |
| `governance` | Prende decisioni. |
| `identity` | Emette/verifica le credenziali. |

## Verifica pubblica

Chiunque può verificare una versione con un singolo comando:

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Questo controlla:
1. L'esistenza dell'evento di rilascio e la validità della firma (Ed25519).
2. La presenza e la firma di tutte le attestazioni (SBOM, provenienza, licenza, sicurezza).
3. Che il rilascio sia incluso in una partizione Merkle ancorata a XRPL.

Per i controlli CI, utilizzare `--json`:

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

Consultare [docs/verification.md](docs/verification.md) per la guida completa alla verifica, il modello di minaccia e i concetti chiave.

### Badge di fiducia

I repository possono incorporare badge di fiducia dal registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Fiducia e verifica

### Verificare una versione

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestare una versione

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Controlli: `sbom.present`, `provenance.present`, `signature.chain`.

### Eseguire i verificatori

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### Eseguire i controlli delle policy

```bash
node policy/scripts/check-policy.mjs
```

Controlli: monotonicità semver, unicità dell'hash degli artefatti, capacità richieste.

## Licenza

MIT.

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>.
