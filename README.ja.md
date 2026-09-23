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

シントロピック・リポジトリ・ネットワーク — 追記専用の台帳、ノードのマニフェスト、および分散リポジトリの連携のためのスコアリング。

## これは何ですか？

RepoMesh は、複数のリポジトリを連携するネットワークに変換します。各リポジトリは、次の要素を持つ **ノード** です。

- `node.json` で、提供および消費するものを宣言する **マニフェスト**
- 追記専用の台帳にブロードキャストされる **署名付きイベント**
- すべてのノードと機能をインデックス化する **レジストリ**
- 信頼における「完了」の意味を定義する **プロファイル**

現在、GitHub の 1 つの組織 (mcp-tool-shop-org) が、ログ、アテスター、ポリシーチェック、および XRPL アンカーを運用しています。登録された 6 つのノードは、6 人のオペレーターを意味するわけではありません。独立した証人とは、この組織が運用していない主体です。

このネットワークは、次の 3 つの不変条件を適用します。

1. **決定的な出力** — 同じ入力、同じ成果物
2. **検証可能な出所** — すべてのリリースは署名され、アテステーションされます
3. **組み合わせ可能な契約** — インターフェースはバージョン管理され、機械可読です

## クイックスタート (1 つのコマンド + 2 つのシークレット)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

これは、必要なものをすべて生成します。
- `node.json` — ノードのマニフェスト
- `repomesh.profile.json` — 選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml` — リリースのブロードキャストワークフロー
- Ed25519 署名キーペア（秘密鍵はローカルに保持）

次に、リポジトリに 2 つのシークレットを追加します。
1. `REPOMESH_SIGNING_KEY` — 秘密鍵の PEM 形式 (init コマンドで出力)
2. `REPOMESH_LEDGER_TOKEN` — このリポジトリに対する `contents:write` + `pull-requests:write` の権限を持つ GitHub PAT

リリースを実行します。信頼は自動的に収束します。

### CLI フラグ

すべてのコマンドは、`--quiet`、`--verbose`、`--debug`、`--no-color` を受け入れます。`init` コマンドは、機械可読の出力のために `--json` もサポートします。

シェル補完が利用可能です。

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 環境オーバーライド

| 変数 | 目的 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 台帳のエンドポイントをオーバーライドします |
| `REPOMESH_MANIFESTS_URL` | マニフェストのエンドポイントをオーバーライドします |
| `REPOMESH_FETCH_TIMEOUT` | フェッチのタイムアウト（ミリ秒） |

### プロファイル

| プロファイル | 証拠 | 保証チェック | 使用するタイミング |
|---------|----------|-----------------|----------|
| `baseline` | オプション | 必須ではありません | 内部ツール、実験 |
| `open-source` | SBOM + 出所 | ライセンス監査 + セキュリティスキャン | OSS のデフォルト |
| `regulated` | SBOM + 出所 | ライセンス + セキュリティ + 再現性 | コンプライアンスが重要な場合 |

### 信頼をチェックします

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、保証スコア、プロファイルに対応した推奨事項を表示します。

### オーバーライド

ベリファイアをフォークすることなく、リポジトリごとにカスタマイズできます。

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

## 手動での参加（5 分）

### 1. ノードのマニフェストを作成します

`node.json` をリポジトリのルートに追加します。

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` は、公開キーと、リポジトリの `node.json` のメンテナーエントリに配置できる `keyId` を出力し、
秘密鍵（モード 0600）を、`--out` で指定した場所にのみ書き込みます。追跡パスには書き込まれません。GitHub リポジトリのシークレット (`REPOMESH_SIGNING_KEY`) として保存します。（手動で実行する場合: `openssl genpkey -algorithm ED25519 ...`。）

> **信頼が重要なノードの場合は、≥2 つのキーを登録してください** (TUF §6.1)。単一のキーは、侵害された場合に、自身の取り消しに署名することはできません。`repomesh init --second-key` は、別の 2 番目のメンテナーを登録し、1 つのキーで別のキーを取り消すことができるようにします。`init` は、ノードにアクティブなキーが 1 つしかない場合に警告します。

### 3. ネットワークに登録します

このリポジトリに、ノードのマニフェストを追加する PR を開きます。

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加します

