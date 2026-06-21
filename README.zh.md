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

- 一个**清单** (`node.json`)，声明它提供和消耗的内容
- **已签名事件**，广播到仅追加日志
- 一个**注册表**，索引所有节点及其功能
- 一个**配置**，定义“完成”对信任的含义

该网络强制执行三个不变性：

1. **确定性的输出**——相同的输入，相同的工件
2. **可验证的来源**——每个发布都经过签名和证明
3. **可组合的协议**——接口具有版本控制且机器可读

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
1. `REPOMESH_SIGNING_KEY`——您的 PEM 格式的私钥（由 init 命令打印）
2. `REPOMESH_LEDGER_TOKEN`——GitHub PAT，具有对该仓库的 `contents:write` + `pull-requests:write` 权限

发布一个版本。信任将自动收敛。

### CLI 标志

所有命令都接受：`--quiet`、`--verbose`、`--debug`、`--no-color`。`init` 命令还支持 `--json`，以获得机器可读的输出。

提供 shell 补全功能：

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

| 配置 | 证据 | 保证检查 | 使用时机 |
|---------|----------|-----------------|----------|
| `baseline` | 可选 | 无需任何必需项 | 内部工具、实验 |
| `open-source` | SBOM + 来源 | 许可证审核 + 安全扫描 | OSS 的默认设置 |
| `regulated` | SBOM + 来源 | 许可证 + 安全性 + 可重现性 | 对合规性至关重要 |

### 检查信任度

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

