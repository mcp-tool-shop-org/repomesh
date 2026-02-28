<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
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

Syntropic リポジトリネットワーク：追記専用の台帳、ノードのマニフェスト、および分散リポジトリ調整のためのスコアリング。

## これは何ですか？

RepoMesh は、一連のリポジトリを協調ネットワークに変換します。各リポジトリは、以下の要素を持つ **ノード** です。

- 提供するものと消費するものを宣言する **マニフェスト** (`node.json`)
- 追記専用の台帳にブロードキャストされる **署名付きイベント**
- すべてのノードと機能をインデックス化する **レジストリ**
- 信頼の基準を定義する **プロファイル**

このネットワークは、次の3つの原則を強制します。

1. **決定論的な出力**：同じ入力に対しては、同じ成果物が出力される。
2. **検証可能なトレーサビリティ**：すべてのリリースは署名され、検証される。
3. **組み合わせ可能な契約**：インターフェースはバージョン管理され、機械可読である。

## クイックスタート（1つのコマンド + 2つのシークレット）

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

これにより、必要なものがすべて生成されます。
- `node.json`：ノードのマニフェスト
- `repomesh.profile.json`：選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml`：リリースブロードキャストワークフロー
- Ed25519 署名キーペア（秘密鍵はローカルに保持される）

次に、リポジトリに次の2つのシークレットを追加します。
1. `REPOMESH_SIGNING_KEY`：秘密鍵の PEM 形式（`init` コマンドで出力されます）
2. `REPOMESH_LEDGER_TOKEN`：このリポジトリに対して `contents:write` および `pull-requests:write` 権限を持つ GitHub PAT

リリースを作成します。信頼は自動的に収束します。

### プロファイル

| プロファイル | エビデンス | アシュアランスチェック | 使用場面 |
|---------|----------|-----------------|----------|
| `baseline` | オプション | 必須なし | 内部ツール、実験 |
| `open-source` | SBOM + トレーサビリティ | ライセンス監査 + セキュリティスキャン | OSS のデフォルト |
| `regulated` | SBOM + トレーサビリティ | ライセンス + セキュリティ + 再現性 | コンプライアンスが重要な場合 |

### 信頼の確認

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、アシュアランススコア、プロファイルに基づいた推奨事項を表示します。

### オーバーライド

フォークせずに、リポジトリごとにカスタマイズ：

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## リポジトリ構造

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

## 手動での参加（5分）

### 1. ノードのマニフェストを作成します

リポジトリのルートに `node.json` を追加します。

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

### 2. 署名キーペアを生成します

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

公開鍵の PEM を `node.json` の maintainers エントリに配置します。
秘密鍵を GitHub リポジトリのシークレットとして保存します (`REPOMESH_SIGNING_KEY`)。

### 3. ネットワークに登録します

このリポジトリにプルリクエストを作成し、ノードのマニフェストを追加します。

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加します

`templates/repomesh-broadcast.yml` をリポジトリの `.github/workflows/` にコピーします。
`REPOMESH_LEDGER_TOKEN` シークレットを設定します（このリポジトリに対して `contents:write` および `pull-requests:write` 権限を持つファイングレインドPAT）。

これにより、すべてのリリースで、署名された `ReleasePublished` イベントが自動的に台帳にブロードキャストされます。

## 台帳のルール

- **追記専用**：既存の行は変更できません。
- **スキーマ準拠**：すべてのイベントは `schemas/event.schema.json` に対して検証されます。
- **署名検証**：すべてのイベントは、登録されたノードのメンテナによって署名されます。
- **一意性**：`(リポジトリ, バージョン, タイプ)` の重複エントリはありません。
- **タイムスタンプの妥当性**：未来から1時間以内、過去から1年以内である必要があります。

## イベントの種類

| 種類 | タイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされたとき |
| `AttestationPublished` | アテスターがリリースを検証したとき |
| `BreakingChangeDetected` | 破壊的な変更が導入されたとき |
| `HealthCheckFailed` | ノードが自身のヘルスチェックに失敗したとき |
| `DependencyVulnFound` | 依存関係に脆弱性が発見されたとき |
| `InterfaceUpdated` | インターフェースのスキーマが変更されたとき |
| `PolicyViolation` | ネットワークポリシーに違反があったとき |

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化します。 |
| `attestor` | 主張を検証します（ビルド、コンプライアンスなど）。 |
| `policy` | ルールを適用します（スコアリング、ゲートなど）。 |
| `oracle` | 外部データを提供します。 |
| `compute` | 作業を実行します（変換、ビルドなど）。 |
| `settlement` | 状態を確定します。 |
| `governance` | 判断を行います。 |
| `identity` | 認証情報を発行/検証します。 |

## 公開検証

誰でも、1つのコマンドでリリースを検証できます。

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

これは以下の項目を確認します。
1. リリースイベントが存在し、署名が有効であること（Ed25519）。
2. すべての証明が存在し、署名されていること（SBOM、プロビナンス、ライセンス、セキュリティ）。
3. リリースが、XRPLにアンカーされたマークルフ分山に含まれていること。

CIゲートの場合、`--json`オプションを使用します。

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

詳細な検証ガイド、脅威モデル、および主要な概念については、[docs/verification.md](docs/verification.md) を参照してください。

### 信頼バッジ

リポジトリは、レジストリから信頼バッジを埋め込むことができます。

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信頼と検証

### リリースの検証

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### リリースの証明

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

確認項目：`sbom.present`、`provenance.present`、`signature.chain`

### 検証ツールの実行

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### ポリシーチェックの実行

```bash
node policy/scripts/check-policy.mjs
```

確認項目：セマンティックバージョンの単調性、アーティファクトハッシュの一意性、必須機能。

## ライセンス

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> によって作成されました。
