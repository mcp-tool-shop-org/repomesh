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

Rilascia il registro e l'orologio di fiducia ancorato a XRPL per una rete di repository: eventi firmati, manifesti dei nodi e verifica. Separato dall'archivio eventi di Attestia.

## Posiziona nel sistema

Attestia, Cognate e RepoMesh sono tre prodotti.

**RepoMesh** è la rete di rilascio: eventi firmati, manifesti dei nodi e un orologio di fiducia ancorato a XRPL. Mantiene il proprio registro RFC 6962.

**Attestia** dimostra che un evento, una transazione o una transizione di stato si sono verificati e lega tale prova a una catena. Il dominio che offre è la verità finanziaria: portafoglio personale, tesoreria dell'organizzazione e registro. Le sue prove Merkle non sono questo registro.

**Cognate** è il dominio di governance AI sull'archivio eventi e sulle prove Merkle di Attestia. Chiama RepoMesh quando ha bisogno che un rilascio venga verificato. Non mantiene un secondo archivio eventi e non utilizza l'albero Merkle di Attestia per questa rete.

## Cosa c'è di nuovo nelle versioni 2.4 e 2.5

**Versione 2.5.1.**

- **2.5.1: rafforzamento della verifica.** Quando un verificatore firma più di un verdetto per la stessa verifica, ora ogni utente seleziona l'ultimo in base alla posizione nel registro, non in base al timestamp del firmatario. Un `verifier.policy.json` mancante o non valido ora fallisce, e qualsiasi tipo di verifica che la policy non riconosce viene trattato come chiuso in tutte le modalità.

- **2.5.0: il fallimento della pubblicazione dell'ancora.** `post-anchor.mjs` rifiuta di pubblicare e non apre alcuna connessione, a meno che la configurazione non indichi `testnet` e l'URL WebSocket sia un endpoint di testnet noto. Una variabile d'ambiente da sola non può modificare la pubblicazione sulla rete principale. Vedi [XRPL Anchoring (Testnet Guard)](#ancoraggio-xrpl-testnet-guard).
- **2.5.0: un gate di test obbligatorio.** Ogni richiesta di pull esegue tutte le 9 suite `node --test` con un limite di copertura delle righe e un `npm audit` di produzione a `high`. `validate-ledger` e `test` sono controlli obbligatori su `main`, e `registry-ci.yml` ora viene eseguito solo dopo che `ledger-ci` ha avuto successo su `main`.
- **2.4.0: esegui le attestazioni da Cognate.** Il registro accetta tre nuovi tipi di attestazione, `run.preregistered`, `run.outcome` e `cognate.root.anchored`, ciascuno con un digest `sha256` e un URI `urn:cognate:...`. Solo un nodo `governance` sia su `trustedAttestors` che su `trustedRunAttestors` (oggi, `mcp-tool-shop-org/cognate`) può firmarli e non può firmare altro. Ogni `run.outcome` deve fare riferimento a un evento `run.preregistered` già presente nel registro.
- **2.4.0: il contratto di firma viene verificato.** Una firma Ed25519 deve essere sui 32 byte grezzi di `canonicalHash`. Il validatore rifiuta una firma creata sul testo JSON canonico o sulla stringa esadecimale di 64 caratteri.

Consulta [CHANGELOG.md](CHANGELOG.md) per l'elenco completo.

## Cos'è questo?

RepoMesh trasforma una raccolta di repository in una rete cooperativa. Ogni repository è un **nodo** con:

- Un **manifesto** (`node.json`) che dichiara cosa fornisce e cosa utilizza
- **Eventi firmati** trasmessi a un registro di sola aggiunta
- Un **registro** che indicizza tutti i nodi e le capacità
- Un **profilo** che definisce cosa significa "completato" per la fiducia

Oggi, un'organizzazione GitHub, mcp-tool-shop-org, gestisce il log, gli attestatori, il controllo delle policy e l'ancora XRPL. Sette nodi registrati non significano sette operatori. Un testimone indipendente sarebbe una parte che questa organizzazione non gestisce.

La rete applica tre invarianti:

1. **Output deterministici:** stessi input, stessi artefatti
2. **Provenienza verificabile:** ogni rilascio è firmato e attestato
3. **Contratti componibili:** le interfacce sono versionate e leggibili dalle macchine

