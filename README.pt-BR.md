<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.md">English</a>
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

Rede de repos sinérgica — livro-razão de apenas anexação, manifestos de nós e pontuação para coordenação distribuída de repos.

## O que é isso?

RepoMesh transforma uma coleção de repos em uma rede cooperativa. Cada repo é um **nó** com:

- Um **manifesto** (`node.json`) declarando o que ele fornece e consome
- **Eventos assinados** transmitidos para um livro-razão de apenas anexação
- Um **registro** que indexa todos os nós e capacidades
- Um **perfil** que define o que significa "concluído" para fins de confiança

Atualmente, uma organização do GitHub, mcp-tool-shop-org, opera o registro, os verificadores, a verificação de políticas e o âncora XRPL. Seis nós registrados não significam seis operadores. Uma testemunha independente seria uma parte que esta organização não opera.

A rede impõe três invariantes:

1. **Saídas determinísticas** — mesmas entradas, mesmos artefatos
2. **Provável verificável** — cada lançamento é assinado e atestado
3. **Contratos compostos** — as interfaces são versionadas e legíveis por máquina

## Início rápido (1 comando + 2 segredos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Isso gera tudo o que você precisa:
- `node.json` — seu manifesto de nó
- `repomesh.profile.json` — seu perfil escolhido
- `.github/workflows/repomesh-broadcast.yml` — fluxo de trabalho de transmissão de lançamento
- Par de chaves de assinatura Ed25519 (a chave privada permanece local)

Em seguida, adicione dois segredos ao seu repo:
1. `REPOMESH_SIGNING_KEY` — sua chave privada PEM (impressa por init)
2. `REPOMESH_LEDGER_TOKEN` — GitHub PAT com `contents:write` + `pull-requests:write` neste repo

Faça um lançamento. A confiança converge automaticamente.

### Flags da CLI

Todos os comandos aceitam: `--quiet`, `--verbose`, `--debug`, `--no-color`. O comando `init` também suporta `--json` para saída legível por máquina.

Os complementos de shell estão disponíveis:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Substituições de ambiente

| Variável | Finalidade |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Substituir o endpoint do livro-razão |
| `REPOMESH_MANIFESTS_URL` | Substituir o endpoint dos manifestos |
| `REPOMESH_FETCH_TIMEOUT` | Tempo limite de busca em ms |

### Perfis

| Perfil | Evidência | Verificações de garantia | Usar quando |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Nenhum necessário | Ferramentas internas, experimentos |
| `open-source` | SBOM + proveniência | Auditoria de licença + verificação de segurança | Padrão para OSS |
| `regulated` | SBOM + proveniência | Licença + segurança + reprodutibilidade | Crítico para conformidade |

### Verificar confiança

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra a pontuação de integridade, a pontuação de garantia e recomendações com reconhecimento do perfil.

### Substituições

Personalização por repo sem bifurcar os verificadores:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Estrutura do repo

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

## Participação manual (5 minutos)

### 1. Crie seu manifesto de nó

Adicione `node.json` à raiz do seu repo:

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

### 2. Gere um par de chaves de assinatura

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` imprime a chave pública + um `keyId` pronto para ser adicionado à entrada de seus `node.json` mantenedores e
grava a chave privada (modo 0600) apenas onde você aponta `--out` — nunca em um caminho rastreado. Armazene-o como um
segredo do repo do GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`.)

> **Registre ≥2 chaves para um nó crítico para a confiança** (TUF §6.1): uma única chave não pode assinar sua própria
> revogação se for comprometida. `repomesh init --second-key` registra um segundo mantenedor distinto para que uma
> chave possa revogar a outra — `init` avisa quando um nó tem apenas uma chave ativa.

### 3. Registre-se na rede

Abra um PR para este repo, adicionando seu manifesto de nó:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Adicione o fluxo de trabalho de transmissão

