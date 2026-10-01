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

Rete di repository sintropica: registro di sola aggiunta, manifesti dei nodi e punteggio per il coordinamento distribuito dei repository.

## Posizione nel sistema

Attestia, Cognate e RepoMesh sono tre prodotti.

**RepoMesh** è la rete di rilascio: eventi firmati, manifesti dei nodi e un orologio di fiducia ancorato a XRPL. Mantiene il proprio registro RFC 6962.

**Attestia** dimostra che un evento, una transazione o una transizione di stato si sono verificati e lega tale prova a una catena. Il dominio che offre è la verità finanziaria: portafoglio personale, tesoreria dell'organizzazione e registro. Le sue prove Merkle non sono questo registro.

**Cognate** è il dominio di governance AI sullo store di eventi e sulle prove Merkle di Attestia. Chiama RepoMesh quando ha bisogno che un rilascio venga verificato. Non mantiene un secondo store di eventi e non utilizza l'albero Merkle di Attestia per questa rete.

## Cos'è questo?

RepoMesh trasforma una raccolta di repository in una rete cooperativa. Ogni repository è un **nodo** con:

- Un **manifesto** (`node.json`) che dichiara cosa fornisce e cosa utilizza
- **Eventi firmati** trasmessi a un registro di sola aggiunta
- Un **registro** che indicizza tutti i nodi e le funzionalità
- Un **profilo** che definisce cosa significa "completato" per la fiducia

Oggi, un'organizzazione GitHub, mcp-tool-shop-org, gestisce il registro, gli attestatori, il controllo delle policy e l'ancora XRPL. Sei nodi registrati non equivalgono a sei operatori. Un testimone indipendente sarebbe una parte che questa organizzazione non gestisce.

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
- `.github/workflows/repomesh-broadcast.yml`: flusso di lavoro di trasmissione del rilascio
- Coppia di chiavi di firma Ed25519 (la chiave privata rimane locale)

Quindi, aggiungi due segreti al tuo repository:
1. `REPOMESH_SIGNING_KEY`: la tua chiave privata in formato PEM (stampata da init)
2. `REPOMESH_LEDGER_TOKEN`: GitHub PAT con `contents:write` + `pull-requests:write` su questo repository

Esegui un rilascio. La fiducia converge automaticamente.

### Flag della CLI

Tutti i comandi accettano: `--quiet`, `--verbose`, `--debug`, `--no-color`. Il comando `init` supporta anche `--json` per un output leggibile dalle macchine.

Sono disponibili completamenti per la shell:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Override dell'ambiente

| Variabile | Scopo |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Override dell'endpoint del registro |
| `REPOMESH_MANIFESTS_URL` | Override dell'endpoint dei manifesti |
| `REPOMESH_FETCH_TIMEOUT` | Timeout di recupero in ms |

### Profili

| Profilo | Evidenza | Controlli di garanzia | Quando utilizzare |
|---------|----------|-----------------|----------|
| `baseline` | Facoltativo | Nessuno richiesto | Strumenti interni, esperimenti |
| `open-source` | SBOM + provenienza | Audit della licenza + scansione di sicurezza | Predefinito per OSS |
| `regulated` | SBOM + provenienza | Licenza + sicurezza + riproducibilità | Critico per la conformità |

### Verifica la fiducia

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra il punteggio di integrità, il punteggio di garanzia e le raccomandazioni specifiche per il profilo.

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

