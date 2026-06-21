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

सिंट्रोपिक रिपो नेटवर्क - केवल-अतिरिक्त लेज़र, नोड मेनिफेस्ट और वितरित रिपो समन्वय के लिए स्कोरिंग।

## यह क्या है?

रिपोमेश रिपोस के संग्रह को एक सहकारी नेटवर्क में बदल देता है। प्रत्येक रिपो एक **नोड** होता है जिसमें:

- एक **मेनिफेस्ट** (`node.json`) जो यह घोषित करता है कि यह क्या प्रदान करता है और उपभोग करता है
- **हस्ताक्षरित इवेंट** जो केवल-अतिरिक्त लेज़र पर प्रसारित होते हैं
- एक **रजिस्ट्री** जो सभी नोड्स और क्षमताओं को अनुक्रमित करती है
- एक **प्रोफ़ाइल** जो परिभाषित करती है कि विश्वास के लिए "पूर्ण" का क्या अर्थ है

नेटवर्क तीन अपरिवर्तनीयताओं को लागू करता है:

1. **निर्धारित आउटपुट** - समान इनपुट, समान कलाकृतियाँ
2. **सत्यापित उत्पत्ति** - प्रत्येक रिलीज़ पर हस्ताक्षर किए जाते हैं और इसकी पुष्टि की जाती है
3. **संयोजनीय अनुबंध** - इंटरफेस संस्करणित और मशीन-पठनीय होते हैं

## त्वरित शुरुआत (1 कमांड + 2 गुप्त)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

यह वह सब कुछ उत्पन्न करता है जिसकी आपको आवश्यकता होती है:
- `node.json` - आपका नोड मेनिफेस्ट
- `repomesh.profile.json` - आपकी चुनी हुई प्रोफ़ाइल
- `.github/workflows/repomesh-broadcast.yml` - रिलीज़ प्रसारण वर्कफ़्लो
- Ed25519 हस्ताक्षर कुंजी जोड़ी (निजी कुंजी स्थानीय रहती है)

फिर अपने रिपो में दो गुप्त जोड़ें:
1. `REPOMESH_SIGNING_KEY` - आपकी निजी कुंजी PEM (init द्वारा मुद्रित)
2. `REPOMESH_LEDGER_TOKEN` - GitHub PAT जिसमें इस रिपो पर `contents:write` + `pull-requests:write` हो

एक रिलीज़ करें। विश्वास स्वचालित रूप से अभिसरित होता है।

### सीएलआई ध्वज

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

### प्रोफ़ाइलें

| प्रोफ़ाइल | साक्ष्य | आश्वासन जांच | कब उपयोग करें |
|---------|----------|-----------------|----------|
| `baseline` | वैकल्पिक | कोई भी आवश्यक नहीं है | आंतरिक उपकरण, प्रयोग |
| `open-source` | एसबीओएम + उत्पत्ति | लाइसेंस ऑडिट + सुरक्षा स्कैन | ओएसएस के लिए डिफ़ॉल्ट |
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

## मैनुअल जॉइन (5 मिनट)

### 1. अपना नोड मेनिफेस्ट बनाएं

अपने रिपो रूट में `node.json` जोड़ें:

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

`keygen` सार्वजनिक कुंजी और एक `keyId` प्रिंट करता है, जिसे आपके `node.json` में रखरखावकर्ता प्रविष्टि में जोड़ा जा सकता है, और निजी कुंजी (मोड 0600) केवल उस स्थान पर लिखता है जहाँ आप `--out` निर्दिष्ट करते हैं - कभी भी किसी ट्रैक किए गए पथ पर नहीं। इसे GitHub रिपॉजिटरी गुप्त (`REPOMESH_SIGNING_KEY`) के रूप में संग्रहीत करें। (हाथ से समकक्ष: `openssl genpkey -algorithm ED25519 ...`)

> **एक महत्वपूर्ण नोड के लिए ≥2 कुंजियाँ पंजीकृत करें** (TUF §6.1): एक ही कुंजी अपनी स्वयं की अमान्यता पर हस्ताक्षर नहीं कर सकती है यदि वह समझौता हो जाती है। `repomesh init --second-key` एक अलग दूसरी रखरखावकर्ता कुंजी को पंजीकृत करता है ताकि एक कुंजी दूसरी को रद्द कर सके - `init` चेतावनी देता है जब किसी नोड में केवल एक सक्रिय कुंजी होती है।

### 3. नेटवर्क के साथ पंजीकरण करें