Copie `templates/repomesh-broadcast.yml` para o `.github/workflows/` do seu repo.
Defina o segredo `REPOMESH_LEDGER_TOKEN` (um PAT de granularidade fina com conteúdos:write + pull-requests:write neste repo).

Cada lançamento agora transmitirá automaticamente um evento `ReleasePublished` assinado para o livro-razão.

## Regras do livro-razão

- **Apenas anexação** — as linhas existentes são imutáveis
- **Validação de esquema** — cada evento é validado em relação a `schemas/event.schema.json`
- **Validação de assinatura** — cada evento é assinado por um mantenedor de nó registrado
- **Único** — sem entradas `(repo, version, type)` duplicadas
- **Carimbo de data/hora sensato** — não mais de 1 hora no futuro ou 1 ano no passado

## Tipos de evento

O livro-razão atualmente emite os tipos de evento **ativos** abaixo. O restante são **reservados / planejados** — o
esquema os aceita, mas nenhum nó os emite ainda. Nós os listamos para que o roteiro seja visível sem
implicar cobertura que não existe (honestidade de porta de entrada para um produto de confiança).

**Ativo (emitido hoje):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Uma nova versão é lançada |
| `AttestationPublished` | Um verificador verifica um lançamento |
| `ledger.anchor` | O nó âncora sela uma partição (raiz Merkle + memorando XRPL) |
| `attestation.dispute` | Um nó confiável contesta uma atestação (rebaixa o veredicto) |
| `KeyRotation` | Uma chave de mantenedor é rotacionada para um sucessor (prospectivo — assinaturas passadas permanecem válidas) |
| `KeyRevocation` | Uma chave de mantenedor é revogada (comprometimento = invalidade retroativa, RFC 5280) |

**Reservado / planejado (ainda não emitido):**

| Tipo | Significado pretendido |
|------|------------------|
| `BreakingChangeDetected` | Uma alteração incompatível é introduzida |
| `HealthCheckFailed` | Um nó falha em seus próprios testes de integridade |
| `DependencyVulnFound` | Uma vulnerabilidade é encontrada em dependências |
| `InterfaceUpdated` | Um esquema de interface é alterado |
| `PolicyViolation` | Uma política de rede é violada |

## Rotação e revogação de chaves

As chaves do mantenedor têm um ciclo de vida. Uma chave pode ser **rotacionada** para um sucessor ou **revogada**, e
a verificação é **consciente do tempo**: uma assinatura é confiável apenas se a chave era válida no momento da assinatura — o tempo de fechamento do âncora XRPL, o mesmo relógio confiável que o livro-razão já usa.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- A **rotação de chaves** é *prospectiva* — as assinaturas anteriores da chave desativada permanecem válidas; ela simplesmente
deixa de assinar novas versões.
- A **comprometimento** é *retroativo* (RFC 5280 §5.3.2) — qualquer assinatura cujo tempo de ancoragem comprovável seja
na/após a data de invalidação é rejeitada, e uma assinatura que não possa ser comprovada como anterior a essa data também é
rejeitada.
- Uma chave sem campos de ciclo de vida é considerada como existente desde o início (sempre válida), portanto, os nós existentes verificam
se não houve alterações.
- As revogações são eventos assinados `KeyRevocation`; um nó de chave única cuja única chave foi comprometida é
restaurado por um nó de **governança** (`trustedPolicy`) que assina a revogação. Os nós críticos para a confiança
devem registrar **≥2 chaves** (TUF §6.1).
- Mesmo contra uma manipulação `node.json`, uma revogação é reativada a partir dos eventos assinados e ancorados na XRPL — um manifesto alterado não pode reativar uma chave revogada. Consulte o [modelo de ameaças](docs/threat-model.md)
para o limite (verifique em relação ao livro-razão canônico; use `--anchored` para verificações sensíveis à revogação).

## Tipos de nó

| Tipo | Função |
|------|------|
| `registry` | Indexa nós e capacidades |
| `attestor` | Verifica alegações (compilações, conformidade) |
| `policy` | Aplica regras (pontuação, controle de acesso) |
| `oracle` | Fornece dados externos |
| `compute` | Realiza tarefas (transformações, compilações) |
| `settlement` | Finaliza o estado |
| `governance` | Toma decisões |
| `identity` | Emite/verifica credenciais |

