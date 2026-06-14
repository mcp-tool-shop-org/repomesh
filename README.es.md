<p align="center">
  <a href="README.es.md">Español</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.ja.md">日本語</a> | <a href="README.pt-BR.md">Português (BR)</a> | <a href="README.zh.md">中文</a>
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

Red de repositorios sintrópica — libro mayor de solo adición, manifiestos de nodo y puntuación para la coordinación de repositorios distribuidos.

## ¿Qué es esto?

RepoMesh convierte una colección de repositorios en una red cooperativa. Cada repositorio es un **nodo** con:

- Un **manifiesto** (`node.json`) que declara lo que proporciona y consume
- **Eventos firmados** difundidos a un libro mayor de solo adición
- Un **registro** que indexa todos los nodos y capacidades
- Un **perfil** que define lo que "terminado" significa para la confianza

La red impone tres invariantes:

1. **Salidas deterministas** — mismas entradas, mismos artefactos
2. **Proveniencia verificable** — cada lanzamiento está firmado y atestiguado
3. **Contratos componibles** — las interfaces tienen versiones y son legibles por máquina

## Inicio rápido (1 comando + 2 secretos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Esto genera todo lo que necesita:
- `node.json` — el manifiesto de su nodo
- `repomesh.profile.json` — su perfil elegido
- `.github/workflows/repomesh-broadcast.yml` — flujo de trabajo de difusión de lanzamientos
- Par de claves de firma Ed25519 (la clave privada permanece local)

Luego, añada dos secretos a su repositorio:
1. `REPOMESH_SIGNING_KEY` — su clave privada PEM (impresa por init)
2. `REPOMESH_LEDGER_TOKEN` — Token de Acceso Personal (PAT) de GitHub con `contents:write` + `pull-requests:write` en este repositorio

Cree un lanzamiento. La confianza converge automáticamente.

### Opciones de la CLI

Todos los comandos aceptan: `--quiet`, `--verbose`, `--debug`, `--no-color`. El comando `init` también admite `--json` para una salida legible por máquina.

Los completados de shell están disponibles:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Sobrescrituras de entorno

| Variable | Propósito |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Sobrescribir endpoint del libro mayor |
| `REPOMESH_MANIFESTS_URL` | Sobrescribir endpoint de manifiestos |
| `REPOMESH_FETCH_TIMEOUT` | Tiempo de espera de obtención en ms |

### Perfiles

| Perfil | Evidencia | Verificaciones de garantía | Cuándo usar |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Ninguno requerido | Herramientas internas, experimentos |
| `open-source` | SBOM + proveniencia | Auditoría de licencia + escaneo de seguridad | Predeterminado para software de código abierto (OSS) |
| `regulated` | SBOM + proveniencia | Licencia + seguridad + reproducibilidad | Crítico para el cumplimiento normativo |

### Verificar confianza

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Muestra la puntuación de integridad, la puntuación de garantía y recomendaciones conscientes del perfil.

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

## Unión manual (5 minutos)

### 1. Cree el manifiesto de su nodo

Añada `node.json` a la raíz de su repositorio:

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

### 2. Genere un par de claves de firma

```bash
openssl genpkey -algorithm ED25519 -out repomesh-private.pem
openssl pkey -in repomesh-private.pem -pubout -out repomesh-public.pem
```

Coloque la clave pública PEM en la entrada de mantenedores de su `node.json`.
Almacene la clave privada como un secreto del repositorio de GitHub (`REPOMESH_SIGNING_KEY`).

### 3. Regístrese en la red

Abra una Pull Request (PR) a este repositorio añadiendo el manifiesto de su nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Añada el flujo de trabajo de difusión

Copie `templates/repomesh-broadcast.yml` en la carpeta `.github/workflows/` de su repositorio.
Establezca el secreto `REPOMESH_LEDGER_TOKEN` (un PAT de grano fino con permisos `contents:write` + `pull-requests:write` en este repositorio).

