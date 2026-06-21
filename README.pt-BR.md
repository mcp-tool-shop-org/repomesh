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

Rede de repos sintrópicos: registro somente para anexar, manifestos de nós e pontuação para coordenação distribuída de repos.

## O que é isso?

RepoMesh transforma uma coleção de repos em uma rede cooperativa. Cada repo é um **nó** com:

- Um **manifesto** (`node.json`) declarando o que ele fornece e consome
- **Eventos assinados** transmitidos para um registro somente para anexar
- Um **registro** indexando todos os nós e capacidades
- Um **perfil** definindo o que significa "concluído" para fins de confiança

A rede impõe três invariantes:

1. **Resultados determinísticos:** as mesmas entradas, os mesmos artefatos
2. **Provável verificável:** cada lançamento é assinado e atestado
3. **Contratos compostos:** as interfaces são versionadas e legíveis por máquina

## Início rápido (1 comando + 2 segredos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Isso gera tudo o que você precisa:
- `node.json`: seu manifesto de nó
- `repomesh.profile.json`: seu perfil escolhido
- `.github/workflows/repomesh-broadcast.yml`: fluxo de trabalho de transmissão de lançamento
- Par de chaves de assinatura Ed25519 (a chave privada permanece local)

Em seguida, adicione dois segredos ao seu repo:
1. `REPOMESH_SIGNING_KEY`: sua chave privada PEM (impressa por init)
2. `REPOMESH_LEDGER_TOKEN`: GitHub PAT com `contents:write` + `pull-requests:write` neste repo

Faça um lançamento. A confiança converge automaticamente.

### Flags da CLI

Todos os comandos aceitam: `--quiet`, `--verbose`, `--debug`, `--no-color`. O comando `init` também suporta `--json` para saída legível por máquina.

O preenchimento automático do shell está disponível:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Substituições de ambiente

| Variável | Finalidade |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Substituir o ponto final do registro |
| `REPOMESH_MANIFESTS_URL` | Substituir o ponto final dos manifestos |
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

Personalização por repo sem bifurcar verificadores:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Estrutura do Repo

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

