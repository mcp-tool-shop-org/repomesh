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

Publicar el libro mayor y el reloj de confianza anclado a XRPL para una red de repositorios: eventos firmados, manifiestos de nodos y verificación. Separado del almacén de eventos de Attestia.

## Colocar en el sistema

Attestia, Cognate y RepoMesh son tres productos.

**RepoMesh** es la red de publicación: eventos firmados, manifiestos de nodos y un reloj de confianza anclado a XRPL. Mantiene su propio libro mayor RFC 6962.

**Attestia** demuestra que un evento, una transacción o una transición de estado ocurrieron, y vincula esa prueba a una cadena. El dominio que ofrece es la verdad financiera: bóveda personal, tesorería de la organización y registro. Sus pruebas de Merkle no son este libro mayor.

**Cognate** es el dominio de gobernanza de IA en el almacén de eventos de Attestia y las pruebas de Merkle. Llama a RepoMesh cuando necesita que se verifique una publicación. No mantiene un segundo almacén de eventos, y no utiliza el árbol de Merkle de Attestia para esta red.

## ¿Qué hay de nuevo en las versiones 2.4 y 2.5?

**Versión 2.5.0.**

- **2.5.0: el anclaje de la publicación falla de forma segura.** `post-anchor.mjs` se niega a publicar y no abre ninguna conexión, a menos que la configuración indique `testnet` y la URL WebSocket sea un punto final conocido de la red de prueba. Una variable de entorno por sí sola no puede cambiar la publicación a la red principal. Consulte [Anclaje XRPL (Protección de la red de prueba)](#anclaje-xrpl-testnet-guard).
- **2.5.0: una puerta de enlace de prueba obligatoria.** Cada solicitud de extracción ejecuta las 9 suites `node --test` con un umbral de cobertura de líneas y una producción `npm audit` en `high`. `validate-ledger` y `test` son comprobaciones obligatorias en `main`, y `registry-ci.yml` ahora se ejecuta solo después de que `ledger-ci` tenga éxito en `main`.
- **2.4.0: ejecutar atestaciones desde Cognate.** El libro mayor acepta tres nuevos tipos de atestación, `run.preregistered`, `run.outcome` y `cognate.root.anchored`, cada uno con un resumen `sha256` y una URI `urn:cognate:...`. Solo un nodo `governance` tanto en `trustedAttestors` como en `trustedRunAttestors` (hoy, `mcp-tool-shop-org/cognate`) puede firmarlos, y no puede firmar nada más. Cada `run.outcome` debe hacer referencia a un evento `run.preregistered` que ya esté en el libro mayor.
- **2.4.0: se comprueba el contrato de firma.** Una firma Ed25519 debe realizarse sobre los 32 bytes sin procesar de `canonicalHash`. El validador rechaza una firma realizada sobre el texto JSON canónico o sobre la cadena hexadecimal de 64 caracteres.

Consulte [CHANGELOG.md](CHANGELOG.md) para obtener la lista completa.

## ¿Qué es esto?

RepoMesh transforma una colección de repositorios en una red cooperativa. Cada repositorio es un **nodo** con:

- Un **manifiesto** (`node.json`) que declara lo que proporciona y consume
- **Eventos firmados** transmitidos a un libro mayor de solo anexión
- Un **registro** que indexa todos los nodos y capacidades
- Un **perfil** que define qué significa "completado" para la confianza

Hoy en día, una organización GitHub, mcp-tool-shop-org, opera el registro, los atestadores, la comprobación de políticas y el anclaje XRPL. Siete nodos registrados no equivalen a siete operadores. Un testigo independiente sería una parte que esta organización no opera.

La red aplica tres invariantes:

1. **Resultados deterministas:** las mismas entradas, los mismos artefactos
2. **Procedencia verificable:** cada publicación está firmada y atestada
3. **Contratos componibles:** las interfaces tienen versiones y son legibles por máquina

## Inicio rápido (1 comando + 2 secretos)

```bash
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source
# JSON output for CI piping:
npx @mcptoolshop/repomesh init --repo your-org/your-repo --profile open-source --json
```

Esto genera todo lo que necesita:
- `node.json`: su manifiesto de nodo
- `repomesh.profile.json`: su perfil elegido
- `.github/workflows/repomesh-broadcast.yml`: flujo de trabajo de transmisión de publicaciones
- Ed25519: par de claves de firma (la clave privada permanece local)

Luego, agregue dos secretos a su repositorio:
1. `REPOMESH_SIGNING_KEY`: su clave privada PEM (impresa por init)
2. `REPOMESH_LEDGER_TOKEN`: PAT GitHub con `contents:write` + `pull-requests:write` en este repositorio

Realice una publicación. La confianza converge automáticamente.

### Indicadores de la CLI

Todos los comandos aceptan: `--quiet`, `--verbose`, `--debug`, `--no-color`. El comando `init` también admite `--json` para una salida legible por máquina.

Hay disponibles complementos de shell:

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

| Perfil | Evidencia | Comprobaciones de garantía | Usar cuando |
|---------|----------|-----------------|----------|
| `baseline` | Opcional | Ninguno requerido | Herramientas internas, experimentos |
| `open-source` | SBOM + procedencia | Auditoría de licencias + análisis de seguridad | Predeterminado para OSS |
| `regulated` | SBOM + procedencia | Licencia + seguridad + reproducibilidad | Crítico para el cumplimiento |

### Comprobar la confianza

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
    { "name": "your-name", "contact": "https://github.com/your-org", "keyId": "ci-yourrepo-2026", "publicKey": "-----BEGIN PUBLIC KEY-----\n...\n-----END PUBLIC KEY-----" }
  ]
}
```

### 2. Genere un par de claves de firma

```bash
# Mint an ed25519 key and a paste-ready node.json maintainer block:
npx @mcptoolshop/repomesh keygen --repo <your-org>/<your-repo> --out repomesh-private.pem
```

`keygen` imprime la clave pública + una `keyId` lista para colocarla en la entrada de sus `node.json` mantenedores, y
escribe la clave privada (modo 0600) solo donde indique `--out`; nunca en una ruta rastreada. Guárdela como un
secreto del repositorio GitHub (`REPOMESH_SIGNING_KEY`). (Equivalente manualmente: `openssl genpkey -algorithm ED25519 ...`).

> **Registre ≥2 claves para un nodo crítico para la confianza** (TUF §6.1): una sola clave no puede firmar su propia revocación si se ve comprometida. `repomesh init --second-key` registra un segundo mantenedor distinto para que una
> clave pueda revocar a la otra; `init` advierte cuando un nodo tiene solo una clave activa.

### 3. Regístrese en la red

Abra una solicitud de extracción a este repositorio agregando su manifiesto de nodo:

```
ledger/nodes/<your-org>/<your-repo>/node.json
ledger/nodes/<your-org>/<your-repo>/repomesh.profile.json
```

### 4. Agregue el flujo de trabajo de transmisión

Copie `templates/repomesh-broadcast.yml` en el `.github/workflows/` de su repositorio.
Establezca el secreto `REPOMESH_LEDGER_TOKEN` (un PAT de grano fino con los permisos:write + pull-requests:write en este repositorio).

Cada publicación ahora transmitirá automáticamente un evento firmado `ReleasePublished` al libro mayor.

## Reglas del libro mayor

- **Solo anexión:** las líneas existentes son inmutables.
- **Validez del esquema:** cada evento se valida con respecto a `schemas/event.schema.json`.
- **Validez de la firma:** cada evento está firmado por un mantenedor de nodo registrado.
- **Unicidad:** no hay entradas duplicadas de `(repo, version, type)`.
- **Marca de tiempo coherente:** no más de 1 hora en el futuro ni 1 año en el pasado.

## Tipos de eventos

Actualmente, el libro mayor emite los siguientes tipos de eventos **activos**. El resto están **reservados/planificados**: el esquema los acepta, pero ningún nodo los emite todavía. Los enumeramos para que el plan de desarrollo sea visible sin implicar una cobertura que no existe (honestidad desde el principio para un producto de confianza).

**Activos (emitidos hoy):**

| Tipo | Cuándo |
|------|------|
| `ReleasePublished` | Se lanza una nueva versión |
| `AttestationPublished` | Un atestador verifica una versión |
| `ledger.anchor` | El nodo ancla sella una partición (raíz de Merkle + memo de XRPL) |
| `attestation.dispute` | Un nodo de confianza impugna una atestación (rebaja el veredicto) |
| `KeyRotation` | La clave de un mantenedor se rota a un sucesor (prospectivo: las firmas anteriores siguen siendo válidas) |
| `KeyRevocation` | Se revoca la clave de un mantenedor (compromiso = invalidez retroactiva, RFC 5280) |

`AttestationPublished` también contiene las atestaciones de ejecución de Cognate (`run.preregistered`, `run.outcome`, `cognate.root.anchored`, desde la versión 2.4.0), firmadas solo por su nodo `governance`.

**Reservados/planificados (aún no emitidos):**

| Tipo | Significado previsto |
|------|------------------|
| `BreakingChangeDetected` | Se introduce un cambio importante |
| `HealthCheckFailed` | Un nodo no supera sus propias comprobaciones de estado |
| `DependencyVulnFound` | Se encuentra una vulnerabilidad en las dependencias |
| `InterfaceUpdated` | Cambia el esquema de la interfaz |
| `PolicyViolation` | Se viola una política de red. `policy/scripts/check-policy.mjs` puede crear y firmar una; ninguna está en el libro mayor todavía. |

## Rotación y revocación de claves

Las claves de los mantenedores tienen un ciclo de vida. Una clave puede ser **rotada** a un sucesor o **revocada**, y la verificación es **consciente del tiempo**: una firma se considera válida solo si la clave era válida en el momento de confianza de la firma: la hora de cierre del ancla de XRPL, el mismo reloj de confianza que ya utiliza el libro mayor.

```bash
# Rotate to a successor key (the retired key's past signatures stay valid)
npx @mcptoolshop/repomesh key rotate --repo your-org/your-repo \
  --retiring mike-2026-01 --new-key mike-2026-06 --public-key new.pem