`templates/repomesh-broadcast.yml` をリポジトリの `.github/workflows/` にコピーします。
`REPOMESH_LEDGER_TOKEN` シークレットを設定します（このリポジトリに対する contents:write + pull-requests:write の権限を持つ、きめ細かい PAT）。

すべてのリリースは、署名された `ReleasePublished` イベントを台帳に自動的にブロードキャストするようになります。

## 台帳ルール

- **追記専用** — 既存の行は不変です
- **スキーマ検証** — すべてのイベントは `schemas/event.schema.json` に対して検証されます
- **署名検証** — すべてのイベントは、登録されたノードのメンテナーによって署名されます
- **一意性** — `(repo, version, type)` エントリの重複はありません
- **タイムスタンプの妥当性** — 現在時刻より 1 時間以上未来、または 1 年以上過去であってはなりません

## イベントタイプ

台帳は現在、以下の **ライブ** イベントタイプを出力します。残りのイベントは **予約済み / 計画中** です。スキーマはそれらを受け入れますが、まだどのノードもそれらを出力していません。それらをリストすることで、ロードマップが明確になり、存在しない機能を暗示することはありません（信頼製品に対する率直さ）。

**ライブ（本日出力）:**

| タイプ | タイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされました |
| `AttestationPublished` | アテスターがリリースを検証しました |
| `ledger.anchor` | アンカーノードがパーティションをシールしました（Merkle ルート + XRPL メモ） |
| `attestation.dispute` | 信頼できるノードがアテステーションに異議を唱えました（評価をダウングレード） |
| `KeyRotation` | メンテナーキーが後継者にローテーションされました（将来的なもの — 過去の署名は有効なままです） |
| `KeyRevocation` | メンテナーキーが取り消されました（侵害 = 事後的な無効性、RFC 5280） |

**予約済み / 計画中（まだ出力されていません）:**

| タイプ | 意図された意味 |
|------|------------------|
| `BreakingChangeDetected` | 破壊的な変更が導入されました |
| `HealthCheckFailed` | ノードが自身のヘルスチェックに失敗しました |
| `DependencyVulnFound` | 依存関係に脆弱性が見つかりました |
| `InterfaceUpdated` | インターフェーススキーマが変更されました |
| `PolicyViolation` | ネットワークポリシーに違反しました |

## キーのローテーションと取り消し

メンテナーキーにはライフサイクルがあります。キーは後継者に **ローテーション** することも、**取り消し** することもでき、検証は **時間依存** です。署名は、署名された信頼できる時間においてキーが有効である場合にのみ信頼されます。信頼できる時間は、台帳がすでに使用している信頼できるクロックである XRPL アンカーのクローズ時間です。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **定期的なローテーション**は*将来的なもの*です。廃止されたキーの過去の署名は有効なままです。単に、新しいリリースの署名を行わなくなるだけです。
- **妥協**は*遡及的*です（RFC 5280 §5.3.2）。検証可能なアンカー時間が無効化日以降であるすべての署名は拒否され、それよりも古い日付であることが証明できない署名も拒否されます。
- **ライフサイクルフィールドを持たない**キーは、既存のキーとして扱われ（常に有効）、既存のノードは変更なしで検証します。
- 失効は`KeyRevocation`イベントとして署名されます。唯一のキーが侵害された単一キーノードは、**ガバナンス**（`trustedPolicy`）ノードが失効に署名することで復旧されます。信頼性が重要なノードは、**≥2つのキー**を登録する必要があります（TUF §6.1）。
- 変更された`node.json`に対しても、失効は署名され、XRPLにアンカーされたイベントから再適用されます。改ざんされたマニフェストは、失効されたキーを復活させることはできません。境界については、[脅威モデル](docs/threat-model.md)を参照してください（正規の台帳に対して検証し、失効に敏感なチェックには`--anchored`を使用します）。

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化 |
| `attestor` | クレームを検証（ビルド、コンプライアンス） |
| `policy` | ルールを適用（スコアリング、ゲーティング） |
| `oracle` | 外部データを提供 |
| `compute` | 作業を実行（変換、ビルド） |
| `settlement` | 状態を確定 |
| `governance` | 意思決定を行う |
| `identity` | 認証情報を発行/検証 |