`keygen` imprime a chave pública + um `keyId` pronto para ser inserido na entrada de mantenedores do seu arquivo `node.json`, e grava a chave privada (modo 0600) apenas no local especificado por `--out` — nunca em um caminho rastreado. Armazene-a como um segredo do repositório GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`).

> **Registre ≥2 chaves para um nó crítico em termos de confiança** (TUF §6.1): uma única chave não pode assinar sua própria revogação se for comprometida. `repomesh init --second-key` registra um segundo mantenedor distinto, para que uma chave possa revogar a outra — `init` avisa quando um nó tem apenas uma chave ativa.

### 3. Registre-se na rede

Abra um PR para este repo, adicionando seu manifesto de nó:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Adicione o fluxo de trabalho de transmissão

Copie `templates/repomesh-broadcast.yml` para `.github/workflows/` do seu repo.
Defina o segredo `REPOMESH_LEDGER_TOKEN` (um PAT refinado com contents:write + pull-requests:write neste repo).

Cada lançamento agora transmitirá automaticamente um evento `ReleasePublished` assinado para o registro.

## Regras do Registro

- **Somente para anexar:** as linhas existentes são imutáveis
- **Validação de esquema:** cada evento é validado em relação a `schemas/event.schema.json`
- **Validação de assinatura:** cada evento é assinado por um mantenedor de nó registrado
- **Único:** sem entradas duplicadas `(repo, versão, tipo)`
- **Carimbo de data/hora sensato:** não mais do que 1 hora no futuro ou 1 ano no passado

## Tipos de eventos

O registro atualmente emite os tipos de eventos **ativos** abaixo. O restante são **reservados / planejados**: o esquema os aceita, mas nenhum nó os emite ainda. Nós os listamos para que o roteiro seja visível sem implicar cobertura que não existe (honestidade na porta da frente para um produto de confiança).

**Ativos (emitidos hoje):**

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Uma nova versão é lançada |
| `AttestationPublished` | Um atestador verifica um lançamento |
| `ledger.anchor` | O nó âncora sela uma partição (raiz Merkle + memorando XRPL) |
| `attestation.dispute` | Um nó confiável contesta uma atestação (rebaixa o veredicto) |
| `KeyRotation` | Uma chave de mantenedor é rotacionada para um sucessor (prospectivo — assinaturas passadas permanecem válidas) |
| `KeyRevocation` | Uma chave de mantenedor é revogada (comprometimento = invalidade retroativa, RFC 5280) |

**Reservado / planejado (ainda não emitido):**

| Tipo | Significado pretendido |
|------|------------------|
| `BreakingChangeDetected` | Uma alteração incompatível é introduzida |
| `HealthCheckFailed` | Um nó falha em seus próprios testes de integridade |
| `DependencyVulnFound` | Uma vulnerabilidade é encontrada nas dependências |
| `InterfaceUpdated` | Um esquema de interface muda |
| `PolicyViolation` | Uma política de rede é violada |

## Rotação e revogação de chaves

As chaves do mantenedor têm um ciclo de vida. Uma chave pode ser **rotacionada** para um sucessor ou **revogada**, e a verificação é **consciente do tempo**: uma assinatura é confiável apenas se a chave era válida no momento da assinatura — o tempo de fechamento âncora XRPL, o mesmo relógio confiável que o registro já usa.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- A **rotação de chaves** é *prospectiva* — as assinaturas anteriores da chave inativa permanecem válidas; simplesmente, deixa de assinar novas versões.
- O **compromisso** é *retroativo* (RFC 5280 §5.3.2) — qualquer assinatura cujo tempo de ancoragem comprovável seja igual ou posterior à data de invalidação é rejeitada, e uma assinatura que não possa ser provada como anterior a essa data também é rejeitada.
- Uma chave sem campos de ciclo de vida é considerada válida indefinidamente, portanto, os nós existentes verificam se permanece inalterada.
- As revogações são assinadas através de eventos `KeyRevocation`; um nó de chave única cuja única chave foi comprometida é recuperado por um nó de **governança** (`trustedPolicy`) que assina a revogação. Os nós críticos para a confiança devem registrar **≥2 chaves** (TUF §6.1).
- Mesmo em caso de manipulação do arquivo `node.json`, uma revogação é reativada a partir dos eventos assinados e ancorados no XRPL — um manifesto incompleto não pode reativar uma chave revogada. Consulte o [modelo de ameaças](docs/threat-model.md) para obter informações sobre os limites (verifique em relação ao livro razão canônico; use `--anchored` para verificações sensíveis à revogação).

## Tipos de nós

| Amável / Gentil / Bondoso | Função / Papel |
|------|------|
| `registry` | Indexa nós e funcionalidades. |
| `attestor` | Confirma as informações fornecidas (relativas a construções e ao cumprimento de normas). |
| `policy` | Aplica as regras (pontuação, critérios de aprovação). |
| `oracle` | Fornece dados externos. |
| `compute` | Funciona? (Transforma, constrói) |
| `settlement` | Define o estado final. |
| `governance` | Toma decisões. |
| `identity` | Verifica e valida credenciais. |

## Verificação pública

Qualquer pessoa pode verificar uma versão com um único comando – **não é necessário fazer o download**; a ferramenta de linha de comandos obtém automaticamente o livro-razão público para si:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Isto verifica:

1. Se o evento `ReleasePublished` existe e está assinado (Ed25519) por uma chave registada no ficheiro `node.json` do próprio repositório — uma chave registada num repositório diferente não pode validá-lo.
2. Se o perfil de confiança do repositório é satisfatório: todas as informações exigidas pelo perfil (SBOM, origem, licença, segurança) estão presentes, são assinadas por um validador confiável e o seu resultado mais recente é `pass`, com pelo menos um validador **independente**. Uma versão que contenha apenas uma assinatura própria e nenhuma validação independente reportará `UNVERIFIED` (não verificado), nunca `PASS`.
3. Com `--anchored`: a raiz de Merkle da partição é recalculada e comparada com o manifesto, e — quando a rede estiver acessível — a transação XRPL na cadeia é obtida e confirmada (`validated` + `tesSUCCESS`, a conta que assina está na lista de permissões do âncora confiável e a nota na cadeia está ligada à raiz/hash do manifesto local/contagem). Em modo offline, reporta `XRPL NOT verified` em vez de uma transação falsa; o modo estrito `--anchored` falhará então (use `--anchored-or-local` para aceitar um manifesto verificado localmente sem a prova na cadeia).

Para os portais do CI, escolha um formato de saída com `--format <texto|json|sarif|markdown>` (`--json` é um atalho para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

O **código de saída** é derivado do resultado ternário, pelo que uma etapa de integração contínua pode usá-lo diretamente como critério:

| Saída | Veredicto | Significado |
|------|---------|---------|
| `0` | APROVAR / PASSAR | Autêntico e comprovado (ou NÃO VERIFICADO quando o parâmetro `--fail-on` é definido como «fail»). |
| `1` | FRACASSO / FALHA | Falha crítica — assinatura inválida ou proveniente de um repositório incorreto, atestador não autorizado ou uma verificação obrigatória falhou. |
| `3` | NÃO VERIFICADO | Evidência fraca – ainda não confirmada, sem testemunha independente ou com algum elemento essencial em falta. |
| `2` | — | Erro de utilização ou falha interna. |

`--fail-on <fail\|unverified>` define o nível de rigor. O valor predefinido é `unverified`, que resulta em falha tanto para FAIL como para UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED seja considerado válido (o programa termina com código 0, exibindo um aviso) quando se utiliza o modo de aviso.

Verifique um lote inteiro de uma só vez ao carregar os dados no livro razão com o comando `verify-all` e, em seguida, verifique os dados offline comparando-os com uma cópia local usando a opção `--local`.

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Integre-o no fluxo de integração contínua (CI)** com a ação composta fornecida — consulte:
[Como usar a Ação do GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulte o guia completo de verificação, o modelo de ameaças e os conceitos-chave em [docs/verification.md](docs/verification.md).

### Use como uma biblioteca

O mecanismo de verificação é exportado como uma API programática estável — incorpore-o em suas próprias ferramentas, em vez de usar a interface de linha de comando:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Ponto de extremidade do status da rede

O painel publica um arquivo legível por máquina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) para consultas externas — atualização do livro-razão (com um sinal de livro-razão congelado), contagens de verificação de confiança, partições ancoradas versus pendentes e um resumo `ok`/`degradado` com os motivos.

### Selos de Confiança

Os repositórios podem incorporar selos de confiança provenientes do registo:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiança e Verificação

### Verificar uma versão/lançamento

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Confirme a libertação

> A autenticação e a execução de verificadores são tarefas do **operador** que atuam sobre uma cópia deste livro-razão, portanto, são executadas a partir de um ambiente isolado. Para verificar uma versão, não utilize o comando `npx` indicado acima.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Verificações: `sbom.presente`, `proveniencia.presente`, `cadeia_de_assinaturas`

### Executar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Os limites dos verificadores de segurança (número máximo de vulnerabilidades CVE e níveis de gravidade permitidos) são definidos através da configuração no ficheiro `verifiers/security/config.json`.

### Executar verificações de políticas

```bash
node policy/scripts/check-policy.mjs
```

Verificações: monotonicidade do SemVer, unicidade do hash dos artefatos, capacidades obrigatórias.

## Modelo de Segurança e Ameaças

O RepoMesh interage com os **registos de eventos** (JSON assinado), os **manifestos dos nós** (chaves públicas + capacidades), os **índices do registo** (pontuações de confiança geradas automaticamente) e a **rede de testes XRPL** (transações de âncora). Não interage com o código-fonte do repositório dos membros, chaves privadas, credenciais de utilizador ou dados de navegação. As chaves de assinatura privadas nunca saem do ambiente de execução da CI. O acesso à rede é limitado à API do GitHub (criação de pedidos de alteração), à rede de testes XRPL (ancoragem) e ao OSV.dev (pesquisa de vulnerabilidades). **Não são recolhidos nem enviados dados de telemetria** — zero análises, zero relatórios de falhas, zero comunicação com servidores externos. Consulte o ficheiro [SECURITY.md](SECURITY.md) para obter informações detalhadas sobre o âmbito, as permissões necessárias e o processo de notificação de vulnerabilidades, e consulte o documento [modelo de ameaças](docs/threat-model.md) para compreender os limites de confiança do ciclo de vida das chaves (por que a autenticidade do ficheiro `node.json` depende da sua origem e por que a verificação sensível à revogação deve utilizar a opção `--anchored`).

Endurecimento:

- As chamadas de processos filhos que interpolam dados variáveis usam `execFileSync` com argumentos em formato de array; as restantes chamadas `execSync` usam strings de comando estáticas e constantes, eliminando vetores de injeção de shell.
- O JSON do livro-razão e do registo é analisado dentro de blocos `try`/`catch`, com erros estruturados e numerados por linha; uma linha malformada é ignorada e reportada, sem nunca causar o travamento da ferramenta com um rastreamento bruto.
- A navegação em diretórios é prevenida em todas as operações de arquivo (resolução + verificação de limites).
- Análise segura contra ReDoS em todo o código (sem expressões regulares ilimitadas).
- As chaves privadas PEM são excluídas através do `.gitignore`, nunca impressas no stdout ou nos logs de CI, e escritas com permissões exclusivas para o proprietário (`0600`).

## Testes

O conjunto completo de testes `node --test` cobre assinaturas Ed25519, validação de esquema, integridade da árvore de Merkle (v1 + RFC-6962 v2), invariantes de anexação exclusiva, prevenção de navegação em diretórios, verificação de âncoras, a lista de permissões do atestador confiável e validação de entrada em todas as camadas: CLI, livro-razão, âncora, verificador e ferramentas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

O número de testes aumenta à medida que novos conjuntos são adicionados; execute o comando acima para obter o total atual, em vez de confiar em um número que pode ficar desatualizado.

## Licença

MIT

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
