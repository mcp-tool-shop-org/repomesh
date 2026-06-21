<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.md">English</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Rete di repository sintropica: registro ad aggiunta esclusiva, manifesti dei nodi e punteggio per il coordinamento distribuito dei repository.

## Cos'è?

RepoMesh trasforma una raccolta di repository in una rete collaborativa. Ogni repository è un **nodo** con:

- Un **manifesto** (`node.json`) che dichiara cosa fornisce e utilizza
- **Eventi firmati** trasmessi a un registro ad aggiunta esclusiva
- Un **registro** che indicizza tutti i nodi e le funzionalità
- Un **profilo** che definisce cosa significa "completato" in termini di affidabilità

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

Pubblica una versione. L'affidabilità converge automaticamente.

### Flag della CLI

Tutti i comandi accettano: `--quiet`, `--verbose`, `--debug`, `--no-color`. Il comando `init` supporta anche `--json` per un output leggibile dalle macchine.

Sono disponibili il completamento automatico della shell:

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

### Verifica l'affidabilità

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra il punteggio di integrità, il punteggio di garanzia e le raccomandazioni specifiche del profilo.

### Override

Personalizzazione per repository senza la necessità di creare fork dei verificatori:

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` stampa la chiave pubblica e un `keyId` pronti per essere inseriti nella voce relativa ai manutentori del file `node.json`, e scrive la chiave privata (modalità 0600) solo nel percorso specificato con l'opzione `--out`; non la scrive mai in un percorso tracciato. Salvala come segreto del repository GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente eseguito manualmente: `openssl genpkey -algorithm ED25519 ...`).

> **Registra almeno 2 chiavi per un nodo di importanza critica per la fiducia** (TUF §6.1): una singola chiave non può firmare la propria revoca in caso di compromissione. `repomesh init --second-key` registra un secondo manutentore distinto, in modo che una chiave possa revocare l'altra; `init` avvisa quando un nodo ha solo una chiave attiva.

### 3. Registrati alla rete

Apri una PR per questo repository aggiungendo il manifesto del tuo nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Aggiungi il flusso di lavoro per la trasmissione

Copia `templates/repomesh-broadcast.yml` nella directory `.github/workflows/` del tuo repository.
Imposta il segreto `REPOMESH_LEDGER_TOKEN` (un token PAT con permessi granulari, contenente `contents:write` e `pull-requests:write` su questo repository).

Ogni versione ora trasmetterà automaticamente un evento firmato `ReleasePublished` al registro.

## Regole del registro

- **Ad aggiunta esclusiva:** le righe esistenti sono immutabili
- **Valida rispetto allo schema:** ogni evento è valido rispetto a `schemas/event.schema.json`
- **Firma valida:** ogni evento è firmato da un manutentore registrato del nodo
- **Unico:** non ci sono voci duplicate `(repository, versione, tipo)`
- **Timestamp corretto:** non più di 1 ora nel futuro o 1 anno nel passato

## Tipi di eventi

Il registro emette attualmente i tipi di eventi "live" elencati di seguito. Il resto sono "riservati/pianificati": lo schema li accetta, ma nessun nodo li emette ancora. Li elenchiamo in modo che la roadmap sia visibile senza implicare una copertura che non esiste (onestà trasparente per un prodotto basato sull'affidabilità).

**Live (emessi oggi):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Viene rilasciata una nuova versione |
| `AttestationPublished` | Un attestatore verifica una versione |
| `ledger.anchor` | Il nodo di ancoraggio sigilla una partizione (radice Merkle + memo XRPL) |
| `attestation.dispute` | Un nodo affidabile contesta un'attestazione (abbassa il verdetto) |
| `KeyRotation` | Una chiave del manutentore viene ruotata su un successore (prospettico: le firme passate rimangono valide) |
| `KeyRevocation` | Una chiave del manutentore viene revocata (compromissione = invalidità retroattiva, RFC 5280) |

**Riservati/pianificati (non ancora emessi):**

| Tipo | Significato previsto |
|------|------------------|
| `BreakingChangeDetected` | Viene introdotta una modifica incompatibile |
| `HealthCheckFailed` | Un nodo non supera i propri controlli di integrità |
| `DependencyVulnFound` | Viene trovata una vulnerabilità nelle dipendenze |
| `InterfaceUpdated` | Lo schema dell'interfaccia cambia |
| `PolicyViolation` | Una politica di rete viene violata |

## Rotazione e revoca delle chiavi

Le chiavi del manutentore hanno un ciclo di vita. Una chiave può essere **ruotata** su un successore o **revocata**, e la verifica è **sensibile al tempo**: una firma viene considerata valida solo se la chiave era valida nel momento della firma, ovvero l'ora di chiusura dell'ancoraggio XRPL, lo stesso orologio affidabile che il registro utilizza già.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotazione periodica** è *prospettica*: le firme precedenti della chiave ritirata rimangono valide; semplicemente smette di firmare nuove versioni.
- Il **compromesso** è *retroattivo* (RFC 5280 §5.3.2): qualsiasi firma la cui data di ancoraggio verificabile sia uguale o successiva alla data di invalidità viene rifiutata e una firma che non può essere dimostrata come antecedente a tale data viene anch'essa rifiutata.
- Una chiave senza campi relativi al ciclo di vita è considerata "ereditata" (sempre valida), quindi i nodi esistenti verificano che rimanga invariata.
- Le revoche sono eventi `KeyRevocation` firmati; un nodo a chiave singola la cui unica chiave è compromessa viene ripristinato da un nodo di **governance** (`trustedPolicy`) che firma la revoca. I nodi critici per l'affidabilità devono registrare **≥2 chiavi** (TUF §6.1).
- Anche in caso di manomissione del file `node.json`, una revoca viene reimposta dagli eventi firmati e ancorati a XRPL: un manifesto modificato non può ripristinare una chiave revocata. Consultare il [modello delle minacce](docs/threat-model.md) per i limiti (verificare rispetto al registro canonico; utilizzare `--anchored` per i controlli sensibili alla revoca).

## Tipi di nodo

| Tipo | Ruolo |
|------|------|
| `registry` | Indicizza nodi e funzionalità |
| `attestor` | Verifica le affermazioni (build, conformità) |
| `policy` | Applica le regole (valutazione, controllo) |
| `oracle` | Fornisce dati esterni |
| `compute` | Esegue operazioni (trasformazioni, build) |
| `settlement` | Finalizza lo stato |
| `governance` | Prende decisioni |
| `identity` | Emette/verifica le credenziali |

## Estensione della rete: il contratto del plugin di verifica

Nuovi **tipi di controllo** e **nodi di verifica** vengono aggiunti modificando i dati, non il codice. Il registro dei tipi di controllo, i pesi di valutazione e le autorizzazioni per tipo di nodo sono contenuti in
[`verifier.policy.json`](verifier.policy.json) (convalidato tramite schema, con comportamento predefinito che prevede il blocco). L'aggiunta di un controllo (ad esempio `sast.scan`) consiste in una modifica della policy di circa 6 righe e in un file `node.json`, entrambi sottoposti a revisione in una PR; non è necessaria alcuna modifica del codice.

L'unica costante: **registrato ≠ affidabile**. La registrazione consente a un controllo di partecipare; tuttavia, l'attribuzione di credito richiede comunque il consenso da parte di un insieme di elementi considerati affidabili. Guida completa:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verifica pubblica

Chiunque può verificare una versione con un singolo comando: **non è richiesta alcuna clonazione**, la CLI recupera il registro pubblico per l'utente:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Questo controlla:
1. L'evento `ReleasePublished` esiste ed è firmato (Ed25519) da una chiave registrata nel file `node.json` **del repository stesso**: una chiave registrata in un repository diverso non può convalidarlo.
2. Il profilo di fiducia del repository è soddisfatto: ogni attestazione richiesta dal profilo (SBOM, provenienza, licenza, sicurezza) è presente, firmata da un attestatore affidabile e il suo risultato più recente è `pass`, con almeno un attestatore **indipendente**. Una versione con solo una firma autonoma e senza attestazioni indipendenti segnala `UNVERIFIED`, mai `PASS`.
3. Con `--anchored`: la radice di Merkle della partizione viene ricalcolata e confrontata con il manifesto e, quando la rete è raggiungibile, la transazione XRPL on-chain viene recuperata e verificata (`validated` + `tesSUCCESS`, l'account firmatario è presente nella lista consentita degli ancoraggi affidabili e la nota on-chain si riferisce alla radice/hash del manifesto locale/conteggio). In modalità offline, segnala `XRPL NOT verified` anziché una transazione falsa; con `--anchored` viene quindi rilevato un errore (utilizzare `--anchored-or-local` per accettare un manifesto verificato localmente senza la prova on-chain).

Per i controlli CI, scegliere un formato di output con `--format <text|json|sarif|markdown>` (`--json` è un alias per `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Il **codice di uscita** deriva dal verdetto a tre stati, quindi un passaggio CI può basarsi direttamente su questo:

