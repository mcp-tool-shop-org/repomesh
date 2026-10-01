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

シントロピックリポジトリネットワーク — 追記専用の台帳、ノードマニフェスト、および分散リポジトリの連携のためのスコアリング。

## システムにおける配置場所

Attestia、Cognate、およびRepoMeshは、3つの製品である。

**RepoMesh**は、リリースネットワークである：署名されたイベント、ノードマニフェスト、およびXRPLにアンカーされた信頼クロック。独自のRFC 6962台帳を保持する。

**Attestia**は、イベント、トランザクション、または状態遷移が発生したことを証明し、その証明をチェーンにバインドする。そのドメインは、金融の真実である：個人用ボルト、組織の財務、およびレジストラム。そのMerkle証明は、この台帳ではない。

**Cognate**は、AttestiaのイベントストアおよびMerkle証明におけるAIガバナンスドメインである。リリースを確認する必要がある場合に、RepoMeshを呼び出す。2番目のイベントストアは保持せず、このネットワークにはAttestiaのMerkleツリーを使用しない。

## これは何ですか？

RepoMeshは、リポジトリの集合を協調的なネットワークに変える。各リポジトリは、次のものを持つ**ノード**である：

- 自身が提供および消費するものを宣言する**マニフェスト**（`node.json`）
- 追記専用の台帳にブロードキャストされる**署名されたイベント**
- すべてのノードと機能をインデックス化する**レジストリ**
- 信頼に対する「完了」の意味を定義する**プロファイル**

現在、GitHub組織の1つであるmcp-tool-shop-orgが、ログ、アテスター、ポリシーチェック、およびXRPLアンカーを運用している。6つの登録されたノードは、6つのオペレーターを意味するわけではない。独立した証人は、この組織が運用していない当事者である。

ネットワークは、次の3つの不変性を強制する：

1. **決定的な出力** — 同じ入力、同じ成果物
2. **検証可能な出所** — すべてのリリースは署名され、アテステーションされる
3. **組み合わせ可能な契約** — インターフェースはバージョン管理され、機械可読である

## クイックスタート（1つのコマンド + 2つのシークレット）

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

これは、必要なものをすべて生成する：
- `node.json` — ノードマニフェスト
- `repomesh.profile.json` — 選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml` — リリースブロードキャストワークフロー
- Ed25519署名キーペア（秘密鍵はローカルに保持）

次に、リポジトリに2つのシークレットを追加する：
1. `REPOMESH_SIGNING_KEY` — 秘密鍵PEM（initによって出力される）
2. `REPOMESH_LEDGER_TOKEN` — このリポジトリの`contents:write` + `pull-requests:write`を持つGitHub PAT

リリースを実行する。信頼は自動的に収束する。

### CLIフラグ

すべてのコマンドは、`--quiet`、`--verbose`、`--debug`、`--no-color`を受け入れる。`init`コマンドは、機械可読の出力のために、`--json`もサポートする。

シェル補完が利用可能である：

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 環境オーバーライド

| 変数 | 目的 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 台帳エンドポイントをオーバーライドする |
| `REPOMESH_MANIFESTS_URL` | マニフェストエンドポイントをオーバーライドする |
| `REPOMESH_FETCH_TIMEOUT` | ミリ秒単位のフェッチタイムアウト |

### プロファイル

| プロファイル | 証拠 | 保証チェック | 使用するタイミング |
|---------|----------|-----------------|----------|
| `baseline` | オプション | 必須ではない | 内部ツール、実験 |
| `open-source` | SBOM + 出所 | ライセンス監査 + セキュリティスキャン | OSSのデフォルト |
| `regulated` | SBOM + 出所 | ライセンス + セキュリティ + 再現可能性 | コンプライアンスが重要な場合 |

### 信頼を確認する

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、保証スコア、プロファイルに対応した推奨事項を表示する。

### オーバーライド

ベリファイアをフォークすることなく、リポジトリごとのカスタマイズ：

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

## 手動での参加（5分）

### 1. ノードマニフェストを作成する

`node.json`をリポジトリのルートに追加する：

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen`は、公開キーと、`node.json`のメンテナーエントリにドロップできる`keyId`を出力し、
秘密鍵（モード0600）を、`--out`が指す場所にのみ書き込む。決して追跡されたパスに書き込まない。GitHubリポジトリのシークレット（`REPOMESH_SIGNING_KEY`）として保存する。（手動で同等の操作：`openssl genpkey -algorithm ED25519 ...`。）

