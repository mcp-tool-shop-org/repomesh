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

Red de repositorios sintrópicos: libro mayor de solo anexión, manifiestos de nodos y puntuación para la coordinación distribuida de repositorios.

## ¿Qué es esto?

RepoMesh transforma una colección de repositorios en una red cooperativa. Cada repositorio es un **nodo** con:

- Un **manifiesto** (`node.json`) que declara lo que proporciona y consume
- **Eventos firmados** transmitidos a un libro mayor de solo anexión
- Un **registro** que indexa todos los nodos y capacidades
- Un **perfil** que define qué significa "completado" para la confianza

Hoy, una organización de GitHub, mcp-tool-shop-org, gestiona el registro, los verificadores, la verificación de políticas y el ancla XRPL. Seis nodos registrados no equivalen a seis operadores. Un testigo independiente sería una parte que esta organización no gestiona.

La red aplica tres invariantes:

1. **Resultados deterministas**: las mismas entradas, los mismos artefactos
2. **Procedencia verificable**: cada versión está firmada y verificada
3. **Contratos componibles**: las interfaces tienen versiones y son legibles por máquina

## Inicio rápido (1 comando + 2 secretos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Esto genera todo lo que necesita:
- `node.json`: su manifiesto de nodo
- `repomesh.profile.json`: su perfil elegido
- `.github/workflows/repomesh-broadcast.yml`: flujo de trabajo de transmisión de versiones
- Par de claves de firma Ed25519 (la clave privada permanece local)

Luego, agregue dos secretos a su repositorio:
1. `REPOMESH_SIGNING_KEY`: su clave privada en formato PEM (impresa por init)
2. `REPOMESH_LEDGER_TOKEN`: PAT de GitHub con `contents:write` + `pull-requests:write` en este repositorio

Cree una versión. La confianza converge automáticamente.

### Indicadores de la CLI

Todos los comandos aceptan: `--quiet`, `--verbose`, `--debug`, `--no-color`. El comando `init` también admite `--json` para una salida legible por máquina.

Hay disponibles complementos para la terminal:

```bash
repomesh completion bash >> ~/.bashrc
repomesh completion zsh >> ~/.zshrc
```

### Anulaciones de entorno

| Variable | Propósito |
|----------|---------|
| `REPOMESH_LEDGER_URL` | Anular el punto final del libro mayor |
| `REPOMESH_MANIFESTS_URL` | Anular el punto final de los manifiestos |
| `REPOMESH_FETCH_TIMEOUT` | Tiempo de espera de la solicitud en ms |

### Perfiles

| Perfil | Evidencia | Comprobaciones de garantía | Cuándo usar |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Ninguno requerido | Herramientas internas, experimentos |
| `open-source` | SBOM + procedencia | Auditoría de licencias + análisis de seguridad | Predeterminado para OSS |
| `regulated` | SBOM + procedencia | Licencia + seguridad + reproducibilidad | Crítico para el cumplimiento |

### Verificar confianza

```bash
node registry/scripts/verify-trust.mjs --repo your-org/your-repo
```

Muestra la puntuación de integridad, la puntuación de garantía y las recomendaciones basadas en el perfil.

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

## Unirse manualmente (5 minutos)

### 1. Cree su manifiesto de nodo

Agregue `node.json` a la raíz de su repositorio:

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
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` imprime la clave pública + un `keyId` listo para agregarse a la entrada de `node.json` de los mantenedores, y
escribe la clave privada (modo 0600) solo donde indique `--out`; nunca en una ruta rastreada. Guárdela como un
secreto del repositorio de GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`).

> **Registre ≥2 claves para un nodo crítico para la confianza** (TUF §6.1): una sola clave no puede firmar su propia
> revocación si se ve comprometida. `repomesh init --second-key` registra un segundo mantenedor distinto para que una
> clave pueda revocar a la otra; `init` advierte cuando un nodo tiene solo una clave activa.

### 3. Regístrese en la red

Abra una solicitud de incorporación de código a este repositorio agregando su manifiesto de nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Agregue el flujo de trabajo de transmisión