## Avvio rapido (1 comando + 2 segreti)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Questo genera tutto ciò di cui hai bisogno:
- `node.json`: il manifesto del tuo nodo
- `repomesh.profile.json`: il tuo profilo scelto
- `.github/workflows/repomesh-broadcast.yml`: flusso di lavoro di pubblicazione dei rilasci
- Ed25519: coppia di chiavi di firma (la chiave privata rimane locale)

Quindi, aggiungi due segreti al tuo repository:
1. `REPOMESH_SIGNING_KEY`: la tua chiave privata PEM (stampata da init)
2. `REPOMESH_LEDGER_TOKEN`: GitHub PAT con `contents:write` + `pull-requests:write` su questo repository

Esegui un rilascio. La fiducia converge automaticamente.

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
| `REPOMESH_FETCH_TIMEOUT` | Timeout di recupero in ms |

### Profili

| Profilo | Evidenza | Controlli di garanzia | Utilizza quando |
|---------|----------|-----------------|----------|
| `baseline` | Opzionale | Nessuno richiesto | Strumenti interni, esperimenti |
| `open-source` | SBOM + provenienza | Audit della licenza + scansione della sicurezza | Predefinito per OSS |
| `regulated` | SBOM + provenienza | Licenza + sicurezza + riproducibilità | Critico per la conformità |

### Verifica la fiducia

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra il punteggio di integrità, il punteggio di garanzia e le raccomandazioni specifiche del profilo.

### Override

Personalizzazione per repository senza creare fork dei verificatori:

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

## Unione manuale (5 minuti)

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
    { "name": "your-name", "contact": "https://github.com/your-org", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Genera una coppia di chiavi di firma

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` stampa la chiave pubblica + una `keyId` pronta per essere inserita nella voce dei manutentori del tuo `node.json` e scrive la chiave privata (modalità 0600) solo dove indichi `--out`: non in un percorso tracciato. Conservala come segreto del repository GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`.)

> **Registra ≥2 chiavi per un nodo critico per la fiducia** (TUF §6.1): una singola chiave non può firmare la propria revoca in caso di compromissione. `repomesh init --second-key` registra un secondo manutentore distinto in modo che una chiave possa revocare l'altra: `init` avvisa quando un nodo ha solo una chiave attiva.

### 3. Registrati nella rete

Apri una PR in questo repository aggiungendo il manifesto del tuo nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Aggiungi il flusso di lavoro di pubblicazione

Copia `templates/repomesh-broadcast.yml` nella directory `.github/workflows/` del tuo repository.
Imposta il segreto `REPOMESH_LEDGER_TOKEN` (un PAT granulare con i contenuti:write + pull-requests:write su questo repository).

Ogni nuova versione trasmetterà automaticamente un evento firmato `ReleasePublished` al registro.

## Regole del registro

- **Solo aggiunta** — le voci esistenti sono immutabili
- **Conforme allo schema** — ogni evento è valido rispetto a `schemas/event.schema.json`
- **Firma valida** — ogni evento è firmato da un responsabile di nodo registrato
- **Unico** — non sono ammesse voci duplicate `(repo, version, type)`
- **Timestamp corretto** — non più di 1 ora nel futuro o 1 anno nel passato

## Tipi di evento

Attualmente, il registro emette i seguenti tipi di evento **attivi**. Gli altri sono **riservati/pianificati**: lo schema li accetta, ma nessun nodo li emette ancora. Li elenchiamo in modo che la tabella di marcia sia visibile, senza implicare una copertura che non esiste (trasparenza per un prodotto basato sulla fiducia).

**Attivi (emessi oggi):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Viene rilasciata una nuova versione |
| `AttestationPublished` | Un attestatore verifica una versione |
| `ledger.anchor` | Il nodo di ancoraggio sigilla una partizione (radice Merkle + memo XRPL) |
| `attestation.dispute` | Un nodo affidabile contesta un'attestazione (abbassa il verdetto) |
| `KeyRotation` | Una chiave di responsabile viene ruotata su un successore (prospettiva: le firme precedenti rimangono valide) |
| `KeyRevocation` | Una chiave di responsabile viene revocata (compromissione = invalidità retroattiva, RFC 5280) |

`AttestationPublished` contiene anche le attestazioni di esecuzione di Cognate (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, a partire dalla versione 2.4.0), firmate solo dal suo `governance` nodo.

**Riservati/pianificati (non ancora emessi):**