# Revoke a compromised key (signatures at/after the invalidity date are rejected)
npx @mcptoolshop/repomesh key revoke --repo your-org/your-repo \
  --key mike-2026-01 --reason compromise --invalid-after 2026-06-18T00:00:00Z
```

- La **rotación de rutina** es *prospectiva*: las firmas anteriores de la clave retirada siguen siendo válidas; simplemente deja de firmar nuevas versiones.
- El **compromiso** es *retroactivo* (RFC 5280 §5.3.2): cualquier firma cuyo tiempo de anclaje demostrable sea en/después de la fecha de invalidez se rechaza, y se rechaza una firma que no se pueda demostrar que sea anterior a esa fecha.
- Una clave que **no** tiene campos de ciclo de vida se considera heredada (siempre válida), por lo que los nodos existentes verifican sin cambios.
- Las revocaciones son eventos firmados `KeyRevocation`; un nodo de una sola clave cuyo única clave está comprometida se recupera mediante un nodo de **gobernanza** (`trustedPolicy`) que firma la revocación. Los nodos críticos para la confianza deben registrar **≥2 claves** (TUF §6.1).
- Incluso frente a un `node.json` manipulado, una revocación se vuelve a aplicar a partir de los eventos firmados y anclados en XRPL: un manifiesto despojado no puede reactivar una clave revocada. Consulte el [modelo de amenazas](docs/threat-model.md) para conocer el límite (verifique con respecto al libro mayor canónico; utilice `--anchored` para las comprobaciones sensibles a la revocación).

## Tipos de nodos

| Tipo | Rol |
|------|------|
| `registry` | Indexa nodos y capacidades |
| `attestor` | Verifica afirmaciones (construye, cumple) |
| `policy` | Aplica reglas (puntuación, control) |
| `oracle` | Proporciona datos externos |
| `compute` | Realiza tareas (transforma, construye) |
| `settlement` | Finaliza el estado |
| `governance` | Toma decisiones; desde la versión 2.4.0, firma las atestaciones de ejecución de Cognate y nada más. |
| `identity` | Emite/verifica credenciales |

## Extiende la red: el contrato del complemento verificador

Se agregan nuevos **tipos de comprobación** y **nodos verificadores** editando los datos, no el código. El registro de tipos de comprobación, los pesos de puntuación y los permisos de tipo de nodo se encuentran en [`verifier.policy.json`](verifier.policy.json) (validado por el esquema, falla de forma segura). Agregar una comprobación (por ejemplo, `sast.scan`) es una edición de política de aproximadamente 6 líneas + un `node.json`, que se revisa en una solicitud de incorporación de código: no hay cambios en el código.

La única invariante: **registrado ≠ confiable**. El registro permite que una comprobación participe; la acreditación aún requiere un consenso del conjunto de confianza. Guía completa: [docs/verifier-plugin-contract.md](docs/verifier-plugin-contract.md).

## Verificación pública

Cualquiera puede verificar una versión con un solo comando: **no se requiere clonar**, la CLI obtiene el libro mayor público por usted:

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

Esto comprueba:
1. Que el evento `ReleasePublished` existe y está firmado (Ed25519) por una clave registrada para **el repositorio propio** `node.json`: una clave registrada para un repositorio diferente no puede validarla.
2. Que se satisface el perfil de confianza del repositorio: cada atestación requerida por el perfil (SBOM, procedencia, licencia, seguridad) está presente, firmada por un atestador de confianza y su resultado más reciente es `pass`, con al menos un atestador **independiente**. Una versión con solo una autofirma y sin atestaciones independientes informa `UNVERIFIED`, nunca `PASS`.
3. Con `--anchored`: se vuelve a calcular la raíz de Merkle de la partición y se compara con el manifiesto, y, cuando la red es accesible, se obtiene la transacción de XRPL en la cadena y se afirma (`validated` + `tesSUCCESS`, la cuenta de firma está en la lista de permitidos del ancla de confianza y el memo en la cadena se vincula a la raíz/hash del manifiesto/recuento local). Sin conexión, informa `XRPL NOT verified` en lugar de una transacción falsa; la comprobación estricta `--anchored` falla entonces (utilice `--anchored-or-local` para aceptar un manifiesto verificado localmente sin la prueba en la cadena).

Para las puertas de enlace de CI, elija un formato de salida con `--format <text|json|sarif|markdown>` (`--json` es un alias para `--format json`):

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored --format json
```