| Uscita | Verdetto | Significato |
|------|---------|---------|
| `0` | PASS | Autentico e affidabile (o UNVERIFIED quando allentato con `--fail-on=fail`). |
| `1` | FAIL | Errore grave: firma contraffatta/proveniente da un repository errato, attestatore non presente nella lista consentita o fallimento di un controllo obbligatorio. |
| `3` | UNVERIFIED | Leggero: non ancora ancorato, nessuna testimonianza indipendente o mancava un controllo obbligatorio. |
| `2` | — | Errore di utilizzo o arresto anomalo interno. |

`--fail-on <fail|unverified>` imposta il livello di rigore. Il valore predefinito `unverified` causa un errore sia in caso di FAIL che di UNVERIFIED; `--fail-on=fail` consente a UNVERIFIED di passare (codice di uscita 0, con un avviso) per l'adozione in modalità di avviso.

Verificare un intero batch caricando tutti i dati nel registro con `verify-all` e verificare offline rispetto a una copia locale con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Integrarlo in CI** con l'azione composita fornita: consultare [Utilizzo dell'azione di GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consultare [docs/verification.md](docs/verification.md) per la guida completa alla verifica, il modello delle minacce e i concetti chiave.

### Utilizzalo come libreria

Il motore di verifica viene esportato come un'API programmatica stabile; incorporalo nei tuoi strumenti invece di utilizzare la CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Endpoint dello stato della rete

