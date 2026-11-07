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

एक रिपो नेटवर्क के लिए रिलीज़ लेज़र और एक्सआरपीएल-आधारित ट्रस्ट क्लॉक: हस्ताक्षरित इवेंट, नोड मेनिफेस्ट और सत्यापन। एटटेस्टिया के इवेंट स्टोर से अलग।

## सिस्टम में रखें।

एटटेस्टिया, कॉग्नेट और RepoMesh, ये तीन उत्पाद हैं।

**RepoMesh** रिलीज़ नेटवर्क है: इसमें हस्ताक्षरित इवेंट, नोड मेनिफ़ेस्ट और एक्सआरपीएल-आधारित ट्रस्ट क्लॉक शामिल हैं। यह अपना स्वयं का आरएफसी 6962 लेज़र रखता है।

**एटटेस्टिया** यह साबित करता है कि कोई घटना, लेनदेन या स्थिति परिवर्तन हुआ, और उस प्रमाण को एक श्रृंखला से जोड़ता है। इसका मुख्य क्षेत्र वित्तीय सत्य है: व्यक्तिगत तिजोरी, संगठनात्मक खजाना और रजिस्टर। इसके मर्कल प्रमाण इस खाते की जानकारी नहीं हैं।

**कॉग्नेट** एटेस्टिया के इवेंट स्टोर और मर्कल प्रूफ पर आधारित एआई शासन डोमेन है। जब इसे किसी रिलीज़ की जांच करने की आवश्यकता होती है, तो यह RepoMesh को कॉल करता है। यह दूसरा इवेंट स्टोर नहीं रखता है, और यह इस नेटवर्क के लिए एटेस्टिया के मर्कल ट्री का उपयोग नहीं करता है।

## संस्करण 2.4 और 2.5 में क्या नया है?

**संस्करण 2.5.1**

- **2.5.1: सत्यापन को अधिक सुरक्षित बनाना।** जब कोई सत्यापनकर्ता एक ही जाँच के लिए एक से अधिक परिणाम पर हस्ताक्षर करता है, तो अब प्रत्येक उपभोक्ता लेज़र स्थिति के आधार पर नवीनतम परिणाम का चयन करता है, न कि हस्ताक्षरकर्ता के अपने टाइमस्टैम्प के आधार पर। यदि कोई `verifier.policy.json` गायब है या गलत है, तो वह अब विफल हो जाएगा, और नीति द्वारा अज्ञात किसी भी जाँच प्रकार को हर मोड में बंद माना जाएगा।

