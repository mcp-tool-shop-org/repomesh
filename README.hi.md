<p align="center">
  <a href="README.md">English</a> | <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
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

सिंट्रोपिक रिपो नेटवर्क - यह एक अपेंड-ओनली लेजर, नोड मैनिफेस्ट और वितरित रिपो समन्वय के लिए स्कोरिंग सिस्टम है।

## यह क्या है?

रेपोमेश रिपो के संग्रह को एक सहयोगी नेटवर्क में बदल देता है। प्रत्येक रिपो एक **नोड** है जिसमें:

- एक **मैनिफेस्ट** (`node.json`) जो यह बताता है कि यह क्या प्रदान करता है और क्या उपयोग करता है।
- **हस्ताक्षरित घटनाएं** जो एक अपेंड-ओनली लेजर पर प्रसारित की जाती हैं।
- एक **रजिस्ट्री** जो सभी नोड्स और क्षमताओं को अनुक्रमित करती है।
- एक **प्रोफाइल** जो यह परिभाषित करती है कि "सत्यापित" का क्या अर्थ है।

यह नेटवर्क तीन बुनियादी नियमों का पालन करता है:

1. **निर्धारित आउटपुट** - समान इनपुट, समान परिणाम।
2. **सत्यापन योग्य उत्पत्ति** - प्रत्येक रिलीज़ पर हस्ताक्षर किए जाते हैं और प्रमाणित किए जाते हैं।
3. **संयोज्य अनुबंध** - इंटरफेस संस्करणित होते हैं और मशीन-पठनीय होते हैं।

## शुरुआत कैसे करें (1 कमांड + 2 गुप्त जानकारी)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

यह वह सब कुछ उत्पन्न करता है जिसकी आपको आवश्यकता है:
- `node.json` - आपका नोड मैनिफेस्ट।
- `repomesh.profile.json` - आपकी चुनी हुई प्रोफाइल।
- `.github/workflows/repomesh-broadcast.yml` - रिलीज़ प्रसारण वर्कफ़्लो।
- Ed25519 हस्ताक्षर कुंजी जोड़ी (निजी कुंजी स्थानीय रूप से रहती है)।

फिर अपने रिपो में दो गुप्त जानकारी जोड़ें:
1. `REPOMESH_SIGNING_KEY` - आपकी निजी कुंजी PEM (इनिशिएट द्वारा मुद्रित)।
2. `REPOMESH_LEDGER_TOKEN` - GitHub PAT जिसमें `contents:write` + `pull-requests:write` इस रिपो पर हों।

एक रिलीज़ जारी करें। विश्वास स्वचालित रूप से स्थापित हो जाएगा।

### प्रोफाइल

| प्रोफाइल | सबूत | सत्यापन जांच | कब उपयोग करें |
|---------|----------|-----------------|----------|
| `baseline` | वैकल्पिक | कुछ भी आवश्यक नहीं | आंतरिक उपकरण, प्रयोग |
| `open-source` | SBOM + उत्पत्ति | लाइसेंस ऑडिट + सुरक्षा स्कैन | OSS के लिए डिफ़ॉल्ट |
| `regulated` | SBOM + उत्पत्ति | लाइसेंस + सुरक्षा + पुनरुत्पादकता | अनुपालन-महत्वपूर्ण |

### विश्वास की जांच करें

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

यह अखंडता स्कोर, आश्वासन स्कोर और प्रोफाइल-जागरूक अनुशंसाएं दिखाता है।

### अतिलेखन

सत्यापनकर्ताओं को फोर्क किए बिना, प्रति-रिपो अनुकूलन:

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

## मैन्युअल रूप से जुड़ें (5 मिनट)

### 1. अपना नोड मैनिफेस्ट बनाएं।

अपने रिपो के रूट में `node.json` जोड़ें:

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

### 2. एक हस्ताक्षर कुंजी जोड़ी उत्पन्न करें।

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

सार्वजनिक कुंजी PEM को अपने `node.json` के रखरखाव प्रविष्टि में रखें।
निजी कुंजी को एक GitHub रिपो गुप्त के रूप में संग्रहीत करें (`REPOMESH_SIGNING_KEY`)।

### 3. नेटवर्क से जुड़ें।

इस रिपो में एक पुल अनुरोध खोलें और अपना नोड मैनिफेस्ट जोड़ें:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. प्रसारण वर्कफ़्लो जोड़ें।