`keygen` stampa la chiave pubblica + un `keyId` pronto per essere inserito nella voce dei manutentori del tuo `node.json` e
scrive la chiave privata (modalità 0600) solo dove indichi `--out`: non in un percorso tracciato. Salvala come
segreto del repository GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`.)

> **Registra ≥2 chiavi per un nodo critico per la fiducia** (TUF §6.1): una singola chiave non può firmare la propria revoca in caso di compromissione. `repomesh init --second-key` registra un secondo manutentore distinto in modo che una chiave possa revocare l'altra: `init` avvisa quando un nodo ha solo una chiave attiva.

### 3. Registrati nella rete

Apri una PR su questo repository aggiungendo il manifesto del tuo nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Aggiungi il flusso di lavoro di trasmissione

Copia `templates/repomesh-broadcast.yml` nella directory `.github/workflows/` del tuo repository.
Imposta il segreto `REPOMESH_LEDGER_TOKEN` (un PAT granulare con i seguenti contenuti: write + pull-requests:write su questo repository).

Ogni rilascio trasmetterà automaticamente un evento firmato `ReleasePublished` al registro.

## Regole del registro

- **Solo aggiunta:** le righe esistenti sono immutabili
- **Schema valido:** ogni evento convalida rispetto a `schemas/event.schema.json`
- **Firma valida:** ogni evento è firmato da un manutentore del nodo registrato
- **Unico:** non sono ammesse voci `(repo, version, type)` duplicate
- **Timestamp corretto:** non più di 1 ora nel futuro o 1 anno nel passato

## Tipi di evento

Il registro emette attualmente i tipi di evento **attivi** elencati di seguito. Il resto sono **riservati / pianificati**: lo schema li accetta, ma nessun nodo li emette ancora. Li elenchiamo in modo che la roadmap sia visibile senza implicare una copertura che non esiste (onestà di base per un prodotto di fiducia).

**Attivi (emessi oggi):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Viene rilasciata una nuova versione |
| `AttestationPublished` | Un attestatore verifica un rilascio |
| `ledger.anchor` | Il nodo di ancoraggio sigilla una partizione (radice Merkle + memo XRPL) |
| `attestation.dispute` | Un nodo affidabile contesta un'attestazione (degrada la valutazione) |
| `KeyRotation` | Una chiave di manutentore viene ruotata a un successore (prospettico: le firme passate rimangono valide) |
| `KeyRevocation` | Una chiave di manutentore viene revocata (compromissione = invalidità retroattiva, RFC 5280) |

**Riservati / pianificati (non ancora emessi):**

| Tipo | Significato previsto |
|------|------------------|
| `BreakingChangeDetected` | Viene introdotta una modifica incompatibile |
| `HealthCheckFailed` | Un nodo non supera i propri controlli di integrità |
| `DependencyVulnFound` | È stata individuata una vulnerabilità nelle dipendenze |
| `InterfaceUpdated` | Lo schema di un'interfaccia cambia |
| `PolicyViolation` | Una policy di rete viene violata |

## Rotazione e revoca delle chiavi

Le chiavi del manutentore hanno un ciclo di vita. Una chiave può essere **sostituita** con una chiave successiva o **revocata** e la verifica è **sensibile al tempo**: una firma è considerata valida solo se la chiave era valida al momento della firma, ovvero al momento di riferimento dell'ancora XRPL, lo stesso orologio affidabile già utilizzato nel ledger.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotazione periodica** è *prospettica*: le firme precedenti della chiave obsoleta rimangono valide; semplicemente, smette di firmare nuove versioni.
- La **compromissione** è *retroattiva* (RFC 5280 §5.3.2): qualsiasi firma il cui tempo di ancoraggio verificabile è uguale o successivo alla data di invalidità viene rifiutata e una firma che non può essere dimostrata essere antecedente a tale data viene rifiutata.
- Una chiave che **non** ha campi del ciclo di vita è considerata "ereditata" (sempre valida), quindi i nodi esistenti eseguono la verifica senza modifiche.
- Le revoche sono eventi firmati `KeyRevocation`; un nodo a chiave singola la cui unica chiave è stata compromessa viene ripristinato da un nodo di **governance** (`trustedPolicy`) che firma la revoca. I nodi critici per la fiducia dovrebbero registrare **≥2 chiavi** (TUF §6.1).
- Anche in caso di manomissione di `node.json`, una revoca viene riapplicata dagli eventi firmati e ancorati a XRPL: un manifest modificato non può ripristinare una chiave revocata. Consultare il [modello di minaccia](docs/threat-model.md) per i limiti (verificare rispetto al ledger canonico; utilizzare `--anchored` per i controlli sensibili alla revoca).

## Tipi di nodo

| Tipo | Ruolo |
|------|------|
| `registry` | Indica i nodi e le loro capacità |
| `attestor` | Verifica le affermazioni (build, conformità) |
| `policy` | Applica le regole (valutazione, controllo) |
| `oracle` | Fornisce dati esterni |
| `compute` | Esegue operazioni (trasformazioni, build) |
| `settlement` | Finalizza lo stato |
| `governance` | Prende decisioni |
| `identity` | Emette/verifica le credenziali |

## Estensione della rete: il contratto verifier-plugin

Nuovi **tipi di controllo** e **nodi verifier** vengono aggiunti modificando i dati, non il codice. Il registro dei tipi di controllo, i pesi di valutazione e i permessi dei tipi di nodo sono contenuti in
[`verifier.policy.json`](verifier.policy.json) (convalidato tramite schema, in caso di errore si interrompe l'esecuzione). L'aggiunta di un controllo (ad esempio, `sast.scan`) è una modifica della policy di circa 6 righe + un `node.json`, esaminata in una PR: non si tratta di una modifica del codice.

L'unica invariante: **registrato ≠ affidabile**. La registrazione consente a un controllo di partecipare; l'approvazione richiede comunque il consenso di un insieme affidabile. Guida completa:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verifica pubblica

Chiunque può verificare una versione con un singolo comando: **non è necessario clonare**, la CLI recupera il ledger pubblico per te:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Questo verifica:
1. L'evento `ReleasePublished` esiste ed è firmato (Ed25519) da una chiave registrata per **il `node.json` di quel repository**: una chiave registrata per un repository diverso non può convalidarla.
2. Il profilo di fiducia del repository è soddisfatto: ogni attestazione richiesta dal profilo (SBOM, provenienza, licenza, sicurezza) è presente, firmata da un attestatore affidabile e il suo risultato più recente è `pass`, con almeno un attestatore **indipendente**. Una versione con solo una firma autonoma e senza attestazioni indipendenti segnala `UNVERIFIED`, mai `PASS`.
3. Con `--anchored`: la radice di Merkle della partizione viene ricalcolata e confrontata con il manifest e, quando la rete è raggiungibile, la transazione XRPL on-chain viene recuperata e verificata (`validated` + `tesSUCCESS`, l'account di firma è presente nella lista di controllo degli ancoraggi affidabili e la nota on-chain si riferisce alla radice/hash/conteggio locali). In modalità offline, segnala `XRPL NOT verified` anziché una transazione falsa; quindi, un controllo rigoroso `--anchored` fallisce (utilizzare `--anchored-or-local` per accettare un manifest verificato localmente senza la prova on-chain).

Per i controlli CI, scegliere un formato di output con `--format <text|json|sarif|markdown>` (`--json` è un alias per `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

