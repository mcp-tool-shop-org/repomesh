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

Syntropic repo network — 分散リポジトリ連携のための、追記専用台帳、ノードマニフェスト、およびスコアリング。

## これは何？

RepoMeshは、リポジトリの集合を協調的なネットワークに変えます。各リポジトリは**ノード**であり、以下の要素を持ちます：

- 提供するものと消費するものを宣言する**マニフェスト** (`node.json`)
- 追記専用台帳にブロードキャストされる**署名付きイベント**
- 全てのノードと機能をインデックス化する**レジストリ**
- 信頼において「完了」の意味を定義する**プロファイル**

このネットワークは3つの不変条件を強制します：

1. **決定的な出力** — 同じ入力からは同じ成果物が生成される
2. **検証可能な来歴** — すべてのリリースは署名され、証明される
3. **合成可能なコントラクト** — インターフェースはバージョン管理され、機械可読である

## クイックスタート（1コマンド + 2つのシークレット）

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

これにより、必要なものがすべて生成されます：
- `node.json` — あなたのノードマニフェスト
- `repomesh.profile.json` — 選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml` — リリースブロードキャストワークフロー
- Ed25519署名キーペア（秘密鍵はローカルに保持）

次に、リポジトリに2つのシークレットを追加します：
1. `REPOMESH_SIGNING_KEY` — 秘密鍵のPEM（initコマンドで表示される）
2. `REPOMESH_LEDGER_TOKEN` — このリポジトリに対して`contents:write`と`pull-requests:write`の権限を持つGitHub PAT

リリースを作成します。信頼は自動的に収束します。

### CLIフラグ

すべてのコマンドは `--quiet`、`--verbose`、`--debug`、`--no-color` を受け付けます。`init`コマンドは、機械可読な出力のために `--json` もサポートしています。

シェル補完が利用可能です：

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 環境変数による上書き

| 変数 | 目的 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 台帳のエンドポイントを上書き |
| `REPOMESH_MANIFESTS_URL` | マニフェストのエンドポイントを上書き |
| `REPOMESH_FETCH_TIMEOUT` | フェッチのタイムアウト（ミリ秒単位） |

### プロファイル

| プロファイル | 証拠 | 保証チェック | 使用場面 |
|---------|----------|-----------------|----------|
| `baseline` | オプション | なし | 内部ツール、実験 |
| `open-source` | SBOM + 来歴 | ライセンス監査 + セキュリティスキャン | OSS向けのデフォルト |
| `regulated` | SBOM + 来歴 | ライセンス + セキュリティ + 再現性 | コンプライアンスが重要な場合 |

### 信頼の確認

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、保証スコア、プロファイル対応の推奨事項を表示します。

### 上書き

検証ツールをフォークすることなく、リポジトリごとのカスタマイズ：

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

### 1. ノードマニフェストを作成する

リポジトリのルートに `node.json` を追加します：

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

### 2. 署名キーペアを生成する

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

公開鍵のPEMを `node.json` の `maintainers` エントリに追加します。
秘密鍵はGitHubリポジトリのシークレット (`REPOMESH_SIGNING_KEY`) として保存します。

### 3. ネットワークに登録する

ノードマニフェストを追加するために、このリポジトリにPRを開きます：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加する

`templates/repomesh-broadcast.yml` をあなたのリポジトリの `.github/workflows/` にコピーします。
`REPOMESH_LEDGER_TOKEN` シークレットを設定します（このリポジトリに対して contents:write と pull-requests:write の権限を持つ、きめ細かいPAT）。

これにより、今後すべてのリリースで、署名付きの `ReleasePublished` イベントが台帳に自動的にブロードキャストされます。

## 台帳のルール

- **追記専用** — 既存の行は不変
- **スキーマ検証済み** — すべてのイベントは `schemas/event.schema.json` に対して検証される
- **署名検証済み** — すべてのイベントは登録されたノードのメンテナーによって署名されている
- **一意性** — 重複する `(repo, version, type)` のエントリは存在しない
- **妥当なタイムスタンプ** — 未来1時間以上、または過去1年以上ではない

## イベントの種類

現在、台帳は以下の**ライブ**イベントタイプを発行します。残りは**予約済み/計画中**です — スキーマはそれらを受け入れますが、まだどのノードも発行していません。ロードマップを可視化し、存在しない範囲を暗示しないようにするために、これらをリストアップしています（信頼性の高い製品として、隠すことなく正直に情報を開示するためです）。

**ライブ（本日発行分）：**

| タイプ | タイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされたとき |
| `AttestationPublished` | 証明者がリリースを検証したとき |
| `ledger.anchor` | アンカーノードがパーティションをシールしたとき（マークルルート + XRPLメモ） |
| `attestation.dispute` | 信頼できるノードが証明に異議を申し立てたとき（判定を格下げ） |

**予約済み/計画中（まだ発行されていません）：**

| タイプ | 意図 |
|------|------------------|
| `BreakingChangeDetected` | 破壊的変更が導入されたとき |
| `HealthCheckFailed` | ノードが自身のヘルスチェックに失敗したとき |
| `DependencyVulnFound` | 依存関係に脆弱性が発見されたとき |
| `InterfaceUpdated` | インターフェーススキーマが変更されたとき |
| `PolicyViolation` | ネットワークポリシーに違反したとき |

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化する |
| `attestor` | クレーム（ビルド、コンプライアンス）を検証する |
| `policy` | ルール（スコアリング、ゲーティング）を強制する |
| `oracle` | 外部データを提供する |
| `compute` | 作業を実行する（変換、ビルド） |
| `settlement` | 状態を確定する |
| `governance` | 意思決定を行う |
| `identity` | 認証情報を発行/検証する |

## 公開検証

誰でも一つのコマンドでリリースを検証できます — **クローンは不要**で、CLIが公開台帳を自動で取得します：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

このコマンドは以下を検証します：
1. `ReleasePublished` イベントが存在し、**そのリポジトリ自身の** `node.json` に登録されたキーによって署名（Ed25519）されていること — 別のリポジトリに登録されたキーでは検証できません。
2. リポジトリのトラストプロファイルが満たされていること：プロファイル必須のすべての証明（SBOM、プロベナンス、ライセンス、セキュリティ）が存在し、信頼できる証明者によって署名され、その最新の結果が `pass` であること。ただし、少なくとも一人の**独立した**証明者が含まれている必要があります。自己署名のみで独立した証明者がいないリリースは、`PASS` になることはなく、`UNVERIFIED` と報告されます。
3. `--anchored` を使用した場合：パーティションのマークルルートが再計算され、マニフェストと一致すること。また、ネットワークに接続可能な場合、オンチェーンのXRPLトランザクションが取得され、検証されます（`validated` + `tesSUCCESS`、署名アカウントが信頼できるアンカーの許可リストに含まれていること、オンチェーンのメモがローカルのルート/マニフェストハッシュ/カウントに紐づいていること）。オフラインの場合、偽のトランザクションではなく `XRPL NOT verified` と報告されます。そのため、厳密な `--anchored` は失敗します（オンチェーンでの証明なしにローカルで検証済みのマニフェストを受け入れるには `--anchored-or-local` を使用してください）。

CIゲートの場合、`--format <text|json|sarif|markdown>` で出力フォーマットを選択します（`--json` は `--format json` のエイリアスです）：

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**終了コード**は3状態の判定から導出されるため、CIのステップでこれを直接ゲートとして使用できます：

| 終了コード | 判定 | 意味 |
|------|---------|---------|
| `0` | PASS | 本物であり、保証されている（または `--fail-on=fail` で緩和された場合は `UNVERIFIED`）。 |
| `1` | FAIL | 致命的な失敗 — 署名の改ざん/不正なリポジトリの署名、許可リストにない証明者、または必須のチェックが失敗した場合。 |
| `3` | UNVERIFIED | ソフト — まだアンカーされていない、独立した監証者がいない、または必須のチェックが欠落している場合。 |
| `2` | — | 使用法のエラーまたは内部クラッシュ。 |

`--fail-on <fail\|unverified>` は厳密さを設定します。デフォルトの `unverified` は FAIL と UNVERIFIED の両方で失敗しますが、`--fail-on=fail` は警告モードでの導入のため、UNVERIFIED を通過させ（終了コード 0、警告付き）、失敗させません。

`verify-all` で台帳を一度にロードし、バッチ全体を検証します。また、`--local` を使ってローカルのクローンに対してオフラインで検証することもできます：

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

バンドルされたコンポジットアクションを使って**CIでゲートする**方法については、[GitHub Actionの使用方法](docs/verification.md#using-the-github-action)を参照してください：

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

詳細な検証ガイド、脅威モデル、および主要な概念については、[docs/verification.md](docs/verification.md) を参照してください。

### トラストバッジ

リポジトリは、レジストリからトラストバッジを埋め込むことができます：

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信頼と検証

### リリースを検証する

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### リリースをアテストする

> アテストと検証の実行は、この台帳のクローンに対して操作を行う**オペレーター**のタスクであるため、チェックアウトから実行します。リリースの検証はそうではありません — 上記の `npx` コマンドを使用してください。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

チェック項目：`sbom.present`、`provenance.present`、`signature.chain`

### 検証を実行する

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

セキュリティ検証のしきい値（最大CVE数、許可される深刻度）は、`verifiers/security/config.json` を通じて設定駆動です。

### ポリシーチェックを実行する

```bash
node policy/scripts/check-policy.mjs
```

チェック項目：semverの単調性、アーティファクトハッシュの一意性、必須ケイパビリティ。

## セキュリティと脅威モデル

RepoMeshは**台帳イベント**（署名付きJSON）、**ノードマニフェスト**（公開キーとケイパビリティ）、**レジストリインデックス**（自動生成された信頼スコア）、および**XRPLテストネット**（アンカートランザクション）を扱います。メンバーリポジトリのソースコード、秘密キー、ユーザーの認証情報、閲覧データにはアクセスしません。秘密の署名キーはCIランナーを離れることはありません。ネットワークアクセスはGitHub API（PRの作成）、XRPLテストネット（アンカー）、OSV.dev（脆弱性の照会）に限定されています。**テレメトリ**は収集も送信もされません — 分析、クラッシュレポート、利用状況の送信（phone-home）は一切ありません。完全なスコープ、必要な権限、および脆弱性報告のプロセスについては、[SECURITY.md](SECURITY.md) を参照してください。

セキュリティ強化：

- 変数データを補間する子プロセス呼び出しは、配列引数を持つ `execFileSync` を使用します。残りの `execSync` 呼び出しは、静的で定数のコマンド文字列を使用します — シェルインジェクションの経路はありません。
- 台帳とレジストリのJSONは、構造化された行番号付きエラーで `try`/`catch` 内で解析されます。不正な形式の行はスキップされて通知され、ツールが生のスタックトレースでクラッシュすることはありません。
- すべてのファイル操作でパストラバーサルを防止します（resolve + 境界チェック）。
- 全体でReDoSセーフな解析を行います（非有界な正規表現は使用しません）。
- PEM秘密キーは `.gitignore` によって除外され、stdoutやCIログに出力されることはなく、所有者のみ（`0600`）のパーミッションで書き込まれます。

## テスト

完全な `node --test` スイートは、Ed25519署名、スキーマ検証、Merkleツリーの整合性（v1 + RFC-6962 v2）、追記のみの不変条件、パストラバーサルの防止、アンカーの検証、信頼されたアテスターの許可リスト、およびCLI、台帳、アンカー、検証、ツールの各レイヤーにおける入力検証をカバーしています。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

テストの数は、スイートが追加されるにつれて増加します — 現在の合計数を確認するには、古くなる可能性のある数値に頼るのではなく、上記のコマンドを実行してください。

## ライセンス

MIT

---

開発：<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
