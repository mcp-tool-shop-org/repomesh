<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.md">English</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

सिंट्रोपिक रिपो नेटवर्क - केवल-जोड़ने योग्य लेज़र, नोड मेनिफेस्ट और वितरित रिपो समन्वय के लिए स्कोरिंग।

## यह क्या है?

रिपोमेश रिपोस के संग्रह को एक सहकारी नेटवर्क में बदल देता है। प्रत्येक रिपो एक **नोड** है जिसमें:

- एक **मेनिफेस्ट** (`node.json`) जो यह घोषित करता है कि यह क्या प्रदान करता है और क्या उपयोग करता है
- **हस्ताक्षरित इवेंट** जो केवल-जोड़ने योग्य लेज़र पर प्रसारित होते हैं
- एक **रजिस्ट्री** जो सभी नोड्स और क्षमताओं को अनुक्रमित करता है
- एक **प्रोफ़ाइल** जो यह परिभाषित करता है कि विश्वास के लिए "पूर्ण" का क्या अर्थ है

आज, एक GitHub संगठन, mcp-tool-shop-org, लॉग, सत्यापनकर्ता, नीति जांच और XRPL एंकर का संचालन करता है। छह पंजीकृत नोड छह ऑपरेटर नहीं बनाते हैं। एक स्वतंत्र गवाह वह पार्टी होगी जिसका यह संगठन संचालन नहीं करता है।

नेटवर्क तीन अपरिवर्तनीयताओं को लागू करता है:

1. **निर्धारित आउटपुट** - समान इनपुट, समान कलाकृतियाँ
2. **सत्यापन योग्य उत्पत्ति** - प्रत्येक रिलीज़ पर हस्ताक्षर किए जाते हैं और सत्यापित किए जाते हैं
3. **संयोजनीय अनुबंध** - इंटरफेस संस्करणित और मशीन-पठनीय हैं

## त्वरित शुरुआत (1 कमांड + 2 गुप्त)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

यह वह सब कुछ उत्पन्न करता है जिसकी आपको आवश्यकता है:
- `node.json` - आपका नोड मेनिफेस्ट
- `repomesh.profile.json` - आपकी चुनी हुई प्रोफ़ाइल
- `.github/workflows/repomesh-broadcast.yml` - रिलीज़ प्रसारण वर्कफ़्लो
- Ed25519 हस्ताक्षर कुंजी जोड़ी (निजी कुंजी स्थानीय रहती है)

फिर अपने रिपो में दो गुप्त जोड़ें:
1. `REPOMESH_SIGNING_KEY` - आपकी निजी कुंजी PEM (init द्वारा मुद्रित)
2. `REPOMESH_LEDGER_TOKEN` - इस रिपो पर `contents:write` + `pull-requests:write` के साथ GitHub PAT

एक रिलीज़ करें। विश्वास स्वचालित रूप से अभिसरित होता है।

### CLI ध्वज

सभी कमांड स्वीकार करते हैं: `--quiet`, `--verbose`, `--debug`, `--no-color`। `init` कमांड मशीन-पठनीय आउटपुट के लिए `--json` का भी समर्थन करता है।

शेल पूर्णताएँ उपलब्ध हैं:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### पर्यावरण ओवरराइड

| चर | उद्देश्य |
|----------|---------|
| `REPOMESH_LEDGER_URL` | लेज़र एंडपॉइंट को ओवरराइड करें |
| `REPOMESH_MANIFESTS_URL` | मेनिफेस्ट एंडपॉइंट को ओवरराइड करें |
| `REPOMESH_FETCH_TIMEOUT` | एमएस में फ़ेच टाइमआउट |

### प्रोफ़ाइल

| प्रोफ़ाइल | सबूत | आश्वासन जांच | कब उपयोग करें |
|---------|----------|-----------------|----------|
| `baseline` | वैकल्पिक | कोई आवश्यक नहीं | आंतरिक उपकरण, प्रयोग |
| `open-source` | SBOM + उत्पत्ति | लाइसेंस ऑडिट + सुरक्षा स्कैन | OSS के लिए डिफ़ॉल्ट |
| `regulated` | SBOM + उत्पत्ति | लाइसेंस + सुरक्षा + पुनरुत्पादकता | अनुपालन-महत्वपूर्ण |