> **信頼が重要なノードには、≥2つのキーを登録する**（TUF §6.1）：単一のキーは、侵害された場合に自身のリボケーションに署名できない。`repomesh init --second-key`は、別の2番目のメンテナーを登録し、1つのキーがもう一方のキーを無効にできるようにする。`init`は、ノードにアクティブなキーが1つしかない場合に警告する。

### 3. ネットワークに登録する

このリポジトリにノードマニフェストを追加するPRを開く：

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加する

`templates/repomesh-broadcast.yml`をリポジトリの`.github/workflows/`にコピーする。
`REPOMESH_LEDGER_TOKEN`シークレットを設定する（このリポジトリのcontents:write + pull-requests:writeを持つ、きめ細かいPAT）。

すべてのリリースは、署名された`ReleasePublished`イベントを台帳に自動的にブロードキャストする。

## 台帳ルール

- **追記専用** — 既存の行は不変
- **スキーマ検証** — すべてのイベントは`schemas/event.schema.json`に対して検証される
- **署名検証** — すべてのイベントは、登録されたノードメンテナーによって署名される
- **一意性** — 重複する`(repo, version, type)`エントリは許可されない
- **タイムスタンプの妥当性** — 現在時刻から1時間以上未来、または1年以上過去であってはならない

## イベントタイプ

台帳は現在、以下に示す**ライブ**イベントタイプを発行する。残りは**予約済み/計画中**であり、スキーマはそれらを受け入れるが、まだどのノードもそれらを発行していない。ロードマップが明確になるようにリストアップするが、存在しないカバレッジを暗示するものではない（信頼製品に対する率直さ）。

**ライブ（本日発行）：**

| タイプ | 発生するタイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされたとき |
| `AttestationPublished` | アテスターがリリースを検証したとき |
| `ledger.anchor` | アンカーノードがパーティションをシールしたとき（Merkleルート + XRPLメモ） |
| `attestation.dispute` | 信頼できるノードがアテステーションに異議を唱えたとき（検証結果をダウングレード） |
| `KeyRotation` | メンテナーキーが後継者にローテーションされたとき（将来的なもの — 過去の署名は有効なまま） |
| `KeyRevocation` | メンテナーキーが無効化されたとき（侵害 = 事後的な無効性、RFC 5280） |

**予約済み/計画中（まだ発行されていない）：**

| タイプ | 意図された意味 |
|------|------------------|
| `BreakingChangeDetected` | 破壊的な変更が導入された |
| `HealthCheckFailed` | ノードが自身の健全性チェックに失敗する |
| `DependencyVulnFound` | 依存関係に脆弱性が発見される |
| `InterfaceUpdated` | インターフェーススキーマが変更される |
| `PolicyViolation` | ネットワークポリシーに違反する |

## キーのローテーションと失効

メンテナーキーにはライフサイクルがあります。キーは後継キーに**ローテーション**されるか、**失効**させることができ、検証は**時間依存**です。つまり、署名が信頼されるのは、署名が行われた時点でキーが有効であった場合のみです。これは、XRPLアンカーのクローズ時間であり、すでにレジャーで使用されている信頼できるクロックと同じです。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **定期的なローテーション**は*将来指向*です。つまり、廃止されたキーの過去の署名は有効なままです。単に、新しいリリースの署名を行わなくなるだけです。
- **侵害**は*遡及的*です（RFC 5280 §5.3.2）。証明可能なアンカー時間が無効化日以降であるすべての署名は拒否され、それよりも前に署名されたことが証明できない署名も拒否されます。
- **ライフサイクルフィールドを持たない**キーは、既存のノードで検証されるため、常に有効とみなされます。
- 失効は、`KeyRevocation`イベントとして署名されます。唯一のキーが侵害された単一キーノードは、**ガバナンス**（`trustedPolicy`）ノードが失効に署名することで復旧されます。信頼性が重要なノードは、**≥2つのキー**（TUF §6.1）を登録する必要があります。
- 変更された`node.json`に対しても、失効は署名され、XRPLにアンカーされたイベントから再適用されます。改ざんされたマニフェストは、失効されたキーを復活させることはできません。境界については、[脅威モデル](docs/threat-model.md)を参照してください（正準レジャーに対して検証し、失効に敏感なチェックには`--anchored`を使用します）。

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化する |
| `attestor` | クレームを検証する（ビルド、コンプライアンス） |
| `policy` | ルールを適用する（スコアリング、ゲーティング） |
| `oracle` | 外部データを提供する |
| `compute` | 作業を行う（変換、ビルド） |
| `settlement` | 状態を確定する |
| `governance` | 意思決定を行う |
| `identity` | 認証情報を発行/検証する |