इस रिपो में अपना नोड मेनिफेस्ट जोड़कर एक पीआर खोलें:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. प्रसारण वर्कफ़्लो जोड़ें

`templates/repomesh-broadcast.yml` को अपने रिपो के `.github/workflows/` में कॉपी करें।
`REPOMESH_LEDGER_TOKEN` गुप्त सेट करें (एक बारीक PAT जिसमें इस रिपो पर `contents:write` + `pull-requests:write` हो)।

प्रत्येक रिलीज़ अब स्वचालित रूप से लेज़र पर एक हस्ताक्षरित `ReleasePublished` इवेंट प्रसारित करेगी।

## लेज़र नियम

- **केवल-अतिरिक्त** - मौजूदा पंक्तियाँ अपरिवर्तनीय हैं
- **स्कीमा-मान्य** - प्रत्येक इवेंट `schemas/event.schema.json` के विरुद्ध मान्य होता है
- **हस्ताक्षर-मान्य** - प्रत्येक इवेंट एक पंजीकृत नोड रखरखावकर्ता द्वारा हस्ताक्षरित होता है
- **अद्वितीय** - कोई डुप्लिकेट `(रिपो, संस्करण, प्रकार)` प्रविष्टियाँ नहीं
- **टाइमस्टैम्प-तर्कसंगत** - 1 घंटे से अधिक भविष्य में या 1 वर्ष से अधिक अतीत में नहीं

## इवेंट प्रकार

लेज़र वर्तमान में नीचे दिए गए **लाइव** इवेंट प्रकारों का उत्सर्जन करता है। शेष **आरक्षित / नियोजित** हैं - स्कीमा उन्हें स्वीकार करता है, लेकिन कोई भी नोड अभी तक उन्हें उत्सर्जित नहीं करता है। हम उन्हें सूचीबद्ध करते हैं ताकि रोडमैप दृश्यमान हो बिना किसी ऐसे कवरेज को निहित किए जो मौजूद नहीं है (विश्वास उत्पाद के लिए फ्रंट-डोर ईमानदारी)।

**लाइव (आज उत्सर्जित):**

| प्रकार | कब |
|------|------|
| `ReleasePublished` | एक नया संस्करण जारी किया गया है |
| `AttestationPublished` | एक एटेस्टेटर एक रिलीज़ को सत्यापित करता है |
| `ledger.anchor` | एंकर नोड एक विभाजन (मर्केल रूट + एक्सआरपी ज्ञापन) को सील करता है |
| `attestation.dispute` | एक विश्वसनीय नोड एक सत्यापन का विवाद करता है (निर्णय को कम करता है) |
| `KeyRotation` | एक रखरखावकर्ता कुंजी को उत्तराधिकारी में बदल दिया जाता है (संभावित - पिछली हस्ताक्षर मान्य रहती हैं)। |
| `KeyRevocation` | एक रखरखावकर्ता कुंजी रद्द कर दी जाती है (समझौता = पूर्वव्यापी अमान्यता, RFC 5280)। |

**आरक्षित / नियोजित (अभी तक उत्सर्जित नहीं):**

| प्रकार | उद्देश्य अर्थ |
|------|------------------|
| `BreakingChangeDetected` | एक ब्रेकिंग परिवर्तन पेश किया गया है |
| `HealthCheckFailed` | एक नोड अपने स्वयं के स्वास्थ्य जांच में विफल रहता है |
| `DependencyVulnFound` | निर्भरताओं में एक भेद्यता पाई जाती है |
| `InterfaceUpdated` | एक इंटरफ़ेस स्कीमा बदल जाता है |
| `PolicyViolation` | एक नेटवर्क नीति का उल्लंघन किया गया है |

## कुंजी रोटेशन और निरसन