El **código de salida** se deriva del veredicto de tres estados, por lo que un paso de CI puede controlarlo directamente:

| Salida | Veredicto | Significado |
|------|---------|---------|
| `0` | PASS | Auténtico y seguro (o NO VERIFICADO cuando se relaja con `--fail-on=fail`). |
| `1` | FAIL | Fallo grave: firma falsificada/de repositorio incorrecto, atestador no incluido en la lista de permitidos o una comprobación requerida falló. |
| `3` | NO VERIFICADO | Suave: aún no anclado, sin testigo independiente o falta una comprobación requerida. |
| `2` | — | Error de uso o bloqueo interno. |

### Contenedor

La misma CLI se publica como `ghcr.io/mcp-tool-shop-org/repomesh`, etiquetada con la versión de npm y el hash de Git. La imagen se ejecuta como un usuario que no es root. No contiene una semilla de billetera.

```bash
docker run --rm ghcr.io/mcp-tool-shop-org/repomesh verify-anchor --tx <TX_HASH>
```

Publicar un ancla es un comando separado. `XRPL_SEED` se pasa en tiempo de ejecución:

```bash
docker run --rm -e XRPL_SEED --entrypoint node ghcr.io/mcp-tool-shop-org/repomesh \
  anchor/xrpl/scripts/post-anchor.mjs
```