## ネットワークを拡張する — ベリファイアプラグインコントラクト

新しい**チェックの種類**と**ベリファイアノード**は、コードではなく、データの編集によって追加されます。チェックの種類レジストリ、スコアリングの重み、ノードの種類権限は、[`verifier.policy.json`](verifier.policy.json)（スキーマ検証済み、フェイルクローズ）に保存されます。チェックを追加する（例：`sast.scan`）には、約6行のポリシー編集と`node.json`が必要であり、PRでレビューされます。コードの変更は必要ありません。

唯一の不変性：**登録 ≠ 信頼**。登録により、チェックが参加できるようになりますが、信頼できるセットのコンセンサスパスによってのみ、信頼性が保証されます。完全なガイド：[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)。

## パブリック検証

誰でも1つのコマンドでリリースを検証できます。**クローンは不要**です。CLIは、パブリックレジャーを自動的に取得します。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

このチェックでは、次のことを確認します。
1. `ReleasePublished`イベントが存在し、**そのリポジトリ自身の**`node.json`に登録されたキーによって署名されている（Ed25519）。別のリポジトリに登録されたキーでは、検証できません。
2. リポジトリの信頼プロファイルが満たされている。プロファイルで必要なすべての証明（SBOM、プロベナンス、ライセンス、セキュリティ）が存在し、信頼できるアテスターによって署名されており、最新の結果が`pass`であり、少なくとも1つの**独立した**アテスターが存在する。自己署名のみで独立したアテステーションがないリリースは、`UNVERIFIED`を報告し、決して`PASS`を報告することはありません。
3. `--anchored`を使用する場合：パーティションのMerkleルートを再計算し、マニフェストと照合し、ネットワークに到達可能な場合は、オンチェーンのXRPLトランザクションを取得してアサートします（`validated` + `tesSUCCESS`、署名アカウントは信頼できるアンカーの許可リストにあり、オンチェーンのメモはローカルのルート/マニフェストハッシュ/カウントにバインドされます）。オフラインの場合、偽のトランザクションではなく、`XRPL NOT verified`を報告します。厳密な`--anchored`では失敗します（ローカルで検証されたマニフェストをオンチェーンの証明なしで受け入れるには、`--anchored-or-local`を使用します）。

CIゲートの場合、`--format <text|json|sarif|markdown>`（`--json`は`--format json`のエイリアスです）を含む出力形式を選択します。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**終了コード**は、3つの状態のいずれかの結果から導き出されるため、CIステップで直接ゲート処理できます。

| 終了 | 結果 | 意味 |
|------|---------|---------|
| `0` | PASS | 認証済みかつ信頼できる（または、`--fail-on=fail`によって緩和された場合、UNVERIFIED）。 |
| `1` | FAIL | 重大なエラー — 偽造/間違ったリポジトリの署名、許可リストにないアテスター、または必要なチェックが失敗。 |
| `3` | UNVERIFIED | 軽微なエラー — まだアンカーされていない、独立した証拠がない、または必要なチェックが不足している。 |
| `2` | — | 使用方法のエラーまたは内部クラッシュ。 |

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

毎日のワークフローでは、このイメージをチェックアウトからビルドし、それとともに投稿します。`anchor/xrpl/config.json`のネットワークは、まだテストネットです。メインネットへの投稿は、最初にCLIリリースで出荷される許可リストに追加されたクラシックアドレスを持つ、資金調達されたアカウントを待機します。その許可リストは上限です。取得した構成は、アカウントを削除できますが、追加することはできません。