Ahora, cada lanzamiento difundirá automáticamente un evento `ReleasePublished` firmado al libro mayor.

## Reglas del libro mayor

- **Solo adición** — las líneas existentes son inmutables
- **Válido según esquema** — cada evento se valida contra `schemas/event.schema.json`
- **Firma válida** — cada evento está firmado por un mantenedor de nodo registrado
- **Único** — no hay entradas duplicadas de `(repositorio, versión, tipo)`
- **Marca de tiempo sensata** — no más de 1 hora en el futuro o 1 año en el pasado

## Tipos de evento

El libro mayor actualmente emite los tipos de eventos **en vivo** que se indican a continuación. El resto están **reservados / planificados** — el esquema los acepta, pero ningún nodo los emite todavía. Los listamos para que la hoja de ruta sea visible sin implicar una cobertura que no existe (honestidad directa para un producto de confianza).

**En vivo (emitidos hoy):**

| Tipo | Cuándo |
|------|------|
| `ReleasePublished` | Se publica una nueva versión |
| `AttestationPublished` | Un atestador verifica una publicación |
| `ledger.anchor` | El nodo ancla sella una partición (raíz de Merkle + memo de XRPL) |
| `attestation.dispute` | Un nodo de confianza impugna una atestación (degrada el veredicto) |

**Reservados / planificados (aún no emitidos):**

| Tipo | Significado previsto |
|------|------------------|
| `BreakingChangeDetected` | Se introduce un cambio rupturista |
| `HealthCheckFailed` | Un nodo falla sus propias comprobaciones de estado |
| `DependencyVulnFound` | Se encuentra una vulnerabilidad en las dependencias |
| `InterfaceUpdated` | Cambia un esquema de interfaz |
| `PolicyViolation` | Se viola una política de red |

## Tipos de nodo

| Tipo | Rol |
|------|------|
| `registry` | Indexa nodos y capacidades |
| `attestor` | Verifica afirmaciones (compilaciones, cumplimiento) |
| `policy` | Hace cumplir las reglas (puntuación, filtrado) |
| `oracle` | Proporciona datos externos |
| `compute` | Realiza el trabajo (transformaciones, compilaciones) |
| `settlement` | Finaliza el estado |
| `governance` | Toma decisiones |
| `identity` | Emite/verifica credenciales |

## Verificación pública

Cualquiera puede verificar una publicación con un solo comando — **no es necesario clonar**, la CLI obtiene el libro mayor público por usted:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Esto comprueba:
1. El evento `ReleasePublished` existe y está firmado (Ed25519) por una clave registrada en el `node.json` **de ese propio repositorio** — una clave registrada en un repositorio diferente no puede validarlo.
2. El perfil de confianza del repositorio se cumple: toda atestación requerida por el perfil (SBOM, procedencia, licencia, seguridad) está presente, firmada por un atestador de confianza, y su último resultado es `pass`, con al menos un atestador **independiente**. Una publicación con solo una autofirma y sin atestaciones independientes informa `UNVERIFIED`, nunca `PASS`.
3. Con `--anchored`: la raíz de Merkle de la partición se vuelve a calcular y se compara con el manifiesto, y — cuando la red es accesible — la transacción XRPL en cadena se obtiene y se comprueba (`validated` + `tesSUCCESS`, la cuenta firmante está en la lista de permitidos de anclas de confianza, y el memo en cadena se vincula a la raíz local/hash del manifiesto/recuento). Sin conexión, informa `XRPL NOT verified` en lugar de una transacción falsa; el `--anchored` estricto entonces falla (use `--anchored-or-local` para aceptar un manifiesto verificado localmente sin la prueba en cadena).