रखरखावकर्ता कुंजियों का एक जीवनचक्र होता है। किसी कुंजी को उत्तराधिकारी में बदला जा सकता है या उसे रद्द किया जा सकता है, और सत्यापन समय के प्रति संवेदनशील होता है: किसी हस्ताक्षर पर तभी भरोसा किया जाता है जब वह कुंजी उस हस्ताक्षर के विश्वसनीय समय पर मान्य हो - XRPL एंकर क्लोज-टाइम, वही विश्वसनीय घड़ी जिसका उपयोग लेज़र पहले से करता है।

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- **नियमित रोटेशन** संभावित है - सेवानिवृत्त कुंजी के पिछले हस्ताक्षर मान्य रहते हैं; यह केवल नई रिलीज़ पर हस्ताक्षर करना बंद कर देता है।
- **समझौता** पूर्वव्यापी है (RFC 5280 §5.3.2) - किसी भी हस्ताक्षर को, जिसका सिद्ध एंकर समय अमान्यता तिथि पर या उसके बाद का है, अस्वीकार कर दिया जाता है, और जिस हस्ताक्षर को इससे पहले साबित नहीं किया जा सकता है, उसे भी अस्वीकार कर दिया जाता है।
- जिन कुंजियों में कोई जीवनचक्र फ़ील्ड नहीं हैं, उन्हें डिफ़ॉल्ट रूप से मान्य माना जाता है (हमेशा मान्य), इसलिए मौजूदा नोड अपरिवर्तित सत्यापन करते हैं।
- निरसन पर `KeyRevocation` इवेंट के साथ हस्ताक्षर किए जाते हैं; एक एकल-कुंजी नोड जिसकी एकमात्र कुंजी समझौता हो जाती है, उसे **शासन** (`trustedPolicy`) नोड द्वारा निरसन पर हस्ताक्षर करके ठीक किया जाता है। महत्वपूर्ण नोड्स को ≥2 कुंजियाँ पंजीकृत करनी चाहिए (TUF §6.1)।
- छेड़छाड़ किए गए `node.json` के खिलाफ भी, एक निरसन को हस्ताक्षरित, XRPL-एन्कर किए गए इवेंट से फिर से लागू किया जाता है - एक हटाए गए मैनिफ़ेस्ट रद्द की गई कुंजी को पुनर्जीवित नहीं कर सकता। सीमा के लिए [खतरा मॉडल](docs/threat-model.md) देखें (लेज़र के विरुद्ध सत्यापित करें; निरसन-संवेदनशील जाँचों के लिए `--anchored` का उपयोग करें)।

## नोड प्रकार

| प्रकार | भूमिका |
|------|------|
| `registry` | नोड्स और क्षमताओं को अनुक्रमित करता है |
| `attestor` | दावों को सत्यापित करता है (बिल्ड, अनुपालन) |
| `policy` | नियमों को लागू करता है (स्कोरिंग, गेटिंग) |
| `oracle` | बाहरी डेटा प्रदान करता है |
| `compute` | काम करता है (परिवर्तन, बिल्ड) |
| `settlement` | अवस्था को अंतिम रूप देता है |
| `governance` | निर्णय लेता है |
| `identity` | क्रेडेंशियल्स जारी/सत्यापित करता है |

## सार्वजनिक सत्यापन

कोई भी एक कमांड के साथ रिलीज़ को सत्यापित कर सकता है - **किसी क्लोन की आवश्यकता नहीं है**, सीएलआई आपके लिए सार्वजनिक लेज़र प्राप्त करता है:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

यह जांचता है:
1. `ReleasePublished` इवेंट मौजूद है और इसे एक कुंजी द्वारा हस्ताक्षरित किया गया है जो **उस रिपॉजिटरी की अपनी** `node.json` में पंजीकृत है - किसी भिन्न रिपॉजिटरी में पंजीकृत कुंजी इसका सत्यापन नहीं कर सकती।
2. रिपॉजिटरी का ट्रस्ट प्रोफाइल संतुष्ट है: प्रत्येक प्रोफाइल-आवश्यक प्रमाणन (एसबीओएम, उत्पत्ति, लाइसेंस, सुरक्षा) मौजूद है, एक विश्वसनीय प्रमाणीकरणकर्ता द्वारा हस्ताक्षरित है, और इसका नवीनतम परिणाम `पास` है, जिसमें कम से कम एक **स्वतंत्र** प्रमाणीकरणकर्ता होना चाहिए। केवल स्व-हस्ताक्षर और कोई स्वतंत्र प्रमाणन न होने वाली रिलीज़ `अमान्य` रिपोर्ट करती है, कभी भी `पास` नहीं।
3. `--एन्कोर्ड` के साथ: विभाजन की मर्कल रूट को पुनर्गणना करके मेनिफेस्ट से मिलान किया जाता है, और - जब नेटवर्क पहुंच योग्य होता है - ऑन-चेन एक्सआरपीएल लेनदेन प्राप्त किया जाता है और इसकी पुष्टि की जाती है (`मान्य` + `tesSUCCESS`, हस्ताक्षर करने वाला खाता विश्वसनीय-एंकर अनुमति सूची में है, और ऑन-चेन मेमो स्थानीय रूट/मेनिफेस्ट-हैश/गणना से बंधा हुआ है)। ऑफ़लाइन होने पर, यह एक नकली लेनदेन के बजाय `एक्सआरपीएल सत्यापित नहीं` रिपोर्ट करता है; सख्त `--एन्कोर्ड` तब विफल हो जाता है (स्थानीय रूप से सत्यापित मेनिफेस्ट को ऑन-चेन प्रमाण के बिना स्वीकार करने के लिए `--एन्कोर्ड-या-स्थानीय` का उपयोग करें)।