### 2. 生成一个签名密钥对

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` 命令会输出公钥和一个 `keyId`，你可以直接将其添加到你的 `node.json` 文件中的维护者条目中，并且会将私钥（权限模式为 0600）写入你指定的 `--out` 参数所指向的目录——绝不会写入到已跟踪的路径中。请将它存储为 GitHub 代码仓库的密钥 (`REPOMESH_SIGNING_KEY`)。（手动操作等效命令：`openssl genpkey -algorithm ED25519 ...`。）

> **为对信任至关重要的节点注册 ≥2 个密钥**（TUF §6.1）：单个密钥在被攻破后无法签署自身的撤销。`repomesh init --second-key` 命令会注册一个不同的第二个维护者，以便一个密钥可以撤销另一个密钥——`init` 命令会在节点只有一个活动密钥时发出警告。

### 3. 向网络注册

向此仓库提交一个 PR，添加您的节点清单：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. 添加广播工作流程

将 `templates/repomesh-broadcast.yml` 复制到您仓库的 `.github/workflows/` 目录中。
设置 `REPOMESH_LEDGER_TOKEN` 密钥（一个细粒度的 PAT，具有对该仓库的 `contents:write` + `pull-requests:write` 权限）。

现在，每次发布都会自动向日志广播一个已签名的 `ReleasePublished` 事件。

## 日志规则

- **仅追加**——现有行不可变
- **模式有效**——每个事件都与 `schemas/event.schema.json` 验证
- **签名有效**——每个事件都由已注册的节点维护者进行签名
- **唯一**——没有重复的 `(repo, version, type)` 条目
- **时间戳合理**——不超过未来 1 小时或过去 1 年

## 事件类型

日志当前发出以下**活动**事件类型。其余为**保留/计划中**——模式接受它们，但目前没有节点发出它们。我们列出它们是为了让路线图可见，而不会暗示不存在的覆盖范围（对于信任产品而言，这是诚实的）。

**活动（今天已发出）：**

| 类型 | 时间 |
|------|------|
| `ReleasePublished` | 发布新版本时 |
| `AttestationPublished` | 证明者验证发布时 |
| `ledger.anchor` | 锚节点密封分区（Merkle 根 + XRPL 备忘录） |
| `attestation.dispute` | 受信任的节点对证明提出异议（降低了判决结果） |
| `KeyRotation` | 维护者密钥轮换到后继者（预期——过去的签名仍然有效） |
| `KeyRevocation` | 维护者密钥被撤销（妥协 = 具有追溯效力的无效性，RFC 5280） |

**保留/计划中（尚未发出）：**

| 类型 | 预期含义 |
|------|------------------|
| `BreakingChangeDetected` | 引入了破坏性更改 |
| `HealthCheckFailed` | 节点未能通过其自身的健康检查 |
| `DependencyVulnFound` | 在依赖项中发现了一个漏洞 |
| `InterfaceUpdated` | 接口模式已更改 |
| `PolicyViolation` | 违反了网络策略 |

## 密钥轮换和撤销

维护者密钥具有生命周期。可以将密钥**轮换**到后继者，也可以**撤销**，并且验证是**基于时间的**：只有在签名时密钥有效，才会信任签名——XRPL 锚定关闭时间，这是日志已经使用的相同的受信任时钟。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **常规轮换**是*前瞻性的*——已退役密钥的过去签名仍然有效；它只是停止对新版本进行签名。
- **妥协**是*追溯性的*（RFC 5280 §5.3.2）——任何其可证明的锚定时间在或之后为无效日期的签名都将被拒绝，并且无法证明早于该日期且会被拒绝。
- 具有**无**生命周期字段的密钥将被保留（始终有效），因此现有的节点会验证未更改的内容。
- 撤销是通过签名的`KeyRevocation`事件进行的；仅有一个密钥被泄露的单密钥节点可以通过**治理**（`trustedPolicy`）节点签署撤销来恢复。对信任至关重要的节点应注册**≥2 个密钥**（TUF §6.1）。
- 即使在篡改了`node.json`的情况下，也会从签名的、与 XRPL 锚定的事件中重新强制执行撤销——剥离的清单无法使已撤销的密钥恢复。请参阅[威胁模型](docs/threat-model.md)，了解边界（针对规范账本进行验证；对于对撤销敏感的检查，使用 `--anchored`）。

## 节点类型

| 类型 | 角色 |
|------|------|
| `registry` | 索引节点和功能 |
| `attestor` | 验证声明（构建、合规性） |
| `policy` | 强制执行规则（评分、门控） |
| `oracle` | 提供外部数据 |
| `compute` | 执行工作（转换、构建） |
| `settlement` | 最终确定状态 |
| `governance` | 做出决策 |
| `identity` | 颁发/验证凭据 |

## 公共验证

任何人都可以使用一个命令来验证发布版本——**无需克隆**，CLI 会为您获取公共账本：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

此操作会检查：
1. `ReleasePublished`事件是否存在且已签名（Ed25519），并且该密钥已注册到**该存储库自己的**`node.json`——注册到不同存储库的密钥无法对其进行验证。
2. 存储库的信任配置文件是否满足：每个配置文件要求的证明（SBOM、来源、许可证、安全性）都存在，由受信任的证明者签名，并且其最新结果为“通过”，且至少有一个**独立的**证明者。仅具有自签名的发布版本且没有独立证明的版本会报告“未验证”，而不是“通过”。
3. 使用 `--anchored`：重新计算分区中的 Merkle 根并与清单进行匹配，并且——当网络可访问时——从链上的 XRPL 事务中获取并断言（`validated` + `tesSUCCESS`，签名帐户在受信任的锚定允许列表中，并且链上备忘录绑定到本地根/清单哈希值/计数）。离线状态下，它会报告“XRPL 未验证”，而不是伪造的事务；严格的 `--anchored` 随后将失败（使用 `--anchored-or-local` 以接受仅在本地验证的清单，而无需链上证明）。

对于 CI 门控，选择带有 `--format <text|json|sarif|markdown>` 的输出格式（`--json` 是 `--format json` 的别名）：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**退出代码**是从三态判决派生的，因此 CI 步骤可以直接对其进行门控：

| 退出 | 判决 | 含义 |
|------|---------|---------|
| `0` | PASS | 真实且已确认（或者在 `--fail-on=fail` 放宽时为 UNVERIFIED）。 |
| `1` | FAIL | 严重错误——伪造/错误的存储库签名、非允许列表中的证明者，或必需的检查失败。 |
| `3` | UNVERIFIED | 轻微——尚未锚定、没有独立的见证者，或者缺少必需的检查。 |
| `2` | — | 用法错误或内部崩溃。 |

`--fail-on <fail|unverified>` 设置严格性。默认 `unverified` 在 FAIL 和 UNVERIFIED 时都会失败；`--fail-on=fail` 允许 UNVERIFIED 通过（退出代码为 0，并显示警告），用于采用警告模式。

使用 `verify-all` 一次加载整个批处理到账本中，并使用 `--local` 针对本地克隆进行离线验证：

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**在 CI 中对其进行门控**，使用捆绑的复合操作——请参阅[使用 GitHub 操作](docs/verification.md#using-the-github-action)：

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

有关完整的验证指南、威胁模型和关键概念，请参见 [docs/verification.md](docs/verification.md)。

### 将其用作库

验证引擎被导出为一个稳定的程序化 API——将它嵌入到你自己的工具中，而不是通过命令行调用：

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### 网络状态端点

仪表板会发布一个机器可读的 [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) 文件，供外部轮询使用——包括账本的新鲜度（带有冻结账本信号）、信任判决计数、已固定与待处理的分区，以及一个 `ok`/`degraded` 汇总信息，并附带原因。

### 信任徽章

存储库可以嵌入来自注册表的信任徽章：

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信任与验证

### 验证发布版本

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### 证明发布版本

> 证明和运行验证器是**操作员**任务，这些任务作用于此账本的克隆副本，因此它们从检出状态运行。验证发布版本不需要这样做——使用上面的 `npx` 命令。

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

安全验证器的阈值（最大 CVE 数量、允许的严重程度）通过 `verifiers/security/config.json` 进行配置。

### 运行策略检查

```bash
node policy/scripts/check-policy.mjs
```

检查：语义版本单调性、工件哈希唯一性、必需的功能。

## 安全与威胁模型

RepoMesh 涉及**账本事件**（签名 JSON）、**节点清单**（公共密钥 + 功能）、**注册表索引**（自动生成的信任分数）和 **XRPL 测试网**（锚定事务）。它不涉及成员存储库源代码、私钥、用户凭据或浏览数据。私有签名密钥永远不会离开 CI 运行器。网络访问仅限于 GitHub API（PR 创建）、XRPL 测试网（锚定）和 OSV.dev（漏洞查找）。**不收集任何遥测数据**——零分析，零崩溃报告，零“回家”功能。请参阅 [SECURITY.md](SECURITY.md），了解完整的范围、所需的权限和漏洞报告流程，以及[威胁模型](docs/threat-model.md)，了解密钥生命周期信任边界（为什么 `node.json` 的真实性取决于其来源，以及为什么对撤销敏感的验证应使用 `--anchored`）。

加固：

- 对于需要插入变量数据的子进程调用，使用带有数组参数的 `execFileSync`；其余的 `execSync` 调用则使用静态、固定的命令字符串，从而避免了 shell 注入漏洞。
- 在 `try`/`catch` 块中对账本和注册表 JSON 进行解析，并提供结构化的、带行号的错误信息；如果某一行格式不正确，则跳过该行并报告，绝不会导致工具因原始堆栈而崩溃。
- 所有文件操作（resolve + 边界检查）都采取措施防止路径遍历攻击。
- 在整个过程中使用安全的 ReDoS 解析方法（不使用无限制的正则表达式）。
- 通过 `.gitignore` 文件排除 PEM 私钥，绝不会将其打印到标准输出或 CI 日志中，并且以仅所有者可读写 (`0600`) 的权限进行写入。

## 测试

完整的 `node --test` 测试套件涵盖 Ed25519 签名、模式验证、Merkle 树完整性（v1 + RFC-6962 v2）、仅追加不变性、路径遍历防护、锚点验证、受信任的证明者允许列表以及跨 CLI、账本、锚点、验证器和工具层面的输入验证。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

随着测试套件的增加，测试用例的数量也会增加——运行上述命令以获取当前的测试总数，而不是依赖于一个可能会过时的数字。

## 许可证

MIT

---

由 <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> 构建