## ネットワークの拡張 — ベリファイアプラグインコントラクト

新しい**チェックの種類**と**ベリファイアノード**は、コードではなくデータを編集することで追加されます。チェック種類のレジストリ、スコアリングの重み、ノード種類の権限は、[`verifier.policy.json`](verifier.policy.json)に保存されます（スキーマ検証済み、フェイルクローズ）。チェックを追加する（例：`sast.scan`）には、約6行のポリシー編集と`node.json`が必要であり、PRでレビューされます。コードの変更は必要ありません。

唯一の不変性：**登録済み ≠ 信頼済み**。登録により、チェックが参加できるようになります。ただし、信頼できるセットのコンセンサスによる承認が必要です。完全なガイド：[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)。

## パブリック検証

誰でも1つのコマンドでリリースを検証できます。**クローンは不要**です。CLIは、パブリック台帳を自動的に取得します。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

これは、次のことを確認します。
1. `ReleasePublished`イベントが存在し、**そのリポジトリ自身の**`node.json`に登録されたキーによって署名されている（Ed25519）。別のリポジトリに登録されたキーは、これを検証できません。
2. リポジトリの信頼プロファイルが満たされている：プロファイルで必要なすべてのアテステーション（SBOM、プロベナンス、ライセンス、セキュリティ）が存在し、信頼できるアテスターによって署名されており、最新の結果が`pass`であり、少なくとも1つの**独立した**アテスターが存在します。自己署名のみで独立したアテステーションがないリリースは、`UNVERIFIED`を報告し、決して`PASS`を報告することはありません。
3. `--anchored`を使用すると、パーティションのMerkleルートが再計算され、マニフェストと照合されます。また、ネットワークに到達可能な場合は、オンチェーンのXRPLトランザクションが取得され、アサートされます（`validated` + `tesSUCCESS`、署名アカウントは信頼できるアンカーの許可リストにあり、オンチェーンのメモはローカルのルート/マニフェストハッシュ/カウントにバインドされます）。オフラインの場合、偽のトランザクションではなく、`XRPL NOT verified`を報告します。厳密な`--anchored`は失敗します（ローカルで検証されたマニフェストをオンチェーンの証明なしで受け入れるには、`--anchored-or-local`を使用します）。

CIゲートの場合、`--format <text|json|sarif|markdown>`を含む出力形式を選択します（`--json`は`--format json`のエイリアスです）。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**終了コード**は、3つの状態の判定から導き出されるため、CIステップで直接ゲート処理できます。

| 終了 | 判定 | 意味 |
|------|---------|---------|
| `0` | PASS | 認証済みで確実（または、`--fail-on=fail`によって緩和された場合にUNVERIFIED）。 |
| `1` | FAIL | 重大なエラー — 偽造/誤ったリポジトリの署名、許可リストにないアテスター、または必要なチェックが失敗。 |
| `3` | UNVERIFIED | 軽微 — まだアンカーされていない、独立した証拠がない、または必要なチェックが不足している。 |
| `2` | — | 使用エラーまたは内部クラッシュ。 |

### コンテナ

同じCLIは、npmバージョンとgit shaでタグ付けされて、`ghcr.io/mcp-tool-shop-org/repomesh`として公開されます。イメージは、非rootユーザーとして実行されます。ウォレットシードは含まれていません。

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

アンカーを投稿するには、別のコマンドを使用します。実行時に`XRPL_SEED`が渡されます。

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

毎日のワークフローは、チェックアウトからこのイメージをビルドし、それとともに投稿します。`anchor/xrpl/config.json`のネットワークは、まだテストネットです。メインネットへの投稿は、まず、CLIリリースで出荷される許可リストに追加されたクラシックアドレスを持つ資金調達されたアカウントを待機します。その許可リストは上限です。取得した構成は、アカウントを削除できますが、追加することはできません。

`--fail-on <fail\|unverified>`は厳密さを設定します。デフォルトの`unverified`は、FAILとUNVERIFIEDの両方で失敗します。`--fail-on=fail`は、UNVERIFIEDを警告モードでの導入でパスさせます（終了コード0、警告付き）。

`verify-all`を使用して、1つの台帳ロードで一括して検証し、`--local`を使用してローカルクローンに対してオフラインで検証します。

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

