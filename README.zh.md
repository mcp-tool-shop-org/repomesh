<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

同构仓库网络——仅追加日志、节点清单和用于分布式仓库协调的评分。

## 这是什么？

RepoMesh 将一组仓库转换为一个协作网络。每个仓库都是一个**节点**，具有：

- 一个**清单**（`node.json`），声明它提供和消耗的内容
- **已签名事件**，广播到仅追加日志
- 一个**注册表**，索引所有节点和功能
- 一个**配置**，定义“完成”对信任的含义

今天，一个 GitHub 组织（mcp-tool-shop-org）运行日志、证明者、策略检查和 XRPL 锚点。六个已注册的节点并不意味着有六个操作员。一个独立的见证者将是该组织不运营的一方。

该网络强制执行三个不变性：

1. **确定性输出**——相同的输入，相同的工件
2. **可验证的来源**——每个发布都经过签名和证明
3. **可组合的合约**——接口具有版本控制且可供机器读取

## 快速入门（1 条命令 + 2 个密钥）

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

这将生成您需要的一切：
- `node.json`——您的节点清单
- `repomesh.profile.json`——您选择的配置
- `.github/workflows/repomesh-broadcast.yml`——发布广播工作流程
- Ed25519 签名密钥对（私钥保留在本地）

然后将两个密钥添加到您的仓库中：
1. `REPOMESH_SIGNING_KEY`——您的私钥 PEM（由 init 命令打印）
2. `REPOMESH_LEDGER_TOKEN`——带有 `contents:write` + `pull-requests:write` 的 GitHub PAT，应用于此仓库

发布一个版本。信任将自动收敛。

### CLI 标志

所有命令都接受：`--quiet`、`--verbose`、`--debug`、`--no-color`。`init` 命令还支持 `--json`，用于生成可供机器读取的输出。

可用的 shell 补全功能：

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 环境变量覆盖

| 变量 | 用途 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 覆盖日志端点 |
| `REPOMESH_MANIFESTS_URL` | 覆盖清单端点 |
| `REPOMESH_FETCH_TIMEOUT` | 以毫秒为单位的获取超时时间 |

### 配置

| 配置 | 证据 | 保证检查 | 使用时 |
|---------|----------|-----------------|----------|
| `baseline` | 可选 | 不需要 | 内部工具、实验 |
| `open-source` | SBOM + 来源 | 许可证审核 + 安全扫描 | OSS 的默认设置 |
| `regulated` | SBOM + 来源 | 许可证 + 安全 + 可重现性 | 对合规性至关重要 |

### 检查信任

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

显示完整性评分、保证评分以及基于配置的建议。

### 覆盖