El flujo de trabajo diario crea esta imagen a partir de la copia y la publica.

### Anclaje XRPL (Testnet Guard)

El anclaje en `anchor/xrpl/config.json` es **solo para la red de prueba** (`"network": "testnet"`). `anchor/xrpl/scripts/post-anchor.mjs` aplica una protección de punto final de falla segura (`assertPostingEndpoint`) antes de validar `XRPL_SEED` o construir un `xrpl.Client`:

- **Comprobación predeterminada de la red de prueba:** se rechaza la publicación (salida distinta de cero, no se abre ningún socket) a menos que `config.network === "testnet"` **y** la URL resuelta WebSocket (`process.env.XRPL_WS_URL || config.rippledUrl`) estén en `KNOWN_TESTNET_WS_URLS` (`wss://s.altnet.rippletest.net:51233`, `wss://clio.altnet.rippletest.net:51233`, `wss://testnet.xrpl-labs.com`). Establecer `XRPL_WS_URL` en una URL de la red principal o desconocida se rechaza inmediatamente con un mensaje que indica tanto la red resuelta como la URL resuelta.
- **Opción para la red principal (deshabilitada):** una variable de entorno por sí sola nunca puede cambiar la publicación a la red principal. Optar por la red principal requiere un commit revisado en `anchor/xrpl/config.json` que establezca `"network": "mainnet"`, `"allowMainnetPosting": true` y `"mainnetAllowedEndpoints": ["wss://..."]`, que contengan el punto final de destino `wss://`, después de agregar la dirección clásica financiada de la red principal a la lista de permisos enviada (`packages/repomesh-cli/src/trusted-anchor-accounts.mjs`). Esa lista de permisos es un límite: una configuración obtenida puede eliminar una cuenta y no puede agregar una.