Il **codice di uscita** deriva dal verdetto a tre stati, quindi un passaggio CI può basarsi direttamente su di esso:

| Uscita | Verdetto | Significato |
|------|---------|---------|
| `0` | PASS | Autentico e affidabile (o NON VERIFICATO quando è consentito da `--fail-on=fail`). |
| `1` | FAIL | Errore grave: firma contraffatta/proveniente da un repository errato, attestatore non presente nella lista di controllo o fallimento di un controllo obbligatorio. |
| `3` | UNVERIFIED | Errore minore: non ancora ancorato, nessuna attestazione indipendente o mancava un controllo obbligatorio. |
| `2` | — | Errore di utilizzo o arresto anomalo interno. |

### Container

La stessa CLI viene pubblicata come `ghcr.io/mcp-tool-shop-org/repomesh`, con l'etichetta della versione npm e l'hash Git. L'immagine viene eseguita come utente non root. Non contiene un seed del wallet.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

L'invio di un'ancora è un comando separato. `XRPL_SEED` viene passato in fase di esecuzione:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

Il flusso di lavoro giornaliero crea questa immagine dal checkout e la pubblica. La rete in `anchor/xrpl/config.json` è ancora testnet. L'invio alla mainnet attende un account finanziato, il cui indirizzo classico viene aggiunto alla lista di controllo fornita con la release della CLI. Tale lista di controllo è un limite: una configurazione recuperata può rimuovere un account, ma non aggiungerne uno.

`--fail-on <fail\|unverified>` imposta il livello di rigore. Il valore predefinito `unverified` fallisce sia con FAIL che con UNVERIFIED; `--fail-on=fail` consente a UNVERIFIED di passare (codice di uscita 0, con un avviso) per l'adozione in modalità di avviso.