| Tipo | Significato previsto |
|------|------------------|
| `BreakingChangeDetected` | Viene introdotta una modifica incompatibile |
| `HealthCheckFailed` | Un nodo non supera i propri controlli di integrità |
| `DependencyVulnFound` | Viene rilevata una vulnerabilità nelle dipendenze |
| `InterfaceUpdated` | Viene modificato uno schema di interfaccia |
| `PolicyViolation` | Viene violata una politica di rete. `policy/scripts/check-policy.mjs` può creare e firmare una politica; nessuna è ancora presente nel registro |

## Rotazione e revoca delle chiavi

Le chiavi dei responsabili hanno un ciclo di vita. Una chiave può essere **ruotata** su un successore o **revocata**, e la verifica è **sensibile al tempo**: una firma è considerata valida solo se la chiave era valida al momento della firma, ovvero l'orario di chiusura dell'ancora XRPL, lo stesso orologio affidabile che il registro utilizza già.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotazione di routine** è *prospettica*: le firme precedenti della chiave dismessa rimangono valide; semplicemente, smette di firmare le nuove versioni.
- La **compromissione** è *retroattiva* (RFC 5280 §5.3.2): qualsiasi firma il cui tempo di ancoraggio verificabile è uguale o successivo alla data di invalidità viene rifiutata e una firma che non può essere dimostrata essere precedente a tale data viene rifiutata.
- Una chiave che **non** ha campi del ciclo di vita viene considerata come una chiave esistente (sempre valida), quindi i nodi esistenti eseguono la verifica senza modifiche.
- Le revoche sono eventi `KeyRevocation` firmati; un nodo a chiave singola la cui unica chiave è compromessa viene ripristinato da un nodo di **governance** (`trustedPolicy`) che firma la revoca. I nodi critici per la fiducia devono registrare **≥2 chiavi** (TUF §6.1).
- Anche in caso di manomissione di `node.json`, una revoca viene reimposta dagli eventi firmati e ancorati a XRPL: un manifesto modificato non può ripristinare una chiave revocata. Vedere il [modello di minaccia](docs/threat-model.md) per i limiti (verificare rispetto al registro canonico; utilizzare `--anchored` per i controlli sensibili alla revoca).

## Tipi di nodo

| Tipo | Ruolo |
|------|------|
| `registry` | Indicizza nodi e capacità |
| `attestor` | Verifica le affermazioni (crea, conformità) |
| `policy` | Applica le regole (valutazione, controllo) |
| `oracle` | Fornisce dati esterni |
| `compute` | Esegue operazioni (trasforma, crea) |
| `settlement` | Finalizza lo stato |
| `governance` | Prende decisioni; a partire dalla versione 2.4.0, firma le attestazioni di esecuzione di Cognate e nient'altro |
| `identity` | Emette/verifica le credenziali |

## Estende la rete: il contratto verifier-plugin

Nuovi **tipi di controllo** e **nodi verifier** vengono aggiunti modificando i dati, non il codice. Il registro dei tipi di controllo, i pesi di valutazione e i permessi dei tipi di nodo sono disponibili all'indirizzo [`verifier.policy.json`](verifier.policy.json) (validati dallo schema, in caso di errore si interrompe l'esecuzione). L'aggiunta di un controllo (ad esempio, `sast.scan`) è una modifica di circa 6 righe alla politica + un `node.json`, esaminata in una PR: non è necessaria alcuna modifica al codice.

L'unica invariante: **registrato ≠ affidabile**. La registrazione consente a un controllo di partecipare; il credito richiede comunque il consenso di un insieme affidabile. Guida completa: [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verifica pubblica