`--fail-on <fail\|unverified>`は厳密さを設定します。デフォルトの`unverified`は、FAILとUNVERIFIEDの両方で失敗します。`--fail-on=fail`は、UNVERIFIEDを警告モードでの導入でパスさせます（終了コード0）。

`verify-all`を使用して、1つのレジャーロードで一括処理を検証し、`--local`を使用して、ローカルクローンに対してオフラインで検証します。

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

### ライブラリとして使用する

検証エンジンは、安定したプログラムAPIとしてエクスポートされます。CLIにシェルコマンドを実行する代わりに、独自のツールに組み込んでください。

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### ネットワークステータスエンドポイント

ダッシュボードは、外部ポーリング用に機械可読形式の[`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)を公開します。これには、台帳の最新性（フローズン台帳シグナル付き）、信頼性検証の件数、アンカーされたパーティションと保留中のパーティション、および理由付きの`ok`/`degraded`ロールアップが含まれます。

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
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### リリースの認証

> 認証と検証ツールの実行は、この台帳のクローンに対して実行される**オペレーター**のタスクであるため、チェックアウトから実行されます。リリースの検証は行いません。上記の`npx`コマンドを使用してください。

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

セキュリティ検証の閾値（最大CVE数、許可される重大度）は、`verifiers/security/config.json`を介して構成によって制御されます。

### ポリシーチェックの実行

```bash
node policy/scripts/check-policy.mjs
```

チェック：セマンティックバージョニングの単調性、アーティファクトハッシュの一意性、必要な機能。

## セキュリティと脅威モデル

RepoMeshは、**台帳イベント**（署名されたJSON）、**ノードマニフェスト**（公開鍵+機能）、**レジストリインデックス**（自動生成された信頼スコア）、および**XRPLテストネット**（アンカー取引）にアクセスします。**メンバーリポジトリのソースコード、秘密鍵、ユーザー認証情報、または閲覧データにはアクセスしません**。秘密の署名鍵は、CIランナーから決して送信されません。ネットワークアクセスは、GitHub API（PRの作成）、XRPLテストネット（アンカー）、およびOSV.dev（脆弱性の検索）に限定されます。**テレメトリは収集または送信されません**。分析、クラッシュレポート、または電話ホーム機能は一切ありません。完全な範囲、必要な権限、および脆弱性報告プロセスについては、[SECURITY.md](SECURITY.md)を参照してください。また、鍵ライフサイクルの信頼境界（なぜ`node.json`の信頼性はそのソースに依存し、なぜ取り消しに敏感な検証には`--anchored`を使用する必要があるのか）については、[脅威モデル](docs/threat-model.md)を参照してください。

セキュリティ強化：

- 変数データを補間する子プロセス呼び出しでは、配列引数とともに`execFileSync`を使用します。残りの`execSync`呼び出しでは、静的で定数であるコマンド文字列を使用します。シェルインジェクションの脆弱性はありません。
- 台帳とレジストリのJSONは、構造化された、行番号付きのエラーとともに`try`/`catch`内で解析されます。不正な形式の行はスキップされ、表面化されますが、生のスタックでツールがクラッシュすることはありません。
- すべてのファイル操作で、パス走査を防止します（解決+境界チェック）。
- どこでもReDoSに安全な解析を使用します（無制限の正規表現はありません）。
- PEM形式の秘密鍵は、`.gitignore`を使用して除外され、stdoutまたはCIログに出力されることはなく、所有者のみがアクセスできる（`0600`）権限で書き込まれます。

## テスト

完全な`node --test`スイートは、Ed25519署名、スキーマ検証、Merkleツリーの整合性（v1 + RFC-6962 v2）、追加専用の不変性、パス走査の防止、アンカー検証、信頼できる認証者の許可リスト、およびCLI、台帳、アンカー、検証ツール、およびツールレイヤー全体の入力検証をカバーします。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

スイートが追加されるにつれて、テスト数は増加します。現在の合計については、上記のコマンドを実行してください。数値に依存しないでください。数値は古くなる可能性があります。

## ライセンス

MIT

---

MCP Tool Shopによって作成されました。