Verificare un intero batch in un singolo caricamento del ledger con `verify-all` e verificare offline rispetto a un clone locale con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Integrarlo nel CI** con l'azione composita fornita: vedere
[Utilizzo dell'azione di GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consultare [docs/verification.md](docs/verification.md) per la guida completa alla verifica, il modello di minaccia e i concetti chiave.

### Utilizzarlo come libreria

Il motore di verifica viene esportato come un'API programmatica stabile: integralo nei tuoi strumenti anziché eseguire il comando CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Endpoint dello stato della rete

La dashboard pubblica un file leggibile da macchina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) per il controllo esterno: aggiornamento del registro (con un segnale di registro bloccato), conteggio dei risultati di affidabilità, partizioni ancorate rispetto a quelle in sospeso e un rollup `ok`/`degraded` con motivazioni.

### Badge di affidabilità

I repository possono incorporare badge di affidabilità dal registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Affidabilità e verifica

### Verifica di una versione

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Attestazione di una versione

> L'attestazione e l'esecuzione dei verificatori sono attività dell'**operatore** che agiscono su una copia di questo registro, quindi vengono eseguite da un checkout. La verifica di una versione non lo fa: utilizzare il comando `npx` sopra.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Controlli: `sbom.present`, `provenance.present`, `signature.chain`

### Esecuzione dei verificatori

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Le soglie dei verificatori di sicurezza (CVE massime, livelli di gravità consentiti) sono configurate tramite `verifiers/security/config.json`.

### Esecuzione dei controlli delle policy

```bash
node policy/scripts/check-policy.mjs
```

Controlli: monotonicità semver, unicità dell'hash dell'artefatto, funzionalità richieste.

## Sicurezza e modello di minaccia

RepoMesh interagisce con gli **eventi del registro** (JSON firmato), i **manifesti dei nodi** (chiavi pubbliche + funzionalità), gli **indici del registro** (punteggi di affidabilità generati automaticamente) e la **XRPL testnet** (transazioni di ancoraggio). Non interagisce con il codice sorgente del repository membro, le chiavi private, le credenziali dell'utente o i dati di navigazione. Le chiavi di firma private non lasciano mai l'ambiente di esecuzione CI. L'accesso alla rete è limitato all'API di GitHub (creazione di PR), alla XRPL testnet (ancoraggio) e a OSV.dev (ricerca di vulnerabilità). **Non vengono raccolti o inviati dati di telemetria**: zero analisi, zero segnalazioni di errori, zero comunicazioni verso casa. Consultare [SECURITY.md](SECURITY.md) per l'ambito completo, le autorizzazioni richieste e il processo di segnalazione delle vulnerabilità, e [il modello di minaccia](docs/threat-model.md) per il limite di fiducia del ciclo di vita della chiave (perché l'autenticità di `node.json` dipende dalla sua origine e perché la verifica sensibile alla revoca dovrebbe utilizzare `--anchored`).

Rafforzamento della sicurezza:

- Le chiamate a processi figlio che interpolano dati variabili utilizzano `execFileSync` con argomenti di array; le restanti chiamate `execSync` utilizzano stringhe di comando statiche e costanti, senza vettori di injection di shell.
- Il JSON del registro e del registro viene analizzato all'interno di `try`/`catch` con errori strutturati e numerati; una riga non valida viene saltata e segnalata, senza mai causare l'arresto anomalo dello strumento con uno stack di chiamate non elaborato.
- La traversia del percorso è impedita in tutte le operazioni sui file (risoluzione + controllo dei limiti).
- Analisi sicura contro ReDoS in tutto il codice (nessuna espressione regolare illimitata).
- Le chiavi private PEM sono escluse tramite `.gitignore`, non vengono mai stampate su stdout o nei log CI e vengono scritte con autorizzazioni solo per il proprietario (`0600`).

## Test

La suite completa `node --test` copre le firme Ed25519, la convalida dello schema, l'integrità dell'albero di Merkle (v1 + RFC-6962 v2), gli invarianti di sola aggiunta, la prevenzione della traversia del percorso, la verifica dell'ancoraggio, la lista di controllo degli attestatori affidabili e la convalida dell'input in tutti i livelli della CLI, del registro, dell'ancoraggio, del verificatore e degli strumenti.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

Il numero di test aumenta man mano che vengono aggiunte nuove suite: eseguire il comando sopra per il totale corrente anziché fare affidamento su un numero che cambia nel tempo.

## Licenza

MIT

---

Realizzato da <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