### ट्रस्ट की जांच करें

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

अखंडता स्कोर, आश्वासन स्कोर, प्रोफ़ाइल-जागरूक अनुशंसाएँ दिखाता है।

### ओवरराइड

सत्यापनकर्ताओं को फोर्क किए बिना प्रति-रिपो अनुकूलन:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## रिपो संरचना

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

## मैन्युअल रूप से जुड़ें (5 मिनट)

### 1. अपना नोड मेनिफेस्ट बनाएं

`node.json` को अपने रिपो रूट में जोड़ें:

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

### 2. एक हस्ताक्षर कुंजी जोड़ी उत्पन्न करें

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` सार्वजनिक कुंजी + एक `keyId` प्रिंट करता है जिसे आपके `node.json` रखरखाव प्रविष्टि में डाला जा सकता है, और
निजी कुंजी (मोड 0600) केवल उस स्थान पर लिखता है जहाँ आप `--out` इंगित करते हैं - कभी भी ट्रैक किए गए पथ पर नहीं। इसे GitHub रिपो गुप्त के रूप में संग्रहीत करें (`REPOMESH_SIGNING_KEY`)। (हाथ से समकक्ष: `openssl genpkey -algorithm ED25519 ...`।)

> **एक ट्रस्ट-महत्वपूर्ण नोड के लिए ≥2 कुंजियाँ पंजीकृत करें** (TUF §6.1): एक ही कुंजी समझौता किए जाने पर अपनी स्वयं की अमान्यता पर हस्ताक्षर नहीं कर सकती है। `repomesh init --second-key` एक अलग दूसरी रखरखावकर्ता को पंजीकृत करता है ताकि एक कुंजी दूसरी कुंजी को रद्द कर सके - `init` चेतावनी देता है जब किसी नोड में केवल एक सक्रिय कुंजी होती है।

### 3. नेटवर्क के साथ पंजीकरण करें

इस रिपो में अपना नोड मेनिफेस्ट जोड़कर एक PR खोलें:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. प्रसारण वर्कफ़्लो जोड़ें

`templates/repomesh-broadcast.yml` को अपने रिपो के `.github/workflows/` में कॉपी करें।
`REPOMESH_LEDGER_TOKEN` गुप्त सेट करें (एक बारीक-दानेदार PAT जिसमें सामग्री:write + pull-requests:write इस रिपो पर है)।

अब प्रत्येक रिलीज़ स्वचालित रूप से लेज़र पर एक हस्ताक्षरित `ReleasePublished` इवेंट प्रसारित करेगी।

## लेज़र नियम

- **केवल-जोड़ने योग्य** - मौजूदा पंक्तियाँ अपरिवर्तनीय हैं
- **स्कीमा-मान्य** - प्रत्येक इवेंट `schemas/event.schema.json` के विरुद्ध मान्य होता है
- **हस्ताक्षर-मान्य** - प्रत्येक इवेंट एक पंजीकृत नोड रखरखावकर्ता द्वारा हस्ताक्षरित होता है
- **अद्वितीय** - कोई डुप्लिकेट `(repo, version, type)` प्रविष्टियाँ नहीं
- **टाइमस्टैम्प-मान्य** - भविष्य में 1 घंटे से अधिक या अतीत में 1 वर्ष से अधिक नहीं

## इवेंट प्रकार

लेज़र वर्तमान में नीचे दिए गए **लाइव** इवेंट प्रकारों का उत्सर्जन करता है। शेष **आरक्षित / नियोजित** हैं - स्कीमा उन्हें स्वीकार करता है, लेकिन कोई भी नोड अभी तक उन्हें उत्सर्जित नहीं करता है। हम उन्हें सूचीबद्ध करते हैं ताकि रोडमैप दिखाई दे, बिना किसी ऐसे कवरेज का संकेत दिए जो मौजूद नहीं है (विश्वास उत्पाद के लिए फ्रंट-डोर ईमानदारी)।

**लाइव (आज उत्सर्जित):**

| प्रकार | कब |
|------|------|
| `ReleasePublished` | एक नया संस्करण जारी किया गया है |
| `AttestationPublished` | एक सत्यापनकर्ता एक रिलीज़ को सत्यापित करता है |
| `ledger.anchor` | एंकर नोड एक विभाजन को सील करता है (मर्केल रूट + XRPL ज्ञापन) |
| `attestation.dispute` | एक विश्वसनीय नोड एक सत्यापन पर विवाद करता है (निर्णय को कम करता है) |
| `KeyRotation` | एक रखरखावकर्ता कुंजी को एक उत्तराधिकारी में घुमाया जाता है (संभावित - पिछली हस्ताक्षर मान्य रहती हैं) |
| `KeyRevocation` | एक रखरखावकर्ता कुंजी को रद्द कर दिया जाता है (समझौता = पिछली अमान्यता, RFC 5280) |

**आरक्षित / नियोजित (अभी तक उत्सर्जित नहीं):**

| प्रकार | उद्देशित अर्थ |
|------|------------------|
| `BreakingChangeDetected` | एक ब्रेकिंग परिवर्तन पेश किया गया है |
| `HealthCheckFailed` | एक नोड अपने स्वयं के स्वास्थ्य जांच में विफल रहता है |
| `DependencyVulnFound` | निर्भरताओं में एक भेद्यता पाई जाती है |
| `InterfaceUpdated` | एक इंटरफ़ेस स्कीमा बदलता है |
| `PolicyViolation` | एक नेटवर्क नीति का उल्लंघन किया गया है |

## कुंजी रोटेशन और अमान्यता

रखरखावकर्ता कुंजियों का एक जीवनचक्र होता है। एक कुंजी को एक उत्तराधिकारी में **घुमाया** या **रद्द** किया जा सकता है, और
सत्यापन **समय-जागरूक** है: एक हस्ताक्षर पर तभी भरोसा किया जाता है जब कुंजी हस्ताक्षर के समय मान्य हो - XRPL एंकर क्लोज-टाइम, वही विश्वसनीय घड़ी जिसका उपयोग लेज़र पहले से ही करता है।

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **नियमित रोटेशन** *भविष्योन्मुखी* होता है — सेवानिवृत्त कुंजी के पिछले हस्ताक्षर मान्य रहते हैं; यह केवल नए संस्करणों पर हस्ताक्षर करना बंद कर देता है।
- **समझौता** *पिछली तारीख से लागू* होता है (RFC 5280 §5.3.2) — किसी भी हस्ताक्षर को, जिसका सिद्ध रूप से स्थापित समय अमान्य तिथि पर या उसके बाद का है, अस्वीकार कर दिया जाता है, और जिस हस्ताक्षर को इससे पहले का साबित नहीं किया जा सकता, उसे भी अस्वीकार कर दिया जाता है।
- जिस कुंजी में **कोई** जीवनचक्र क्षेत्र नहीं है, उसे पुराने प्रारूप में माना जाता है (हमेशा मान्य), इसलिए मौजूदा नोड अपरिवर्तित रूप में सत्यापित करते हैं।
- निरसन `KeyRevocation` घटनाओं पर हस्ताक्षर किए जाते हैं; एक एकल-कुंजी नोड जिसकी एकमात्र कुंजी से समझौता किया गया है, उसे एक **शासन** (`trustedPolicy`) नोड द्वारा निरसन पर हस्ताक्षर करके पुनर्प्राप्त किया जाता है। विश्वास-महत्वपूर्ण नोड्स को **≥2 कुंजियाँ** पंजीकृत करनी चाहिए (TUF §6.1)।
- छेड़छाड़ किए गए `node.json` के खिलाफ भी, एक निरसन पर हस्ताक्षरित, XRPL-आधारित घटनाओं से फिर से जोर दिया जाता है — एक संक्षिप्त घोषणापत्र निरसित कुंजी को पुनर्जीवित नहीं कर सकता। [खतरा मॉडल](docs/threat-model.md) देखें ताकि सीमा निर्धारित की जा सके (मानक लेज़र के विरुद्ध सत्यापित करें; निरसन-संवेदनशील जाँचों के लिए `--anchored` का उपयोग करें)।

## नोड के प्रकार

| दयालु | भूमिका |
|------|------|
| `registry` | नोड्स और क्षमताओं का अनुक्रमण करता है। |
| `attestor` | दावों की पुष्टि करता है (निर्माण, अनुपालन) |
| `policy` | नियमों का पालन करवाता है (अंक गणना, नियंत्रण)। |
| `oracle` | बाहरी डेटा प्रदान करता है। |
| `compute` | क्या यह काम करता है (परिवर्तित करता है, बनाता है)? |
| `settlement` | अंतिम रूप दिया गया। |
| `governance` | निर्णय लेता है। |
| `identity` | प्रमाण-पत्रों की जांच/सत्यापन करना। |

## नेटवर्क का विस्तार — सत्यापनकर्ता-प्लगइन अनुबंध।

नए **जाँच प्रकार** और **सत्यापन नोड** डेटा संपादित करके जोड़े जाते हैं, कोड नहीं। जाँच-प्रकार रजिस्ट्री, स्कोरिंग भार और नोड-प्रकार की अनुमतियाँ यहाँ मौजूद हैं:
[`verifier.policy.json`](verifier.policy.json) (स्कीमा-सत्यापित, विफल-बंद)। एक जाँच जोड़ना (जैसे `sast.scan`) लगभग 6 पंक्तियों वाली नीति संपादन + एक `node.json` है, जिसकी समीक्षा एक पीआर में की जाती है — इसमें कोई कोड परिवर्तन नहीं होता।

एक अपरिवर्तनीय तथ्य: **पंजीकृत = विश्वसनीय नहीं।** पंजीकरण किसी जाँच को भाग लेने की अनुमति देता है; लेकिन क्रेडिट के लिए अभी भी एक विश्वसनीय समूह की सहमति की आवश्यकता होती है। विस्तृत जानकारी:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)।

## सार्वजनिक सत्यापन

कोई भी व्यक्ति एक कमांड के माध्यम से किसी रिलीज़ की पुष्टि कर सकता है – **क्लोन करने की आवश्यकता नहीं है**, सीएलआई आपके लिए सार्वजनिक लेज़र प्राप्त करता है:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

This checks:
1. The `ReleasePublished` event exists and is signed (Ed25519) by a key registered to **that repo's own** `node.json` — a key registered to a different repo cannot validate it.
2. The repo's trust profile is satisfied: every profile-required attestation (SBOM, provenance, license, security) is present, signed by a trusted attestor, and its latest result is `pass`, with at least one **independent** attestor. A release with only a self-signature and no independent attestations reports `UNVERIFIED`, never `PASS`.
3. With `--anchored`: the partition's Merkle root is recomputed and matched to the manifest, and — when the network is reachable — the on-chain XRPL transaction is fetched and asserted (`validated` + `tesSUCCESS`, the signing account is in the trusted-anchor allowlist, and the on-chain memo binds to the local root/manifest-hash/count). Offline, it reports `XRPL NOT verified` rather than a fake transaction; strict `--anchored` then fails (use `--anchored-or-local` to accept a locally-verified manifest without the on-chain proof).

निरंतर एकीकरण (सीआई) गेट के लिए, एक ऐसे आउटपुट प्रारूप का चयन करें जिसमें `--format <text|json|sarif|markdown>` हो (`--json`, `--format json` का एक पर्याय है):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**निकास कोड** तीन-अवस्था वाले परिणाम से प्राप्त होता है, इसलिए एक सीआई चरण सीधे इस पर निर्भर हो सकता है:

| बाहर निकलें। | निर्णय | अर्थ |
|------|---------|---------|
| `0` | पास | प्रामाणिक और सुनिश्चित (या `--fail-on=fail` द्वारा शिथिल किए जाने पर, अप्रमाणित)। |
| `1` | असफल | गंभीर विफलता – जाली/गलत रिपॉजिटरी हस्ताक्षर, गैर-अनुमोदित सत्यापनकर्ता, या आवश्यक जाँच विफल। |
| `3` | पुष्टि न की गई। | अस्थिर – अभी तक स्थापित नहीं, कोई स्वतंत्र गवाह नहीं, या आवश्यक जाँच अनुपस्थित। |
| `2` | — | उपयोग में त्रुटि या आंतरिक खराबी। |

### कंटेनर

उसी कमांड-लाइन इंटरफ़ेस (सीएलआई) को `ghcr.io/mcp-tool-shop-org/repomesh` के रूप में प्रकाशित किया गया है, और इसे एनपीएम संस्करण और गिट शा के साथ टैग किया गया है। यह इमेज एक गैर-रूट उपयोगकर्ता के रूप में चलती है। इसमें कोई वॉलेट सीड नहीं है।

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

एक एंकर पोस्ट करना एक अलग कमांड है। `XRPL_SEED` रनटाइम पर पास किया जाता है:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

दैनिक कार्यप्रवाह इस छवि को चेकआउट और पोस्ट से बनाता है और उसके साथ साझा करता है। `anchor/xrpl/config.json` में नेटवर्क अभी भी परीक्षण नेटवर्क है। एक मुख्य नेटवर्क पोस्ट एक ऐसे खाते की प्रतीक्षा कर रहा है जिसमें धन जमा हो, और जिसका क्लासिक पता पहले सीएलआई रिलीज़ में भेजे गए अनुमति सूची में जोड़ा गया है। वह अनुमति सूची एक सीमा है: प्राप्त कॉन्फ़िगरेशन किसी खाते को हटा सकता है, लेकिन उसमें कोई खाता नहीं जोड़ सकता।

`--fail-on <fail\|unverified>` कठोरता निर्धारित करता है। डिफ़ॉल्ट रूप से `unverified`, FAIL और UNVERIFIED दोनों स्थितियों में विफल हो जाता है; `--fail-on=fail`, चेतावनी मोड में अपनाने के लिए UNVERIFIED को पास होने देता है (चेतावनी के साथ 0 पर समाप्त होता है)।

एक ही लेज़र लोड में एक साथ पूरे बैच को `verify-all` से सत्यापित करें, और स्थानीय क्लोन के विरुद्ध ऑफ़लाइन सत्यापन `--local` से करें।

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**इसे सीआई में एकीकृत करें** बंडल किए गए समग्र क्रिया के साथ – देखें:
[गिटहब क्रिया का उपयोग करना](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

पूर्ण सत्यापन मार्गदर्शिका, खतरे का मॉडल और मुख्य अवधारणाओं के लिए [docs/verification.md](docs/verification.md) देखें।

### इसे पुस्तकालय के रूप में उपयोग करें।

सत्यापन इंजन को एक स्थिर प्रोग्रामेटिक एपीआई के रूप में निर्यात किया जाता है – इसे अपने स्वयं के टूल में शामिल करें, बजाय इसके कि आप कमांड लाइन इंटरफेस (सीएलआई) का उपयोग करें।

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### नेटवर्क स्थिति का अंतिम बिंदु।

डैशबोर्ड एक मशीन-पठनीय `status.json` (https://mcp-tool-shop-org.github.io/repomesh/status.json) प्रकाशित करता है, जिसका उपयोग बाहरी निगरानी के लिए किया जाता है—इसमें लेज़र की ताजगी (एक स्थिर-लेज़र संकेत के साथ), विश्वास-निर्णय की संख्या, एंकर किए गए बनाम लंबित विभाजन और `ok`/`degraded` रोलअप, साथ में उनके कारण शामिल हैं।

### विश्वसनीयता बैज

रिपॉजिटरी से प्राप्त भरोसेमंदता बैज को रिपॉजिटरी में शामिल किया जा सकता है:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## विश्वास और सत्यापन

### रिलीज़ की पुष्टि करें।

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### रिहाई की पुष्टि करें।

> सत्यापन और सत्यापनकर्ता चलाने, ये **ऑपरेटर** कार्य हैं जो इस लेज़र की एक प्रति पर काम करते हैं, इसलिए वे एक चेकआउट से चलते हैं। किसी रिलीज़ को सत्यापित करने के लिए ऊपर दिए गए `npx` कमांड का उपयोग न करें।

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

जाँच: `sbom.present`, `provenance.present`, `signature.chain`

### सत्यापनकर्ता चलाएँ

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

सुरक्षा सत्यापनकर्ता सीमाएँ (अधिकतम सीवीई, अनुमत गंभीरता) `verifiers/security/config.json` के माध्यम से कॉन्फ़िगरेशन द्वारा संचालित होती हैं।

### नीति जाँच चलाएँ

```bash
node policy/scripts/check-policy.mjs
```

जाँच: सेम्वर मोनोटोनिसिटी, कलाकृति हैश विशिष्टता, आवश्यक क्षमताएँ।

## सुरक्षा और खतरे का मॉडल

RepoMesh **लेज़र घटनाओं** (हस्ताक्षरित JSON), **नोड मेनिफ़ेस्ट** (सार्वजनिक कुंजियाँ + क्षमताएँ), **रजिस्ट्री इंडेक्स** (स्वचालित रूप से उत्पन्न विश्वास स्कोर), और **XRPL टेस्टनेट** (एंकर लेनदेन) को प्रभावित करता है। यह सदस्य रिपॉजिटरी स्रोत कोड, निजी कुंजियों, उपयोगकर्ता क्रेडेंशियल्स या ब्राउज़िंग डेटा को **नहीं** प्रभावित करता है। निजी हस्ताक्षर कुंजियाँ कभी भी सीआई रनर को नहीं छोड़ती हैं। नेटवर्क एक्सेस GitHub API (पीआर निर्माण), XRPL टेस्टनेट (एंकरिंग) और OSV.dev (भेद्यता लुकअप) तक सीमित है। **कोई टेलीमेट्री** एकत्र या भेजी नहीं जाती है - शून्य विश्लेषण, शून्य क्रैश रिपोर्ट, शून्य फोन-होम। पूर्ण दायरे, आवश्यक अनुमतियों और भेद्यता रिपोर्टिंग प्रक्रिया के लिए [SECURITY.md](SECURITY.md) देखें, और कुंजी-जीवनचक्र विश्वास सीमा (यह क्यों `node.json` प्रामाणिकता इसके स्रोत पर निर्भर करती है, और क्यों निरसन-संवेदनशील सत्यापन को `--anchored` का उपयोग करना चाहिए) के लिए [खतरे का मॉडल](docs/threat-model.md) देखें।

सुरक्षा बढ़ाना:

- चाइल्ड-प्रोसेस कॉल जो परिवर्तनीय डेटा को इंटरपोलेट करते हैं, वे सरणी तर्कों के साथ `execFileSync` का उपयोग करते हैं; शेष `execSync` कॉल स्थिर, निरंतर कमांड स्ट्रिंग का उपयोग करते हैं - कोई शेल-इंजेक्शन वेक्टर नहीं।
- लेज़र और रजिस्ट्री JSON को संरचित, पंक्ति-संख्यांकित त्रुटियों के साथ `try`/`catch` के अंदर पार्स किया जाता है; एक गलत पंक्ति को छोड़ दिया जाता है और प्रदर्शित किया जाता है, यह उपकरण को कच्चे स्टैक के साथ कभी भी क्रैश नहीं करता है।
- सभी फ़ाइल संचालन (रिज़ॉल्व + सीमा जाँच) पर पथ ट्रैवर्सल को रोका जाता है।
- पूरे में ReDoS-सुरक्षित पार्सिंग (कोई असीमित रेगुलर एक्सप्रेशन नहीं)।
- PEM निजी कुंजियों को `.gitignore` के माध्यम से बाहर रखा जाता है, उन्हें कभी भी stdout या CI लॉग में नहीं छापा जाता है, और उन्हें केवल मालिक (`0600`) अनुमतियों के साथ लिखा जाता है।

## परीक्षण

पूरा `node --test` सूट Ed25519 हस्ताक्षर, स्कीमा सत्यापन, मर्कल ट्री अखंडता (v1 + RFC-6962 v2), केवल-अतिरिक्त अपरिवर्तनीय, पथ ट्रैवर्सल रोकथाम, एंकर सत्यापन, विश्वसनीय-सत्यापनकर्ता अनुमति सूची और CLI, लेज़र, एंकर, सत्यापनकर्ता और उपकरण परतों में इनपुट सत्यापन को कवर करता है।

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

जैसे-जैसे सूट जोड़े जाते हैं, परीक्षणों की संख्या बढ़ती जाती है - वर्तमान कुल के लिए ऊपर दिए गए कमांड को चलाएँ, न कि किसी ऐसे नंबर पर निर्भर रहें जो समय के साथ बदलता रहता है।

## लाइसेंस

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> द्वारा निर्मित