`--fail-on <fail\|unverified>` establece el nivel de rigor. El valor predeterminado `unverified` falla tanto en FAIL como en
UNVERIFIED; `--fail-on=fail` permite que UNVERIFIED pase (salida 0, con una advertencia) para la adopción del modo de advertencia.

Verifique un lote completo en una sola carga del libro mayor con `verify-all` y verifique sin conexión contra un clon local
con `--local`:

```bash
# Every release in the trust index, warn-mode
npx @mcptoolshop/repomesh verify-all --from-registry --fail-on fail

# Offline against a local ledger checkout
npx @mcptoolshop/repomesh verify-release --repo org/repo --version 1.0.0 --local ./repomesh
```

**Limítelo en CI** con la acción compuesta incluida; consulte
[Uso de la acción GitHub](docs/verification.md#using-the-github-action):

```yaml
- uses: mcp-tool-shop-org/repomesh/.github/actions/verify@v1
  with:
    repo: ${{ github.repository }}
    version: ${{ github.event.release.tag_name }}
    anchored: "true"
```

Consulte [docs/verification.md](docs/verification.md) para obtener la guía completa de verificación, el modelo de amenazas y los conceptos clave.

### Úselo como una biblioteca

El motor de verificación se exporta como una API programática estable; incorpórelo en sus propias herramientas
en lugar de ejecutar comandos en la CLI.

```js
import { verifyRelease, buildSarif, exitCodeForStatus } from "@mcptoolshop/repomesh";

const result = await verifyRelease({ repo: "org/repo", version: "1.0.0", local: "./repomesh" });
process.exitCode = exitCodeForStatus(result.status);
```

### Punto final de estado de la red

El panel publica una información legible por máquina [`status.json`](https://mcp-tool-shop-org.github.io/repomesh/status.json)
para la consulta externa: actualización del libro mayor (con una señal de libro mayor congelado), recuentos de veredicto de confianza, anclado frente a
particiones pendientes y un resumen `ok`/`degraded` con razones.

### Insignias de confianza

Los repositorios pueden insertar insignias de confianza del registro:

```markdown
[![Integrity](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/integrity.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Assurance](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/assurance.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
[![Anchored](https://raw.githubusercontent.com/mcp-tool-shop-org/repomesh/main/registry/badges/mcp-tool-shop-org/shipcheck/anchored.svg)](https://mcp-tool-shop-org.github.io/repomesh/repos/mcp-tool-shop-org/shipcheck/)
```

## Confianza y verificación

### Verifique una versión

```bash
npx @mcptoolshop/repomesh verify-release --repo mcp-tool-shop-org/shipcheck --version 1.0.4 --anchored
```

### Atestigüe una versión

> Atestiguar y ejecutar verificadores son tareas del **operador** que actúan sobre una copia de este libro mayor, por lo que
> se ejecutan a partir de una copia. La verificación de una versión no lo hace; use el comando `npx` anterior.

```bash
node attestor/scripts/attest-release.mjs --scan-new  # process all unattested releases
node attestor/scripts/attest-release.mjs --scan-new --dry-run  # preview without writing
```

Comprobaciones: `sbom.present`, `provenance.present`, `signature.chain`

### Ejecute los verificadores

```bash
node verifiers/license/scripts/verify-license.mjs --scan-new
node verifiers/security/scripts/verify-security.mjs --scan-new
```

Los umbrales del verificador de seguridad (CVE máximos, severidades permitidas) se configuran a través de `verifiers/security/config.json`.

### Ejecute las comprobaciones de políticas

```bash
node policy/scripts/check-policy.mjs
```

Comprobaciones: monotonicidad semver, singularidad del hash del artefacto, capacidades requeridas.

## Seguridad y modelo de amenazas

RepoMesh accede a los **eventos del libro mayor** (JSON con firma), los **manifiestos de los nodos** (claves públicas + capacidades), los **índices del registro** (puntuaciones de confianza generadas automáticamente) y la **red de prueba XRPL** (transacciones de anclaje; la publicación rechaza cualquier punto final que no sea uno conocido de la red de prueba). **No** accede al código fuente del repositorio de los miembros, las claves privadas, las credenciales de los usuarios ni los datos de navegación. Las claves de firma privadas nunca abandonan el entorno de ejecución de CI. El acceso a la red se limita a la API GitHub (creación de solicitudes de extracción), la red de prueba XRPL (anclaje) y OSV.dev (búsquedas de vulnerabilidades). No se recopila ni se envía **ningún dato de telemetría**: cero análisis, cero informes de fallos, cero comunicación con el servidor. Consulte [SECURITY.md](SECURITY.md) para obtener el alcance completo, los permisos requeridos y el proceso de notificación de vulnerabilidades, y el [modelo de amenazas](docs/threat-model.md) para conocer el límite de confianza del ciclo de vida de la clave (por qué la autenticidad de `node.json` depende de su origen y por qué la verificación sensible a la revocación debe usar `--anchored`).

Endurecimiento:

- Las llamadas a subprocesos que interpolan datos de variables utilizan `execFileSync` con argumentos de matriz; las llamadas restantes `execSync` utilizan cadenas de comandos estáticas y constantes; no hay vectores de inyección de shell.
- El JSON del libro mayor y del registro se analiza dentro de `try`/`catch` con errores estructurados y numerados por línea; se omite una línea con formato incorrecto y se muestra, nunca se produce un error en la herramienta con una pila sin procesar.
- Se evita el recorrido de rutas en todas las operaciones de archivos (resolución + comprobación de límites).
- Análisis seguro con ReDoS en todo el proceso (sin expresiones regulares ilimitadas).
- Las claves privadas PEM se excluyen mediante `.gitignore`, nunca se imprimen en stdout ni en los registros de CI y se escriben con permisos de solo propietario (`0600`).

## Pruebas

El conjunto completo de pruebas `node --test` cubre Ed25519 firmas, validación de esquema, integridad del árbol de Merkle (v1 + RFC-6962 v2), invariantes de solo anexión, prevención del recorrido de rutas, verificación de anclaje, la lista de permisos de atestiguadores de confianza y la validación de entrada en las capas de CLI, libro mayor, anclaje, verificador y herramientas.

```bash
# Run every suite and read the exact pass/fail counts from the summary footer:
node --test $(git ls-files '*.test.mjs')
```

El recuento de pruebas aumenta a medida que se agregan conjuntos; ejecute el comando anterior para obtener el total actual en lugar de confiar en un número que se vuelve obsoleto.

CI ejecuta los mismos 9 conjuntos en cada solicitud de extracción (`ledger-ci.yml`, la comprobación `test` requerida), con `--experimental-test-coverage` y un límite de cobertura de líneas (`--test-coverage-lines=57`), luego `npm audit --audit-level=high --omit=dev` para la raíz, `anchor/xrpl` y `ledger`.

## Licencia

MIT

---

Creado por <a href="https://mcp-tool-shop.github.io/">MCP Tool Shop</a>
