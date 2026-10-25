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

Libere o livro-razão e o relógio de confiança ancorado ao XRPL para uma rede de repositórios: eventos assinados, manifestos de nós e verificação. Separe do armazenamento de eventos do Attestia.

## Coloque no sistema

Attestia, Cognate e RepoMesh são três produtos.

**RepoMesh** é a rede de lançamento: eventos assinados, manifestos de nós e um relógio de confiança ancorado ao XRPL. Ele mantém seu próprio livro-razão RFC 6962.

**Attestia** prova que um evento, uma transação ou uma transição de estado ocorreu e vincula essa prova a uma cadeia. O domínio que ele oferece é a verdade financeira: cofre pessoal, tesouraria da organização e registrum. Suas provas de Merkle não são este livro-razão.

**Cognate** é o domínio de governança de IA no armazenamento de eventos e nas provas de Merkle do Attestia. Ele chama RepoMesh quando precisa que um lançamento seja verificado. Ele não mantém um segundo armazenamento de eventos e não usa a árvore de Merkle do Attestia para esta rede.

## O que há de novo nas versões 2.4 e 2.5?

**Versão 2.5.0.**

- **2.5.0: a publicação de âncora falha e é interrompida.** `post-anchor.mjs` se recusa a publicar e não abre nenhuma conexão, a menos que a configuração diga `testnet` e a URL WebSocket seja um endpoint de testnet conhecido. Uma variável de ambiente sozinha não pode alterar a publicação para a mainnet. Consulte [Ancoragem XRPL (Proteção de Testnet)](#ancoragem-xrpl-testnet-guard).
- **2.5.0: um portão de teste obrigatório.** Cada solicitação de pull executa todas as 9 suítes `node --test` com um limite de cobertura de linha e uma produção `npm audit` em `high`. `validate-ledger` e `test` são verificações obrigatórias em `main`, e `registry-ci.yml` agora é executado apenas após `ledger-ci` ter sucesso em `main`.
- **2.4.0: execute as atestações do Cognate.** O livro-razão aceita três novos tipos de atestação, `run.preregistered`, `run.outcome` e `cognate.root.anchored`, cada um com um resumo `sha256` e um URI `urn:cognate:...`. Apenas um nó `governance` em ambos `trustedAttestors` e `trustedRunAttestors` (hoje, `mcp-tool-shop-org/cognate`) pode assiná-los, e ele não pode assinar mais nada. Cada `run.outcome` deve referenciar um evento `run.preregistered` já presente no livro-razão.
- **2.4.0: o contrato de assinatura é verificado.** Uma assinatura Ed25519 deve ser sobre os 32 bytes brutos de `canonicalHash`. O validador rejeita uma assinatura feita sobre o texto JSON canônico ou sobre a string hexadecimal de 64 caracteres.

Consulte [CHANGELOG.md](CHANGELOG.md) para a lista completa.

## O que é isso?

RepoMesh transforma uma coleção de repositórios em uma rede cooperativa. Cada repositório é um **nó** com:

- Um **manifesto** (`node.json`) declarando o que ele fornece e consome
- **Eventos assinados** transmitidos para um livro-razão de apenas anexação
- Um **registro** que indexa todos os nós e capacidades
- Um **perfil** que define o que "concluído" significa para a confiança

Hoje, uma organização GitHub, mcp-tool-shop-org, opera o log, os atestadores, a verificação de política e a âncora XRPL. Sete nós registrados não significam sete operadores. Uma testemunha independente seria uma parte que esta organização não opera.

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
- Ed25519 par de chaves de assinatura (a chave privada permanece local)

Em seguida, adicione dois segredos ao seu repositório:
1. `REPOMESH_SIGNING_KEY` — sua chave privada PEM (impressa por init)
2. `REPOMESH_LEDGER_TOKEN` — PAT GitHub com `contents:write` + `pull-requests:write` neste repositório

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
| `REPOMESH_LEDGER_URL` | Substituir endpoint do livro-razão |
| `REPOMESH_MANIFESTS_URL` | Substituir endpoint de manifestos |
| `REPOMESH_FETCH_TIMEOUT` | Tempo limite de busca em ms |

### Perfis

| Perfil | Evidência | Verificações de garantia | Usar quando |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Nenhum obrigatório | Ferramentas internas, experimentos |
| `open-source` | SBOM + proveniência | Auditoria de licença + verificação de segurança | Padrão para OSS |
| `regulated` | SBOM + proveniência | Licença + segurança + reprodutibilidade | Crítico para a conformidade |

### Verificar confiança

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra a pontuação de integridade, a pontuação de garantia e as recomendações específicas do perfil.

### Substituições

Personalização por repositório sem bifurcar os verificadores:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Estrutura do repositório

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

Adicione `node.json` à raiz do seu repositório:

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

### 2. Gere um par de chaves de assinatura

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` imprime a chave pública + uma `keyId` pronta para ser adicionada à entrada de seus mantenedores `node.json` e grava a chave privada (modo 0600) apenas onde você aponta `--out` — nunca em um caminho rastreado. Armazene-o como um segredo do repositório GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`.)

