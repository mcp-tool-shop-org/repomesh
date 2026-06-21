<p align="center">
  <a href="README.ja.md">日本語</a> | <a href="README.zh.md">中文</a> | <a href="README.md">English</a> | <a href="README.fr.md">Français</a> | <a href="README.hi.md">हिन्दी</a> | <a href="README.it.md">Italiano</a> | <a href="README.pt-BR.md">Português (BR)</a>
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

Red de repositorios sintrópicos: un registro de solo anexión, manifiestos de nodos y puntuación para la coordinación distribuida de repositorios.

## ¿Qué es esto?

RepoMesh convierte una colección de repositorios en una red cooperativa. Cada repositorio es un **nodo** con:

- Un **manifiesto** (`node.json`) que declara lo que proporciona y consume
- **Eventos firmados** transmitidos a un registro de solo anexión
- Un **registro** que indexa todos los nodos y capacidades
- Un **perfil** que define qué significa "completado" para la confianza

La red aplica tres invariantes:

1. **Resultados deterministas:** las mismas entradas, los mismos artefactos
2. **Procedencia verificable:** cada versión está firmada y certificada
3. **Contratos componibles:** las interfaces tienen versiones y son legibles por máquina

## Inicio rápido (1 comando + 2 secretos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Esto genera todo lo que necesitas:
- `node.json`: tu manifiesto de nodo
- `repomesh.profile.json`: tu perfil elegido
- `.github/workflows/repomesh-broadcast.yml`: flujo de trabajo de transmisión de versiones
- Par de claves de firma Ed25519 (la clave privada permanece local)

Luego, agrega dos secretos a tu repositorio:
1. `REPOMESH_SIGNING_KEY`: tu clave privada en formato PEM (impresa por el comando init)
2. `REPOMESH_LEDGER_TOKEN`: token PAT de GitHub con permisos `contents:write` + `pull-requests:write` en este repositorio

Publica una versión. La confianza converge automáticamente.

### Indicadores de la CLI

Todos los comandos aceptan: `--quiet`, `--verbose`, `--debug`, `--no-color`. El comando `init` también admite `--json` para obtener resultados legibles por máquina.

Las finalizaciones de shell están disponibles:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Anulaciones de entorno

| Variable | Propósito |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Anular el punto final del registro |
| `REPOMESH_MANIFESTS_URL` | Anular el punto final de los manifiestos |
| `REPOMESH_FETCH_TIMEOUT` | Tiempo de espera de la solicitud en milisegundos |

### Perfiles

| Perfil | Evidencia | Comprobaciones de garantía | Cuándo usar |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Ninguno requerido | Herramientas internas, experimentos |
| `open-source` | SBOM + procedencia | Auditoría de licencias + análisis de seguridad | Predeterminado para OSS |
| `regulated` | SBOM + procedencia | Licencia + seguridad + reproducibilidad | Crítico para el cumplimiento normativo |

### Verificar la confianza

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Muestra la puntuación de integridad, la puntuación de garantía y las recomendaciones específicas del perfil.

