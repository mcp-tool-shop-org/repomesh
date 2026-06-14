<p align="center">
  <a href="README.md">English</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

シントロピックリポジトリネットワーク - 追加専用の台帳、ノードマニフェスト、および分散リポジトリ調整のためのスコアリング。

## これは何ですか？

RepoMesh は、一連のリポジトリを協調的なネットワークに変えます。各リポジトリは、次の機能を持つ **ノード** です。

- 提供および消費するものを宣言する **マニフェスト** (`node.json`)
- 追加専用の台帳にブロードキャストされる **署名付きイベント**
- すべてのノードと機能をインデックス化する **レジストリ**
- 信頼のために「完了」が何を意味するかを定義する **プロファイル**

ネットワークは、次の3つの不変性を強制します。

1. **決定的な出力** - 同じ入力であれば、同じ成果物が出力される
2. **検証可能な出所** - すべてのリリースには署名が付けられ、証明されます
3. **組み合わせ可能な契約** - インターフェースはバージョン管理され、機械可読です

## クイックスタート（1つのコマンド + 2つのシークレット）

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

これは、必要なものをすべて生成します。
- `node.json` - ノードマニフェスト
- `repomesh.profile.json` - 選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml` - リリースブロードキャストワークフロー
- Ed25519署名キーペア（秘密鍵はローカルに保存されます）

次に、リポジトリに次の2つのシークレットを追加します。
1. `REPOMESH_SIGNING_KEY` - PEM形式の秘密鍵（initコマンドで出力されます）
2. `REPOMESH_LEDGER_TOKEN` - このリポジトリに対する`contents:write` + `pull-requests:write`権限を持つGitHub PAT

リリースを作成します。信頼は自動的に収束します。

### CLIフラグ

すべてのコマンドは、`--quiet`、`--verbose`、`--debug`、`--no-color`を受け入れます。`init`コマンドは、機械可読の出力のために`--json`もサポートします。

シェル補完が利用可能です。

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 環境オーバーライド

| 変数 | 目的 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 台帳エンドポイントをオーバーライドします |
| `REPOMESH_MANIFESTS_URL` | マニフェストエンドポイントをオーバーライドします |
| `REPOMESH_FETCH_TIMEOUT` | フェッチタイムアウト（ミリ秒） |

### プロファイル

| プロファイル | 証拠 | 保証チェック | 使用するタイミング |
|---------|----------|-----------------|----------|
| `baseline` | オプション | 必須ではありません | 内部ツール、実験 |
| `open-source` | SBOM + 出所情報 | ライセンス監査 + セキュリティスキャン | OSSのデフォルト設定 |
| `regulated` | SBOM + 出所情報 | ライセンス + セキュリティ + 再現性 | コンプライアンスが重要な場合 |

### 信頼を確認します

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、保証スコア、プロファイルに基づいた推奨事項を表示します。

### オーバーライド

ベリファイアーをフォークすることなく、リポジトリごとのカスタマイズ:

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

### 1. ノードマニフェストを作成します

`node.json`をリポジトリのルートに追加します。

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

公開鍵PEMを、`node.json`のmaintainersエントリに配置します。
秘密鍵をGitHubリポジトリシークレット（`REPOMESH_SIGNING_KEY`）として保存します。

### 3. ネットワークに登録します

このリポジトリにノードマニフェストを追加するプルリクエストを開きます。

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加します

`templates/repomesh-broadcast.yml`を、リポジトリの`.github/workflows/`にコピーします。
`REPOMESH_LEDGER_TOKEN`シークレットを設定します（このリポジトリに対する`contents:write` + `pull-requests:write`権限を持つきめ細かいPAT）。

すべてのリリースは、署名された`ReleasePublished`イベントを台帳に自動的にブロードキャストするようになります。

## 台帳ルール

- **追加専用** - 既存の行は不変です
- **スキーマ検証済み** - すべてのイベントは、`schemas/event.schema.json`に対して検証されます
- **署名検証済み** - すべてのイベントには、登録されたノードのメンテナーによる署名が付けられています
- **一意性** - `(repo, version, type)`エントリの重複はありません
- **タイムスタンプの妥当性** - 現在時刻より1時間以上未来または1年以上過去であることはありません

## イベントタイプ

台帳は現在、以下に示す**ライブ**イベントタイプを発行しています。残りのイベントは**予約済み/計画中**です。スキーマはそれらを受け入れますが、まだどのノードも発行していません。ロードマップが明確になるようにリストアップしていますが、存在しない機能があることを暗示するものではありません（信頼製品における正直さ）。

**ライブ（本日発行）:**

| タイプ | タイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされました |
| `AttestationPublished` | アテスターがリリースを検証しました |
| `ledger.anchor` | アンカーノードがパーティション（Merkleルート + XRPLメモ）をシールしました |
| `attestation.dispute` | 信頼できるノードがアテステーションに異議を申し立てました（評価を下げる） |
| `KeyRotation` | メンテナンスキーは、後継のキーに切り替えられます（将来的に有効であり、過去の署名は引き続き有効）。 |
| `KeyRevocation` | メンテナンスキーは無効化されます（セキュリティ侵害＝遡及的な無効化、RFC 5280）。 |

**予約済み/計画中（まだ発行されていません）:**

| タイプ | 意図された意味 |
|------|------------------|
| `BreakingChangeDetected` | 破壊的な変更が導入されました |
| `HealthCheckFailed` | ノードが独自のヘルスチェックに失敗しました |
| `DependencyVulnFound` | 依存関係に脆弱性が見つかりました |
| `InterfaceUpdated` | インターフェーススキーマが変更されました |
| `PolicyViolation` | ネットワークポリシーに違反しました |

## キーのローテーションと無効化

メンテナンスキーにはライフサイクルがあります。キーは後継のキーに**ローテーション**されるか、または**無効化**され、検証は**時間依存**です。つまり、署名が信頼されるのは、そのキーが署名が行われた時点で有効であった場合のみであり、XRPLアンカーのクローズタイム（すでにレジャーで使用されている信頼できるクロック）が使用されます。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **定期的なローテーション**は*将来的に有効*です。つまり、廃止されたキーによる過去の署名は引き続き有効であり、単に新しいリリースの署名を行わなくなります。
- **セキュリティ侵害**は*遡及的*です（RFC 5280 §5.3.2）。証明可能なアンカー時間が無効化日以降であるすべての署名は拒否され、それよりも前に作成されたことが証明できない署名も拒否されます。
- **ライフサイクルフィールドを持たない**キーは、既存のノードで変更なしに検証されるため、引き続き有効とみなされます（過去からの互換性）。
- 無効化は`KeyRevocation`イベントとして署名され、唯一のキーが侵害された単一キーノードは、**ガバナンス**（`trustedPolicy`）ノードによって無効化イベントに署名することで復旧されます。信頼性が重要なノードは、**2つ以上のキー**を登録する必要があります（TUF §6.1）。
- 変更された`node.json`であっても、署名され、XRPLアンカーされたイベントから無効化が再適用されるため、改ざんされたマニフェストでは無効化されたキーを復活させることはできません。境界については、[脅威モデル](docs/threat-model.md)を参照してください（正当なレジャーに対して検証し、無効化に敏感なチェックには`--anchored`を使用します）。

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化します |
| `attestor` | クレームを検証します（ビルド、コンプライアンス） |
| `policy` | ルールを適用します（スコアリング、ゲート） |
| `oracle` | 外部データを提供します |
| `compute` | 作業を実行します（変換、ビルド） |
| `settlement` | 状態を確定します |
| `governance` | 意思決定を行います |
| `identity` | 資格情報を発行/検証します |

## パブリック検証

誰でも1つのコマンドでリリースを検証できます。クローンは必要ありません。CLIが代わりに公開台帳を取得します。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

このチェックでは、以下の項目を確認します。

1.  `ReleasePublished` イベントが存在し、**そのリポジトリ自身の** `node.json` に登録されたキーによって署名されていること（Ed25519）。別のリポジトリに登録されたキーでは検証できません。
2.  リポジトリの信頼プロファイルが満たされていること：すべてのプロファイルで必須とされるアテステーション（SBOM、来歴、ライセンス、セキュリティ）が存在し、信頼できるアテスターによって署名され、最新の結果が `pass` であり、少なくとも 1 つ以上の**独立した**アテスターが存在すること。自己署名のみで独立したアテステーションがないリリースの場合、結果は `UNVERIFIED` となり、決して `PASS` にはなりません。
3.  `--anchored` オプションを使用した場合：パーティションの Merkle ルートが再計算され、マニフェストと照合されます。また、ネットワークに接続されている場合は、オンチェーン XRPL トランザクションを取得し、検証します（`validated` + `tesSUCCESS` となり、署名アカウントが信頼できるアンカーの許可リストに含まれ、オンチェーンメモがローカルのルート/マニフェストハッシュ/カウントと一致すること）。オフラインの場合は、偽のトランザクションではなく、`XRPL NOT verified` という結果が表示されます。厳密な `--anchored` オプションを使用すると、このチェックに失敗します（オンチェーンの証明なしでローカルで検証されたマニフェストを受け入れる場合は、`--anchored-or-local` を使用してください）。

CIゲートの場合、出力形式として`--format <text|json|sarif|markdown>` を選択してください（`--json` は `--format json` のエイリアスです）。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**終了コード**は、3値の結果に基づいて決定されるため、CIのステップで直接その値を参照して処理を制御できます。

| 出口 | 判決、結論、評決 | 意味 |
|------|---------|---------|
| `0` | 合格。 | 信頼できる情報であり、検証済である（または、`--fail-on=fail` オプションが指定されている場合は、検証されていない）。 |
| `1` | 失敗。 | 重大なエラー：偽造または誤ったリポジトリの署名、許可リストに登録されていない認証者、または必須のチェックが失敗。 |
| `3` | 確認されていません。 | 不確かな情報——まだ裏付けが取れていない、独立した証拠がない、または必要な確認手続きが完了していない。 |
| `2` | — | 使用方法の誤り、または内部エラーが発生しました。 |

`--fail-on <fail\|unverified>` は、厳格さを設定します。デフォルトは `unverified` で、FAIL と UNVERIFIED の両方でエラーとなります。`--fail-on=fail` を指定すると、UNVERIFIED の場合は警告を表示して正常終了（終了コード 0）となり、警告モードでの導入が可能になります。

`verify-all` を使用して、一度にすべてのデータをまとめて検証し、ローカルの複製に対してオフラインで検証するには、`--local` オプションを使用します。

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

CIでゲート処理を行うには、同梱されている複合アクションを使用してください。詳細については、次のドキュメントを参照してください。[GitHub Actionsの使用方法](docs/verification.md#using-the-github-action)。

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

完全な検証ガイド、脅威モデル、および主要な概念については、[docs/verification.md](docs/verification.md) を参照してください。

### 信頼の証マーク

リポジトリには、レジストリから信頼性のバッジを埋め込むことができます。

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信頼と検証

### リリースを確認する

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### リリースを証明する

> 検証を行い、検証プログラムを実行することは、この台帳のクローンに対して実行される「オペレーター」のタスクであるため、チェックアウトから実行されます。リリースを検証する際には、上記の `npx` コマンドを使用してください。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

確認項目：`sbom.present`、`provenance.present`、`signature.chain`

### 検証ツールを実行する

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

セキュリティ検証の閾値（最大CVE数、許容される深刻度）は、`verifiers/security/config.json`を通じて設定されます。

### ポリシーチェックを実行する

```bash
node policy/scripts/check-policy.mjs
```

チェック項目：セマンティックバージョニングの単調性、成果物のハッシュ値の一意性、必要な機能。

## セキュリティと脅威モデル

RepoMeshは、**レジャーイベント**（署名されたJSON）、**ノードマニフェスト**（公開キー＋機能）、**レジストリインデックス**（自動生成された信頼スコア）、および**XRPLテストネット**（アンカー取引）にアクセスします。メンバーリポジトリのソースコード、秘密鍵、ユーザー認証情報、または閲覧データにはアクセスしません。署名に使用する秘密鍵は、CIランナーから外部に送信されることはありません。ネットワークへのアクセスは、GitHub API（PR作成）、XRPLテストネット（アンカーリング）、およびOSV.dev（脆弱性検索）に限定されます。**テレメトリは収集または送信されません**。分析、クラッシュレポート、電話ホーム機能はありません。完全な範囲、必要な権限、および脆弱性報告プロセスについては、[SECURITY.md](SECURITY.md)を参照し、キーライフサイクルの信頼境界（`node.json`の真正性がそのソースに依存する理由、および無効化に敏感な検証で`--anchored`を使用する必要がある理由）については、[脅威モデル](docs/threat-model.md)を参照してください。

硬化：

- 変数データを展開する子プロセス呼び出しでは、配列を引数として `execFileSync` を使用します。残りの `execSync` 呼び出しでは、静的で固定のコマンド文字列を使用するため、シェルインジェクションのリスクはありません。
- Ledger およびレジストリの JSON は、構造化された行番号付きのエラーとともに `try`/`catch` ブロック内で解析されます。不正な形式の行はスキップされ、エラーとして表示されますが、生のスタックによってツールがクラッシュすることはありません。
- すべてのファイル操作（解決 + 境界チェック）において、パス・トラバーサルを防止します。
- ReDoS（Regular Expression Denial of Service）攻撃から保護された解析処理全体（無制限の正規表現は使用しません）。
- PEM形式の秘密鍵は `.gitignore` を通じて除外され、標準出力や CI ログに出力されることはなく、所有者のみがアクセス可能な権限 (`0600`) で書き込まれます。

## テスト

包括的な `node --test` スイートは、Ed25519署名、スキーマ検証、Merkleツリーの整合性（v1 + RFC-6962 v2）、追加専用不変条件、パス走査防止、アンカー検証、信頼できる認証者許可リスト、およびCLI、台帳、アンカー、検証者、ツールレイヤー全体にわたる入力検証を網羅します。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

テストケースの数は、テストスイートを追加するたびに増えていくため、最新の合計数を把握するには、上記のコマンドを実行してください。古い数値に頼るのではなく、常に最新の情報を使用するようにしましょう。

## ライセンス

マサチューセッツ工科大学

---

<a href="https://mcp-tool-shop.github.io/">MCPツールショップ</a>によって作成されました。