सीआई गेट्स के लिए, `--फॉर्मेट <टेक्स्ट|जेसन|एसएआरआईएफ|मार्कडाउन>` के साथ एक आउटपुट प्रारूप चुनें (`--जेसन` `--फॉर्मेट जेसन` का उपनाम है):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**निकास कोड** त्रि-अवस्था वाले निर्णय से प्राप्त होता है, इसलिए सीआई चरण सीधे इस पर गेट लगा सकता है:

| निकलें | निर्णय | अर्थ |
|------|---------|---------|
| `0` | पास | प्रामाणिक और सुनिश्चित (या `--फेल-ऑन=फेल` द्वारा आराम करने पर अमान्य)। |
| `1` | असफल | कठिन विफलता - जाली/गलत-रिपॉजिटरी हस्ताक्षर, गैर-अनुमत प्रमाणीकरणकर्ता, या एक आवश्यक जांच विफल। |
| `3` | अमान्य | नरम - अभी तक एंकर नहीं किया गया, कोई स्वतंत्र गवाह नहीं, या एक आवश्यक जांच गायब है। |
| `2` | — | उपयोग त्रुटि या आंतरिक दुर्घटना। |

`--फेल-ऑन <फेल|अमान्य>` कठोरता निर्धारित करता है। डिफ़ॉल्ट `अमान्य` विफल और अमान्य दोनों पर विफल हो जाता है; `--फेल-ऑन=फेल` अमान्य को पारित करने देता है (चेतावनी के साथ 0 से बाहर निकलें) चेतावनी-मोड अपनाने के लिए।