### Anulaciones

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` imprime la clave pública y un `keyId` listos para agregarlos a la entrada de los mantenedores en su archivo `node.json`, y escribe la clave privada (modo 0600) solo donde se especifique con `--out`; nunca en una ruta rastreada. Guárdela como un secreto del repositorio de GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manual: `openssl genpkey -algorithm ED25519 ...`.)

> **Registre ≥2 claves para un nodo crítico para la confianza** (TUF §6.1): una sola clave no puede firmar su propia revocación si se ve comprometida. `repomesh init --second-key` registra un segundo mantenedor distinto, de modo que una clave pueda revocar a la otra; `init` advierte cuando un nodo tiene solo una clave activa.

### 3. Regístrate en la red

Abre una solicitud de extracción a este repositorio agregando tu manifiesto de nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Agrega el flujo de trabajo de transmisión

Copia `templates/repomesh-broadcast.yml` al directorio `.github/workflows/` de tu repositorio.
Establece el secreto `REPOMESH_LEDGER_TOKEN` (un token PAT con permisos específicos para `contents:write` + `pull-requests:write` en este repositorio).

Cada versión ahora transmitirá automáticamente un evento firmado `ReleasePublished` al registro.

## Reglas del libro mayor

- **Solo anexión:** las líneas existentes son inmutables
- **Validez del esquema:** cada evento se valida según `schemas/event.schema.json`
- **Validez de la firma:** cada evento está firmado por un mantenedor registrado del nodo
- **Único:** no hay entradas duplicadas `(repo, versión, tipo)`
- **Marca de tiempo correcta:** no más de 1 hora en el futuro ni 1 año en el pasado

## Tipos de eventos

El registro actualmente emite los tipos de eventos **activos** que se muestran a continuación. El resto son **reservados/planificados**: el esquema los acepta, pero ningún nodo los emite todavía. Los enumeramos para que la hoja de ruta sea visible sin implicar una cobertura que no existe (honestidad en la puerta de entrada para un producto de confianza).

**Activos (emitidos hoy):**

| Tipo | Cuándo |
|------|------|
| `ReleasePublished` | Se publica una nueva versión |
| `AttestationPublished` | Un certificador verifica una versión |
| `ledger.anchor` | El nodo ancla sella una partición (raíz de Merkle + memorándum XRPL) |
| `attestation.dispute` | Un nodo confiable impugna una certificación (degrada el veredicto) |
| `KeyRotation` | Una clave de mantenedor se rota hacia un sucesor (potencial; las firmas anteriores siguen siendo válidas). |
| `KeyRevocation` | Una clave de mantenedor se revoca (compromiso = invalidez retroactiva, RFC 5280). |

**Reservados/planificados (aún no emitidos):**

| Tipo | Significado previsto |
|------|------------------|
| `BreakingChangeDetected` | Se introduce un cambio incompatible |
| `HealthCheckFailed` | Un nodo falla sus propias comprobaciones de estado |
| `DependencyVulnFound` | Se encuentra una vulnerabilidad en las dependencias |
| `InterfaceUpdated` | Cambia el esquema de la interfaz |
| `PolicyViolation` | Se viola una política de red |

## Rotación y revocación de claves

Las claves de los mantenedores tienen un ciclo de vida. Una clave puede ser **rotada** a un sucesor o **revocada**, y la verificación es **consciente del tiempo**: una firma solo se considera confiable si la clave era válida en el momento de confianza de la firma: la hora de cierre del ancla XRPL, el mismo reloj de confianza que ya utiliza el libro mayor.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotación rutinaria** es *prospectiva*: las firmas anteriores de la clave retirada siguen siendo válidas; simplemente deja de firmar nuevas versiones.
- El **compromiso** es *retroactivo* (RFC 5280 §5.3.2): cualquier firma cuyo tiempo de anclaje comprobable sea en o después de la fecha de invalidez se rechaza, y una firma que no se pueda demostrar que sea anterior a esa fecha también se rechaza.
- Una clave sin campos de ciclo de vida se considera heredada (siempre válida), por lo que los nodos existentes verifican sin cambios.
- Las revocaciones se firman como eventos `KeyRevocation`; un nodo de una sola clave cuyo única clave está comprometida se recupera mediante un nodo de **gobernanza** (`trustedPolicy`) que firma la revocación. Los nodos críticos para la confianza deben registrar **≥2 claves** (TUF §6.1).
- Incluso frente a un archivo `node.json` manipulado, una revocación se vuelve a aplicar a partir de los eventos firmados y anclados en XRPL; un manifiesto modificado no puede reactivar una clave revocada. Consulte el [modelo de amenazas](docs/threat-model.md) para conocer el límite (verificar con respecto al libro mayor canónico; utilizar `--anchored` para las comprobaciones sensibles a la revocación).

## Tipos de nodos

| Tipo | Rol |
|------|------|
| `registry` | Indexa nodos y capacidades |
| `attestor` | Verifica las afirmaciones (compilaciones, cumplimiento) |
| `policy` | Aplica reglas (puntuación, control) |
| `oracle` | Proporciona datos externos |
| `compute` | Realiza el trabajo (transformaciones, compilaciones) |
| `settlement` | Finaliza el estado |
| `governance` | Toma decisiones |
| `identity` | Emite/verifica credenciales |

## Verificación pública

Cualquiera puede verificar una versión con un comando: no se requiere clonar, la CLI obtiene el libro mayor público por ti:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Esto verifica:
1. Que el evento `ReleasePublished` exista y esté firmado (Ed25519) con una clave registrada en el **repositorio específico** (`node.json`) — una clave registrada en un repositorio diferente no puede validarlo.
2. Que se cumpla el perfil de confianza del repositorio: que cada atestación requerida por el perfil (SBOM, procedencia, licencia, seguridad) esté presente, firmada por un atestador confiable y que su resultado más reciente sea `pass`, con al menos un atestador **independiente**. Una versión con solo una autofirma y sin atestaciones independientes informa `UNVERIFIED`, nunca `PASS`.
3. Con `--anchored`: se recalcula la raíz Merkle de la partición y se compara con el manifiesto, y —cuando la red es accesible— se obtiene la transacción XRPL en cadena y se afirma (`validated` + `tesSUCCESS`, la cuenta de firma está en la lista de permisos del ancla de confianza y el memo en cadena se vincula a la raíz/hash/recuento local). Fuera de línea, informa `XRPL NOT verified` en lugar de una transacción falsa; `--anchored` estricto falla entonces (use `--anchored-or-local` para aceptar un manifiesto verificado localmente sin la prueba en cadena).

Para las puertas de enlace de CI, elija un formato de salida con `--format <text|json|sarif|markdown>` (`--json` es un alias para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

El **código de salida** se deriva del veredicto triestatal, por lo que un paso de CI puede usarlo directamente:

| Salida | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Auténtico y asegurado (o UNVERIFIED cuando se relaja con `--fail-on=fail`). |
| `1` | FAIL | Fallo grave: firma falsificada/de repositorio incorrecto, atestador no incluido en la lista de permisos o una comprobación requerida falló. |
| `3` | UNVERIFIED | Suave: aún no anclado, sin testigo independiente o falta una comprobación requerida. |
| `2` | — | Error de uso o fallo interno. |

`--fail-on <fail|unverified>` establece el nivel de rigor. El valor predeterminado `unverified` falla tanto en FAIL como en UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED pase (salida 0, con una advertencia) para la adopción en modo de advertencia.

Verifique un lote completo en una sola carga del libro mayor con `verify-all`, y verifique fuera de línea contra un clon local con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Incorpórelo en CI** con la acción compuesta incluida; consulte [Uso de la Acción de GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulte [docs/verification.md](docs/verification.md) para obtener la guía completa de verificación, el modelo de amenazas y los conceptos clave.

### Úselo como una biblioteca

El motor de verificación se exporta como una API programática estable: incorpórelo en sus propias herramientas en lugar de ejecutar comandos en la CLI.

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Punto final del estado de la red

El panel publica un archivo [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json) legible por máquina para consultas externas: frescura del libro mayor (con una señal de libro mayor congelado), recuentos de veredicto de confianza, particiones ancladas frente a pendientes y un resumen `ok`/`degraded` con las razones.

### Insignias de confianza

Los repositorios pueden incrustar insignias de confianza del registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confianza y verificación

### Verificar una versión

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Atestiguar una versión

> Atestiguar y ejecutar verificadores son tareas de **operador** que actúan sobre un clon de este libro mayor, por lo que se ejecutan desde un checkout. La verificación de una versión no lo hace; use el comando `npx` anterior.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Comprobaciones: `sbom.present`, `provenance.present`, `signature.chain`

### Ejecutar verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Los umbrales del verificador de seguridad (CVE máximos, severidades permitidas) se configuran a través de `verifiers/security/config.json`.

### Ejecutar comprobaciones de políticas

```bash
node policy/scripts/check-policy.mjs
```

Comprobaciones: monotonicidad semántica, singularidad del hash de artefactos, capacidades requeridas.

## Seguridad y modelo de amenazas

RepoMesh interactúa con los **eventos del libro mayor** (JSON firmado), los **manifiestos de los nodos** (claves públicas + capacidades), los **índices del registro** (puntuaciones de confianza generadas automáticamente) y la **red de prueba XRPL** (transacciones de anclaje). No interactúa con el código fuente del repositorio de los miembros, las claves privadas, las credenciales de usuario ni los datos de navegación. Las claves de firma privadas nunca abandonan el entorno de ejecución de CI. El acceso a la red se limita a la API de GitHub (creación de solicitudes de extracción), la red de prueba XRPL (anclaje) y OSV.dev (búsquedas de vulnerabilidades). No se recopilan ni envían **telemetrías**: cero análisis, cero informes de fallos, cero comunicación con el servidor. Consulte [SECURITY.md](SECURITY.md) para conocer el alcance completo, los permisos requeridos y el proceso de notificación de vulnerabilidades, y el [modelo de amenazas](docs/threat-model.md) para conocer el límite del ciclo de vida de la clave (por qué la autenticidad de `node.json` depende de su origen y por qué la verificación sensible a la revocación debe utilizar `--anchored`).

Endurecimiento:

- Las llamadas a subprocesos que interpolan datos variables utilizan `execFileSync` con argumentos de matriz; las llamadas restantes a `execSync` utilizan cadenas de comandos estáticas y constantes, sin vectores de inyección de shell.
- El JSON del libro mayor y el registro se analiza dentro de bloques `try`/`catch` con errores estructurados y numerados por línea; una línea mal formada se omite y se muestra, nunca provocando que la herramienta falle con un rastreo de pila sin procesar.
- Se evita el recorrido de rutas en todas las operaciones de archivo (resolución + comprobación de límites).
- Análisis seguro contra ReDoS en todo momento (sin expresiones regulares ilimitadas).
- Las claves privadas PEM se excluyen a través de `.gitignore`, nunca se imprimen en stdout o en los registros de CI y se escriben con permisos de solo propietario (`0600`).

## Pruebas

La suite completa `node --test` cubre las firmas Ed25519, la validación de esquemas, la integridad del árbol Merkle (v1 + RFC-6962 v2), las invariantes de solo anexión, la prevención del recorrido de rutas, la verificación del ancla y la lista de permisos del atestador confiable, así como la validación de entrada en todas las capas: CLI, libro mayor, ancla, verificador y herramientas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

El recuento de pruebas aumenta a medida que se agregan suites; ejecute el comando anterior para obtener el total actual en lugar de confiar en un número que se vuelve obsoleto.

## Licencia

MIT

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
