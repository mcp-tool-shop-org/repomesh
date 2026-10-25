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

रिलीज़ लेज़र और XRPL-आधारित ट्रस्ट क्लॉक को एक रिपो नेटवर्क के लिए जारी करें: हस्ताक्षरित इवेंट, नोड मेनिफेस्ट और सत्यापन। एटटेस्टिया के इवेंट स्टोर से अलग।

## सिस्टम में रखें

एटटेस्टिया, कॉग्नेट और RepoMesh तीन उत्पाद हैं।

**RepoMesh** रिलीज़ नेटवर्क है: हस्ताक्षरित इवेंट, नोड मेनिफेस्ट और एक XRPL-आधारित ट्रस्ट क्लॉक। यह अपना RFC 6962 लेज़र रखता है।

**एटटेस्टिया** यह साबित करता है कि कोई इवेंट, लेनदेन या स्थिति परिवर्तन हुआ, और उस प्रमाण को एक श्रृंखला से जोड़ता है। इसका डोमेन वित्तीय सत्य है: व्यक्तिगत वॉल्ट, संगठन का खजाना और रजिस्ट्रम। इसके मर्कल प्रूफ इस लेज़र नहीं हैं।

**कॉग्नेट** एटटेस्टिया के इवेंट स्टोर और मर्कल प्रूफ पर AI शासन डोमेन है। जब इसे किसी रिलीज़ की जांच करने की आवश्यकता होती है, तो यह RepoMesh को कॉल करता है। यह दूसरा इवेंट स्टोर नहीं रखता है, और यह इस नेटवर्क के लिए एटटेस्टिया के मर्कल ट्री का उपयोग नहीं करता है।

## 2.4 और 2.5 में नया क्या है

**संस्करण 2.5.0।**