## Expandindo a rede — o contrato do plugin verificador

Novos **tipos de verificação** e **nós verificadores** são adicionados editando os dados, não o código. O registro de tipos de verificação, os pesos de pontuação e as permissões de tipo de nó estão localizados em
[`verifier.policy.json`](verifier.policy.json) (validados por esquema, falha segura). Adicionar uma verificação (por exemplo,
`sast.scan`) é uma edição de política de cerca de 6 linhas + um `node.json`, revisada em um PR — sem alteração de código.

A única invariante: **registrado ≠ confiável**. O registro permite que uma verificação participe; o crédito ainda
requer um consenso do conjunto confiável. Guia completo:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verificação pública

Qualquer pessoa pode verificar uma versão com um único comando — **não é necessário clonar**, a CLI obtém o
livro-razão público para você:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Isso verifica:
1. O evento `ReleasePublished` existe e é assinado (Ed25519) por uma chave registrada no **próprio** `node.json` do repositório — uma chave registrada em um repositório diferente não pode validá-lo.
2. O perfil de confiança do repositório é satisfeito: cada atestação exigida pelo perfil (SBOM, rastreabilidade, licença, segurança) está presente, assinada por um atestador confiável e seu resultado mais recente é `pass`, com pelo menos um atestador **independente**. Uma versão com apenas uma autoassinatura e sem atestações independentes relata `UNVERIFIED`, nunca `PASS`.
3. Com `--anchored`: a raiz de Merkle da partição é recalculada e correspondida ao manifesto e — quando a rede estiver acessível — a transação XRPL na cadeia é obtida e confirmada (`validated` + `tesSUCCESS`, a conta de assinatura está na lista de permissões de âncoras confiáveis e o memo na cadeia se vincula à raiz/hash/contagem local). Offline, relata `XRPL NOT verified` em vez de uma transação falsa; a verificação estrita `--anchored` falha (use `--anchored-or-local` para aceitar um manifesto verificado localmente sem a prova na cadeia).