Para las puertas de CI, elija un formato de salida con `--format <text|json|sarif|markdown>` (`--json` es un alias para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

El **código de salida** se deriva del veredicto de tres estados, por lo que un paso de CI puede basar su puerta en él directamente:

| Salida | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Auténtico y asegurado (o UNVERIFIED cuando se relaja con `--fail-on=fail`). |
| `1` | FAIL | Fallo grave — firma falsificada/de repositorio incorrecto, atestador no permitido, o una comprobación requerida falló. |
| `3` | UNVERIFIED | Suave — aún no anclado, sin testigo independiente, o falta una comprobación requerida. |
| `2` | — | Error de uso o fallo interno. |

`--fail-on <fail\|unverified>` establece la estrictitud. El valor predeterminado `unverified` falla tanto en FAIL como en UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED pase (salida 0, con una advertencia) para la adopción en modo de advertencia.

Verifique un lote completo en una sola carga del libro mayor con `verify-all`, y verifique sin conexión contra una clonación local con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Intégrelo en una puerta de CI** con la acción compuesta incluida — consulte [Using the GitHub Action](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Vea [docs/verification.md](docs/verification.md) para la guía completa de verificación, el modelo de amenazas y los conceptos clave.

### Insignias de Confianza

Los repositorios pueden incrustar insignias de confianza del registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confianza y Verificación

### Verificar una versión

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Atestiguar una versión

> Atestiguar y ejecutar verificadores son tareas del **operador** que actúan sobre un clon de este libro mayor, por lo que
> se ejecutan desde una copia de trabajo. Verificar una versión no lo hace — use el comando `npx` anterior.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Verificaciones: `sbom.present`, `provenance.present`, `signature.chain`

### Ejecutar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Los umbrales del verificador de seguridad (máximas CVE, severidades permitidas) se configuran mediante `verifiers/security/config.json`.

### Ejecutar verificaciones de políticas

```bash
node policy/scripts/check-policy.mjs
```

Verificaciones: monotonía semver, unicidad del hash de artefactos, capacidades requeridas.

## Seguridad y Modelo de Amenazas

RepoMesh toca **eventos del libro mayor** (JSON firmado), **manifiestos de nodos** (claves públicas + capacidades), **índices del registro** (puntuaciones de confianza generadas automáticamente) y **XRPL testnet** (transacciones de anclaje). **No** toca el código fuente de los repositorios de miembros, claves privadas, credenciales de usuario o datos de navegación. Las claves de firma privadas nunca abandonan el ejecutor de CI. El acceso a la red se limita a la API de GitHub (creación de PR), XRPL testnet (anclaje) y OSV.dev (consultas de vulnerabilidades). **No se recopila ni envía telemetría** — cero análisis, cero informes de fallos, cero llamadas a casa. Vea [SECURITY.md](SECURITY.md) para obtener el alcance completo, los permisos requeridos y el proceso de reporte de vulnerabilidades.

Endurecimiento:

- Las llamadas a procesos secundarios que interpolan datos variables usan `execFileSync` con argumentos de matriz; las llamadas restantes a `execSync` usan cadenas de comando estáticas y constantes — sin vectores de inyección de shell.
- El JSON del libro mayor y del registro se analiza dentro de `try`/`catch` con errores estructurados numerados por línea; una línea malformada se omite y se expone, nunca bloquea la herramienta con una pila sin procesar.
- Se previene el recorrido de rutas en todas las operaciones de archivo (resolución + verificación de límites).
- Análisis seguro contra ReDoS en todo el código (sin expresiones regulares sin límites).
- Las claves privadas PEM se excluyen mediante `.gitignore`, nunca se imprimen en stdout o registros de CI, y se escriben con permisos de solo propietario (`0600`).

## Pruebas

La suite completa de `node --test` cubre firmas Ed25519, validación de esquemas, integridad del árbol de Merkle
(v1 + RFC-6962 v2), invariantes de solo adición, prevención de recorrido de rutas, verificación
de anclaje, la lista de permitidos de atestadores confiables y validación de entrada en las capas de CLI, libro mayor,
anclaje, verificador y herramientas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

El recuento de pruebas crece a medida que se agregan suites — ejecute el comando anterior para obtener el total actual
en lugar de confiar en un número que queda desactualizado.

## Licencia

MIT

---

Desarrollado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
