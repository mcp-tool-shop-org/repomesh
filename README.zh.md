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

Syntropic 代码仓库网络 — 用于分布式仓库协调的仅追加账本、节点清单和评分。

## 这是什么？

RepoMesh 将一组代码仓库转变为一个协作网络。每个代码仓库都是一个**节点**，包含：

- 一个**清单** (`node.json`)，用于声明其提供和消费的内容
- 广播到仅追加账本的**签名事件**
- 一个为所有节点和能力建立索引的**注册表**
- 一个定义信任“完成”标准的**配置文件**

该网络确保三个不变性：

1. **确定性输出** — 相同的输入，相同的构件
2. **可验证的来源** — 每个**发布**都经过签名和证明
3. **可组合的合约** — 接口是版本化的且机器可读的

## 快速开始 (1 条命令 + 2 个密钥)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

这将生成您所需的一切：
- `node.json` — 您的节点清单
- `repomesh.profile.json` — 您选择的配置文件
- `.github/workflows/repomesh-broadcast.yml` — **发布**广播工作流
- Ed25519 签名密钥对（私钥保留在本地）

然后，向您的代码仓库添加两个密钥：
1. `REPOMESH_SIGNING_KEY` — 您的私钥 PEM（由 init 命令打印）
2. `REPOMESH_LEDGER_令牌` — GitHub 个人访问令牌 (PAT)，拥有对此仓库的 `contents:write` + `pull-requests:write` 权限

创建一个**发布**。信任会自动收敛。

### CLI 标志

所有命令都接受：`--quiet`、`--verbose`、`--debug`、`--no-color`。`init` 命令还支持 `--json` 以生成机器可读的输出。

提供 Shell 自动补全：

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 环境变量覆盖

| 变量 | 用途 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 覆盖账本端点 |
| `REPOMESH_MANIFESTS_URL` | 覆盖清单端点 |
| `REPOMESH_FETCH_TIMEOUT` | 获取超时时间（毫秒） |

### 配置文件

| 配置文件 | 证据 | 保证检查 | 使用场景 |
|---------|----------|-----------------|----------|
| `baseline` | 可选 | 无要求 | 内部工具、实验 |
| `open-source` | SBOM + 来源 | 许可证审计 + 安全扫描 | 开源软件 (OSS) 默认配置 |
| `regulated` | SBOM + 来源 | 许可证 + 安全 + 可重现性 | 合规关键型 |

### 检查信任

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

显示完整性评分、保证评分以及基于配置文件的推荐。

### 覆盖

按仓库定制，无需派生验证器：

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## 仓库结构

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

### 1. 创建您的节点清单

将 `node.json` 添加到您的仓库根目录：

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

将公钥 PEM 放入您 `node.json` 的维护者条目中。
将私钥存储为 GitHub 仓库密钥 (`REPOMESH_SIGNING_KEY`)。

### 3. 向网络注册

向此仓库提交一个 PR，添加您的节点清单：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. 添加广播工作流

将 `templates/repomesh-broadcast.yml` 复制到您仓库的 `.github/workflows/` 目录。
设置 `REPOMESH_LEDGER_令牌` 密钥（一个精细化的个人访问令牌 (PAT)，拥有对此仓库的 contents:write + pull-requests:write 权限）。

现在，每个**发布**都会自动向账本广播一个签名的 `ReleasePublished` 事件。

## 账本规则

- **仅追加** — 现有行不可变
- **模式有效** — 每个事件都需根据 `schemas/event.schema.json` 进行验证
- **签名有效** — 每个事件都由已注册的节点维护者签名
- **唯一** — 不允许重复的 `(repo, version, type)` 条目
- **时间戳合理** — 时间戳不能超过未来 1 小时或过去 1 年

## 事件类型

账本当前发出以下**实时**事件类型。其余的为**已预留/已规划**——模式接受它们，但尚无节点发出它们。我们列出它们是为了让路线图清晰可见，同时不暗示不存在的覆盖范围（这是信任产品的开诚布公原则）。

**实时（当前发出）：**

| 类型 | 时机 |
|------|------|
| `ReleasePublished` | 发布新版本时 |
| `AttestationPublished` | 证明者验证一个发布时 |
| `ledger.anchor` | 锚定节点封存一个分区时（Merkle 根 + XRPL 备忘录） |
| `attestation.dispute` | 受信任节点对一项证明提出异议时（降低裁决结果） |

**已预留/已规划（尚未发出）：**

| 类型 | 预期含义 |
|------|------------------|
| `BreakingChangeDetected` | 引入破坏性变更时 |
| `HealthCheckFailed` | 节点自身健康检查失败时 |
| `DependencyVulnFound` | 在依赖项中发现漏洞时 |
| `InterfaceUpdated` | 接口模式发生变更时 |
| `PolicyViolation` | 网络策略被违反时 |

## 节点类型

| 类型 | 角色 |
|------|------|
| `registry` | 索引节点和能力 |
| `attestor` | 验证声明（构建、合规性） |
| `policy` | 执行规则（评分、门控） |
| `oracle` | 提供外部数据 |
| `compute` | 执行工作（转换、构建） |
| `settlement` | 最终确定状态 |
| `governance` | 做出决策 |
| `identity` | 颁发/验证凭证 |

