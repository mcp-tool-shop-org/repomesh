<p align="center">
  <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
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

Red de de repositorios sintrópica: registro de solo anexión, manifiestos de nodos y puntuación para la coordinación distribuida de repositorios.

## ¿Qué es esto?

RepoMesh transforma una colección de repositorios en una red cooperativa. Cada repositorio es un **nodo** con:

- Un **manifiesto** (`node.json`) que declara lo que proporciona y consume.
- **Eventos firmados** que se transmiten a un registro de solo anexión.
- Un **registro** que indexa todos los nodos y capacidades.
- Un **perfil** que define lo que significa "completado" en términos de confianza.

La red impone tres invariantes:

1. **Salidas deterministas**: las mismas entradas producen los mismos artefactos.
2. **Origen verificable**: cada versión se firma y se verifica.
3. **Contratos componibles**: las interfaces están versionadas y son legibles por máquina.

## Inicio rápido (1 comando + 2 secretos)

```bash
node tools/repomesh.mjs init --repo your-org/your-repo --profile open-source
```

Esto genera todo lo que necesitas:
- `node.json`: tu manifiesto de nodo.
- `repomesh.profile.json`: tu perfil elegido.
- `.github/workflows/repomesh-broadcast.yml`: flujo de trabajo de transmisión de versiones.
- Par de claves de firma Ed25519 (la clave privada permanece local).

Luego, agrega dos secretos a tu repositorio:
1. `REPOMESH_SIGNING_KEY`: tu clave privada en formato PEM (se imprime durante la inicialización).
2. `REPOMESH_LEDGER_TOKEN`: token PAT de GitHub con permisos `contents:write` + `pull-requests:write` en este repositorio.

Crea una nueva versión. La confianza converge automáticamente.

### Perfiles

| Perfil | Evidencia | Verificaciones de seguridad | Cuándo usar |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | No se requiere ninguno | Herramientas internas, experimentos |
| `open-source` | SBOM + origen | Auditoría de licencias + análisis de seguridad | Predeterminado para OSS (Software de Código Abierto) |
| `regulated` | SBOM + origen | Licencia + seguridad + reproducibilidad | Crítico para el cumplimiento normativo |

### Verificar la confianza

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Muestra la puntuación de integridad, la puntuación de seguridad y recomendaciones específicas del perfil.

### Sobrescrituras

Personalización por repositorio sin bifurcar los verificadores:

```json
// repomesh.overrides.json
{
  "license": { "allowlistAdd": ["WTFPL"] },
  "security": { "ignoreVulns": [{ "id": "GHSA-xxx", "justification": "Not reachable" }] }
}
```

## Estructura del repositorio

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

## Unirse manualmente (5 minutos)

### 1. Crea tu manifiesto de nodo

Agrega `node.json` a la raíz de tu repositorio:

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

### 2. Genera un par de claves de firma

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Coloca la clave pública en formato PEM en la entrada de mantenedores de tu `node.json`.
Guarda la clave privada como un secreto del repositorio de GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Regístrate en la red

Abre una solicitud de extracción (PR) en este repositorio y agrega tu manifiesto de nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Agrega el flujo de trabajo de transmisión

Copia `templates/repomesh-broadcast.yml` a la carpeta `.github/workflows/` de tu repositorio.
Establece el secreto `REPOMESH_LEDGER_TOKEN` (un token PAT con permisos de `contents:write` + `pull-requests:write` en este repositorio).

Cada nueva versión ahora transmitirá automáticamente un evento firmado `ReleasePublished` al registro.

## Reglas del registro

- **Solo anexión**: las líneas existentes son inmutables.
- **Esquema válido**: cada evento se valida contra `schemas/event.schema.json`.
- **Firma válida**: cada evento está firmado por un mantenedor de nodo registrado.
- **Único**: no hay entradas duplicadas de `(repositorio, versión, tipo)`.
- **Marca de tiempo válida**: no puede tener más de 1 hora de anticipación o 1 año de retraso.

## Tipos de eventos

| Tipo | Cuándo |
|------|------|
| `ReleasePublished` | Se lanza una nueva versión. |
| `AttestationPublished` | Un verificador verifica una versión. |
| `BreakingChangeDetected` | Se introduce un cambio importante. |
| `HealthCheckFailed` | Un nodo falla sus propias comprobaciones de estado. |
| `DependencyVulnFound` | Se encuentra una vulnerabilidad en las dependencias. |
| `InterfaceUpdated` | El esquema de una interfaz cambia. |
| `PolicyViolation` | Se viola una política de red. |

## Tipos de nodos

| Tipo | Rol |
|------|------|
| `registry` | Indexa nodos y capacidades. |
| `attestor` | Verifica las afirmaciones (construcción, cumplimiento). |
| `policy` | Hace cumplir las reglas (puntuación, control de acceso). |
| `oracle` | Proporciona datos externos. |
| `compute` | Realiza tareas (transformaciones, construcción). |
| `settlement` | Finaliza el estado. |
| `governance` | Toma decisiones. |
| `identity` | Emite/verifica credenciales. |

## Verificación pública

Cualquier persona puede verificar una versión con un solo comando:

```bash
git clone https://github.com/mcp-tool-shop-org/repomesh.git && cd repomesh
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Esto verifica:
1. Que el evento de la versión existe y la firma es válida (Ed25519).
2. Que todas las declaraciones están presentes y firmadas (SBOM, procedencia, licencia, seguridad).
3. Que la versión está incluida en una partición Merkle anclada a XRPL.

Para los controles de CI, utilice `--json`:

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --json
```

Consulte [docs/verification.md](docs/verification.md) para obtener la guía completa de verificación, el modelo de amenazas y los conceptos clave.

### Insignias de confianza

Los repositorios pueden incluir insignias de confianza del registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confianza y verificación

### Verificar una versión

```bash
node tools/repomesh.mjs verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Certificar una versión

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
```

Verificaciones: `sbom.present`, `provenance.present`, `signature.chain`.

### Ejecutar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

### Ejecutar controles de políticas

```bash
node policy/scripts/check-policy.mjs
```

Verificaciones: monotonicidad de semver, unicidad del hash del artefacto, capacidades requeridas.

## Licencia

MIT.

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>.