> **Registre ≥2 chaves para um nó crítico para a confiança** (TUF §6.1): uma única chave não pode assinar sua própria revogação se for comprometida. `repomesh init --second-key` registra um segundo mantenedor distinto para que uma chave possa revogar a outra — `init` avisa quando um nó tem apenas uma chave ativa.

### 3. Registre-se na rede

Abra um PR para este repositório, adicionando seu manifesto de nó:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Adicione o fluxo de trabalho de transmissão

Copie `templates/repomesh-broadcast.yml` para o `.github/workflows/` do seu repositório.
Defina o segredo `REPOMESH_LEDGER_TOKEN` (um PAT de granularidade fina com conteúdo:write + pull-requests:write neste repositório).

Cada lançamento agora transmitirá automaticamente um evento assinado `ReleasePublished` para o livro-razão.

## Regras do livro-razão

- **Apenas anexar** — as linhas existentes são imutáveis
- **Validação de esquema** — cada evento é validado em relação a `schemas/event.schema.json`
- **Validação de assinatura** — cada evento é assinado por um mantenedor de nó registrado
- **Único** — sem entradas duplicadas `(repo, version, type)`
- **Carimbo de data/hora consistente** — não mais do que 1 hora no futuro ou 1 ano no passado

## Tipos de eventos

Atualmente, o livro-razão emite os seguintes tipos de eventos **ativos**. O restante está **reservado/planejado** — o esquema os aceita, mas nenhum nó os emite ainda. Listamos para que o roteiro seja visível sem implicar cobertura que não existe (honestidade transparente para um produto de confiança).

**Ativos (emitidos hoje):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Uma nova versão é lançada |
| `AttestationPublished` | Um atestador verifica um lançamento |
| `ledger.anchor` | O nó âncora sela uma partição (raiz Merkle + memorando XRPL) |
| `attestation.dispute` | Um nó confiável contesta uma atestação (rebaixa o veredicto) |
| `KeyRotation` | Uma chave de mantenedor é rotacionada para um sucessor (prospectivo — assinaturas passadas permanecem válidas) |
| `KeyRevocation` | Uma chave de mantenedor é revogada (comprometimento = invalidação retroativa, RFC 5280) |

`AttestationPublished` também contém as atestações de execução da Cognate (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, desde a versão 2.4.0), assinadas apenas por seu `governance` nó.

**Reservado/planejado (ainda não emitido):**

| Tipo | Significado pretendido |
|------|------------------|
| `BreakingChangeDetected` | Uma alteração incompatível é introduzida |
| `HealthCheckFailed` | Um nó falha em seus próprios testes de integridade |
| `DependencyVulnFound` | Uma vulnerabilidade é encontrada em dependências |
| `InterfaceUpdated` | Um esquema de interface é alterado |
| `PolicyViolation` | Uma política de rede é violada. `policy/scripts/check-policy.mjs` pode construir e assinar uma; nenhuma está no livro-razão ainda |

## Rotação e revogação de chaves

As chaves de mantenedor têm um ciclo de vida. Uma chave pode ser **rotacionada** para um sucessor ou **revogada**, e a verificação é **consciente do tempo**: uma assinatura é confiável apenas se a chave era válida no momento da assinatura — o tempo de fechamento da âncora XRPL, o mesmo relógio confiável que o livro-razão já usa.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- A **rotação de rotina** é *prospectiva* — as assinaturas passadas da chave desativada permanecem válidas; ela simplesmente para de assinar novos lançamentos.
- O **comprometimento** é *retroativo* (RFC 5280 §5.3.2) — qualquer assinatura cujo tempo de ancoragem comprovável seja na/após a data de invalidação é rejeitada, e uma assinatura que não pode ser comprovada como anterior a ela é rejeitada.
- Uma chave **sem** campos de ciclo de vida é considerada como existente (sempre válida), para que os nós existentes verifiquem sem alterações.
- As revogações são eventos assinados `KeyRevocation`; um nó de chave única cuja única chave foi comprometida é recuperado por um nó de **governança** (`trustedPolicy`) que assina a revogação. Os nós críticos para a confiança devem registrar **≥2 chaves** (TUF §6.1).
- Mesmo contra um `node.json` adulterado, uma revogação é reimposta a partir dos eventos assinados e ancorados na XRPL — um manifesto despojado não pode reativar uma chave revogada. Consulte o [modelo de ameaças](docs/threat-model.md) para o limite (verifique em relação ao livro-razão canônico; use `--anchored` para verificações sensíveis à revogação).