- **2.5.0: एंकर पोस्टिंग विफल होने पर बंद हो जाती है।** `post-anchor.mjs` पोस्ट करने से इनकार करता है, और कोई कनेक्शन नहीं खोलता, जब तक कि कॉन्फ़िगरेशन में `testnet` न कहा गया हो और WebSocket यूआरएल एक ज्ञात टेस्टनेट एंडपॉइंट न हो। केवल एक पर्यावरण चर पोस्टिंग को मेननेट पर स्विच नहीं कर सकता। [एक्सआरपीएल एंकरिंग (टेस्टनेट गार्ड)](#xrpl-एंकरिंग-टेस्टनेट-गार्ड) देखें।
- **2.5.0: एक आवश्यक परीक्षण गेट।** प्रत्येक पुल अनुरोध 9 `node --test` सुइट्स को लाइन-कवरेज सीमा और `high` पर एक उत्पादन `npm audit` के साथ चलाता है। `main` पर `validate-ledger` और `test` आवश्यक जांच हैं, और `registry-ci.yml` अब केवल `main` पर `ledger-ci` के सफल होने के बाद ही चलता है।
- **2.4.0: कॉग्नेट से सत्यापन चलाएं।** लेज़र तीन नए सत्यापन प्रकार, `run.preregistered`, `run.outcome` और `cognate.root.anchored` स्वीकार करता है, जिनमें से प्रत्येक में `sha256` डाइजेस्ट और `urn:cognate:...` यूआरआई होता है। केवल `trustedAttestors` और `trustedRunAttestors` (आज, `mcp-tool-shop-org/cognate`) दोनों पर एक `governance` नोड ही उन्हें साइन कर सकता है, और यह कुछ और साइन नहीं कर सकता। प्रत्येक `run.outcome` को लेज़र पर पहले से मौजूद `run.preregistered` घटना का संदर्भ देना चाहिए।
- **2.4.0: हस्ताक्षर अनुबंध की जांच की जाती है।** `canonicalHash` के 32 कच्चे बाइट्स पर एक Ed25519 हस्ताक्षर होना चाहिए। सत्यापनकर्ता उन हस्ताक्षरों को अस्वीकार कर देता है जो विहित JSON टेक्स्ट या 64-वर्ण हेक्स स्ट्रिंग पर किए गए हैं।

पूरी सूची के लिए [CHANGELOG.md] CHANGELOG.md देखें।

## यह क्या है?

RepoMesh रिपॉजिटरीज़ के संग्रह को एक सहयोगी नेटवर्क में बदल देता है। प्रत्येक रिपॉजिटरी एक **नोड** होता है, जिसमें:

- एक **मैनिफेस्ट** (`node.json`) जो यह बताता है कि यह क्या प्रदान करता है और क्या उपयोग करता है।
- **हस्ताक्षरित इवेंट** जो केवल-जोड़ने योग्य लेज़र में प्रसारित किए जाते हैं।
- एक **रजिस्ट्री** जो सभी नोड्स और क्षमताओं को सूचीबद्ध करती है।
- एक **प्रोफ़ाइल** जो यह परिभाषित करती है कि "पूर्ण" होने का अर्थ विश्वास के संदर्भ में क्या है।

Today one GitHub organization, mcp-tool-shop-org, operates the log, the attestors, the policy check, and the XRPL anchor. Seven registered nodes do not make seven operators. An independent witness would be a party this organization does not operate.

यह नेटवर्क तीन नियमों का पालन करता है:

1. **निश्चित परिणाम** – समान इनपुट, समान आउटपुट
2. **सत्यापित उत्पत्ति** – प्रत्येक संस्करण पर हस्ताक्षर किए जाते हैं और इसकी पुष्टि की जाती है
3. **संयोजनीय अनुबंध** – इंटरफेस का संस्करण निर्धारित होता है और यह मशीन द्वारा पठनीय होता है

## त्वरित शुरुआत (1 कमांड + 2 गुप्त कोड)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

यह वह सब कुछ उत्पन्न करता है जिसकी आपको आवश्यकता है:
- `node.json` — आपका नोड मेनिफ़ेस्ट
- `repomesh.profile.json` — आपके द्वारा चुना गया प्रोफ़ाइल
- `.github/workflows/repomesh-broadcast.yml` — रिलीज़ प्रसारण वर्कफ़्लो
- Ed25519 — हस्ताक्षर कुंजी जोड़ी (निजी कुंजी स्थानीय रूप से रहती है)

फिर अपनी रिपॉजिटरी में दो गुप्त कोड जोड़ें:
1. `REPOMESH_SIGNING_KEY` — आपकी निजी कुंजी PEM (जिसे ‘इनिट’ द्वारा मुद्रित किया गया है)
2. `REPOMESH_LEDGER_TOKEN` — GitHub पीएटी, जिसमें `contents:write` + `pull-requests:write` इस रिपॉजिटरी पर लागू हों।

रिलीज़ करें। विश्वास स्वचालित रूप से स्थापित हो जाएगा।

### सीएलआई ध्वज/विकल्प

सभी आदेश निम्नलिखित स्वीकार करते हैं: `--quiet`, `--verbose`, `--debug`, `--no-color`। `init` आदेश मशीन-पठनीय आउटपुट के लिए `--json` का भी समर्थन करता है।

शेल के लिए ऑटो-कंप्लीशन सुविधाएँ उपलब्ध हैं:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### पर्यावरण संबंधी प्राथमिकताएँ

| परिवर्तनशील | उद्देश्य |
|----------|---------|
| `REPOMESH_LEDGER_URL` | लेज़र एंडपॉइंट को बदलें। |
| `REPOMESH_MANIFESTS_URL` | मैनिफेस्ट एंडपॉइंट को बदलें। |
| `REPOMESH_FETCH_TIMEOUT` | मिलीसेकंड में फ़ेच टाइमआउट। |

### प्रोफ़ाइलें

| प्रोफ़ाइल | सबूत | गुणवत्ता जाँच। | इसका उपयोग कब करें। |
|---------|----------|-----------------|----------|
| `baseline` | वैकल्पिक | किसी की आवश्यकता नहीं है। | आंतरिक उपकरण, प्रयोग |
| `open-source` | सॉफ्टवेयर सामग्री बिल + उत्पत्ति | लाइसेंस ऑडिट + सुरक्षा जांच | ओ.एस.एस. के लिए डिफ़ॉल्ट सेटिंग। |
| `regulated` | सॉफ्टवेयर सामग्री बिल + उत्पत्ति | लाइसेंस + सुरक्षा + पुनरुत्पादनीयता | अनुपालन के लिए अत्यंत महत्वपूर्ण। |

### विश्वसनीयता की जाँच करें।

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

इसमें ईमानदारी का स्कोर, आश्वासन का स्कोर और प्रोफ़ाइल के आधार पर दिए गए सुझाव शामिल हैं।

### अधिलेखन

प्रत्येक रिपॉजिटरी के लिए, रिपॉजिटरी को फोर्क किए बिना अनुकूलन:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## रिपॉजिटरी संरचना

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

### 1. अपना नोड मेनिफ़ेस्ट बनाएं।

अपने रिपॉजिटरी की रूट निर्देशिका में `node.json` जोड़ें:

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

### 2. एक हस्ताक्षर कुंजी-युग्म उत्पन्न करें।

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` सार्वजनिक कुंजी और एक `keyId` प्रिंट करता है, जिसे आप अपने `node.json` मेंटेनर्स एंट्री में डाल सकते हैं, और
निजी कुंजी (मोड 0600) केवल उसी स्थान पर लिखता है, जहाँ आप `--out` निर्दिष्ट करते हैं—कभी भी किसी ट्रैक किए गए पाथ पर नहीं। इसे एक GitHub रिपो सीक्रेट (`REPOMESH_SIGNING_KEY`) के रूप में संग्रहीत करें। (हाथ से करने पर: `openssl genpkey -algorithm ED25519 ...`)।

> **किसी महत्वपूर्ण नोड के लिए कम से कम 2 कुंजियाँ पंजीकृत करें** (टीयूएफ §6.1): एक अकेली कुंजी अपनी स्वयं की अमान्यता पर हस्ताक्षर नहीं कर सकती है यदि वह समझौता कर ली गई हो। `repomesh init --second-key` एक अलग दूसरी रखरखाव कुंजी पंजीकृत करता है ताकि एक कुंजी दूसरी कुंजी को अमान्य कर सके — `init` चेतावनी देता है जब किसी नोड में केवल एक सक्रिय कुंजी होती है।

### 3. नेटवर्क में पंजीकरण करें।

इस रिपॉजिटरी में अपना नोड मेनिफेस्ट जोड़ते हुए एक पुल रिक्वेस्ट खोलें।

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. प्रसारण प्रक्रिया जोड़ें।

`templates/repomesh-broadcast.yml` को अपने रिपॉजिटरी के `.github/workflows/` में कॉपी करें।
`REPOMESH_LEDGER_TOKEN` सीक्रेट सेट करें (यह रिपॉजिटरी पर सामग्री लिखने और पुल अनुरोधों को प्रबंधित करने की अनुमति वाला एक विस्तृत PAT है)।

प्रत्येक रिलीज़ अब स्वचालित रूप से एक हस्ताक्षरित `ReleasePublished` इवेंट को लेज़र पर प्रसारित करेगी।

## लेज़र नियम

- **केवल-जोड़ें** - मौजूदा पंक्तियाँ अपरिवर्तनीय हैं
- **स्कीमा-मान्य** - प्रत्येक इवेंट `schemas/event.schema.json` के विरुद्ध मान्य होता है
- **हस्ताक्षर-मान्य** - प्रत्येक इवेंट एक पंजीकृत नोड रखरखावकर्ता द्वारा हस्ताक्षरित होता है
- **अद्वितीय** - कोई डुप्लिकेट `(repo, version, type)` प्रविष्टियाँ नहीं
- **टाइमस्टैम्प-तार्किक** - भविष्य में 1 घंटे या अतीत में 1 वर्ष से अधिक नहीं

## इवेंट प्रकार

लेज़र वर्तमान में नीचे दिए गए **लाइव** इवेंट प्रकारों को उत्सर्जित करता है। बाकी **आरक्षित / नियोजित** हैं - स्कीमा उन्हें स्वीकार करता है, लेकिन अभी तक कोई भी नोड उन्हें उत्सर्जित नहीं करता है। हम उन्हें सूचीबद्ध करते हैं ताकि रोडमैप दिखाई दे, बिना किसी ऐसे कवरेज का संकेत दिए जो मौजूद नहीं है (एक विश्वसनीय उत्पाद के लिए ईमानदारी)।

**लाइव (आज उत्सर्जित):**

| प्रकार | कब |
|------|------|
| `ReleasePublished` | एक नया संस्करण जारी किया गया है |
| `AttestationPublished` | एक एटेस्टर एक रिलीज़ को सत्यापित करता है |
| `ledger.anchor` | एंकर नोड एक विभाजन को सील करता है (मर्केल रूट + एक्सआरपीएल मेमो) |
| `attestation.dispute` | एक विश्वसनीय नोड एक एटेस्टेशन का विरोध करता है (निर्णय को कम करता है) |
| `KeyRotation` | एक रखरखाव कुंजी को एक उत्तराधिकारी में घुमाया जाता है (संभावित - पिछले हस्ताक्षर मान्य रहते हैं) |
| `KeyRevocation` | एक रखरखाव कुंजी को रद्द कर दिया जाता है (समझौता = पिछली अमान्यता, RFC 5280) |

`AttestationPublished` में कोग्नेट के रन एटेस्टेशन (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, 2.4.0 से) भी होते हैं, जो केवल इसके `governance` नोड द्वारा हस्ताक्षरित होते हैं।

**आरक्षित / नियोजित (अभी तक उत्सर्जित नहीं):**

| प्रकार | उद्देशित अर्थ |
|------|------------------|
| `BreakingChangeDetected` | एक ब्रेकिंग परिवर्तन पेश किया गया है |
| `HealthCheckFailed` | एक नोड अपने स्वयं के स्वास्थ्य जांच में विफल रहता है |
| `DependencyVulnFound` | निर्भरताओं में एक भेद्यता पाई जाती है |
| `InterfaceUpdated` | एक इंटरफ़ेस स्कीमा बदलता है |
| `PolicyViolation` | एक नेटवर्क नीति का उल्लंघन किया जाता है। `policy/scripts/check-policy.mjs` एक बना सकता है और उस पर हस्ताक्षर कर सकता है; अभी तक कोई भी लेज़र पर नहीं है |

## कुंजी रोटेशन और निरसन

रखरखाव कुंजियों का एक जीवनचक्र होता है। एक कुंजी को एक उत्तराधिकारी में **घुमाया** या **रद्द** किया जा सकता है, और सत्यापन **समय-जागरूक** है: एक हस्ताक्षर पर तभी भरोसा किया जाता है जब कुंजी हस्ताक्षर के विश्वसनीय समय पर मान्य हो - एक्सआरपीएल एंकर क्लोज-टाइम, वही विश्वसनीय घड़ी जिसका लेज़र पहले से उपयोग करता है।

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
- कोई भी **जीवनचक्र** फ़ील्ड वाली कुंजी को पिछली पीढ़ी की माना जाता है (हमेशा मान्य), इसलिए मौजूदा नोड अपरिवर्तित रूप से सत्यापित करते हैं।
- निरसन हस्ताक्षरित `KeyRevocation` इवेंट हैं; एक एकल-कुंजी नोड जिसकी एकमात्र कुंजी से समझौता किया गया है, उसे **शासन** (`trustedPolicy`) नोड द्वारा निरसन पर हस्ताक्षर करके पुनर्प्राप्त किया जाता है। विश्वास-महत्वपूर्ण नोड्स को **≥2 कुंजियाँ** पंजीकृत करनी चाहिए (टीयूएफ §6.1)।
- एक छेड़छाड़ किए गए `node.json` के खिलाफ भी, एक निरसन को हस्ताक्षरित, एक्सआरपीएल-एन्कर किए गए इवेंट से फिर से लागू किया जाता है - एक स्ट्रिप्ड मैनिफ़ेस्ट रद्द की गई कुंजी को पुनर्जीवित नहीं कर सकता है। [खतरा मॉडल](docs/threat-model.md) देखें सीमा के लिए (मानक लेज़र के विरुद्ध सत्यापित करें; निरसन-संवेदनशील जांच के लिए `--anchored` का उपयोग करें)।

## नोड प्रकार

| प्रकार | भूमिका |
|------|------|
| `registry` | नोड्स और क्षमताओं को अनुक्रमित करता है |
| `attestor` | दावों को सत्यापित करता है (बिल्ड, अनुपालन) |
| `policy` | नियमों को लागू करता है (स्कोरिंग, गेटिंग) |
| `oracle` | बाहरी डेटा प्रदान करता है |
| `compute` | काम करता है (परिवर्तित करता है, बनाता है) |
| `settlement` | अवस्था को अंतिम रूप देता है |
| `governance` | निर्णय लेता है; 2.4.0 से, कोग्नेट के रन एटेस्टेशन पर हस्ताक्षर करता है और कुछ और नहीं |
| `identity` | क्रेडेंशियल्स जारी करता है/सत्यापित करता है |

## नेटवर्क का विस्तार - सत्यापनकर्ता-प्लगइन अनुबंध

नए **जांच प्रकार** और **सत्यापनकर्ता नोड** डेटा को संपादित करके जोड़े जाते हैं, कोड से नहीं। जांच-प्रकार रजिस्ट्री, स्कोरिंग भार और नोड-प्रकार अनुमतियाँ [`verifier.policy.json`](verifier.policy.json) में हैं (स्कीमा-मान्य, विफल-बंद)। एक जांच जोड़ना (जैसे `sast.scan`) लगभग 6-पंक्ति नीति संपादन + एक `node.json` है, जिसे पीआर में समीक्षा की जाती है - कोई कोड परिवर्तन नहीं।

एक अपरिवर्तनीय: **पंजीकृत ≠ विश्वसनीय।** पंजीकरण एक जांच को भाग लेने देता है; क्रेडिट के लिए अभी भी एक विश्वसनीय-सेट सर्वसम्मति पास की आवश्यकता होती है। पूर्ण मार्गदर्शिका: [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md)।

## सार्वजनिक सत्यापन

कोई भी एक कमांड के साथ एक रिलीज़ को सत्यापित कर सकता है - **किसी क्लोन की आवश्यकता नहीं है**, सीएलआई आपके लिए सार्वजनिक लेज़र प्राप्त करता है:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

यह जांचता है:
1. `ReleasePublished` इवेंट मौजूद है और उस रेपो के **अपने** `node.json` से पंजीकृत कुंजी द्वारा हस्ताक्षरित है (Ed25519) - किसी भिन्न रेपो से पंजीकृत कुंजी इसे मान्य नहीं कर सकती है।
2. रेपो की विश्वास प्रोफ़ाइल संतुष्ट है: प्रोफ़ाइल-आवश्यक एटेस्टेशन (एसबीओएम, उत्पत्ति, लाइसेंस, सुरक्षा) में से प्रत्येक मौजूद है, एक विश्वसनीय एटेस्टर द्वारा हस्ताक्षरित है, और लेज़र स्थिति द्वारा इसका नवीनतम परिणाम `pass` है (`(check, signer)` के अनुसार, अधिक लेज़र सूचकांक पर इवेंट जीतता है; हस्ताक्षरकर्ता का टाइमस्टैम्प केवल डेटा है), जिसमें कम से कम एक **स्वतंत्र** एटेस्टर है। केवल एक स्व-हस्ताक्षर और कोई स्वतंत्र एटेस्टेशन वाला रिलीज़ `UNVERIFIED`, कभी भी `PASS` रिपोर्ट करता है।
3. `--anchored` के साथ: विभाजन के मर्केल रूट की पुनर्गणना की जाती है और इसे मैनिफ़ेस्ट से मिलाया जाता है, और - जब नेटवर्क पहुंच योग्य होता है - ऑन-चेन एक्सआरपीएल लेनदेन प्राप्त किया जाता है और दावा किया जाता है (`validated` + `tesSUCCESS`, हस्ताक्षर करने वाला खाता विश्वसनीय-एंकर अनुमति सूची में है, और ऑन-चेन मेमो स्थानीय रूट/मैनिफेस्ट-हैश/गणना से बंधा है)। ऑफ़लाइन, यह `XRPL NOT verified` की रिपोर्ट करता है, न कि एक नकली लेनदेन; सख्त `--anchored` तब विफल हो जाता है (स्थानीय रूप से सत्यापित मैनिफ़ेस्ट को ऑन-चेन प्रमाण के बिना स्वीकार करने के लिए `--anchored-or-local` का उपयोग करें)।

सीआई गेट्स के लिए, `--format <text|json|sarif|markdown>` (`--json` एक उपनाम है `--format json` के लिए) के साथ एक आउटपुट प्रारूप चुनें:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

**निकास कोड** को त्रि-अवस्था वाले निर्णय से प्राप्त किया जाता है, इसलिए एक सीआई चरण सीधे उस पर गेट कर सकता है:

| निकास | निर्णय | अर्थ |
|------|---------|---------|
| `0` | पास | प्रामाणिक और सुनिश्चित (या `--fail-on=fail` द्वारा आराम करने पर अपरिवर्तित)। |
| `1` | विफल | गंभीर विफलता — जाली/गलत-रिपॉजिटरी हस्ताक्षर, गैर-अनुमत एटेस्टर, या आवश्यक जांच विफल। |
| `3` | अपरमाणित | हल्की — अभी तक एंकर नहीं किया गया, कोई स्वतंत्र गवाह नहीं, या आवश्यक जांच गायब। |
| `2` | — | उपयोग त्रुटि या आंतरिक क्रैश। |

### कंटेनर

उसी CLI को `ghcr.io/mcp-tool-shop-org/repomesh` के रूप में प्रकाशित किया गया है, जिस पर npm संस्करण और git sha टैग किया गया है। छवि एक गैर-रूट उपयोगकर्ता के रूप में चलती है। इसमें वॉलेट सीड शामिल नहीं है।

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

एक एंकर पोस्ट करना एक अलग कमांड है। `XRPL_SEED` रनटाइम पर पास किया जाता है:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

दैनिक वर्कफ़्लो इस छवि को चेकआउट से बनाता है और उसके साथ पोस्ट करता है।

### XRPL एंकरिंग (टेस्टनेट गार्ड)

`anchor/xrpl/config.json` में एंकरिंग केवल **टेस्टनेट** के लिए है (`"network": "testnet"`)। `anchor/xrpl/scripts/post-anchor.mjs` `XRPL_SEED` को मान्य करने या `xrpl.Client` बनाने से पहले एक विफल-बंद एंडपॉइंट गार्ड (`assertPostingEndpoint`) लागू करता है:

- **डिफ़ॉल्ट टेस्टनेट जांच:** पोस्टिंग को अस्वीकार कर दिया जाता है (गैर-शून्य एग्जिट, कोई सॉकेट नहीं खोला गया) जब तक कि `config.network === "testnet"` **और** रिज़ॉल्व किया गया WebSocket URL (`process.env.XRPL_WS_URL || config.rippledUrl`) `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`) में न हो। `XRPL_WS_URL` को मेननेट या अज्ञात URL पर सेट करने से तुरंत एक संदेश के साथ अस्वीकार कर दिया जाता है जिसमें रिज़ॉल्व किए गए नेटवर्क और रिज़ॉल्व किए गए URL दोनों का नाम बताया गया हो।
- **मेननेट ऑप्ट-इन (अक्षम):** केवल एक पर्यावरण चर पोस्टिंग को मेननेट पर स्विच नहीं कर सकता है। मेननेट में ऑप्ट-इन करने के लिए `anchor/xrpl/config.json` में एक समीक्षा किए गए कमिट की आवश्यकता होती है जो `"network": "mainnet"`, `"allowMainnetPosting": true` और `"mainnetAllowedEndpoints": ["wss://..."]` को सेट करता है, जिसमें लक्ष्य `wss://` एंडपॉइंट होता है, शिप किए गए अनुमति सूची छत (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`) में वित्त पोषित मेननेट क्लासिक पते को जोड़ने के बाद। वह अनुमति सूची एक छत है: एक प्राप्त कॉन्फ़िगरेशन एक खाते को हटा सकता है और एक नहीं जोड़ सकता है।

`--fail-on <fail\|unverified>` कठोरता निर्धारित करता है। डिफ़ॉल्ट `unverified` FAIL और UNVERIFIED दोनों पर विफल रहता है; `--fail-on=fail` UNVERIFIED को पास करने देता है (चेतावनी के साथ एग्जिट 0) चेतावनी-मोड अपनाने के लिए।

`verify-all` के साथ एक ही लेजर लोड में एक पूरे बैच को सत्यापित करें, और स्थानीय क्लोन के विरुद्ध ऑफ़लाइन सत्यापित करें `--local` के साथ:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

बंडल किए गए कंपोजिट एक्शन के साथ **इसे CI में गेट करें** — देखें
[GitHub एक्शन का उपयोग करना](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

पूर्ण सत्यापन मार्गदर्शिका, खतरे के मॉडल और प्रमुख अवधारणाओं के लिए [docs/verification.md](docs/verification.md) देखें।

### इसे एक लाइब्रेरी के रूप में उपयोग करें

सत्यापन इंजन को एक स्थिर प्रोग्रामेटिक API के रूप में निर्यात किया जाता है — इसे अपनी स्वयं की टूलिंग में एम्बेड करें CLI पर शेलिंग करने के बजाय:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### नेटवर्क स्थिति एंडपॉइंट

डैशबोर्ड एक मशीन-पठनीय [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) प्रकाशित करता है
बाहरी पोलिंग के लिए — लेजर ताजगी (एक जमे हुए-लेजर संकेत के साथ), ट्रस्ट-निर्णय गणना, एंकर किए गए बनाम लंबित विभाजन, और एक `ok`/`degraded` रोलअप जिसमें कारण शामिल हैं।

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

> प्रमाणित करना और सत्यापनकर्ता चलाना **ऑपरेटर** कार्य हैं जो इस लेजर के क्लोन पर कार्य करते हैं, इसलिए वे चेकआउट से चलते हैं। एक रिलीज़ को सत्यापित करने से ऐसा नहीं होता है — ऊपर दिए गए `npx` कमांड का उपयोग करें।

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

सुरक्षा सत्यापनकर्ता सीमाएँ (अधिकतम CVE, अनुमत गंभीरता) `verifiers/security/config.json` के माध्यम से कॉन्फ़िगर-संचालित हैं।

### नीति जांच चलाएं

```bash
node policy/scripts/check-policy.mjs
```

जांच: सेम्वर मोनोटोनिसिटी, कलाकृति हैश विशिष्टता, आवश्यक क्षमताएं।

## सुरक्षा और खतरे का मॉडल

RepoMesh **लेजर घटनाओं** (हस्ताक्षरित JSON), **नोड मेनिफेस्ट** (सार्वजनिक कुंजियाँ + क्षमताएं), **रजिस्ट्री इंडेक्स** (स्वचालित रूप से उत्पन्न ट्रस्ट स्कोर), और **XRPL टेस्टनेट** (एंकर लेनदेन; पोस्टिंग किसी भी ऐसे एंडपॉइंट को अस्वीकार कर देता है जो ज्ञात टेस्टनेट नहीं है) को छूता है। यह सदस्य रिपॉजिटरी स्रोत कोड, निजी कुंजियों, उपयोगकर्ता क्रेडेंशियल्स या ब्राउज़िंग डेटा को **नहीं** छूता है। निजी हस्ताक्षर कुंजियाँ कभी भी CI रनर को नहीं छोड़ती हैं। नेटवर्क एक्सेस GitHub API (PR निर्माण), XRPL टेस्टनेट (एंकरिंग) और OSV.dev (भेद्यता लुकअप) तक सीमित है। **कोई टेलीमेट्री** एकत्र या नहीं भेजी जाती है — शून्य एनालिटिक्स, शून्य क्रैश रिपोर्ट, शून्य फोन-होम। पूर्ण दायरे, आवश्यक अनुमतियों और भेद्यता रिपोर्टिंग प्रक्रिया के लिए [SECURITY.md](SECURITY.md) देखें, और कुंजी-जीवनचक्र ट्रस्ट सीमा (क्यों `node.json` प्रामाणिकता इसके स्रोत पर निर्भर करती है, और क्यों पुनरावृत्ति-संवेदनशील सत्यापन को `--anchored` का उपयोग करना चाहिए) के लिए [खतरे का मॉडल](docs/threat-model.md)।

मजबूत बनाना:

- चर डेटा को इंटरपोलेट करने वाले चाइल्ड-प्रोसेस कॉल `execFileSync` का उपयोग करते हैं जिसमें सरणी तर्क होते हैं; शेष `execSync` कॉल स्थिर, निरंतर कमांड स्ट्रिंग का उपयोग करते हैं — कोई शेल-इंजेक्शन वेक्टर नहीं।
- लेजर और रजिस्ट्री JSON को संरचित, पंक्ति-संख्यांकित त्रुटियों के साथ `try`/`catch` के अंदर पार्स किया जाता है; एक गलत पंक्ति को छोड़ दिया जाता है और प्रदर्शित किया जाता है, कभी भी कच्चे स्टैक के साथ उपकरण को क्रैश नहीं करता है।
- सभी फ़ाइल संचालन पर पथ ट्रैवर्सल को रोका जाता है (रिज़ॉल्व + सीमा जांच)।
- ReDoS-सुरक्षित पार्सिंग (कोई असीमित रेगुलर एक्सप्रेशन नहीं)।
- PEM निजी कुंजियों को `.gitignore` के माध्यम से बाहर रखा जाता है, कभी भी stdout या CI लॉग में मुद्रित नहीं किया जाता है, और मालिक-केवल (`0600`) अनुमतियों के साथ लिखा जाता है।

## परीक्षण

पूर्ण `node --test` सूट Ed25519 हस्ताक्षर, स्कीमा सत्यापन, मर्कल ट्री अखंडता (v1 + RFC-6962 v2), केवल-अतिरिक्त अपरिवर्तनीय, पथ ट्रैवर्सल रोकथाम, एंकर सत्यापन, विश्वसनीय-एटेस्टर अनुमति सूची और CLI, लेजर, एंकर, सत्यापनकर्ता और उपकरण परतों में इनपुट सत्यापन को कवर करता है।

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

परीक्षणों की संख्या तब तक बढ़ती है जब तक कि सूट जोड़े जाते हैं — वर्तमान कुल के लिए ऊपर दिए गए कमांड को चलाएं, न कि किसी ऐसे नंबर पर भरोसा करें जो पुरानी हो जाती है।

CI प्रत्येक पुल अनुरोध (`ledger-ci.yml`, आवश्यक `test` जांच) पर एक ही 9 सूट चलाता है, जिसमें `--experimental-test-coverage` और एक पंक्ति-कवरेज तल (`--test-coverage-lines=57`) होता है, फिर रूट के लिए `npm audit --audit-level=high --omit=dev`, और `anchor/xrpl` और `ledger`।

## लाइसेंस

MIT

---

<a href="https://mcp-tool-shop.github.io/">MCP टूल शॉप</a> द्वारा निर्मित