एक ही लेजर लोड में एक पूरे बैच को `वेरीफाई-ऑल` के साथ सत्यापित करें, और `--स्थानीय` के साथ स्थानीय क्लोन के विरुद्ध ऑफ़लाइन सत्यापित करें:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**इसे सीआई में गेट करें** बंडल किए गए कंपोजिट एक्शन के साथ - [गिटहब एक्शन का उपयोग करना](docs/verification.md#using-the-github-action) देखें:

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

पूर्ण सत्यापन मार्गदर्शिका, खतरे के मॉडल और प्रमुख अवधारणाओं के लिए [docs/verification.md](docs/verification.md) देखें।

### इसे एक लाइब्रेरी के रूप में उपयोग करें

सत्यापन इंजन को एक स्थिर प्रोग्रामेटिक API के रूप में निर्यात किया जाता है - इसे अपने स्वयं के टूलिंग में एम्बेड करें, CLI पर शेल करने के बजाय:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### नेटवर्क स्थिति समापन बिंदु

डैशबोर्ड एक मशीन-पठनीय [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) प्रकाशित करता है, जिसका उपयोग बाहरी पोलिंग के लिए किया जा सकता है - लेज़र ताजगी (एक जमे हुए-लेज़र संकेत के साथ), विश्वास-निर्णय गणनाएँ, एंकर बनाम लंबित विभाजन, और एक `ok`/`degraded` रोलअप जिसमें कारण शामिल हैं।

### ट्रस्ट बैज

रिपॉजिटरी रजिस्ट्री से ट्रस्ट बैज एम्बेड कर सकते हैं:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## विश्वास और सत्यापन

### एक रिलीज़ सत्यापित करें

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### एक रिलीज़ को प्रमाणित करें

> प्रमाणीकरण करना और सत्यापनकर्ता चलाना **ऑपरेटर** कार्य हैं जो इस लेजर के क्लोन पर काम करते हैं, इसलिए वे एक चेकआउट से चलते हैं। किसी रिलीज़ को सत्यापित करने की आवश्यकता नहीं है - उपरोक्त `एनपीएक्स` कमांड का उपयोग करें।

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

जांच: `sbom.present`, `provenance.present`, `signature.chain`

### सत्यापनकर्ता चलाएं

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

सुरक्षा सत्यापनकर्ता सीमाएँ (अधिकतम सीवीई, अनुमत गंभीरता) को `verifiers/security/config.json` के माध्यम से कॉन्फ़िगर किया जाता है।

### नीति जांच चलाएं

```bash
node policy/scripts/check-policy.mjs
```

जांच: सेमवर मोनोटोनिसिटी, कलाकृति हैश विशिष्टता, आवश्यक क्षमताएँ।

## सुरक्षा और खतरे का मॉडल

RepoMesh **लेज़र इवेंट** (हस्ताक्षरित JSON), **नोड मैनिफ़ेस्ट** (सार्वजनिक कुंजियाँ + क्षमताएँ), **रजिस्ट्री इंडेक्स** (स्वचालित रूप से उत्पन्न विश्वास स्कोर), और **XRPL टेस्टनेट** (एंकर लेनदेन) को प्रभावित करता है। यह सदस्य रिपॉजिटरी स्रोत कोड, निजी कुंजियों, उपयोगकर्ता क्रेडेंशियल्स या ब्राउज़िंग डेटा को प्रभावित नहीं करता है। निजी हस्ताक्षर कुंजियाँ कभी भी CI रनर को नहीं छोड़ती हैं। नेटवर्क एक्सेस GitHub API (PR निर्माण), XRPL टेस्टनेट (एंकरिंग) और OSV.dev (भेद्यता लुकअप) तक सीमित है। कोई टेलीमेट्री एकत्र या भेजी नहीं जाती है - शून्य विश्लेषण, शून्य क्रैश रिपोर्ट, शून्य फोन-होम। पूर्ण दायरे, आवश्यक अनुमतियों और भेद्यता रिपोर्टिंग प्रक्रिया के लिए [SECURITY.md](SECURITY.md) देखें, और कुंजी-जीवनचक्र विश्वास सीमा (क्यों `node.json` की प्रामाणिकता इसके स्रोत पर निर्भर करती है, और क्यों निरसन-संवेदनशील सत्यापन को `--anchored` का उपयोग करना चाहिए) के लिए [खतरा मॉडल](docs/threat-model.md)।

मजबूत बनाना:

- चर डेटा को इंटरपोलेट करने वाले चाइल्ड-प्रोसेस कॉल `execFileSync` का उपयोग करते हैं जिसमें सरणी तर्क होते हैं; शेष `execSync` कॉल स्थिर, निरंतर कमांड स्ट्रिंग का उपयोग करते हैं - कोई शेल-इंजेक्शन वेक्टर नहीं।
- लेजर और रजिस्ट्री JSON को संरचित, पंक्ति-संख्या वाली त्रुटियों के साथ `try`/`catch` के अंदर पार्स किया जाता है; एक गलत पंक्ति को छोड़ दिया जाता है और प्रदर्शित किया जाता है, उपकरण को कच्चे स्टैक के साथ दुर्घटनाग्रस्त नहीं करता है।
- सभी फ़ाइल संचालन पर पथ ट्रैवर्सल को रोका जाता है (रिज़ॉल्व + सीमा जांच)।
- पूरे में ReDoS-सुरक्षित पार्सिंग (असीमित रेगुलर एक्सप्रेशन नहीं)।
- पीईएम निजी कुंजियों को `.gitignore` के माध्यम से बाहर रखा गया है, कभी भी stdout या सीआई लॉग पर मुद्रित नहीं किया जाता है, और मालिक-केवल (`0600`) अनुमतियों के साथ लिखा जाता है।

## परीक्षण

पूर्ण `नोड --टेस्ट` सूट Ed25519 हस्ताक्षर, स्कीमा सत्यापन, मर्कल ट्री अखंडता (v1 + RFC-6962 v2), केवल-अतिरिक्त अपरिवर्तनीयता, पथ ट्रैवर्सल रोकथाम, एंकर सत्यापन, विश्वसनीय-प्रमाणीकरणकर्ता अनुमति सूची और सीएलआई, लेजर, एंकर, सत्यापनकर्ता और उपकरण परतों में इनपुट सत्यापन को कवर करता है।

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

परीक्षण गणना तब बढ़ती है जब सूट जोड़े जाते हैं - वर्तमान कुल के लिए उपरोक्त कमांड चलाएं बजाय एक ऐसे नंबर पर निर्भर रहने के जो पुराना हो जाता है।

## लाइसेंस

एमआईटी

---

<a href="https://mcp-tool-shop.github.io/">एमसीपी टूल शॉप</a> द्वारा निर्मित