バンドルされた複合アクションを使用して、**CIでゲート処理**します。詳細については、[GitHubアクションの使用](docs/verification.md#using-the-github-action)を参照してください。

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

完全な検証ガイド、脅威モデル、および主要な概念については、[docs/verification.md](docs/verification.md)を参照してください。

### ライブラリとして使用

検証エンジンは、安定したプログラムAPIとしてエクスポートされます。CLIへのシェルアウトの代わりに、独自のツールに組み込んでください。

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### ネットワークステータスエンドポイント

ダッシュボードは、外部ポーリング用の機械可読の[`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)を公開します。台帳の鮮度（フローズン台帳シグナル付き）、信頼の判定数、アンカーされたパーティションと保留中のパーティション、および`ok`/`degraded`ロールアップ（理由付き）。

### 信頼バッジ

リポジトリは、レジストリから信頼バッジを埋め込むことができます。

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## 信頼と検証

### リリースを検証

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### リリースをアテステーション

> 検証の実行とアテステーションは、この台帳のクローンに対して実行される**オペレーター**のタスクであるため、チェックアウトから実行されます。リリースの検証には、上記の`npx`コマンドは使用しません。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

チェック：`sbom.present`、`provenance.present`、`signature.chain`

### 検証ツールの実行

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

セキュリティ検証の閾値（最大CVE数、許可される重大度）は、`verifiers/security/config.json`を通じて構成によって制御されます。

### ポリシーチェックの実行

```bash
node policy/scripts/check-policy.mjs
```

チェック：セマンティックバージョニングの一貫性、アーティファクトハッシュの一意性、必要な機能。

## セキュリティと脅威モデル

RepoMeshは、**台帳イベント**（署名されたJSON）、**ノードマニフェスト**（公開鍵＋機能）、**レジストリインデックス**（自動生成された信頼スコア）、および**XRPLテストネット**（アンカー取引）にアクセスします。メンバーリポジトリのソースコード、秘密鍵、ユーザー認証情報、または閲覧データにはアクセスしません。秘密の署名鍵は、CIランナーから決して送信されません。ネットワークアクセスは、GitHub API（PRの作成）、XRPLテストネット（アンカーリング）、およびOSV.dev（脆弱性の検索）に限定されます。**テレメトリは収集または送信されません**。分析、クラッシュレポート、または外部への通信は行いません。完全な範囲、必要な権限、および脆弱性報告プロセスについては、[SECURITY.md](SECURITY.md)を参照してください。また、鍵のライフサイクルにおける信頼の境界（なぜ`node.json`の信頼性はそのソースに依存し、なぜ取り消しに敏感な検証には`--anchored`を使用する必要があるのか）については、[脅威モデル](docs/threat-model.md)を参照してください。

セキュリティ強化：

- 変数データを補間する子プロセス呼び出しでは、配列引数とともに`execFileSync`を使用します。残りの`execSync`呼び出しでは、静的で定数であるコマンド文字列を使用します。シェルインジェクションの脆弱性はありません。
- 台帳とレジストリのJSONは、構造化された、行番号付きのエラーとともに、`try`/`catch`内で解析されます。不正な形式の行はスキップされ、エラーとして表示されますが、生のスタックによってツールがクラッシュすることはありません。
- すべてのファイル操作において、パス・トラバーサルを防止します（解決＋境界チェック）。
- ReDoS（Regular Expression Denial of Service）攻撃に強い解析を全体で使用します（無制限の正規表現はありません）。
- PEM形式の秘密鍵は、`.gitignore`によって除外され、標準出力またはCIログに出力されることはなく、所有者のみがアクセスできる（`0600`）権限で書き込まれます。

## テスト

完全な`node --test`スイートは、Ed25519署名、スキーマ検証、Merkleツリーの整合性（v1 + RFC-6962 v2）、追加専用の不変性、パス・トラバーサルの防止、アンカー検証、信頼できるアテスターの許可リスト、およびCLI、台帳、アンカー、検証ツール、およびツールレイヤー全体の入力検証をカバーします。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

テストスイートを追加するにつれて、テスト数は増加します。現在の合計数は、上記のコマンドを実行して確認してください。古い数値に依存しないでください。

## ライセンス

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>によって作成されました。
