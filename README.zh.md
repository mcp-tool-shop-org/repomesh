<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Syntropic 代码仓库网络：仅追加的账本、节点配置和评分，用于分布式代码仓库协调。

## 这是什么？

RepoMesh 将一组代码仓库转换为一个协作网络。每个代码仓库是一个**节点**，具有：

- 一个**配置清单** (`node.json`)，声明其提供的功能和所依赖的功能。
- **签名事件**，广播到仅追加的账本。
- 一个**注册表**，索引所有节点和功能。
- 一个**配置**，定义“完成”在信任方面意味着什么。

该网络强制执行三个不变性：

1. **确定性输出**：相同的输入，相同的构建产物。
2. **可验证的溯源**：每个**发布**都经过签名和验证。
3. **可组合的合约**：接口的版本控制，并且是机器可读的。

## 快速开始（1 个命令 + 2 个密钥）

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

这会生成您所需的一切：
- `node.json` — 您的节点配置。
- `repomesh.profile.json` — 您选择的配置。
- `.github/workflows/repomesh-broadcast.yml` — **发布**广播工作流程。
- Ed25519 签名密钥对（私钥保存在本地）。

然后，将两个密钥添加到您的代码仓库：
1. `REPOMESH_SIGNING_KEY` — 您的私钥 PEM（由 `init` 命令打印）。
2. `REPOMESH_LEDGER_TOKEN` — 具有 `contents:write` + `pull-requests:write` 权限的 GitHub PAT（个人访问令牌），针对此代码仓库。

进行**发布**。信任会自动收敛。

### 配置

| 配置 | 证据 | 信任检查 | 使用场景 |
|---------|----------|-----------------|----------|
| `baseline` | 可选 | 无需任何 | 内部工具，实验 |
| `open-source` | SBOM + 溯源 | 许可证审计 + 安全扫描 | 默认配置（适用于开源项目） |
| `regulated` | SBOM + 溯源 | 许可证 + 安全 + 可重现性 | 合规性至关重要 |

### 检查信任

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

显示完整性评分、信任评分，以及基于配置的建议。

### 覆盖

在不进行分支的情况下，对每个代码仓库进行自定义：

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## 代码仓库结构

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

## 手动加入（5 分钟）

### 1. 创建您的节点配置

将 `node.json` 添加到您的代码仓库的根目录：

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

### 2. 生成签名密钥对

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

将公钥 PEM 放入您的 `node.json` 的 maintainers 字段。
将私钥作为 GitHub 代码仓库的密钥存储 (`REPOMESH_SIGNING_KEY`)。

### 3. 注册到网络

向此代码仓库提交一个拉取请求，添加您的节点配置：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. 添加广播工作流程

将 `templates/repomesh-broadcast.yml` 复制到您的代码仓库的 `.github/workflows/` 目录。
设置 `REPOMESH_LEDGER_TOKEN` 密钥（一个具有 `contents:write` + `pull-requests:write` 权限的细粒度 PAT，针对此代码仓库）。

现在，每个**发布**都会自动将一个经过签名的 `ReleasePublished` 事件广播到账本。

## 账本规则

- **仅追加**：现有条目是不可变的。
- **符合模式**：每个事件都必须验证 `schemas/event.schema.json`。
- **签名有效**：每个事件都由已注册的节点维护者进行签名。
- **唯一性**：没有重复的 `(代码仓库, 版本, 类型)` 条目。
- **时间戳合理**：时间戳不能晚于 1 小时，也不能早于 1 年。

## 事件类型

| 类型 | 触发条件 |
|------|------|
| `ReleasePublished` | 发布新版本 |
| `AttestationPublished` | 验证者验证**发布** |
| `BreakingChangeDetected` | 引入破坏性变更 |
| `HealthCheckFailed` | 节点自身健康检查失败 |
| `DependencyVulnFound` | 在依赖项中发现漏洞 |
| `InterfaceUpdated` | 接口模式发生变化 |
| `PolicyViolation` | 违反网络策略 |

## 节点类型

| 类型 | 角色 |
|------|------|
| `registry` | 索引节点和功能。 |
| `attestor` | 验证声明（构建、合规性） |
| `policy` | 执行规则（评分、权限控制） |
| `oracle` | 提供外部数据 |
| `compute` | 执行任务（转换、构建） |
| `settlement` | 完成状态 |
| `governance` | 做出决策 |
| `identity` | 颁发/验证凭证 |

## 公开验证

任何人都可以使用一个命令验证一个发布版本：

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

此操作会检查以下内容：
1. 发布事件是否存在，并且签名有效（Ed25519）。
2. 所有证明信息都存在并且已签名（SBOM、来源、许可证、安全信息）。
3. 发布版本包含在 XRPL 锚定的 Merkle 分区中。

对于 CI 权限控制，请使用 `--json`。

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

请参阅 [docs/verification.md](docs/verification.md)，以获取完整的验证指南、威胁模型和关键概念。

### 信任徽章

仓库可以嵌入来自注册表的信任徽章。

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信任与验证

### 验证发布版本

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### 证明发布版本

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

检查内容：`sbom.present`、`provenance.present`、`signature.chain`

### 运行验证器

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### 运行策略检查

```bash
node policy/scripts/check-policy.mjs
```

检查内容：语义版本号递增性、工件哈希唯一性、必需的功能。

## 许可证

MIT

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建。