- **2.5.0: एंकर पोस्टिंग विफल होने पर बंद हो जाती है।** `post-anchor.mjs` पोस्ट करने से इनकार करता है, और कोई कनेक्शन नहीं खोलता है, जब तक कि कॉन्फ़िगरेशन `testnet` न कहे और WebSocket URL एक ज्ञात टेस्टनेट एंडपॉइंट न हो। केवल एक पर्यावरण चर पोस्टिंग को मेननेट पर स्विच नहीं कर सकता है। [XRPL एंकरिंग (टेस्टनेट गार्ड)](#xrpl-एंकरिंग-टेस्टनेट-गार्ड) देखें।
- **2.5.0: एक आवश्यक परीक्षण गेट।** प्रत्येक पुल अनुरोध सभी 9 `node --test` सूट को लाइन-कवरेज फ्लोर और `high` पर एक उत्पादन `npm audit` के साथ चलाता है। `main` पर `validate-ledger` और `test` आवश्यक जांच हैं, और `registry-ci.yml` अब केवल `main` पर `ledger-ci` के सफल होने के बाद ही चलता है।
- **2.4.0: कॉग्नेट से सत्यापन चलाएं।** लेज़र तीन नए सत्यापन प्रकार, `run.preregistered`, `run.outcome` और `cognate.root.anchored` स्वीकार करता है, प्रत्येक में `sha256` डाइजेस्ट और `urn:cognate:...` URI होता है। केवल `trustedAttestors` और `trustedRunAttestors` (आज, `mcp-tool-shop-org/cognate`) दोनों पर एक `governance` नोड ही उन्हें साइन कर सकता है, और यह कुछ और साइन नहीं कर सकता है। प्रत्येक `run.outcome` को पहले से ही लेज़र पर मौजूद `run.preregistered` इवेंट का संदर्भ देना चाहिए।
- **2.4.0: हस्ताक्षर अनुबंध की जांच की जाती है।** `canonicalHash` के 32 कच्चे बाइट्स पर एक Ed25519 हस्ताक्षर होना चाहिए। सत्यापनकर्ता कैनोनिकल JSON टेक्स्ट या 64-वर्ण हेक्स स्ट्रिंग पर बनाए गए हस्ताक्षर को नाम देता है और अस्वीकार करता है।

पूर्ण सूची के लिए [CHANGELOG.md](CHANGELOG.md) देखें।

## यह क्या है?

RepoMesh रिपोस के संग्रह को एक सहकारी नेटवर्क में बदल देता है। प्रत्येक रिपो एक **नोड** है जिसमें:

- एक **मेनिफेस्ट** (`node.json`) जो बताता है कि यह क्या प्रदान करता है और क्या उपयोग करता है
- **हस्ताक्षरित इवेंट** जो केवल-जोड़ने वाले लेज़र में प्रसारित होते हैं
- एक **रजिस्ट्री** जो सभी नोड्स और क्षमताओं को अनुक्रमित करता है
- एक **प्रोफ़ाइल** जो यह परिभाषित करता है कि ट्रस्ट के लिए "पूर्ण" का क्या अर्थ है

आज एक GitHub संगठन, mcp-tool-shop-org, लॉग, सत्यापनकर्ताओं, नीति जांच और XRPL एंकर का संचालन करता है। सात पंजीकृत नोड सात ऑपरेटर नहीं बनाते हैं। एक स्वतंत्र गवाह वह पार्टी होगी जिसका यह संगठन संचालन नहीं करता है।

नेटवर्क तीन अपरिवर्तनीयता लागू करता है:

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
- Ed25519 साइनिंग कीपेयर (निजी कुंजी स्थानीय रहती है)

फिर अपने रिपो में दो गुप्त जोड़ें:
1. `REPOMESH_SIGNING_KEY` - आपकी निजी कुंजी PEM (init द्वारा मुद्रित)
2. `REPOMESH_LEDGER_TOKEN` - GitHub PAT जिसमें `contents:write` + `pull-requests:write` इस रिपो पर है

एक रिलीज़ करें। ट्रस्ट स्वचालित रूप से अभिसरित होता है।

### CLI झंडे

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

| प्रोफ़ाइल | साक्ष्य | आश्वासन जांच | उपयोग कब करें |
|---------|----------|-----------------|----------|
| `baseline` | वैकल्पिक | कोई भी आवश्यक नहीं | आंतरिक उपकरण, प्रयोग |
| `open-source` | एसबीओएम + उत्पत्ति | लाइसेंस ऑडिट + सुरक्षा स्कैन | ओपन सोर्स सॉफ़्टवेयर के लिए डिफ़ॉल्ट |
| `regulated` | एसबीओएम + उत्पत्ति | लाइसेंस + सुरक्षा + पुनरुत्पादकता | अनुपालन-महत्वपूर्ण |

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

## मैन्युअल रूप से शामिल हों (5 मिनट)

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
    { "name": "your-name", "contact": "https://github.com/your-org", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. एक साइनिंग कीपेयर उत्पन्न करें

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` सार्वजनिक कुंजी + एक `keyId` प्रिंट करता है जिसे आपके `node.json` रखरखाव प्रविष्टि में डाला जा सकता है, और
निजी कुंजी (मोड 0600) केवल वहीं लिखता है जहाँ आप `--out` इंगित करते हैं - कभी भी ट्रैक किए गए पथ पर नहीं। इसे एक GitHub रिपो गुप्त के रूप में संग्रहीत करें (`REPOMESH_SIGNING_KEY`)। (हाथ से समकक्ष: `openssl genpkey -algorithm ED25519 ...`)।

> **एक ट्रस्ट-महत्वपूर्ण नोड के लिए ≥2 कुंजियाँ पंजीकृत करें** (टीयूएफ §6.1): समझौता किए जाने पर एक ही कुंजी अपने स्वयं के निरसन पर हस्ताक्षर नहीं कर सकती है। `repomesh init --second-key` एक अलग दूसरी रखरखावकर्ता को पंजीकृत करता है ताकि एक कुंजी दूसरी कुंजी को निरस्त कर सके - `init` चेतावनी देता है जब किसी नोड में केवल एक सक्रिय कुंजी होती है।

### 3. नेटवर्क के साथ पंजीकरण करें

इस रिपो में अपना नोड मेनिफेस्ट जोड़कर एक पीआर खोलें:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. प्रसारण वर्कफ़्लो जोड़ें

`templates/repomesh-broadcast.yml` को अपने रिपो के `.github/workflows/` में कॉपी करें।
`REPOMESH_LEDGER_TOKEN` गुप्त सेट करें (एक बारीक-दानेदार PAT जिसमें इस रिपो पर सामग्री: लिखें + पुल-अनुरोध: लिखें)।

प्रत्येक रिलीज़ अब स्वचालित रूप से लेज़र में एक हस्ताक्षरित `ReleasePublished` इवेंट प्रसारित करेगी।

## लेज़र नियम

- **केवल-जोड़ने योग्य** - मौजूदा पंक्तियाँ अपरिवर्तनीय हैं
- **स्कीमा-मान्य** - प्रत्येक घटना `schemas/event.schema.json` के विरुद्ध मान्य होती है
- **हस्ताक्षर-मान्य** - प्रत्येक घटना एक पंजीकृत नोड अनुरक्षक द्वारा हस्ताक्षरित होती है
- **अद्वितीय** - कोई डुप्लिकेट `(repo, version, type)` प्रविष्टियाँ नहीं
- **टाइमस्टैम्प-तार्किक** - भविष्य में 1 घंटे या अतीत में 1 वर्ष से अधिक नहीं

## घटना प्रकार

लेजर वर्तमान में नीचे दिए गए **लाइव** घटना प्रकारों को उत्सर्जित करता है। बाकी **आरक्षित / नियोजित** हैं - स्कीमा उन्हें स्वीकार करता है, लेकिन अभी तक कोई भी नोड उन्हें उत्सर्जित नहीं करता है। हम उन्हें सूचीबद्ध करते हैं ताकि रोडमैप दिखाई दे, बिना किसी ऐसे कवरेज का संकेत दिए जो मौजूद नहीं है (एक विश्वसनीय उत्पाद के लिए ईमानदारी)।

**लाइव (आज उत्सर्जित):**

| प्रकार | कब |
|------|------|
| `ReleasePublished` | एक नया संस्करण जारी किया गया है |
| `AttestationPublished` | एक सत्यापनकर्ता एक रिलीज़ को सत्यापित करता है |
| `ledger.anchor` | एंकर नोड एक विभाजन को सील करता है (मर्केल रूट + एक्सआरपीएल ज्ञापन) |
| `attestation.dispute` | एक विश्वसनीय नोड एक सत्यापन पर विवाद करता है (निर्णय को कम करता है) |
| `KeyRotation` | एक अनुरक्षक कुंजी को एक उत्तराधिकारी में घुमाया जाता है (संभावित - पिछली हस्ताक्षर मान्य रहते हैं) |
| `KeyRevocation` | एक अनुरक्षक कुंजी को रद्द कर दिया जाता है (समझौता = पिछली अमान्यता, RFC 5280) |

`AttestationPublished` में कोग्नेट के रन सत्यापन भी शामिल हैं (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, 2.4.0 से), केवल इसके `governance` नोड द्वारा हस्ताक्षरित।

**आरक्षित / नियोजित (अभी तक उत्सर्जित नहीं):**

| प्रकार | उद्देशित अर्थ |
|------|------------------|
| `BreakingChangeDetected` | एक ब्रेकिंग परिवर्तन पेश किया गया है |
| `HealthCheckFailed` | एक नोड अपने स्वयं के स्वास्थ्य जांच में विफल रहता है |
| `DependencyVulnFound` | निर्भरताओं में एक भेद्यता पाई जाती है |
| `InterfaceUpdated` | एक इंटरफ़ेस स्कीमा बदलता है |
| `PolicyViolation` | एक नेटवर्क नीति का उल्लंघन किया जाता है। `policy/scripts/check-policy.mjs` एक बना सकता है और उस पर हस्ताक्षर कर सकता है; अभी तक कोई भी लेजर पर नहीं है |

## कुंजी रोटेशन और निरसन

अनुरक्षक कुंजियों का एक जीवनचक्र होता है। एक कुंजी को एक उत्तराधिकारी में **घुमाया** या **रद्द** किया जा सकता है, और सत्यापन **समय-जागरूक** है: एक हस्ताक्षर पर तभी भरोसा किया जाता है जब कुंजी हस्ताक्षर के विश्वसनीय समय पर मान्य हो - एक्सआरपीएल एंकर क्लोज-टाइम, वही विश्वसनीय घड़ी जिसका लेजर पहले से उपयोग करता है।

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **नियमित रोटेशन** *संभावित* है - सेवानिवृत्त कुंजी के पिछले हस्ताक्षर मान्य रहते हैं; यह बस नए रिलीज़ पर हस्ताक्षर करना बंद कर देता है।
- **समझौता** *पिछली तारीख का* है (RFC 5280 §5.3.2) - किसी भी हस्ताक्षर को जिसकी सिद्ध एंकर समय अमान्यता तिथि पर या उसके बाद है, उसे अस्वीकार कर दिया जाता है, और एक ऐसे हस्ताक्षर को जिसे इससे पहले सिद्ध नहीं किया जा सकता है, उसे अस्वीकार कर दिया जाता है।
- **कोई** जीवनचक्र फ़ील्ड नहीं होने वाली कुंजी को पिछली पीढ़ी की माना जाता है (हमेशा मान्य), इसलिए मौजूदा नोड अपरिवर्तित रूप से सत्यापित करते हैं।
- निरसन पर `KeyRevocation` घटनाओं पर हस्ताक्षर किए जाते हैं; एक एकल-कुंजी नोड जिसकी एकमात्र कुंजी से समझौता किया गया है, उसे **शासन** (`trustedPolicy`) नोड द्वारा निरसन पर हस्ताक्षर करके पुनर्प्राप्त किया जाता है। विश्वास-महत्वपूर्ण नोड्स को **≥2 कुंजियाँ** पंजीकृत करनी चाहिए (टीयूएफ §6.1)।
- छेड़छाड़ किए गए `node.json` के खिलाफ भी, एक निरसन पर हस्ताक्षरित, एक्सआरपीएल-एन्कर घटनाओं से फिर से लागू किया जाता है - एक स्ट्रिप्ड मेनिफेस्ट रद्द की गई कुंजी को पुनर्जीवित नहीं कर सकता है। [खतरा मॉडल](docs/threat-model.md) देखें सीमा के लिए (मानक लेजर के विरुद्ध सत्यापित करें; निरसन-संवेदनशील जांच के लिए `--anchored` का उपयोग करें)।

## नोड प्रकार

| प्रकार | भूमिका |
|------|------|
| `registry` | नोड्स और क्षमताओं को अनुक्रमित करता है |
| `attestor` | दावों को सत्यापित करता है (बिल्ड, अनुपालन) |
| `policy` | नियमों को लागू करता है (स्कोरिंग, गेटिंग) |
| `oracle` | बाहरी डेटा प्रदान करता है |
| `compute` | काम करता है (परिवर्तित करता है, बनाता है) |
| `settlement` | अवस्था को अंतिम रूप देता है |
| `governance` | निर्णय लेता है; 2.4.0 से, कोग्नेट के रन सत्यापन पर हस्ताक्षर करता है और कुछ और नहीं |
| `identity` | क्रेडेंशियल्स जारी/सत्यापित करता है |

## नेटवर्क का विस्तार - सत्यापनकर्ता-प्लगइन अनुबंध

नए **जांच प्रकार** और **सत्यापनकर्ता नोड** डेटा को संपादित करके जोड़े जाते हैं, कोड से नहीं। जांच-प्रकार रजिस्ट्री, स्कोरिंग भार और नोड-प्रकार अनुमतियाँ में मौजूद हैं
[`verifier.policy.json`](verifier.policy.json) (स्कीमा-मान्य, विफल-बंद)। एक जांच जोड़ना (जैसे `sast.scan`) लगभग 6-पंक्ति नीति संपादन + एक `node.json` है, जिसे पीआर में समीक्षा की जाती है - कोई कोड परिवर्तन नहीं।

एक अपरिवर्तनीय: **पंजीकृत ≠ विश्वसनीय।** पंजीकरण एक जांच को भाग लेने देता है; क्रेडिट के लिए अभी भी एक विश्वसनीय-सेट सर्वसम्मति पास की आवश्यकता होती है। पूर्ण मार्गदर्शिका: [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)।

## सार्वजनिक सत्यापन

कोई भी एक कमांड के साथ एक रिलीज़ को सत्यापित कर सकता है - **किसी क्लोन की आवश्यकता नहीं है**, सीएलआई आपके लिए सार्वजनिक लेजर प्राप्त करता है:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

यह जांचता है:
1. `ReleasePublished` घटना मौजूद है और उस पर हस्ताक्षर किए गए हैं (Ed25519) उस कुंजी द्वारा जो **उस रिपो की अपनी** `node.json` के लिए पंजीकृत है - किसी भिन्न रिपो के लिए पंजीकृत एक कुंजी इसे मान्य नहीं कर सकती है।
2. रिपो की विश्वास प्रोफ़ाइल संतुष्ट है: प्रोफ़ाइल-आवश्यक प्रत्येक सत्यापन (एसबीओएम, उत्पत्ति, लाइसेंस, सुरक्षा) मौजूद है, एक विश्वसनीय सत्यापनकर्ता द्वारा हस्ताक्षरित है, और इसका नवीनतम परिणाम `pass` है, जिसमें कम से कम एक **स्वतंत्र** सत्यापनकर्ता है। केवल एक स्व-हस्ताक्षर और कोई स्वतंत्र सत्यापन न होने वाली रिलीज़ `UNVERIFIED` की रिपोर्ट करती है, कभी भी `PASS` नहीं।
3. `--anchored` के साथ: विभाजन के मर्केल रूट की पुनर्गणना की जाती है और इसे मेनिफेस्ट से मिलाया जाता है, और - जब नेटवर्क पहुंच योग्य होता है - ऑन-चेन एक्सआरपीएल लेनदेन प्राप्त किया जाता है और दावा किया जाता है (`validated` + `tesSUCCESS`, हस्ताक्षर करने वाला खाता विश्वसनीय-एंकर अनुमति सूची में है, और ऑन-चेन ज्ञापन स्थानीय रूट/मेनिफेस्ट-हैश/गणना से बंधा हुआ है)। ऑफ़लाइन, यह `XRPL NOT verified` की रिपोर्ट करता है, नकली लेनदेन के बजाय; सख्त `--anchored` तब विफल हो जाता है (स्थानीय रूप से सत्यापित मेनिफेस्ट को ऑन-चेन प्रमाण के बिना स्वीकार करने के लिए `--anchored-or-local` का उपयोग करें)।

सीआई गेट्स के लिए, `--format <text|json|sarif|markdown>` के साथ एक आउटपुट प्रारूप चुनें (`--json` एक उपनाम है `--format json` के लिए):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**निकास कोड** को त्रि-अवस्था वाले निर्णय से प्राप्त किया जाता है, इसलिए एक सीआई चरण सीधे उस पर गेट कर सकता है:

| निकास | निर्णय | अर्थ |
|------|---------|---------|
| `0` | पास | प्रामाणिक और सुनिश्चित (या `--fail-on=fail` द्वारा आराम करने पर अपरिवर्तित)। |
| `1` | विफल | कठिन विफलता - जाली/गलत-रिपो हस्ताक्षर, गैर-अनुमत सत्यापनकर्ता, या एक आवश्यक जांच विफल। |
| `3` | अपरिवर्तित | नरम - अभी तक एंकर नहीं किया गया, कोई स्वतंत्र गवाह नहीं, या एक आवश्यक जांच गायब है। |
| `2` | — | उपयोग त्रुटि या आंतरिक क्रैश। |

### कंटेनर

उसी CLI को `ghcr.io/mcp-tool-shop-org/repomesh` के रूप में प्रकाशित किया गया है, जिसे npm संस्करण और git sha के साथ टैग किया गया है। यह इमेज एक गैर-रूट उपयोगकर्ता के रूप में चलती है। इसमें वॉलेट सीड शामिल नहीं है।

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

एक एंकर पोस्ट करना एक अलग कमांड है। `XRPL_SEED` रनटाइम पर पास किया जाता है:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

दैनिक वर्कफ़्लो इस इमेज को चेकआउट से बनाता है और इसके साथ पोस्ट करता है।

### XRPL एंकरिंग (टेस्टनेट गार्ड)

`anchor/xrpl/config.json` में एंकरिंग केवल **टेस्टनेट** के लिए है (`"network": "testnet"`)। `anchor/xrpl/scripts/post-anchor.mjs` `XRPL_SEED` को मान्य करने या `xrpl.Client` बनाने से पहले एक विफल-बंद एंडपॉइंट गार्ड (`assertPostingEndpoint`) लागू करता है:

- **डिफ़ॉल्ट टेस्टनेट चेक:** जब तक `config.network === "testnet"` **और** रिज़ॉल्व किया गया WebSocket URL (`process.env.XRPL_WS_URL || config.rippledUrl`) `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`) में नहीं है, तब तक पोस्टिंग से इनकार कर दिया जाता है (शून्य से अलग एग्जिट, कोई सॉकेट नहीं खोला गया)। `XRPL_WS_URL` को मेननेट या अज्ञात URL पर सेट करने से तुरंत इनकार कर दिया जाता है, जिसमें रिज़ॉल्व किए गए नेटवर्क और रिज़ॉल्व किए गए URL दोनों का उल्लेख किया जाता है।
- **मेननेट ऑप्ट-इन (अक्षम):** केवल एक पर्यावरण चर पोस्टिंग को मेननेट पर स्विच नहीं कर सकता है। मेननेट में ऑप्ट-इन करने के लिए `anchor/xrpl/config.json` में एक समीक्षा किए गए कमिट की आवश्यकता होती है, जो `"network": "mainnet"`, `"allowMainnetPosting": true` और `"mainnetAllowedEndpoints": ["wss://..."]` को सेट करता है, जिसमें लक्षित `wss://` एंडपॉइंट होता है, इसके बाद शिप किए गए अनुमति सूची छत (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`) में वित्तपोषित मेननेट क्लासिक पते को जोड़ा जाता है। वह अनुमति सूची एक छत है: एक प्राप्त कॉन्फ़िगरेशन एक खाते को हटा सकता है और एक नहीं जोड़ सकता है।

`--fail-on <fail\|unverified>` कठोरता निर्धारित करता है। डिफ़ॉल्ट `unverified`, FAIL और UNVERIFIED दोनों पर विफल रहता है; `--fail-on=fail`, चेतावनी-मोड अपनाने के लिए UNVERIFIED को पास करने देता है (एग्जिट 0, एक चेतावनी के साथ)।

`verify-all` के साथ एक ही लेज़र लोड में एक पूरे बैच को सत्यापित करें, और स्थानीय क्लोन के विरुद्ध ऑफ़लाइन सत्यापित करें `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

बंडल किए गए कंपोजिट एक्शन के साथ **इसे CI में गेट करें** — देखें [GitHub एक्शन का उपयोग करना](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

पूर्ण सत्यापन मार्गदर्शिका, खतरे के मॉडल और प्रमुख अवधारणाओं के लिए [docs/verification.md](docs/verification.md) देखें।

### इसे एक लाइब्रेरी के रूप में उपयोग करें

सत्यापन इंजन को एक स्थिर प्रोग्रामेटिक API के रूप में निर्यात किया जाता है — इसे CLI पर निर्भर रहने के बजाय अपनी स्वयं की टूलिंग में एम्बेड करें:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### नेटवर्क स्थिति एंडपॉइंट

डैशबोर्ड एक मशीन-पठनीय [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) प्रकाशित करता है, जिसका उपयोग बाहरी पोलिंग के लिए किया जा सकता है — लेज़र ताजगी (एक जमे हुए-लेज़र सिग्नल के साथ), ट्रस्ट-निर्णय गणना, एंकर किए गए बनाम लंबित विभाजन, और `ok`/`degraded` रोलअप जिसमें कारण शामिल हैं।

### ट्रस्ट बैज

रिपॉजिटरी रजिस्ट्री से ट्रस्ट बैज एम्बेड कर सकते हैं:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## ट्रस्ट और सत्यापन

### एक रिलीज़ सत्यापित करें

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### एक रिलीज़ को प्रमाणित करें

> प्रमाणित करना और सत्यापनकर्ता चलाना **ऑपरेटर** कार्य हैं जो इस लेज़र के क्लोन पर कार्य करते हैं, इसलिए वे चेकआउट से चलते हैं। एक रिलीज़ को सत्यापित करने की आवश्यकता नहीं है — ऊपर दिए गए `npx` कमांड का उपयोग करें।

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

चेक: `sbom.present`, `provenance.present`, `signature.chain`

### सत्यापनकर्ता चलाएँ

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

सुरक्षा सत्यापनकर्ता सीमाएँ (अधिकतम CVE, अनुमत गंभीरता) `verifiers/security/config.json` के माध्यम से कॉन्फ़िगरेशन-संचालित हैं।

### नीति जाँच चलाएँ

```bash
node policy/scripts/check-policy.mjs
```

चेक: सेम्वर मोनोटोनिसिटी, कलाकृति हैश विशिष्टता, आवश्यक क्षमताएँ।

## सुरक्षा और खतरे का मॉडल

RepoMesh **लेज़र घटनाओं** (हस्ताक्षरित JSON), **नोड मेनिफेस्ट** (सार्वजनिक कुंजियाँ + क्षमताएँ), **रजिस्ट्री इंडेक्स** (स्वचालित रूप से उत्पन्न ट्रस्ट स्कोर), और **XRPL टेस्टनेट** (एंकर लेनदेन; पोस्टिंग किसी भी ऐसे एंडपॉइंट को अस्वीकार कर देता है जो ज्ञात टेस्टनेट नहीं है) को छूता है। यह सदस्य रिपॉजिटरी स्रोत कोड, निजी कुंजियों, उपयोगकर्ता क्रेडेंशियल्स या ब्राउज़िंग डेटा को **नहीं** छूता है। निजी हस्ताक्षर कुंजियाँ कभी भी CI रनर को नहीं छोड़ती हैं। नेटवर्क एक्सेस GitHub API (PR निर्माण), XRPL टेस्टनेट (एंकरिंग) और OSV.dev (भेद्यता लुकअप) तक सीमित है। **कोई टेलीमेट्री** एकत्र या नहीं भेजी जाती है — शून्य एनालिटिक्स, शून्य क्रैश रिपोर्ट, शून्य फोन-होम। पूर्ण दायरे, आवश्यक अनुमतियों और भेद्यता रिपोर्टिंग प्रक्रिया के लिए [SECURITY.md](SECURITY.md) देखें, और कुंजी-जीवनचक्र ट्रस्ट सीमा (क्यों `node.json` प्रामाणिकता इसके स्रोत पर निर्भर करती है, और क्यों पुनरावृत्ति-संवेदनशील सत्यापन को `--anchored` का उपयोग करना चाहिए) के लिए [खतरे का मॉडल](docs/threat-model.md) देखें।

मजबूत बनाना:

- चर डेटा को इंटरपोलेट करने वाले चाइल्ड-प्रोसेस कॉल `execFileSync` का उपयोग करते हैं जिसमें सरणी तर्क होते हैं; शेष `execSync` कॉल स्थिर, निरंतर कमांड स्ट्रिंग का उपयोग करते हैं — कोई शेल-इंजेक्शन वेक्टर नहीं।
- लेज़र और रजिस्ट्री JSON को संरचित, पंक्ति-संख्यांकित त्रुटियों के साथ `try`/`catch` के अंदर पार्स किया जाता है; एक गलत पंक्ति को छोड़ दिया जाता है और प्रदर्शित किया जाता है, यह उपकरण को कच्चे स्टैक के साथ कभी भी क्रैश नहीं करता है।
- सभी फ़ाइल संचालन पर पथ ट्रैवर्सल को रोका जाता है (रिज़ॉल्व + सीमा जाँच)।
- ReDoS-सुरक्षित पार्सिंग (कोई असीमित रेगुलर एक्सप्रेशन नहीं)।
- PEM निजी कुंजियों को `.gitignore` के माध्यम से बाहर रखा जाता है, उन्हें कभी भी stdout या CI लॉग में नहीं छापा जाता है, और मालिक-केवल (`0600`) अनुमतियों के साथ लिखा जाता है।

## परीक्षण

पूर्ण `node --test` सूट Ed25519 हस्ताक्षर, स्कीमा सत्यापन, मर्कल ट्री अखंडता (v1 + RFC-6962 v2), केवल-अतिरिक्त अपरिवर्तनीय, पथ ट्रैवर्सल रोकथाम, एंकर सत्यापन, विश्वसनीय-प्रमाणित अनुमति सूची और CLI, लेज़र, एंकर, सत्यापनकर्ता और उपकरण परतों में इनपुट सत्यापन को कवर करता है।

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

जैसे-जैसे सूट जोड़े जाते हैं, परीक्षणों की संख्या बढ़ती जाती है — वर्तमान कुल के लिए ऊपर दिए गए कमांड को चलाएँ, न कि किसी ऐसे नंबर पर निर्भर रहें जो समय के साथ बदलता रहता है।

CI प्रत्येक पुल अनुरोध (`ledger-ci.yml`, आवश्यक `test` जाँच) पर समान 9 सूट चलाता है, जिसमें `--experimental-test-coverage` और एक पंक्ति-कवरेज तल (`--test-coverage-lines=57`) होता है, फिर रूट के लिए `npm audit --audit-level=high --omit=dev`, और `anchor/xrpl` और `ledger`।

## लाइसेंस

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP टूल शॉप</a> द्वारा निर्मित