Copie `templates/repomesh-broadcast.yml` en el `.github/workflows/` de su repositorio.
Establezca el secreto `REPOMESH_LEDGER_TOKEN` (un PAT de grano fino con los siguientes permisos: write y pull-requests:write en este repositorio).

Ahora, cada versión transmitirá automáticamente un evento `ReleasePublished` firmado al libro mayor.

## Reglas del libro mayor

- **Solo anexión**: las líneas existentes son inmutables
- **Validez del esquema**: cada evento se valida con `schemas/event.schema.json`
- **Validez de la firma**: cada evento está firmado por un mantenedor de nodo registrado
- **Único**: no hay entradas `(repo, version, type)` duplicadas
- **Marca de tiempo correcta**: no más de 1 hora en el futuro ni 1 año en el pasado

## Tipos de eventos

El libro mayor emite actualmente los tipos de eventos **activos** que se muestran a continuación. El resto son **reservados/planificados**: el esquema los acepta, pero ningún nodo los emite todavía. Los enumeramos para que la hoja de ruta sea visible sin implicar una cobertura que no existe (honestidad de entrada para un producto de confianza).

**Activos (emitidos hoy):**

| Tipo | Cuándo |
|------|------|
| `ReleasePublished` | Se lanza una nueva versión |
| `AttestationPublished` | Un verificador verifica una versión |
| `ledger.anchor` | El nodo ancla sella una partición (raíz de Merkle + memo de XRPL) |
| `attestation.dispute` | Un nodo de confianza impugna una atestación (degrada el veredicto) |
| `KeyRotation` | Una clave de mantenedor se rota a un sucesor (prospectivo: las firmas anteriores siguen siendo válidas) |
| `KeyRevocation` | Se revoca una clave de mantenedor (compromiso = invalidez retroactiva, RFC 5280) |

**Reservados/planificados (aún no emitidos):**

| Tipo | Significado previsto |
|------|------------------|
| `BreakingChangeDetected` | Se introduce un cambio incompatible |
| `HealthCheckFailed` | Un nodo no supera sus propias comprobaciones de estado |
| `DependencyVulnFound` | Se encuentra una vulnerabilidad en las dependencias |
| `InterfaceUpdated` | Cambia el esquema de la interfaz |
| `PolicyViolation` | Se viola una política de red |

## Rotación y revocación de claves

Las claves de los mantenedores tienen un ciclo de vida. Una clave se puede **rotar** a un sucesor o **revocar**, y
la verificación es **consciente del tiempo**: una firma se considera válida solo si la clave era válida en el momento de la firma; este es el mismo reloj de confianza que el libro mayor ya utiliza, el tiempo de cierre de XRPL.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotación de rutina** es *prospectiva*; las firmas anteriores de la clave retirada siguen siendo válidas; simplemente deja de firmar nuevas versiones.
- El **compromiso** es *retroactivo* (RFC 5280 §5.3.2); cualquier firma cuya hora de anclaje comprobable sea en o después de la fecha de invalidez se rechaza, y se rechaza una firma que no se pueda demostrar que sea anterior a esa fecha.
- Una clave que **no** tiene campos de ciclo de vida se considera heredada (siempre válida), por lo que los nodos existentes verifican sin cambios.
- Las revocaciones se firman como eventos `KeyRevocation`; un nodo de clave única cuyo único clave ha sido comprometido se recupera mediante un nodo de **gobernanza** (`trustedPolicy`) que firma la revocación. Los nodos críticos para la confianza deben registrar **≥2 claves** (TUF §6.1).
- Incluso frente a una manipulación `node.json`, una revocación se vuelve a aplicar a partir de los eventos firmados y anclados en XRPL; un manifiesto modificado no puede reactivar una clave revocada. Consulte el [modelo de amenazas](docs/threat-model.md) para conocer los límites (verifique con respecto al libro mayor canónico; utilice `--anchored` para las comprobaciones sensibles a la revocación).

## Tipos de nodos