Chiunque può verificare una versione con un singolo comando: **non è necessario clonare**, la CLI recupera il registro pubblico per te:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Questo controlla:
1. L'evento `ReleasePublished` esiste ed è firmato (Ed25519) da una chiave registrata per **quello specifico repository** `node.json`: una chiave registrata per un repository diverso non può convalidarla.
2. Il profilo di fiducia del repository è soddisfatto: ogni attestazione richiesta dal profilo (SBOM, provenienza, licenza, sicurezza) è presente, firmata da un attestatore affidabile e il suo risultato più recente in base alla posizione nel registro è `pass` (in base a `(check, signer)`, l'evento con l'indice di registro più alto prevale; il timestamp del firmatario è solo un dato), con almeno un attestatore **indipendente**. Una versione con solo una firma e nessuna attestazione indipendente segnala `UNVERIFIED`, mai `PASS`.
3. Con `--anchored`: la radice Merkle della partizione viene ricalcolata e confrontata con il manifesto e, quando la rete è raggiungibile, la transazione XRPL sulla catena viene recuperata e verificata (`validated` + `tesSUCCESS`, l'account di firma è presente nella lista di controllo degli ancoraggi affidabili e il memo sulla catena si riferisce alla radice/hash del manifesto/conteggio locale). In modalità offline, segnala `XRPL NOT verified` anziché una transazione falsa; quindi, un controllo rigoroso `--anchored` fallisce (utilizzare `--anchored-or-local` per accettare un manifesto verificato localmente senza la prova sulla catena).

Per i controlli CI, scegliere un formato di output con `--format <text|json|sarif|markdown>` (`--json` è un alias per `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Il **codice di uscita** deriva dal verdetto a tre stati, quindi un passaggio CI può basarsi direttamente su di esso:

| Uscita | Verdetto | Significato |
|------|---------|---------|
| `0` | PASS | Autentico e affidabile (o NON VERIFICATO quando è consentito da `--fail-on=fail`). |
| `1` | FAIL | Errore grave: firma contraffatta/errata del repository, attestatore non presente nella lista consentita o fallimento di un controllo obbligatorio. |
| `3` | NON VERIFICATO | Errore minore: ancora non ancorato, nessuna testimonianza indipendente o mancato controllo obbligatorio. |
| `2` | — | Errore di utilizzo o crash interno. |

### Container

La stessa CLI viene pubblicata come `ghcr.io/mcp-tool-shop-org/repomesh`, con l'etichetta della versione npm e l'hash Git. L'immagine viene eseguita come utente non root. Non contiene una seed del wallet.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

L'invio di un ancoraggio è un comando separato. `XRPL_SEED` viene passato in fase di esecuzione:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

Il flusso di lavoro giornaliero crea questa immagine dal checkout e la pubblica.

### Ancoraggio XRPL (Testnet Guard)

L'ancoraggio in `anchor/xrpl/config.json` è valido **solo per la testnet** (`"network": "testnet"`). `anchor/xrpl/scripts/post-anchor.mjs` applica una protezione di endpoint fail-closed (`assertPostingEndpoint`) prima di convalidare `XRPL_SEED` o costruire un `xrpl.Client`:

- **Controllo predefinito della testnet:** l'invio viene rifiutato (codice di uscita diverso da zero, nessun socket aperto) a meno che `config.network === "testnet"` **e** l'URL risolto WebSocket (`process.env.XRPL_WS_URL || config.rippledUrl`) non siano presenti in `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`). L'impostazione di `XRPL_WS_URL` su un URL della mainnet o sconosciuto viene rifiutata immediatamente con un messaggio che indica sia la rete risolta che l'URL risolto.
- **Inclusione opzionale nella mainnet (disabilitata):** una variabile d'ambiente da sola non può mai modificare l'invio alla mainnet. L'inclusione nella mainnet richiede un commit revisionato in `anchor/xrpl/config.json` che imposta `"network": "mainnet"`, `"allowMainnetPosting": true` e `"mainnetAllowedEndpoints": ["wss://..."]` contenenti l'endpoint di destinazione `wss://`, dopo aver aggiunto l'indirizzo classico della mainnet finanziato alla soglia della lista consentita fornita (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`). Tale lista consentita è una soglia: una configurazione recuperata può rimuovere un account e non può aggiungerne uno.

`--fail-on <fail\|unverified>` imposta il livello di rigore. Il valore predefinito `unverified` fallisce sia in caso di FAIL che di
NON VERIFICATO; `--fail-on=fail` consente a NON VERIFICATO di passare (codice di uscita 0, con un avviso) per l'adozione della modalità di avviso.

Verifica di un intero batch in un singolo caricamento del ledger con `verify-all` e verifica offline rispetto a una copia locale con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Implementalo nella CI** con l'azione composita fornita: consulta
[Utilizzo dell'azione GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulta [docs/verification.md](docs/verification.md) per la guida completa alla verifica, il modello di minaccia e i concetti chiave.

### Usalo come libreria

Il motore di verifica viene esportato come un'API programmatica stabile: incorporalo nei tuoi strumenti invece di eseguire chiamate alla CLI.

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Endpoint dello stato della rete

Il dashboard pubblica un formato leggibile dalla macchina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
per il polling esterno: aggiornamento del ledger (con un segnale di ledger congelato), conteggi dei verdetti di fiducia, partizioni ancorate rispetto a
partizioni in sospeso e un rollup `ok`/`degraded` con le relative motivazioni.

### Badge di fiducia

I repository possono incorporare badge di fiducia dal registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Fiducia e verifica

### Verifica di una release

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestazione di una release

> L'attestazione e l'esecuzione dei verificatori sono attività dell'**operatore** che agiscono su una copia di questo ledger, quindi vengono eseguite da un checkout. La verifica di una release non lo fa: usa il comando `npx` sopra.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Controlli: `sbom.present`, `provenance.present`, `signature.chain`

### Esegui i verificatori

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Le soglie dei verificatori di sicurezza (CVE massime, livelli di gravità consentiti) sono configurate tramite `verifiers/security/config.json`.

### Esegui i controlli delle policy

```bash
node policy/scripts/check-policy.mjs
```

Controlli: monotonicità semver, unicità dell'hash dell'artefatto, funzionalità richieste.

## Sicurezza e modello di minaccia

RepoMesh accede agli **eventi del ledger** (JSON firmato), ai **manifesti dei nodi** (chiavi pubbliche + funzionalità), agli **indici del registro** (punteggi di fiducia generati automaticamente) e alla **testnet XRPL** (transazioni di ancoraggio; l'invio rifiuta qualsiasi endpoint che non sia un endpoint di testnet noto). Non accede al codice sorgente del repository dei membri, alle chiavi private, alle credenziali dell'utente o ai dati di navigazione. Le chiavi di firma private non lasciano mai l'ambiente di esecuzione della CI. L'accesso alla rete è limitato all'API GitHub (creazione di PR), alla testnet XRPL (ancoraggio) e a OSV.dev (ricerca di vulnerabilità). **Non vengono raccolti o inviati dati di telemetria**: zero analisi, zero report di crash, zero invio di dati a casa. Consulta [SECURITY.md](SECURITY.md) per l'ambito completo, le autorizzazioni richieste e il processo di segnalazione delle vulnerabilità, e il [modello di minaccia](docs/threat-model.md) per il limite di fiducia del ciclo di vita della chiave (perché l'autenticità di `node.json` dipende dalla sua origine e perché la verifica sensibile alla revoca dovrebbe utilizzare `--anchored`).

Rafforzamento:

- Le chiamate a processi figlio che interpolano dati variabili utilizzano `execFileSync` con argomenti di array; le restanti chiamate `execSync` utilizzano stringhe di comando statiche e costanti: nessun vettore di injection di shell.
- Il JSON del ledger e del registro viene analizzato all'interno di `try`/`catch` con errori strutturati e numerati per riga; una riga non valida viene saltata e visualizzata, non causa mai l'arresto anomalo dello strumento con uno stack grezzo.
- La traversia del percorso viene impedita in tutte le operazioni sui file (risoluzione + controllo dei limiti).
- Analisi ReDoS-safe in tutto il codice (nessuna espressione regolare illimitata).
- Le chiavi private PEM vengono escluse tramite `.gitignore`, non vengono mai stampate su stdout o nei log della CI e vengono scritte con autorizzazioni solo per il proprietario (`0600`).

## Test

La suite completa `node --test` copre Ed25519 firme, convalida dello schema, integrità dell'albero di Merkle (v1 + RFC-6962 v2), invarianti append-only, prevenzione della traversia del percorso, verifica dell'ancoraggio, la lista consentita degli attestatori affidabili e la convalida dell'input in tutti i livelli della CLI, del ledger, dell'ancoraggio, del verificatore e degli strumenti.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Il numero di test aumenta man mano che vengono aggiunte nuove suite: esegui il comando sopra per il totale corrente invece di fare affidamento su un numero che diventa obsoleto.

La CI esegue le stesse 9 suite su ogni richiesta di pull (`ledger-ci.yml`, il controllo obbligatorio `test`), con `--experimental-test-coverage` e una soglia di copertura delle righe (`--test-coverage-lines=57`), quindi `npm audit --audit-level=high --omit=dev` per la radice, `anchor/xrpl` e `ledger`.

## Licenza

MIT

---

Creato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