## Tipos de nós

| Tipo | Função |
|------|------|
| `registry` | Indexa nós e capacidades |
| `attestor` | Verifica alegações (cria, conformidade) |
| `policy` | Aplica regras (pontuação, controle) |
| `oracle` | Fornece dados externos |
| `compute` | Realiza trabalho (transforma, cria) |
| `settlement` | Finaliza o estado |
| `governance` | Toma decisões; desde a versão 2.4.0, assina as atestações de execução da Cognate e nada mais |
| `identity` | Emite/verifica credenciais |

## Estendendo a rede — o contrato do plugin verificador

Novos **tipos de verificação** e **nós verificadores** são adicionados editando dados, não código. O registro de tipos de verificação, pesos de pontuação e permissões de tipo de nó estão em [`verifier.policy.json`](verifier.policy.json) (validação de esquema, falha segura). Adicionar uma verificação (por exemplo, `sast.scan`) é uma edição de política de ~6 linhas + um `node.json`, revisada em um PR — nenhuma alteração de código.

A única invariante: **registrado ≠ confiável**. O registro permite que uma verificação participe; o crédito ainda requer uma aprovação de consenso do conjunto confiável. Guia completo: [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verificação pública

Qualquer pessoa pode verificar um lançamento com um único comando — **não é necessário clonar**, a CLI busca o livro-razão público para você:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Isso verifica:
1. O evento `ReleasePublished` existe e é assinado (Ed25519) por uma chave registrada para **o próprio repositório** `node.json` — uma chave registrada em um repositório diferente não pode validá-lo.
2. O perfil de confiança do repositório é satisfeito: cada atestação exigida pelo perfil (SBOM, procedência, licença, segurança) está presente, assinada por um atestador confiável e seu resultado mais recente é `pass`, com pelo menos um atestador **independente**. Um lançamento com apenas uma autoassinatura e sem atestações independentes relata `UNVERIFIED`, nunca `PASS`.
3. Com `--anchored`: a raiz Merkle da partição é recalculada e correspondida ao manifesto e — quando a rede estiver acessível — a transação XRPL na cadeia é buscada e afirmada (`validated` + `tesSUCCESS`, a conta de assinatura está na lista de permissões do âncora confiável e o memorando na cadeia se vincula à raiz/hash/contagem local do manifesto). Offline, ele relata `XRPL NOT verified` em vez de uma transação falsa; o `--anchored` estrito falha então (use `--anchored-or-local` para aceitar um manifesto verificado localmente sem a prova na cadeia).

Para portões de CI, escolha um formato de saída com `--format <text|json|sarif|markdown>` (`--json` é um alias para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

O **código de saída** é derivado do veredicto de três estados, para que um passo de CI possa controlá-lo diretamente:

| Saída | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Autêntico e garantido (ou NÃO VERIFICADO quando relaxado por `--fail-on=fail`). |
| `1` | FAIL | Falha grave — assinatura falsificada/de repositório incorreto, atestador não autorizado ou uma verificação obrigatória falhou. |
| `3` | NÃO VERIFICADO | Suave — ainda não ancorado, sem testemunha independente ou uma verificação obrigatória ausente. |
| `2` | — | Erro de uso ou falha interna. |

### Contêiner

A mesma CLI é publicada como `ghcr.io/mcp-tool-shop-org/repomesh`, com a tag da versão npm e o hash Git. A imagem é executada como um usuário não root. Não contém uma seed de carteira.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

Publicar uma âncora é um comando separado. `XRPL_SEED` é passado em tempo de execução:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

O fluxo de trabalho diário cria esta imagem a partir do checkout e a publica.

### Ancoragem XRPL (Testnet Guard)

A ancoragem em `anchor/xrpl/config.json` é **apenas para testnet** (`"network": "testnet"`). `anchor/xrpl/scripts/post-anchor.mjs` aplica uma proteção de ponto de extremidade do tipo "fail-closed" (`assertPostingEndpoint`) antes de validar `XRPL_SEED` ou construir uma `xrpl.Client`:

- **Verificação padrão da testnet:** a publicação é recusada (saída diferente de zero, nenhum socket aberto), a menos que `config.network === "testnet"` **e** a URL resolvida WebSocket (`process.env.XRPL_WS_URL || config.rippledUrl`) estejam em `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`). Definir `XRPL_WS_URL` para uma URL da mainnet ou desconhecida é recusado imediatamente com uma mensagem que indica a rede e a URL resolvidas.
- **Opção de mainnet (desativada):** uma variável de ambiente sozinha nunca pode alterar a publicação para a mainnet. Optar pela mainnet requer um commit revisado em `anchor/xrpl/config.json`, definindo `"network": "mainnet"`, `"allowMainnetPosting": true` e `"mainnetAllowedEndpoints": ["wss://..."]`, contendo o ponto de extremidade de destino `wss://`, após adicionar o endereço clássico da mainnet financiado à lista de permissões enviada (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`). Essa lista de permissões é um limite: uma configuração obtida pode remover uma conta e não pode adicionar uma.

`--fail-on <fail\|unverified>` define o nível de rigor. O padrão `unverified` falha em ambos, FAIL e
UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED passe (saída 0, com um aviso) para adoção do modo de aviso.

Verifique um lote inteiro em uma única carga do ledger com `verify-all` e verifique offline em relação a um clone local com `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Implemente no CI** com a ação composta incluída — veja
[Usando a ação GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Veja [docs/verification.md](docs/verification.md) para o guia completo de verificação, modelo de ameaças e conceitos-chave.

### Use como uma biblioteca

O mecanismo de verificação é exportado como uma API programática estável — incorpore-o em suas próprias ferramentas, em vez de usar a CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Ponto de extremidade de status da rede

O painel publica um dado legível por máquina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
para polling externo — atualização do ledger (com um sinal de ledger congelado), contagens de veredicto de confiança, âncoras versus
partições pendentes e um rollup `ok`/`degraded` com motivos.

### Crachás de confiança

Os repositórios podem incorporar crachás de confiança do registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiança e Verificação

### Verifique uma versão

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Ateste uma versão

> Atestar e executar verificadores são tarefas do **operador** que atuam em um clone deste ledger, portanto, são executados a partir de um checkout. A verificação de uma versão não — use o comando `npx` acima.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Verificações: `sbom.present`, `provenance.present`, `signature.chain`

### Execute verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Os limites do verificador de segurança (CVEs máximos, severidades permitidas) são definidos por meio da configuração em `verifiers/security/config.json`.

### Execute verificações de política

```bash
node policy/scripts/check-policy.mjs
```

Verificações: monotonicidade semver, singularidade do hash do artefato, capacidades necessárias.

## Segurança e Modelo de Ameaças

RepoMesh acessa **eventos do ledger** (JSON assinado), **manifestos de nó** (chaves públicas + capacidades), **índices do registro** (pontuações de confiança geradas automaticamente) e **testnet XRPL** (transações de âncora; a publicação recusa qualquer ponto de extremidade que não seja um ponto de extremidade conhecido da testnet). **Não** acessa o código-fonte do repositório do membro, chaves privadas, credenciais de usuário ou dados de navegação. As chaves de assinatura privadas nunca saem do executor do CI. O acesso à rede é limitado à API GitHub (criação de PR), testnet XRPL (ancoragem) e OSV.dev (pesquisa de vulnerabilidades). **Nenhuma telemetria** é coletada ou enviada — zero análises, zero relatórios de falhas, zero comunicação com o servidor. Veja [SECURITY.md](SECURITY.md) para o escopo completo, permissões necessárias e processo de relatório de vulnerabilidades, e o [modelo de ameaças](docs/threat-model.md) para o limite de confiança do ciclo de vida da chave (por que a autenticidade de `node.json` depende de sua fonte e por que a verificação sensível à revogação deve usar `--anchored`).

Reforço:

- As chamadas de processo filho que interpolam dados variáveis usam `execFileSync` com argumentos de array; as chamadas `execSync` restantes usam strings de comando estáticas e constantes — sem vetores de injeção de shell.
- O JSON do ledger e do registro é analisado dentro de `try`/`catch` com erros estruturados e numerados por linha; uma linha malformada é ignorada e exibida, nunca causando a falha da ferramenta com uma pilha bruta.
- A travessia de caminho é evitada em todas as operações de arquivo (resolução + verificação de limite).
- Análise ReDoS-segura em todo o código (sem regex não limitado).
- As chaves privadas PEM são excluídas por meio de `.gitignore`, nunca impressas no stdout ou nos logs do CI e gravadas com permissões de proprietário (`0600`).

## Testes

O conjunto completo `node --test` cobre Ed25519 assinaturas, validação de esquema, integridade da árvore de Merkle (v1 + RFC-6962 v2), invariantes de anexação, prevenção de travessia de caminho, verificação de âncora, a lista de permissões de atestador confiável e validação de entrada em todas as camadas da CLI, ledger, âncora, verificador e ferramentas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

A contagem de testes aumenta à medida que os conjuntos são adicionados — execute o comando acima para obter o total atual, em vez de confiar em um número que se torna desatualizado.

O CI executa os mesmos 9 conjuntos em cada solicitação de pull (`ledger-ci.yml`, a verificação `test` necessária), com `--experimental-test-coverage` e um limite de cobertura de linha (`--test-coverage-lines=57`), e, em seguida, `npm audit --audit-level=high --omit=dev` para a raiz, `anchor/xrpl` e `ledger`.

## Licença

MIT

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