| Tipo | Función |
|------|------|
| `registry` | Indexa nodos y capacidades |
| `attestor` | Verifica afirmaciones (compilaciones, cumplimiento) |
| `policy` | Aplica reglas (puntuación, control) |
| `oracle` | Proporciona datos externos |
| `compute` | Realiza tareas (transformaciones, compilaciones) |
| `settlement` | Finaliza el estado |
| `governance` | Toma decisiones |
| `identity` | Emite/verifica credenciales |

## Ampliación de la red: el contrato del complemento verificador

Se añaden nuevos **tipos de comprobación** y **nodos verificadores** editando los datos, no el código. El registro de tipos de comprobación, los pesos de puntuación y los permisos de tipo de nodo se encuentran en
[`verifier.policy.json`](verifier.policy.json) (validado con un esquema, falla de forma segura). Añadir una comprobación (por ejemplo, `sast.scan`) es una edición de política de aproximadamente 6 líneas + un `node.json`, que se revisa en una solicitud de incorporación de cambios; no hay cambios en el código.

La única invariante: **registrado ≠ confiable**. El registro permite que una comprobación participe; la aprobación aún requiere un consenso del conjunto de confianza. Guía completa:
[docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verificación pública

Cualquiera puede verificar una versión con un solo comando; **no se requiere clonar**, la CLI obtiene el libro mayor público por usted:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Esto comprueba:
1. Que el evento `ReleasePublished` existe y está firmado (Ed25519) por una clave registrada en el `node.json` **propio** de ese repositorio; una clave registrada en un repositorio diferente no puede validarlo.
2. Que se satisface el perfil de confianza del repositorio: cada atestación requerida por el perfil (SBOM, procedencia, licencia, seguridad) está presente, firmada por un atestador de confianza, y su resultado más reciente es `pass`, con al menos un atestador **independiente**. Una versión con solo una autofirma y sin atestaciones independientes informa `UNVERIFIED`, nunca `PASS`.
3. Con `--anchored`: se vuelve a calcular la raíz de Merkle de la partición y se compara con el manifiesto, y, cuando la red es accesible, se obtiene la transacción XRPL en la cadena y se afirma (`validated` + `tesSUCCESS`, la cuenta de firma está en la lista de permitidos del ancla de confianza y el memo en la cadena se vincula a la raíz/hash/recuento local). Sin conexión, informa `XRPL NOT verified` en lugar de una transacción falsa; la comprobación estricta `--anchored` falla entonces (utilice `--anchored-or-local` para aceptar un manifiesto verificado localmente sin la prueba en la cadena).

Para las puertas de enlace de CI, elija un formato de salida con `--format <text|json|sarif|markdown>` (`--json` es un alias para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

El **código de salida** se deriva del veredicto de tres estados, por lo que un paso de CI puede controlarlo directamente:

| Salida | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Auténtico y seguro (o UNVERIFIED cuando se relaja con `--fail-on=fail`). |
| `1` | FAIL | Fallo grave: firma falsificada/de repositorio incorrecto, atestador no incluido en la lista de permitidos o una comprobación requerida falló. |
| `3` | UNVERIFIED | Suave: aún no anclado, sin testigo independiente o falta una comprobación requerida. |
| `2` | — | Error de uso o bloqueo interno. |

### Contenedor

La misma CLI se publica como `ghcr.io/mcp-tool-shop-org/repomesh`, etiquetada con la versión de npm y el hash de git. La imagen se ejecuta como un usuario que no es root. No contiene una semilla de billetera.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

Publicar un ancla es un comando independiente. `XRPL_SEED` se pasa en tiempo de ejecución:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

El flujo de trabajo diario crea esta imagen a partir del código fuente y la publica. La red en `anchor/xrpl/config.json` sigue siendo testnet. Una publicación en la red principal espera una cuenta financiada, cuya dirección clásica se añade a la lista de permitidos que se incluye en una versión de la CLI. Esa lista de permitidos es un límite: una configuración obtenida puede eliminar una cuenta, pero no puede añadir una.

`--fail-on <fail\|unverified>` establece el nivel de rigor. El valor predeterminado `unverified` falla tanto en FAIL como en UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED pase (código de salida 0, con una advertencia) para la adopción en modo de advertencia.

Verifique un lote completo en una sola carga del libro mayor con `verify-all` y verifique sin conexión con respecto a un clon local con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Contrólelo en CI** con la acción compuesta incluida; consulte
[Uso de la acción de GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulte [docs/verification.md](docs/verification.md) para obtener la guía de verificación completa, el modelo de amenazas y los conceptos clave.

### Úselo como una biblioteca

El motor de verificación se exporta como una API programática estable; incorpórelo en sus propias herramientas en lugar de ejecutar comandos en la CLI:

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Punto final de estado de la red

El panel publica una información legible por máquina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
para la consulta externa: actualización del libro mayor (con una señal de libro mayor congelado), recuentos de veredicto de confianza, particiones ancladas frente a pendientes y un resumen `ok`/`degraded` con motivos.

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

Las tareas de **atestación** y ejecución de verificadores son tareas del **operador** que actúan sobre una copia de este libro mayor, por lo que se ejecutan desde una copia de trabajo. La verificación de una versión no utiliza el comando `npx` mencionado anteriormente.

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

Los umbrales de los verificadores de seguridad (CVE máximos, niveles de gravedad permitidos) se configuran mediante `verifiers/security/config.json`.

### Ejecutar verificaciones de políticas

```bash
node policy/scripts/check-policy.mjs
```

Verificaciones: monotonicidad de semver, unicidad del hash del artefacto, capacidades requeridas.

## Seguridad y modelo de amenazas

RepoMesh interactúa con los **eventos del libro mayor** (JSON con firma), los **manifiestos de los nodos** (claves públicas + capacidades), los **índices del registro** (puntuaciones de confianza generadas automáticamente) y la **XRPL testnet** (transacciones de anclaje). No interactúa con el código fuente del repositorio de los miembros, las claves privadas, las credenciales de los usuarios ni los datos de navegación. Las claves de firma privadas nunca abandonan el entorno de ejecución de CI. El acceso a la red se limita a la API de GitHub (creación de PR), la XRPL testnet (anclaje) y OSV.dev (búsqueda de vulnerabilidades). No se recopilan ni se envían datos de telemetría: cero análisis, cero informes de fallos, cero comunicación con el servidor. Consulte [SECURITY.md](SECURITY.md) para obtener información completa sobre el alcance, los permisos requeridos y el proceso de notificación de vulnerabilidades, y el [modelo de amenazas](docs/threat-model.md) para conocer el límite de confianza del ciclo de vida de las claves (por qué la autenticidad de `node.json` depende de su origen y por qué la verificación sensible a la revocación debe utilizar `--anchored`).

Refuerzo de la seguridad:

- Las llamadas a subprocesos que interpolan datos variables utilizan `execFileSync` con argumentos de matriz; las llamadas restantes `execSync` utilizan cadenas de comandos estáticas y constantes, sin vectores de inyección de shell.
- El JSON del libro mayor y del registro se analiza dentro de `try`/`catch` con errores estructurados y numerados por línea; una línea con formato incorrecto se omite y se muestra, sin provocar que la herramienta se bloquee con una pila de llamadas sin procesar.
- Se evita el recorrido de rutas en todas las operaciones de archivo (resolución + comprobación de límites).
- Análisis seguro contra ReDoS en todo el proceso (sin expresiones regulares sin límites).
- Las claves privadas PEM se excluyen mediante `.gitignore`, nunca se imprimen en stdout ni en los registros de CI, y se escriben con permisos solo para el propietario (`0600`).

## Pruebas

El conjunto completo de pruebas `node --test` cubre las firmas Ed25519, la validación de esquemas, la integridad del árbol de Merkle (v1 + RFC-6962 v2), las invariantes de solo anexión, la prevención del recorrido de rutas, la verificación de anclaje, la lista de permitidos de atestadores de confianza y la validación de entradas en las capas de CLI, libro mayor, anclaje, verificador y herramientas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

El número de pruebas aumenta a medida que se añaden conjuntos de pruebas; ejecute el comando anterior para obtener el total actual en lugar de confiar en un número que pueda quedar desactualizado.

## Licencia

MIT

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