无需分叉验证器即可进行每个仓库的自定义：

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` 打印公共密钥 + 一个 `keyId`，可以将其放入您的 `node.json` 维护者条目中，并
将私钥（模式 0600）写入您指向 `--out` 的位置——绝不会写入已跟踪的路径。将其存储为 GitHub 仓库密钥（`REPOMESH_SIGNING_KEY`）。（手动操作等效：`openssl genpkey -algorithm ED25519 ...`。）

> **为信任至关重要的节点注册 ≥2 个密钥**（TUF §6.1）：如果密钥被泄露，单个密钥无法对其自身进行撤销。`repomesh init --second-key` 注册一个不同的第二个维护者，以便一个密钥可以撤销另一个密钥——`init` 警告当一个节点只有 1 个活动密钥时。

### 3. 向网络注册

向此仓库提交一个 PR，添加您的节点清单：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. 添加广播工作流程

将 `templates/repomesh-broadcast.yml` 复制到您的仓库的 `.github/workflows/`。
设置 `REPOMESH_LEDGER_TOKEN` 密钥（一个细粒度的 PAT，内容为：write + pull-requests:write，应用于此仓库）。

现在，每次发布都会自动向日志广播一个已签名的 `ReleasePublished` 事件。

## 日志规则

- **仅追加**——现有的行是不可变的
- **模式有效**——每个事件都必须通过 `schemas/event.schema.json` 进行验证
- **签名有效**——每个事件都必须由已注册的节点维护者签名
- **唯一**——不允许重复的 `(repo, version, type)` 条目
- **时间戳合理**——不得超过未来 1 小时或过去 1 年

## 事件类型

日志当前发出以下**活动**事件类型。其余为**保留/计划**——模式接受它们，但目前没有节点发出它们。我们列出它们，以便路线图可见，而不会暗示不存在的覆盖范围（对信任产品而言，这是诚实的）。

**活动（今天发出）：**

| 类型 | 时间 |
|------|------|
| `ReleasePublished` | 发布新版本 |
| `AttestationPublished` | 证明者验证发布 |
| `ledger.anchor` | 锚点节点密封分区（Merkle 根 + XRPL 备忘录） |
| `attestation.dispute` | 受信任的节点对证明提出异议（降低了判决结果） |
| `KeyRotation` | 维护者密钥旋转到后继者（预期——过去的签名仍然有效） |
| `KeyRevocation` | 维护者密钥被撤销（泄露 = 具有追溯效力的无效性，RFC 5280） |

**保留/计划（尚未发出）：**

| 类型 | 预期含义 |
|------|------------------|
| `BreakingChangeDetected` | 引入了破坏性更改 |
| `HealthCheckFailed` | 节点未能通过其自身的健康检查 |
| `DependencyVulnFound` | 在依赖项中发现了一个漏洞 |
| `InterfaceUpdated` | 接口模式已更改 |
| `PolicyViolation` | 违反了网络策略 |

## 密钥轮换和撤销

维护者密钥具有生命周期。密钥可以**轮换**到后继者或**撤销**，并且
验证是**基于时间的**：只有当密钥在签名的时间点有效时，签名才会被信任——XRPL 锚点关闭时间，这是日志已经使用的相同的受信任时钟。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **常规轮换**是*前瞻性的*——已退役密钥的先前签名仍然有效；它只是停止对新版本进行签名。
- **密钥泄露**是*追溯性的*（RFC 5280 §5.3.2）——任何其可证明的锚定时间在或之后无效日期之后的签名都会被拒绝，并且无法证明其时间早于该日期的签名也会被拒绝。
- 具有**无**生命周期字段的密钥将被视为历史密钥（始终有效），因此现有的节点会验证未更改的内容。
- 撤销签名是 `KeyRevocation` 事件；如果某个单密钥节点的唯一密钥被泄露，则可以通过**治理**（`trustedPolicy`）节点对撤销进行签名来恢复该节点。对信任至关重要的节点应注册**≥2 个密钥**（TUF §6.1）。
- 即使在篡改 `node.json` 的情况下，撤销也会从已签名的、与 XRPL 关联的事件中重新强制执行——删除的清单无法恢复已撤销的密钥。请参阅[威胁模型](docs/threat-model.md)，了解边界（针对规范账本进行验证；使用 `--anchored` 进行对撤销敏感的检查）。

## 节点类型

| 类型 | 角色 |
|------|------|
| `registry` | 索引节点和功能 |
| `attestor` | 验证声明（构建、合规性） |
| `policy` | 强制执行规则（评分、门控） |
| `oracle` | 提供外部数据 |
| `compute` | 执行任务（转换、构建） |
| `settlement` | 最终确定状态 |
| `governance` | 做出决策 |
| `identity` | 颁发/验证凭据 |

## 扩展网络——验证器插件协议

通过编辑数据（而不是代码）添加新的**检查类型**和**验证器节点**。检查类型注册表、评分权重和节点类型权限位于
[`verifier.policy.json`](verifier.policy.json)（经过模式验证，出现错误时会停止）。添加检查（例如
`sast.scan`）是一个大约 6 行的策略编辑 + 一个 `node.json`，并在 PR 中进行审核——无需更改代码。

唯一的固定不变的规则：**已注册 ≠ 可信**。注册允许检查参与；信用仍然需要可信集合的一致性通过。完整指南：
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)。

## 公共验证

任何人都可以使用一个命令验证发布，**无需克隆**，CLI 会为您获取公共账本：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

此操作会检查：
1. `ReleasePublished` 事件是否存在并且是由注册到**该仓库的**`node.json` 签名的——注册到不同仓库的密钥无法对其进行验证。
2. 仓库的信任配置文件是否满足：每个配置文件要求的证明（SBOM、来源、许可证、安全性）都存在，由可信的证明者签名，并且其最新结果为 `pass`，并且至少有一个**独立的**证明者。仅具有自签名且没有独立证明的发布会报告 `UNVERIFIED`，而不是 `PASS`。
3. 使用 `--anchored`：重新计算分区的 Merkle 根，并将其与清单进行匹配，并且——当网络可访问时——获取链上 XRPL 事务并进行断言（`validated` + `tesSUCCESS`，签名帐户位于可信锚点允许列表中，并且链上备忘录与本地根/清单哈希/计数绑定）。在离线状态下，它会报告 `XRPL NOT verified`，而不是虚假的事务；严格的 `--anchored` 随后会失败（使用 `--anchored-or-local` 以接受本地验证的清单，而无需链上证明）。

对于 CI 门控，选择具有 `--format <text|json|sarif|markdown>` 的输出格式（`--json` 是 `--format json` 的别名）：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**退出代码**是从三态判决派生的，因此 CI 步骤可以直接对其进行门控：

| 退出 | 判决 | 含义 |
|------|---------|---------|
| `0` | PASS | 真实且有保证（或在 `--fail-on=fail` 放宽时为 UNVERIFIED）。 |
| `1` | FAIL | 严重错误——伪造/错误仓库签名、未在允许列表中的证明者，或必需的检查失败。 |
| `3` | UNVERIFIED | 轻微——尚未锚定、没有独立的见证者，或缺少必需的检查。 |
| `2` | — | 用法错误或内部崩溃。 |

### 容器

相同的 CLI 作为 `ghcr.io/mcp-tool-shop-org/repomesh` 发布，并标记了 npm 版本和 git sha。该镜像以非 root 用户身份运行。它不包含钱包种子。

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

发布锚点是一个单独的命令。在运行时传递 `XRPL_SEED`：

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

每日工作流程从检出内容构建此镜像并使用它进行发布。在 `anchor/xrpl/config.json` 中的网络仍然是测试网。主网发布等待一个已资助的帐户，该帐户的经典地址首先添加到 CLI 发布中发行的允许列表中。该允许列表是一个上限：获取的配置可以删除一个帐户，但不能添加一个帐户。

`--fail-on <fail\|unverified>` 设置严格性。默认 `unverified` 在 FAIL 和
UNVERIFIED 时都会失败；`--fail-on=fail` 允许 UNVERIFIED 通过（退出代码为 0，并显示警告），用于警告模式采用。

使用 `verify-all` 验证一个账本中的整个批次，并使用 `--local` 针对本地克隆进行离线验证：

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

使用捆绑的复合操作在 CI 中进行门控——请参阅
[使用 GitHub 操作](docs/verification.md#using-the-github-action)：

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

请参阅 [docs/verification.md](docs/verification.md)，了解完整的验证指南、威胁模型和关键概念。

### 将其用作库

验证引擎被导出为稳定的程序化 API——将其嵌入到您自己的工具中，而不是调用 CLI：

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### 网络状态端点

仪表板发布一个机器可读的 [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)，用于外部轮询——账本新鲜度（带有冻结账本信号）、信任判决计数、已锚定与待处理的分区，以及 `ok`/`degraded` 汇总，其中包含原因。

### 信任徽章

仓库可以嵌入来自注册表的信任徽章：

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信任与验证

### 验证发布

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### 证明发布

> 验证和运行验证器是**操作员**任务，它们作用于此账本的克隆副本，因此它们是从检出版本运行的。验证发布版本时，请勿使用上述 `npx` 命令。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

检查：`sbom.present`、`provenance.present`、`signature.chain`

### 运行验证器

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

安全验证器阈值（最大 CVE 数量、允许的严重程度）通过 `verifiers/security/config.json` 进行配置。

### 运行策略检查

```bash
node policy/scripts/check-policy.mjs
```

检查：语义版本单调性、制品哈希唯一性、所需功能。

## 安全与威胁模型

RepoMesh 涉及**账本事件**（已签名的 JSON）、**节点清单**（公钥 + 功能）、**注册表索引**（自动生成的信任评分）和 **XRPL 测试网络**（锚定交易）。它**不**涉及成员仓库源代码、私钥、用户凭据或浏览数据。私钥绝不会离开 CI 运行器。网络访问仅限于 GitHub API（PR 创建）、XRPL 测试网络（锚定）和 OSV.dev（漏洞查找）。**不**收集或发送任何遥测数据——零分析、零崩溃报告、零“回家”行为。有关完整范围、所需权限和漏洞报告流程，请参阅 [SECURITY.md](SECURITY.md)，有关密钥生命周期信任边界（为什么 `node.json` 的真实性取决于其来源，以及为什么应使用 `--anchored` 进行撤销敏感验证），请参阅 [威胁模型](docs/threat-model.md)。

加固：

- 插入变量数据的子进程调用使用带有数组参数的 `execFileSync`；其余 `execSync` 调用使用静态、常量命令字符串——没有 shell 注入漏洞。
- 账本和注册表 JSON 在 `try`/`catch` 中使用结构化、带行号的错误进行解析；格式错误的行将被跳过并显示，绝不会导致工具因原始堆栈而崩溃。
- 所有文件操作都防止路径遍历（解析 + 边界检查）。
- 整个过程都使用 ReDoS 安全的解析（没有无限制的正则表达式）。
- 通过 `.gitignore` 排除 PEM 私钥，绝不会将其打印到 stdout 或 CI 日志，并以仅所有者（`0600`）权限写入。

## 测试

完整的 `node --test` 套件涵盖 Ed25519 签名、模式验证、Merkle 树完整性（v1 + RFC-6962 v2）、仅追加不变性、路径遍历预防、锚定验证、受信任的验证者允许列表以及跨 CLI、账本、锚定、验证器和工具层的输入验证。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

随着添加更多测试套件，测试数量会增加——运行上述命令以获取当前的测试总数，而不是依赖于一个会过时的数据。

## 许可证

MIT

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建。