Para os controles de CI, escolha um formato de saída com `--format <text|json|sarif|markdown>` (`--json` é um alias
para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

O **código de saída** é derivado do veredicto de três estados, portanto, um passo de CI pode usá-lo diretamente:

| Saída | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Autêntico e garantido (ou NÃO VERIFICADO quando relaxado por `--fail-on=fail`). |
| `1` | FAIL | Falha grave — assinatura falsificada/de repositório incorreto, atestador não autorizado ou uma verificação obrigatória falhou. |
| `3` | UNVERIFIED | Suave — ainda não ancorado, sem testemunha independente ou uma verificação obrigatória ausente. |
| `2` | — | Erro de uso ou falha interna. |

### Contêiner

A mesma CLI é publicada como `ghcr.io/mcp-tool-shop-org/repomesh`, com a tag da versão npm e o hash Git. A imagem é executada como um usuário não root. Não contém uma semente de carteira.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

Postar uma âncora é um comando separado. `XRPL_SEED` é passado em tempo de execução:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

O fluxo de trabalho diário cria esta imagem a partir do checkout e a posta com ela. A rede em `anchor/xrpl/config.json` ainda é a testnet. Uma postagem na mainnet aguarda uma conta financiada cujo endereço clássico é adicionado à lista de permissões enviada em uma versão da CLI primeiro. Essa lista de permissões é um limite: uma configuração obtida pode remover uma conta e não pode adicionar uma.

`--fail-on <fail\|unverified>` define o rigor. O padrão `unverified` falha em FAIL e
UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED passe (saída 0, com um aviso) para a adoção do modo de aviso.

Verifique um lote inteiro em uma única carga do livro-razão com `verify-all` e verifique offline em relação a um clone local
com `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Controle-o no CI** com a ação composta incluída — consulte
[Usando a Ação do GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulte [docs/verification.md](docs/verification.md) para obter o guia completo de verificação, o modelo de ameaças e os conceitos-chave.

### Use-o como uma biblioteca

O mecanismo de verificação é exportado como uma API programática estável — incorpore-o em suas próprias ferramentas
em vez de executar comandos na CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Ponto de extremidade de status da rede

O painel publica uma máquina legível [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
para polling externo — atualização do livro-razão (com um sinal de livro-razão congelado), contagens de veredicto de confiança, partições ancoradas versus
partições pendentes e um resumo `ok`/`degraded` com motivos.

### Crachás de confiança

Os repositórios podem incorporar crachás de confiança do registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiança e verificação

### Verificar uma versão

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Atestar uma versão

> A execução de verificadores e a confirmação de sua validade são tarefas do **operador** que atuam em uma cópia deste livro-razão, portanto, são executadas a partir de um checkout. A verificação de uma versão não utiliza o comando `npx` acima.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Verificações: `sbom.present`, `provenance.present`, `signature.chain`

### Executar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Os limites dos verificadores de segurança (número máximo de CVEs, níveis de severidade permitidos) são definidos por meio da configuração em `verifiers/security/config.json`.

### Executar verificações de política

```bash
node policy/scripts/check-policy.mjs
```

Verificações: monotonicidade semântica, unicidade do hash do artefato, capacidades obrigatórias.

## Segurança e Modelo de Ameaças

O RepoMesh interage com **eventos do livro-razão** (JSON assinado), **manifestos de nó** (chaves públicas + capacidades), **índices do registro** (pontuações de confiança geradas automaticamente) e **XRPL testnet** (transações de âncora). Ele **não** interage com o código-fonte do repositório do membro, chaves privadas, credenciais de usuário ou dados de navegação. As chaves de assinatura privadas nunca saem do executor CI. O acesso à rede é limitado à API do GitHub (criação de PR), XRPL testnet (ancoragem) e OSV.dev (pesquisa de vulnerabilidades). **Nenhuma telemetria** é coletada ou enviada — zero análises, zero relatórios de falhas, zero comunicação com servidores externos. Consulte [SECURITY.md](SECURITY.md) para obter o escopo completo, as permissões necessárias e o processo de relatório de vulnerabilidades, e o [modelo de ameaças](docs/threat-model.md) para obter o limite de confiança do ciclo de vida da chave (por que a autenticidade de `node.json` depende de sua origem e por que a verificação sensível à revogação deve usar `--anchored`).

Fortalecimento da segurança:

- As chamadas de subprocesso que interpolam dados variáveis usam `execFileSync` com argumentos de array; as chamadas restantes `execSync` usam strings de comando estáticas e constantes — sem vetores de injeção de shell.
- O JSON do livro-razão e do registro é analisado dentro de `try`/`catch` com erros estruturados e numerados por linha; uma linha malformada é ignorada e exibida, nunca causando a falha da ferramenta com uma pilha de execução bruta.
- A travessia de caminho é evitada em todas as operações de arquivo (resolução + verificação de limite).
- Análise segura contra ReDoS em todo o código (sem expressões regulares ilimitadas).
- As chaves privadas PEM são excluídas por meio de `.gitignore`, nunca impressas no stdout ou nos logs do CI e gravadas com permissões apenas para o proprietário (`0600`).

## Testes

O conjunto completo de testes `node --test` cobre assinaturas Ed25519, validação de esquema, integridade da árvore de Merkle (v1 + RFC-6962 v2), invariantes de anexação, prevenção de travessia de caminho, verificação de âncora, a lista de permissões do verificador confiável e validação de entrada em todas as camadas: CLI, livro-razão, âncora, verificador e ferramentas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

O número de testes aumenta à medida que novos conjuntos são adicionados — execute o comando acima para obter o total atual, em vez de confiar em um número que pode ficar desatualizado.

## Licença

MIT

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
