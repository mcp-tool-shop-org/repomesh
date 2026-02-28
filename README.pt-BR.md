<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a>
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

Rede de repositórios sintrópica — um registro de dados somente para anexação, manifestos de nós e pontuação para coordenação distribuída de repositórios.

## O que é isso?

RepoMesh transforma uma coleção de repositórios em uma rede cooperativa. Cada repositório é um **nó** com:

- Um **manifesto** (`node.json`) que declara o que ele fornece e consome.
- **Eventos assinados** transmitidos para um registro de dados somente para anexação.
- Um **registro** que indexa todos os nós e capacidades.
- Um **perfil** que define o que significa "concluído" em termos de confiança.

A rede impõe três princípios:

1. **Saídas determinísticas** — mesmas entradas, mesmos artefatos.
2. **Rastreabilidade verificável** — cada lançamento é assinado e autenticado.
3. **Contratos compostáveis** — interfaces são versionadas e legíveis por máquina.

## Início rápido (1 comando + 2 segredos)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

Isso gera tudo o que você precisa:
- `node.json` — seu manifesto de nó.
- `repomesh.profile.json` — seu perfil escolhido.
- `.github/workflows/repomesh-broadcast.yml` — fluxo de trabalho de transmissão de lançamento.
- Par de chaves de assinatura Ed25519 (a chave privada permanece local).

Em seguida, adicione dois segredos ao seu repositório:
1. `REPOMESH_SIGNING_KEY` — sua chave privada PEM (impressa pelo init).
2. `REPOMESH_LEDGER_TOKEN` — token PAT do GitHub com `contents:write` + `pull-requests:write` neste repositório.

Faça um lançamento. A confiança converge automaticamente.

### Perfis

| Perfil | Evidências | Verificações de garantia | Quando usar |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Nenhum necessário | Ferramentas internas, experimentos |
| `open-source` | SBOM + rastreabilidade | Auditoria de licença + verificação de segurança | Padrão para OSS |
| `regulated` | SBOM + rastreabilidade | Licença + segurança + reprodutibilidade | Crítico para conformidade |

### Verificar a confiança

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Mostra a pontuação de integridade, a pontuação de garantia e recomendações específicas do perfil.

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
    { "name": "your-name", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Gere um par de chaves de assinatura

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Coloque a chave pública PEM na entrada de mantenedores do seu `node.json`.
Armazene a chave privada como um segredo do repositório do GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Registre-se na rede

Abra um pull request para este repositório adicionando seu manifesto de nó:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Adicione o fluxo de trabalho de transmissão

Copie `templates/repomesh-broadcast.yml` para o diretório `.github/workflows/` do seu repositório.
Defina o segredo `REPOMESH_LEDGER_TOKEN` (um token PAT com permissões de escrita de conteúdo e pull requests neste repositório).

Cada lançamento agora transmitirá automaticamente um evento `ReleasePublished` assinado para o registro.

## Regras do registro

- **Somente para anexação** — linhas existentes são imutáveis.
- **Validação de esquema** — cada evento é validado em relação a `schemas/event.schema.json`.
- **Validação de assinatura** — cada evento é assinado por um mantenedor de nó registrado.
- **Único** — nenhuma entrada duplicada `(repositório, versão, tipo)`.
- **Timestamp válido** — não mais de 1 hora no futuro ou 1 ano no passado.

## Tipos de eventos

| Tipo | Quando |
|------|------|
| `ReleasePublished` | Uma nova versão é lançada. |
| `AttestationPublished` | Um verificador autentica um lançamento. |
| `BreakingChangeDetected` | Uma alteração disruptiva é introduzida. |
| `HealthCheckFailed` | Um nó falha em suas próprias verificações de saúde. |
| `DependencyVulnFound` | Uma vulnerabilidade é encontrada em dependências. |
| `InterfaceUpdated` | Um esquema de interface é alterado. |
| `PolicyViolation` | Uma política de rede é violada. |

## Tipos de nós

| Tipo | Função |
|------|------|
| `registry` | Indexa nós e capacidades. |
| `attestor` | Verifica as alegações (construção, conformidade). |
| `policy` | Faz cumprir as regras (pontuação, restrições). |
| `oracle` | Fornece dados externos. |
| `compute` | Executa tarefas (transformações, construções). |
| `settlement` | Finaliza o estado. |
| `governance` | Toma decisões. |
| `identity` | Emite/verifica credenciais. |

## Verificação Pública

Qualquer pessoa pode verificar uma versão com um único comando:

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Isso verifica:
1. Se o evento de lançamento existe e a assinatura é válida (Ed25519).
2. Se todas as declarações estão presentes e assinadas (SBOM, origem, licença, segurança).
3. Se a versão está incluída em uma partição Merkle ancorada no XRPL.

Para restrições de CI, use `--json`:

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

Consulte [docs/verification.md](docs/verification.md) para o guia completo de verificação, modelo de ameaças e conceitos-chave.

### Selos de Confiança

Os repositórios podem incorporar selos de confiança do registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confiança e Verificação

### Verificar uma versão

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Declarar uma versão

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Verificações: `sbom.present`, `provenance.present`, `signature.chain`.

### Executar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### Executar verificações de políticas

```bash
node policy/scripts/check-policy.mjs
```

Verificações: monotonicidade semver, unicidade do hash do artefato, capacidades necessárias.

## Licença

MIT.

---

Criado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>.
