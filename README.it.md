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

Rete di repository sintropica: registro ad aggiunta, manifesti dei nodi e punteggio per il coordinamento distribuito dei repository.

## Cos'è?

RepoMesh trasforma una raccolta di repository in una rete collaborativa. Ogni repository è un **nodo** con:

- Un **manifesto** (`node.json`) che dichiara cosa fornisce e consuma
- **Eventi firmati** trasmessi a un registro ad aggiunta
- Un **registro** che indicizza tutti i nodi e le funzionalità
- Un **profilo** che definisce cosa significa "completato" per la fiducia

La rete applica tre invarianti:

1. **Output deterministici:** stessi input, stessi artefatti
2. **Provenienza verificabile:** ogni versione è firmata e attestata
3. **Contratti componibili:** le interfacce sono versionate e leggibili dalle macchine

## Avvio rapido (1 comando + 2 segreti)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Questo genera tutto ciò di cui hai bisogno:
- `node.json`: il manifesto del tuo nodo
- `repomesh.profile.json`: il profilo scelto
- `.github/workflows/repomesh-broadcast.yml`: flusso di lavoro per la trasmissione delle versioni
- Coppia di chiavi di firma Ed25519 (la chiave privata rimane locale)

Quindi, aggiungi due segreti al tuo repository:
1. `REPOMESH_SIGNING_KEY`: la tua chiave privata in formato PEM (stampata durante l'inizializzazione)
2. `REPOMESH_LEDGER_TOKEN`: token GitHub PAT con i permessi `contents:write` e `pull-requests:write` su questo repository

Pubblica una versione. La fiducia converge automaticamente.

### Flag della CLI

Tutti i comandi accettano: `--quiet`, `--verbose`, `--debug`, `--no-color`. Il comando `init` supporta anche `--json` per un output leggibile dalle macchine.

Sono disponibili completamenti della shell:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Override dell'ambiente

| Variabile | Scopo |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Sovrascrivi l'endpoint del registro |
| `REPOMESH_MANIFESTS_URL` | Sovrascrivi l'endpoint dei manifesti |
| `REPOMESH_FETCH_TIMEOUT` | Timeout di recupero in millisecondi |

### Profili

| Profilo | Evidenza | Controlli di garanzia | Quando utilizzare |
|---------|----------|-----------------|----------|
| `baseline` | Opzionale | Nessuno richiesto | Strumenti interni, esperimenti |
| `open-source` | SBOM + provenienza | Audit della licenza + scansione di sicurezza | Predefinito per OSS |
| `regulated` | SBOM + provenienza | Licenza + sicurezza + riproducibilità | Critico per la conformità |

### Verifica della fiducia

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra il punteggio di integrità, il punteggio di garanzia e le raccomandazioni specifiche del profilo.

### Override

Personalizzazione per repository senza la necessità di creare verificatori:

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

### 1. Crea il manifesto del tuo nodo

Aggiungi `node.json` alla directory principale del tuo repository:

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

Inserisci la chiave pubblica in formato PEM nella voce "maintainers" del tuo `node.json`.
Archivia la chiave privata come segreto del repository GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Registrati alla rete

Apri una PR per questo repository aggiungendo il manifesto del tuo nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Aggiungi il flusso di lavoro di trasmissione

Copia `templates/repomesh-broadcast.yml` nella directory `.github/workflows/` del tuo repository.
Imposta il segreto `REPOMESH_LEDGER_TOKEN` (un token PAT con permessi granulari, contenente `contents:write` e `pull-requests:write` su questo repository).

Ogni versione ora trasmetterà automaticamente un evento firmato `ReleasePublished` al registro.

## Regole del registro

- **Solo aggiunta:** le righe esistenti sono immutabili
- **Valida rispetto allo schema:** ogni evento è valido rispetto a `schemas/event.schema.json`
- **Firma valida:** ogni evento è firmato da un manutentore del nodo registrato
- **Unico:** non ci sono voci duplicate `(repository, versione, tipo)`
- **Timestamp corretto:** non più di 1 ora nel futuro o 1 anno nel passato

## Tipi di evento

Il registro attualmente emette i tipi di eventi "live" elencati di seguito. Il resto sono "riservati / pianificati": lo schema li accetta, ma nessun nodo li emette ancora. Li elenchiamo in modo che la roadmap sia visibile senza implicare una copertura che non esiste (onestà per un prodotto basato sulla fiducia).

**Live (emessi oggi):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Viene rilasciata una nuova versione |
| `AttestationPublished` | Un attestatore verifica una versione |
| `ledger.anchor` | Il nodo di ancoraggio sigilla una partizione (radice Merkle + memo XRPL) |
| `attestation.dispute` | Un nodo affidabile contesta un'attestazione (abbassa il verdetto) |

**Riservati / pianificati (non ancora emessi):**

| Tipo | Significato previsto |
|------|------------------|
| `BreakingChangeDetected` | Viene introdotta una modifica incompatibile |
| `HealthCheckFailed` | Un nodo non supera i propri controlli di integrità |
| `DependencyVulnFound` | Viene trovata una vulnerabilità nelle dipendenze |
| `InterfaceUpdated` | Lo schema dell'interfaccia cambia |
| `PolicyViolation` | Una politica di rete viene violata |

## Tipi di nodo

| Tipo | Ruolo |
|------|------|
| `registry` | Indicizza nodi e funzionalità |
| `attestor` | Verifica le affermazioni (build, conformità) |
| `policy` | Applica le regole (punteggio, controllo) |
| `oracle` | Fornisce dati esterni |
| `compute` | Svolge il lavoro (trasformazioni, build) |
| `settlement` | Finalizza lo stato |
| `governance` | Prende decisioni |
| `identity` | Emette/verifica le credenziali |

## Verifica pubblica

Chiunque può verificare una versione con un solo comando: non è necessario clonare, la CLI recupera il registro pubblico per te:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Questo controllo verifica:
1. Se l'evento `ReleasePublished` esiste ed è firmato (Ed25519) con una chiave registrata per il **repository specifico** nel file `node.json`. Una chiave registrata per un repository diverso non può validarlo.
2. Se il profilo di fiducia del repository soddisfa i requisiti: tutte le attestazioni richieste dal profilo (SBOM, provenienza, licenza, sicurezza) sono presenti, firmate da un attestatore affidabile e l'ultimo risultato è `pass`, con almeno un attestatore **indipendente**. Un rilascio con solo una firma interna e senza attestazioni indipendenti segnala `UNVERIFIED`, mai `PASS`.
3. Con `--anchored`: la radice Merkle della partizione viene ricalcolata e confrontata con il manifest, e — quando la rete è raggiungibile — la transazione XRPL on-chain viene recuperata e verificata (`validated` + `tesSUCCESS`, l'account di firma è presente nella lista consentita degli ancoraggi affidabili e il memo on-chain si riferisce alla radice/hash del manifest locale). In modalità offline, segnala `XRPL NOT verified` anziché una transazione fittizia; con `--anchored` viene rilevato un errore (utilizzare `--anchored-or-local` per accettare un manifest verificato localmente senza la prova on-chain).

Per i controlli CI, scegliere un formato di output con `--format <text|json|sarif|markdown>` (`--json` è un alias per `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Il **codice di uscita** deriva dal risultato a tre stati, quindi una fase CI può basarsi su questo direttamente:

| Uscita | Risultato | Significato |
|------|---------|---------|
| `0` | PASS | Autentico e affidabile (o UNVERIFIED quando allentato con `--fail-on=fail`). |
| `1` | FAIL | Errore grave: firma contraffatta/di un repository errato, attestatore non presente nella lista consentita o un controllo richiesto non è stato superato. |
| `3` | UNVERIFIED | Minore: non ancora ancorato, nessun testimone indipendente o un controllo richiesto mancante. |
| `2` | — | Errore di utilizzo o crash interno. |

`--fail-on <fail\|unverified>` imposta il livello di rigore. Il valore predefinito `unverified` causa l'errore sia in caso di FAIL che di UNVERIFIED; `--fail-on=fail` consente a UNVERIFIED di passare (uscita 0, con un avviso) per l'adozione in modalità di avviso.

Verificare un intero batch in una singola operazione di caricamento del ledger con `verify-all`, e verificare offline rispetto a una copia locale con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Integrarlo nel CI** con l'azione composita fornita: vedere [Utilizzo dell'azione GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Vedere [docs/verification.md](docs/verification.md) per la guida completa alla verifica, il modello di minaccia e i concetti chiave.

### Badge di fiducia

I repository possono incorporare badge di fiducia dal registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Fiducia e verifica

### Verificare un rilascio

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestare un rilascio

> L'attestazione e l'esecuzione dei verificatori sono attività dell'**operatore** che agiscono su una copia di questo ledger, quindi vengono eseguite da un checkout. La verifica di un rilascio non lo richiede: utilizzare il comando `npx` sopra indicato.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Controlli: `sbom.present`, `provenance.present`, `signature.chain`

### Eseguire i verificatori

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Le soglie dei verificatori di sicurezza (numero massimo di CVE, livelli di gravità consentiti) sono configurate tramite `verifiers/security/config.json`.

### Eseguire i controlli delle policy

```bash
node policy/scripts/check-policy.mjs
```

Controlli: monotonicità semantica, unicità dell'hash degli artefatti, funzionalità richieste.

## Sicurezza e modello di minaccia

RepoMesh interagisce con gli **eventi del ledger** (JSON firmato), i **manifest dei nodi** (chiavi pubbliche + funzionalità), gli **indici del registro** (punteggi di fiducia generati automaticamente) e la **XRPL testnet** (transazioni di ancoraggio). Non interagisce con il codice sorgente, le chiavi private, le credenziali utente o i dati di navigazione dei repository membri. Le chiavi di firma private non lasciano mai l'ambiente CI. L'accesso alla rete è limitato all'API GitHub (creazione di PR), alla XRPL testnet (ancoraggio) e a OSV.dev (ricerca di vulnerabilità). **Non vengono raccolti o inviati dati di telemetria**: zero analisi, zero segnalazioni di crash, zero comunicazioni verso casa. Vedere [SECURITY.md](SECURITY.md) per l'ambito completo, le autorizzazioni richieste e il processo di segnalazione delle vulnerabilità.

Rafforzamento:

- Le chiamate a processi figlio che interpolano dati variabili utilizzano `execFileSync` con argomenti in formato array; le restanti chiamate `execSync` utilizzano stringhe di comando statiche e costanti, senza vettori di injection del codice.
- Il JSON del ledger e del registro viene analizzato all'interno di blocchi `try`/`catch` con errori strutturati e numerati per riga; una riga non valida viene saltata e segnalata, senza mai causare il crash dello strumento con uno stacktrace grezzo.
- La traversia dei percorsi è impedita in tutte le operazioni sui file (risoluzione + controllo dei limiti).
- Analisi sicura contro ReDoS in tutto il codice (nessuna espressione regolare illimitata).
- Le chiavi private PEM sono escluse tramite `.gitignore`, non vengono mai stampate su stdout o nei log CI e vengono scritte con permessi di sola lettura per il proprietario (`0600`).

## Test

La suite completa `node --test` copre le firme Ed25519, la convalida dello schema, l'integrità dell'albero di Merkle (v1 + RFC-6962 v2), gli invarianti append-only, la prevenzione della traversia dei percorsi, la verifica degli ancoraggi, la lista consentita degli attestatori affidabili e la convalida degli input in tutti i livelli: CLI, ledger, ancoraggio, verificatore e strumenti.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Il numero di test aumenta man mano che vengono aggiunte nuove suite; eseguire il comando sopra per ottenere il totale corrente anziché fare affidamento su un numero che potrebbe diventare obsoleto.

## Licenza

MIT

---

Realizzato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