## 公开验证

任何人都可以通过一条命令验证一个发布——**无需克隆**，命令行界面会为您获取公共账本：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

此命令会检查：
1. `ReleasePublished` 事件存在，并且由注册到**该仓库自己的** `node.json` 的密钥签名（Ed25519）——注册到不同仓库的密钥无法验证它。
2. 仓库的信任配置文件得到满足：每个配置文件要求的证明（SBOM、来源、许可证、安全）都存在，由受信任的证明者签名，且其最新结果为 `pass`，并至少有一个**独立**证明者。仅有自签名而无独立证明的发布会报告为 `UNVERIFIED`，绝不会是 `PASS`。
3. 使用 `--anchored` 时：分区的 Merkle 根会被重新计算并与清单匹配，并且——当网络可达时——会获取并断言链上 XRPL 交易（`validated` + `tesSUCCESS`，签名账户在受信任锚点允许列表中，且链上备忘录绑定到本地根/清单哈希/计数）。离线时，它会报告 `XRPL NOT verified` 而非伪造交易；此时严格的 `--anchored` 模式将失败（请使用 `--anchored-or-local` 来接受未经链上证明的本地验证清单）。

对于 CI 门控，可使用 `--format <text|json|sarif|markdown>` 选择输出格式（`--json` 是 `--format json` 的别名）：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**退出代码**源自三态裁决，因此 CI 步骤可以直接基于它进行门控：

| 退出 | 裁决 | 含义 |
|------|---------|---------|
| `0` | PASS | 真实且可信（或在 `--fail-on=fail` 放宽要求时为 UNVERIFIED）。 |
| `1` | FAIL | 硬性失败——伪造/错误仓库的签名、非允许列表中的证明者，或必需检查失败。 |
| `3` | UNVERIFIED | 软性——尚未锚定、无独立见证者，或缺少必需检查。 |
| `2` | — | 使用错误或内部崩溃。 |

`--fail-on <fail|unverified>` 设置严格程度。默认为 `unverified`，在 FAIL 和 UNVERIFIED 时均失败；`--fail-on=fail` 允许 UNVERIFIED 通过（退出代码为 0 并附带警告），以用于警告模式的采用。

使用 `verify-all` 在一次账本加载中验证整批内容，并使用 `--local` 针对本地克隆进行离线验证：

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

使用捆绑的复合操作**在 CI 中进行门控**——参见[使用 GitHub Action](docs/verification.md#using-the-github-action)：

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

请参阅 [docs/verification.md](docs/verification.md) 以了解完整的验证指南、威胁模型和关键概念。

### 信任徽章

仓库可以嵌入来自注册表的信任徽章：

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信任与验证

### 验证一个发布

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### 证明一个发布

> 证明和运行验证器是**操作员**任务，它们作用于该账本的一个克隆，因此它们从代码检出中运行。验证一个发布则不需要——请使用上面的 `npx` 命令。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

检查项：`sbom.present`、`provenance.present`、`signature.chain`

### 运行验证器

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

安全验证器阈值（最大 CVE 数量，允许的严重程度）由 `verifiers/security/config.json` 配置驱动。

### 运行策略检查

```bash
node policy/scripts/check-policy.mjs
```

检查项：语义化版本单调性、构件哈希唯一性、所需能力。

## 安全与威胁模型

RepoMesh 涉及 **账本事件**（已签名的 JSON）、**节点清单**（公钥 + 能力）、**注册表索引**（自动生成的信任分数）和 **XRPL 测试网**（锚定交易）。它**不**会接触成员仓库的源代码、私钥、用户凭证或浏览数据。私有签名密钥永远不会离开 CI 运行器。网络访问仅限于 GitHub API（创建 PR）、XRPL 测试网（锚定）和 OSV.dev（漏洞查询）。**不收集或发送**任何遥测数据——零分析、零崩溃报告、零回传信息。关于完整范围、所需权限和漏洞报告流程，请参阅 [SECURITY.md](SECURITY.md)。

加固：

- 对可变数据进行插值的子进程调用使用带数组参数的 `execFileSync`；其余的 `execSync` 调用使用静态、恒定的命令字符串——没有 shell 注入途径。
- 账本和注册表的 JSON 在 `try`/`catch` 内部解析，并带有结构化的、带行号的错误信息；格式错误的行会被跳过并显示出来，绝不会因原始堆栈信息而导致工具崩溃。
- 所有文件操作都防止了路径遍历（路径解析 + 边界检查）。
- 全程采用 ReDoS 安全的解析方式（无限制的正则表达式）。
- PEM 私钥通过 `.gitignore` 排除，从不打印到标准输出或 CI 日志，并以仅所有者可读（`0600`）的权限写入。

## 测试

完整的 `node --test` 测试套件覆盖了 Ed25519 签名、模式验证、Merkle 树完整性（v1 + RFC-6962 v2）、仅追加不变性、路径遍历防护、锚定验证、可信证明者白名单，以及在 CLI、账本、锚定、验证器和工具等各个层面的输入验证。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

随着测试套件的增加，测试数量也会增长——请运行上面的命令来获取当前的总数，而不是依赖一个会过时的数字。

## 许可证

MIT

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建