La dashboard pubblica un file [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) leggibile da una macchina, per il polling esterno: include informazioni sulla freschezza del registro (con un segnale di "registro congelato"), il numero di verdetti di fiducia, le partizioni ancorate rispetto a quelle in sospeso e un riepilogo `ok`/`degradato` con le relative motivazioni.

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
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestare una versione

> L'attestazione e l'esecuzione dei verificatori sono **attività dell'operatore** che agiscono su una copia di questo registro, quindi vengono eseguite da un checkout. La verifica di una versione non lo richiede: utilizzare il comando `npx` sopra indicato.

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

## Sicurezza e modello delle minacce

RepoMesh interagisce con gli **eventi del registro** (JSON firmati), i **manifesti dei nodi** (chiavi pubbliche + funzionalità), gli **indici del registro** (punteggi di fiducia generati automaticamente) e la **testnet XRPL** (transazioni di ancoraggio). Non interagisce con il codice sorgente dei repository membri, le chiavi private, le credenziali degli utenti o i dati di navigazione. Le chiavi di firma private non lasciano mai l'ambiente di esecuzione CI. L'accesso alla rete è limitato all'API GitHub (creazione di PR), alla testnet XRPL (ancoraggio) e a OSV.dev (ricerca di vulnerabilità). **Non vengono raccolti o inviati dati di telemetria**: zero analisi, zero segnalazioni di arresti anomali, zero comunicazioni verso casa. Consultare [SECURITY.md](SECURITY.md) per l'ambito completo, le autorizzazioni richieste e il processo di segnalazione delle vulnerabilità, nonché il [modello delle minacce](docs/threat-model.md) per i limiti del ciclo di vita della chiave (perché l'autenticità di `node.json` dipende dalla sua origine e perché la verifica sensibile alla revoca dovrebbe utilizzare `--anchored`).

Rafforzamento:

- Il codice JSON del registro e dell'elenco viene analizzato all'interno di un blocco `try`/`catch` con messaggi di errore strutturati e numerati; una riga non valida viene saltata e segnalata, senza mai causare l'arresto anomalo dello strumento con uno stacktrace grezzo.
- La traversia del percorso è impedita in tutte le operazioni sui file (risoluzione + controllo dei limiti).
- L'analisi è protetta contro attacchi ReDoS (nessuna espressione regolare non limitata).
- Le chiavi private PEM sono escluse tramite `.gitignore`, non vengono mai stampate su stdout o nei log CI e vengono scritte con permessi di sola lettura per il proprietario (`0600`).

## Test

La suite completa `node --test` copre le firme Ed25519, la convalida dello schema, l'integrità dell'albero di Merkle (v1 + RFC-6962 v2), gli invarianti append-only, la prevenzione della traversia del percorso, la verifica degli ancoraggi, la lista di controllo dei trusted attestor e la convalida degli input in tutti i livelli: CLI, registro, ancoraggio, verificatore e strumenti.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Il numero di test aumenta man mano che vengono aggiunte nuove suite; esegui il comando sopra per ottenere il conteggio corrente anziché affidarti a un numero che potrebbe diventare obsoleto.

## Licenza

MIT

---

Realizzato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