`templates/repomesh-broadcast.yml` को अपने रिपो के `.github/workflows/` में कॉपी करें।
`REPOMESH_LEDGER_TOKEN` गुप्त सेट करें (एक बारीक PAT जिसमें `contents:write` + `pull-requests:write` इस रिपो पर हों)।

अब प्रत्येक रिलीज़ स्वचालित रूप से लेजर पर एक हस्ताक्षरित `ReleasePublished` घटना प्रसारित करेगा।

## लेजर नियम

- **अपेंड-ओनली** - मौजूदा पंक्तियाँ अपरिवर्तनीय हैं।
- **स्कीमा-वैलिड** - प्रत्येक घटना `schemas/event.schema.json` के विरुद्ध मान्य होती है।
- **हस्ताक्षर-वैलिड** - प्रत्येक घटना एक पंजीकृत नोड रखरखावकर्ता द्वारा हस्ताक्षरित होती है।
- **अद्वितीय** - कोई भी डुप्लिकेट `(रिपो, संस्करण, प्रकार)` प्रविष्टियाँ नहीं।
- **टाइमस्टैम्प-सane** - भविष्य में 1 घंटे से अधिक या अतीत में 1 वर्ष से कम।

## घटना प्रकार

| प्रकार | कब |
|------|------|
| `ReleasePublished` | जब एक नया संस्करण जारी किया जाता है। |
| `AttestationPublished` | जब कोई सत्यापनकर्ता एक रिलीज़ को सत्यापित करता है। |
| `BreakingChangeDetected` | जब एक महत्वपूर्ण परिवर्तन पेश किया जाता है। |
| `HealthCheckFailed` | जब कोई नोड अपने स्वयं के स्वास्थ्य जांच में विफल रहता है। |
| `DependencyVulnFound` | जब निर्भरताओं में कोई भेद्यता पाई जाती है। |
| `InterfaceUpdated` | जब कोई इंटरफ़ेस स्कीमा बदलता है। |
| `PolicyViolation` | जब कोई नेटवर्क नीति का उल्लंघन होता है। |

## नोड प्रकार

| प्रकार | भूमिका |
|------|------|
| `registry` | नोड्स और क्षमताओं को अनुक्रमित करता है। |
| `attestor` | दावों की पुष्टि करता है (निर्माण, अनुपालन)। |
| `policy` | नियमों का पालन करवाता है (स्कोरिंग, गेटिंग)। |
| `oracle` | बाहरी डेटा प्रदान करता है। |
| `compute` | कार्य करता है (परिवर्तन, निर्माण)। |
| `settlement` | अंतिम स्थिति निर्धारित करता है। |
| `governance` | निर्णय लेता है। |
| `identity` | प्रमाण-पत्र जारी करता है/पुष्टि करता है। |

## सार्वजनिक सत्यापन।

कोई भी एक कमांड के माध्यम से किसी रिलीज़ की पुष्टि कर सकता है:

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

यह निम्नलिखित जांचता है:
1. रिलीज़ इवेंट मौजूद है और हस्ताक्षर मान्य है (Ed25519)।
2. सभी प्रमाण मौजूद हैं और हस्ताक्षरित हैं (SBOM, उत्पत्ति, लाइसेंस, सुरक्षा)।
3. रिलीज़ XRPL-आधारित मर्केल विभाजन में शामिल है।

CI गेट के लिए, `--json` का उपयोग करें:

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

पूर्ण सत्यापन गाइड, खतरे का मॉडल और मुख्य अवधारणाओं के लिए [docs/verification.md](docs/verification.md) देखें।

### विश्वसनीयता बैज।

रिपॉजिटरी रजिस्ट्री से विश्वसनीयता बैज एम्बेड कर सकते हैं:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## विश्वसनीयता और सत्यापन।

### किसी रिलीज़ की पुष्टि करें।

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### किसी रिलीज़ का प्रमाण दें।

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

जांच: `sbom.present`, `provenance.present`, `signature.chain`।

### सत्यापनकर्ता चलाएं।

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### नीति जांच चलाएं।

```bash
node policy/scripts/check-policy.mjs
```

जांच: सेमवर् मॉनोटोनिसिटी, आर्टिफैक्ट हैश की विशिष्टता, आवश्यक क्षमताएं।

## लाइसेंस।

MIT।

---

<a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a> द्वारा निर्मित।
