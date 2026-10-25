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

リリース台帳と、リポジトリネットワーク用のXRPLにアンカーされた信頼クロック：署名されたイベント、ノードマニフェスト、および検証。Attestiaのイベントストアとは別にします。

## システム内の配置場所

Attestia、Cognate、およびRepoMeshは、3つの製品です。

**RepoMesh**は、リリースネットワークです：署名されたイベント、ノードマニフェスト、およびXRPLにアンカーされた信頼クロック。独自のRFC 6962台帳を保持します。

**Attestia**は、イベント、トランザクション、または状態遷移が発生したことを証明し、その証明をチェーンにバインドします。提供するドメインは、金融の真実です：個人用保管庫、組織の財務、およびレジストラム。そのMerkle証明は、この台帳ではありません。

**Cognate**は、AttestiaのイベントストアとMerkle証明に基づくAIガバナンスドメインです。リリースチェックが必要な場合に、RepoMeshを呼び出します。2番目のイベントストアは保持せず、このネットワークにはAttestiaのMerkleツリーを使用しません。

## 2.4および2.5の新機能

**バージョン2.5.0**

- **2.5.0：アンカー投稿が失敗した場合に閉じる。** `post-anchor.mjs`は投稿を拒否し、接続を開きません。ただし、configで`testnet`と指定され、WebSocket URLが既知のテストネットエンドポイントである場合に限ります。環境変数だけでは、メインネットへの投稿を切り替えることはできません。[XRPLアンカリング（テストネットガード）](#xrplアンカリングテストネットガード)を参照してください。
- **2.5.0：必須のテストゲート。** すべてのプルリクエストで、9つの`node --test`スイートすべてが、最小限の行カバレッジと、`high`での本番環境の`npm audit`で実行されます。`validate-ledger`と`test`は、`main`に対する必須のチェックであり、`registry-ci.yml`は、`main`で`ledger-ci`が成功した場合にのみ実行されます。
- **2.4.0：Cognateからのアテステーションを実行。** 台帳は、3つの新しいアテステーションタイプ、`run.preregistered`、`run.outcome`、および`cognate.root.anchored`を受け入れます。それぞれに、`sha256`ダイジェストと`urn:cognate:...` URIが付属します。両方の`trustedAttestors`と`trustedRunAttestors`（現在、`mcp-tool-shop-org/cognate`）の`governance`ノードのみが署名でき、それ以外の署名はできません。すべての`run.outcome`は、すでに台帳にある`run.preregistered`イベントを参照する必要があります。
- **2.4.0：署名契約がチェックされます。** Ed25519署名は、`canonicalHash`の32バイトの生のバイトに対して行われる必要があります。検証プログラムは、カノニカルJSONテキストまたは64文字の16進文字列に対して行われた署名を拒否します。

完全なリストについては、[CHANGELOG.md](CHANGELOG.md)を参照してください。

## これは何ですか？

RepoMeshは、リポジトリのコレクションを協調的なネットワークに変えます。各リポジトリは、次の機能を持つ**ノード**です。

- `node.json`（**ノードマニフェスト**）で、提供および消費するものを宣言します。
- **署名されたイベント**を、追加専用の台帳にブロードキャストします。
- すべてのノードと機能をインデックス化する**レジストリ**。
- 信頼の「完了」の意味を定義する**プロファイル**。

現在、1つのGitHub組織（mcp-tool-shop-org）が、ログ、アテステーター、ポリシーチェック、およびXRPLアンカーを運用しています。7つの登録されたノードは、7つのオペレーターを意味するわけではありません。独立した証人とは、この組織が運用していない当事者のことです。

ネットワークは、次の3つの不変性を強制します。

1. **決定的な出力** — 同じ入力、同じ成果物
2. **検証可能な出所** — すべてのリリースは署名され、アテステーションされます。
3. **組み合わせ可能な契約** — インターフェイスはバージョン管理され、機械可読です。

## クイックスタート（1つのコマンド+ 2つのシークレット）

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

これは、必要なものをすべて生成します。
- `node.json` — ノードマニフェスト
- `repomesh.profile.json` — 選択したプロファイル
- `.github/workflows/repomesh-broadcast.yml` — リリースブロードキャストワークフロー
- Ed25519 署名キーペア（プライベートキーはローカルに保持されます）

Then add two secrets to your repo:
1. `REPOMESH_SIGNING_KEY` — your private key PEM (printed by init)
2. `REPOMESH_LEDGER_TOKEN` — GitHub PAT with `contents:write` + `pull-requests:write` on this repo

リリースを実行します。信頼は自動的に収束します。

### CLIフラグ

すべてのコマンドは、`--quiet`、`--verbose`、`--debug`、`--no-color`を受け入れます。`init`コマンドは、機械可読の出力のために、`--json`もサポートします。

シェル補完が利用可能です。

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### 環境オーバーライド

| 変数 | 目的 |
|----------|---------|
| `REPOMESH_LEDGER_URL` | 台帳エンドポイントをオーバーライドします。 |
| `REPOMESH_MANIFESTS_URL` | マニフェストエンドポイントをオーバーライドします。 |
| `REPOMESH_FETCH_TIMEOUT` | フェッチタイムアウト（ミリ秒単位）。 |

### プロファイル

| プロファイル | 証拠 | 保証チェック | 使用するタイミング |
|---------|----------|-----------------|----------|
| `baseline` | オプション | 必須ではありません。 | 内部ツール、実験 |
| `open-source` | SBOM + 出所 | ライセンス監査 + セキュリティスキャン | OSSのデフォルト |
| `regulated` | SBOM + 出所 | ライセンス + セキュリティ + 再現可能性 | コンプライアンスが重要な場合 |

### 信頼をチェックします

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

整合性スコア、保証スコア、プロファイルに対応した推奨事項を表示します。

### オーバーライド

検証プログラムをフォークせずに、リポジトリごとのカスタマイズを行います。

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
    { "name": "your-name", "contact": "https://github.com/your-org", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. 署名キーペアを生成します

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen`は、公開キーと、リポジトリの`node.json`のメンテナーエントリに配置できる`keyId`を出力し、プライベートキー（モード0600）を、`--out`で指定した場所にのみ書き込みます。追跡パスには書き込まれません。これを、GitHubリポジトリシークレット（`REPOMESH_SIGNING_KEY`）として保存します。（手動で実行する場合：`openssl genpkey -algorithm ED25519 ...`。）

> **信頼が重要なノードの場合は、≥2つのキーを登録してください**（TUF §6.1）：単一のキーは、侵害された場合に、自身を失効することはできません。`repomesh init --second-key`は、別の2番目のメンテナーを登録し、1つのキーで別のキーを失効できるようにします。`init`は、ノードにアクティブなキーが1つしかない場合に警告します。

### 3. ネットワークに登録します

このリポジトリに、ノードマニフェストを追加するPRを開きます。

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. ブロードキャストワークフローを追加します

`templates/repomesh-broadcast.yml`をリポジトリの`.github/workflows/`にコピーします。
`REPOMESH_LEDGER_TOKEN`シークレットを設定します（このリポジトリのcontents:write + pull-requests:write権限を持つ、きめ細かいPAT）。

すべてのリリースは、署名された`ReleasePublished`イベントを台帳に自動的にブロードキャストします。

## 台帳ルール

- **追加専用** — 既存の行は変更不可
- **スキーマ検証済み** — すべてのイベントは`schemas/event.schema.json`に対して検証されます
- **署名検証済み** — すべてのイベントは登録されたノードの管理者によって署名されています
- **一意** — 重複する`(repo, version, type)`エントリは存在しません
- **タイムスタンプの整合性** — 未来で1時間以内、または過去で1年以内のタイムスタンプではありません

## イベントタイプ

現在、この台帳は以下の**アクティブ**なイベントタイプを発行しています。残りのイベントは**予約済み/計画中**であり、
スキーマはそれらを受け入れますが、現時点ではどのノードもそれらを発行していません。ロードマップが明確になるようにリストアップしていますが、存在しない機能を暗示するものではありません（信頼できる製品に対する率直な姿勢）。

**アクティブ（本日発行）：**

| タイプ | 発生するタイミング |
|------|------|
| `ReleasePublished` | 新しいバージョンがリリースされたとき |
| `AttestationPublished` | アテスターがリリースを検証したとき |
| `ledger.anchor` | アンカーノードがパーティションをシールしたとき（Merkleルート + XRPLメモ） |
| `attestation.dispute` | 信頼できるノードがアテステーションに異議を申し立てたとき（検証結果をダウングレード） |
| `KeyRotation` | メンテナンスキーが後継者にローテーションされたとき（将来的なもの — 過去の署名は有効のまま） |
| `KeyRevocation` | メンテナンスキーが無効化されたとき（侵害 = 事後的な無効化、RFC 5280） |

`AttestationPublished`には、Cognateの実行アテステーション（`run.preregistered`、`run.outcome`、
`cognate.root.anchored`、バージョン2.4.0以降）も含まれており、これはその`governance`ノードによってのみ署名されます。

**予約済み/計画中（まだ発行されていない）：**

| タイプ | 意図された意味 |
|------|------------------|
| `BreakingChangeDetected` | 破壊的な変更が導入されたとき |
| `HealthCheckFailed` | ノードが自身の健全性チェックに失敗したとき |
| `DependencyVulnFound` | 依存関係に脆弱性が発見されたとき |
| `InterfaceUpdated` | インターフェーススキーマが変更されたとき |
| `PolicyViolation` | ネットワークポリシーに違反したとき。`policy/scripts/check-policy.mjs`はビルドして署名できますが、現時点では台帳には存在しません。 |

## キーのローテーションと無効化

メンテナンスキーにはライフサイクルがあります。キーは後継者に**ローテーション**されるか、**無効化**される可能性があり、
検証は**時間依存**です。署名は、署名されたキーが署名時の信頼できる時間（XRPLアンカーのクローズ時間、台帳がすでに使用している信頼できるクロック）に有効であった場合にのみ信頼されます。

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **定期的なローテーション**は*将来的なもの*です。廃止されたキーの過去の署名は有効のままです。単に新しいリリースの署名を行わなくなるだけです。
- **侵害**は*事後的なもの*です（RFC 5280 §5.3.2）。証明可能なアンカー時間が無効化日以降であるすべての署名は拒否され、それよりも前に署名されたことが証明できない署名も拒否されます。
- **ライフサイクルフィールドを持たない**キーは、過去の資産として扱われ（常に有効）、既存のノードは変更されていないものを検証します。
- 無効化は署名された`KeyRevocation`イベントです。唯一のキーが侵害された単一キーノードは、**ガバナンス**（`trustedPolicy`）ノードがその無効化に署名することで復旧されます。信頼性が重要なノードは、**≥2つのキー**を登録する必要があります（TUF §6.1）。
- 変更された`node.json`に対しても、無効化は署名された、XRPLにアンカーされたイベントから再適用されます。改ざんされたマニフェストは、無効化されたキーを復活させることはできません。[脅威モデル](docs/threat-model.md)を参照して、境界を確認してください（正準台帳に対して検証し、無効化に敏感なチェックには`--anchored`を使用します）。

## ノードの種類

| 種類 | 役割 |
|------|------|
| `registry` | ノードと機能をインデックス化します |
| `attestor` | クレームを検証します（ビルド、コンプライアンス） |
| `policy` | ルールを適用します（スコアリング、ゲート） |
| `oracle` | 外部データを提供します |
| `compute` | 作業を実行します（変換、ビルド） |
| `settlement` | 状態を確定します |
| `governance` | 意思決定を行います。バージョン2.4.0以降、Cognateの実行アテステーションに署名し、それ以外のことは行いません。 |
| `identity` | 資格情報の発行/検証 |

## ネットワークの拡張 — verifier-pluginコントラクト

新しい**チェックの種類**と**検証ノード**は、コードではなくデータ編集によって追加されます。チェック種類のレジストリ、スコアリングの重み、ノード種類の権限は、[`verifier.policy.json`](verifier.policy.json)（スキーマ検証済み、フェイルクローズ）に保存されます。チェックを追加する（例：
`sast.scan`）には、約6行のポリシー編集と`node.json`が必要であり、PRでレビューされます。コードの変更は必要ありません。

唯一の不変性：**登録済み ≠ 信頼済み**。登録により、チェックが参加できるようになります。ただし、信頼できるセットのコンセンサスパスによってのみ、信頼性が得られます。完全なガイド：
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)。

## パブリック検証

誰でも1つのコマンドでリリースを検証できます。**クローンは必要ありません**。CLIは代わりに、パブリック台帳を自動的に取得します。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

これは以下のことを確認します。
1. `ReleasePublished`イベントが存在し、署名されていること（Ed25519）。署名者は、**そのリポジトリ自体に**登録された`node.json`キーである必要があります。別のリポジトリに登録されたキーでは、検証できません。
2. リポジトリの信頼プロファイルが満たされていること。プロファイルで必要なすべてのアテステーション（SBOM、プロベナンス、ライセンス、セキュリティ）が存在し、信頼できるアテスターによって署名され、最新の結果が`pass`であり、少なくとも1つの**独立した**アテスターが存在すること。自己署名のみで独立したアテステーションがないリリースは、`UNVERIFIED`を報告し、決して`PASS`を報告することはありません。
3. `--anchored`を使用する場合：パーティションのMerkleルートを再計算し、マニフェストと照合し、ネットワークに到達可能な場合は、オンチェーンのXRPLトランザクションを取得してアサートします（`validated` + `tesSUCCESS`、署名アカウントは信頼できるアンカーの許可リストにあり、オンチェーンのメモはローカルのルート/マニフェストハッシュ/カウントにバインドされます）。オフラインの場合、代わりに`XRPL NOT verified`を報告します。偽のトランザクションではなく。厳密な`--anchored`は失敗します（ローカルで検証されたマニフェストをオンチェーンの証拠なしで受け入れるには、`--anchored-or-local`を使用します）。

CIゲートの場合、`--format <text|json|sarif|markdown>`を含む出力形式を選択します（`--json`は`--format json`のエイリアスです）。

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**終了コード**は、3つの状態の検証結果から導き出されるため、CIステップで直接ゲート処理できます。

| 終了 | 検証結果 | 意味 |
|------|---------|---------|
| `0` | PASS | 信頼でき、保証されています（または、`--fail-on=fail`によって緩和された場合、UNVERIFIED）。 |
| `1` | FAIL | ハードエラー — 偽造された/間違ったリポジトリの署名、許可リストにないアテスター、または必要なチェックが失敗しました。 |
| `3` | UNVERIFIED | ソフト — まだアンカーされていない、独立した証拠がない、または必要なチェックがありません。 |
| `2` | — | 使用方法のエラーまたは内部クラッシュ。 |

### コンテナ

同じCLIが`ghcr.io/mcp-tool-shop-org/repomesh`として公開され、npmバージョンとgit SHAでタグ付けされています。イメージは非rootユーザーとして実行されます。ウォレットシードは含まれていません。

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

アンカーの投稿は別のコマンドです。実行時に`XRPL_SEED`が渡されます。

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

毎日のワークフローでは、このイメージをチェックアウトからビルドし、それを使って投稿します。

### XRPLアンカリング（テストネットガード）

`anchor/xrpl/config.json`でのアンカリングは**テストネットのみ**（`"network": "testnet"`）です。`anchor/xrpl/scripts/post-anchor.mjs`は、`XRPL_SEED`を検証または`xrpl.Client`を構築する前に、フェイルクローズエンドポイントガード（`assertPostingEndpoint`）を強制します。

- **デフォルトのテストネットチェック:** `config.network === "testnet"`**かつ**解決されたWebSocket URL（`process.env.XRPL_WS_URL || config.rippledUrl`）が`KNOWN_TESTNET_WS_URLS`（`wss://s.altnet.rippletest.net:51233`、`wss://clio.altnet.rippletest.net:51233`、`wss://testnet.xrpl-labs.com`）にある場合を除き、投稿は拒否されます（ゼロ以外の終了コード、ソケットは開かれず）。`XRPL_WS_URL`をメインネットまたは不明なURLに設定すると、解決されたネットワークと解決されたURLの両方を明示するメッセージとともに、すぐに拒否されます。
- **メインネットのオプトイン（無効）：** 環境変数だけでは、投稿をメインネットに切り替えることはできません。メインネットへのオプトインには、`anchor/xrpl/config.json`で`"network": "mainnet"`、`"allowMainnetPosting": true`、および`"mainnetAllowedEndpoints": ["wss://..."]`を設定するレビュー済みのコミットが必要です。これらには、ターゲットの`wss://`エンドポイントが含まれます。さらに、資金提供されたメインネットの従来の住所を、出荷される許可リストの上限（`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`）に追加する必要があります。この許可リストは上限です。フェッチされた構成はアカウントを削除できますが、追加することはできません。

`--fail-on <fail\|unverified>`は厳密さを設定します。デフォルトの`unverified`は、FAILとUNVERIFIEDの両方で失敗します。`--fail-on=fail`は、警告モードでの導入のために、UNVERIFIEDを通過させます（終了コード0、警告付き）。

`verify-all`を使用して、1つのレジャーロードで一括処理全体を検証し、ローカルクローンに対してオフラインで検証します（`--local`）。

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

バンドルされた複合アクションを使用して、**CIでゲート**します。詳細については、[Using the GitHub Action](docs/verification.md#using-the-github-action)を参照してください。

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

完全な検証ガイド、脅威モデル、および主要な概念については、[docs/verification.md](docs/verification.md)を参照してください。

### ライブラリとして使用

検証エンジンは、安定したプログラムAPIとしてエクスポートされます。CLIにシェルコマンドを実行するのではなく、独自のツールに組み込んでください。

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### ネットワークステータスエンドポイント

ダッシュボードは、外部ポーリング用の機械可読形式の[`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)を公開します。これには、レジャーの鮮度（フローズンレジャーシグナル）、信頼の検証数、アンカーされたパーティションと保留中のパーティション、および`ok`/`degraded`ロールアップ（理由付き）が含まれます。

### 信頼バッジ

リポジトリは、レジストリからの信頼バッジを埋め込むことができます。

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

### リリースをアテスト

> アテストと検証ツールの実行は、このレジャーのクローンに対して動作する**オペレーター**のタスクであるため、チェックアウトから実行されます。リリースの検証は行いません。上記の`npx`コマンドを使用してください。

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

チェック：`sbom.present`、`provenance.present`、`signature.chain`

### 検証ツールを実行

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

セキュリティ検証のしきい値（最大CVE数、許可される重大度）は、`verifiers/security/config.json`を介して構成によって制御されます。

### ポリシーチェックを実行

```bash
node policy/scripts/check-policy.mjs
```

チェック：semverの単調性、アーティファクトハッシュの一意性、必要な機能。

## セキュリティと脅威モデル

RepoMeshは、**レジャーイベント**（署名されたJSON）、**ノードマニフェスト**（公開キー+機能）、**レジストリインデックス**（自動生成された信頼スコア）、および**XRPLテストネット**（アンカートランザクション。既知のテストネットでないエンドポイントへの投稿は拒否されます）にアクセスします。**メンバーリポジトリのソースコード、秘密鍵、ユーザー認証情報、または閲覧データにはアクセスしません。** 秘密の署名キーは、CIランナーから決して送信されません。ネットワークアクセスは、GitHub API（PRの作成）、XRPLテストネット（アンカリング）、およびOSV.dev（脆弱性の検索）に限定されます。**テレメトリは収集または送信されません**。分析、クラッシュレポート、または電話回線は一切ありません。完全な範囲、必要な権限、および脆弱性報告プロセスについては、[SECURITY.md](SECURITY.md)を参照してください。また、キーライフサイクルの信頼境界（なぜ`node.json`の信頼性はそのソースに依存し、なぜ改ざんに対する検証には`--anchored`を使用する必要があるのか）については、[脅威モデル](docs/threat-model.md)を参照してください。

強化：

- 変数データを補間する子プロセスの呼び出しでは、配列引数とともに`execFileSync`を使用します。残りの`execSync`の呼び出しでは、静的で定数であるコマンド文字列を使用します。シェルインジェクションの脆弱性はありません。
- レジャーとレジストリのJSONは、構造化された、行番号付きのエラーとともに`try`/`catch`内で解析されます。不正な形式の行はスキップされ、表面化されますが、生のスタックでツールがクラッシュすることはありません。
- すべてのファイル操作（解決+境界チェック）で、パスのトラバーサルを防ぎます。
- ReDoSに安全な解析を全体で使用します（無制限の正規表現はありません）。
- PEM形式の秘密鍵は、`.gitignore`を使用して除外され、stdoutまたはCIログに出力されることはなく、所有者のみのアクセス許可（`0600`）で書き込まれます。

## テスト

完全な`node --test`スイートは、Ed25519署名、スキーマ検証、Merkleツリーの整合性（v1 + RFC-6962 v2）、追加専用の不変性、パスのトラバーサルの防止、アンカー検証、信頼できるアテスターの許可リスト、およびCLI、レジャー、アンカー、検証ツール、およびツールレイヤー全体の入力検証をカバーします。

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

テストの数は、スイートが追加されるにつれて増加します。現在の合計については、上記のコマンドを実行してください。数値に依存しないでください。数値は古くなる可能性があります。

CIは、すべてのプルリクエストで同じ9つのスイート（`ledger-ci.yml`、必要な`test`チェック）を実行し、次に`--experimental-test-coverage`と行カバレッジの下限（`--test-coverage-lines=57`）、次にルートの`npm audit --audit-level=high --omit=dev`、および`anchor/xrpl`と`ledger`を実行します。

## ライセンス

MIT

---

MCP Tool Shopによって作成されました。<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
