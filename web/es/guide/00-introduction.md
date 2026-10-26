# Introducción

Este tutorial te enseña a construir un backend con newt construyendo uno: cooper.
Empiezas con un repositorio que tiene el framework y ninguna aplicación, y escribes el
backend de cooper capítulo a capítulo. Al final de cada capítulo el proyecto compila,
sus tests pasan, su lint está limpio y puedes arrancarlo y preguntarle algo.

No explica cómo funciona el framework por dentro. Explica **cómo se usa**: qué piezas
hay, cómo se combinan, qué garantiza cada una y qué decisiones te tocan a ti. Cuando
un capítulo dice "newt garantiza X", puedes fiarte sin saber cómo lo consigue.

## Lo que vas a construir: cooper

cooper es un Trello pequeño: espacios de trabajo (*workspaces*) con tableros, tableros
con columnas, columnas con tarjetas. Alrededor tiene lo que tiene un SaaS de verdad:
una cuenta con la que entrar, un servidor OAuth, un servidor MCP para asistentes de IA
y una consola para el personal de la empresa.

Está dividido en tres **contextos**, tres partes del backend con sus propios datos y
su propio servidor:

| Contexto | Qué es | Puerto (dev) |
|---|---|---|
| `auth` | Quién es cada uno: cuentas, workspaces, quién puede entrar en qué, y el servidor OAuth con el que entran todas las apps. | 3001 |
| `boards` | El SaaS en sí: los tableros, columnas y tarjetas de cada workspace, en la web y por MCP. | 3002 |
| `backoffice` | La consola del personal: lee `auth` y `boards`. | 3003 |

Construyes `boards` primero, solo, y los otros dos cuando ya se sostiene.

### Dos tipos de personas

- Los **miembros** usan el SaaS. Cualquiera puede registrarse, crear un workspace (del
  que pasa a ser el único admin) e invitar a otros por email. Quien acepta una
  invitación pasa a ser miembro de ese workspace.
- El **personal** (*staff*) trabaja para la empresa que lleva cooper. No se registra:
  alguien le da acceso al backoffice.

### Productos, tenants y accesos

`auth` no sabe qué es un tablero. Sabe tres cosas que le sirven para cualquier app:

- Un **producto** es una app en la que se entra a través de `auth`. cooper tiene dos:
  `cooper` (la app de tableros: cualquiera puede registrarse) y `backoffice` (solo
  quien tenga acceso).
- Un **tenant** es un workspace: `Acme`, con quien lo creó como admin.
- Un **acceso** dice quién puede entrar en qué producto, y dónde: Ana en `cooper`, en
  el tenant Acme; el personal en `backoffice`, en ningún tenant.

Así que "Bob es miembro de Acme" es, en `auth`, un acceso de Bob al producto `cooper`
en el tenant Acme. `boards` le hace esa pregunta a `auth` cada vez que alguien abre un
workspace.

### OAuth y MCP

`auth` es un **servidor de autorización OAuth 2.1** completo: códigos de autorización
con PKCE, tokens de acceso y de refresco, y registro dinámico de clientes. `boards` y
`backoffice` inician sesión a través de él, como lo haría cualquier otra app.

`boards` tiene además un **servidor MCP** en `/mcp`. Un asistente de IA (Claude, por
ejemplo) se registra en `auth`, pide a la persona que inicie sesión y obtiene un token
para `boards`. Con él llama a herramientas como `list_boards`, `create_card` o
`move_card`, que llaman a los mismos casos de uso que la app web, como esa persona.
Aun así, cooper sabe por dónde llegó cada cambio: quien actúa dice si fue por la web o
por MCP, y la actividad de cada tarjeta lo enseña.

cooper también tiene tres frontends web, uno por contexto. El tutorial va del backend:
los frontends se copian del repositorio en el capítulo [23](./23-frontends), donde se
ve qué comparten con el backend.

## Las piezas

Un backend hecho con newt se compone siempre de las mismas pocas piezas. Conocerás cada
una en su capítulo; aquí va el mapa:

| Pieza | Qué es | En cooper |
|---|---|---|
| **Contexto** | Una parte de la aplicación con sus propios datos y su propio servidor. | `auth`, `boards`, `backoffice`. |
| **Módulo** | Una responsabilidad dentro de un contexto: unos datos, sus reglas y lo que pasa cuando cambian. | `board`, `column`, `card`, `tenant`, `access`… |
| **Entidad** | Lo que guarda un módulo, con su comportamiento. | `Board`, `Card`, `Tenant`. |
| **Caso de uso** | Cada cosa que se le puede pedir a un módulo. | `board.create`, `card.move`. |
| **Repositorio** | Lo único que lee y escribe las entidades de un módulo. | `Board_Repository`. |
| **Store** | Donde un contexto guarda sus datos. | Ficheros planos al principio, luego SQLite, luego Postgres. |
| **Evento** | Algo que ha pasado, contado a quien quiera escucharlo. | `card.assigned`, `tenant.created`. |
| **Worker** | Código que reacciona a un evento, después y por su cuenta. | Avisar por email a quien le asignan una tarjeta. |

Así viaja una petición por ellas:

```
client ── POST /api/workspaces/:id/cards/:cardId/assign ──▶ route
route ── card.assign ──▶ use case ── changes ──▶ Card (entity)
use case ── persist ──▶ repository ── transaction ──▶ store
                         repository ┄┄ event card.assigned ┄┄▶ worker ── sends the email
```

Fíjate en la flecha de puntos. La ruta responde al cliente en cuanto la tarjeta está
guardada; el worker trabaja después, por su cuenta. Esa separación entre **lo que pasa
ahora** y **lo que pasa enseguida** es la idea más importante de newt. Tiene nombre,
*consistencia eventual*, y la Parte II trata de ella.

## El mapa

El tutorial tiene seis partes. Cada capítulo añade algo a lo que dejó el anterior.

**Parte I: un primer contexto.** `boards`, solo, desde una carpeta vacía hasta
tableros, columnas y tarjetas que varias personas cambian a la vez.

| Capítulo | Qué añade |
|---|---|
| [1. El proyecto y un contexto](./01-project-and-context) | El proyecto TypeScript de cooper, su lint y su `AGENTS.md`, el contexto `boards` sobre ficheros planos, su salud. |
| [2. El primer módulo: tableros](./02-first-module) | El módulo `board`, entero: entidad, esquema, value object, errores, repositorio, casos de uso, rutas. |
| [3. Casos de uso, páginas y errores](./03-pages-and-errors) | Listas por páginas, y cada error contestado con las palabras de cooper. |
| [4. Quién y dónde](./04-who-and-where) | El actor, el ámbito del workspace, un grupo de rutas con su middleware. |
| [5. De ficheros a SQLite](./05-sqlite) | SQLite y sus migraciones, sin cambiar ningún módulo. |
| [6. Reglas sobre filas](./06-rules-over-rows) | Columnas, y reglas que valen sobre varias filas: como mucho diez, un nombre por workspace. |
| [7. Tarjetas y un contador compartido](./07-cards-and-a-counter) | Tarjetas, numeradas por un contador que todos cambian a la vez. |
| [8. Dos personas, una tarjeta](./08-two-people-one-card) | Versiones, conflictos y el caso de uso que se repite. |
| [9. Preguntar dos veces: POST idempotentes](./09-idempotent-posts) | Una petición enviada dos veces que hace su trabajo una sola. |

**Parte II: eventos.** Lo que pasa después de un guardado, y en otros módulos.

| Capítulo | Qué añade |
|---|---|
| [10. Eventos](./10-events) | Eventos de dominio, publicados cuando el guardado se confirma. |
| [11. Reaccionar: handlers y el outbox](./11-reacting) | Workers sobre una cola, escrita en la misma transacción que el cambio. |
| [12. Lo irreversible, y los fallos](./12-failures) | Emails desde un worker, intentos, espera entre reintentos y trabajos muertos. |
| [13. Escuchar a otro contexto](./13-another-context) | Una fuente de eventos como puerto, y la regla de quién escribe dónde. |
| [14. Sagas: un workspace va y viene](./14-sagas) | Un flujo por varios módulos que converge. |
| [15. Consultas que una tabla no sabe decir: Kysely](./15-kysely) | Kysely sobre el store, y los filtros que un cliente puede enviar. |
| [16. Un puerto de búsqueda propio](./16-search-port) | Un puerto, su adaptador en memoria y su suite de contrato. |

**Parte III: auth.** Un segundo contexto, y los dos hablando.

| Capítulo | Qué añade |
|---|---|
| [17. Un segundo contexto: auth](./17-auth) | Usuarios y sesiones, secretos fuera de los DTO, varios contextos en un proceso. |
| [18. Tenants y accesos](./18-tenants-and-access) | Workspaces y quién puede entrar en ellos. |
| [19. Invitaciones y tiempo](./19-invitations-and-time) | Un reloj que controlas, programaciones y cron. |
| [20. Conectar los contextos](./20-wiring-contexts) | `boards` sobre el `auth` de verdad, y el lint entre contextos. |

**Parte IV: iniciar sesión de verdad.**

| Capítulo | Qué añade |
|---|---|
| [21. Un servidor OAuth](./21-oauth-server) | `auth` como servidor OAuth 2.1, rutas fuera de `/api`, CORS. |
| [22. Entrar en boards: la sesión web](./22-web-session) | Cookies y sesiones; la cabecera `x-user` desaparece. |
| [23. Los frontends y newt/contract](./23-frontends) | Las apps web, y lo que comparten con el backend. |
| [24. Un servidor MCP](./24-mcp-server) | Tokens bearer y herramientas que llaman a los mismos casos de uso. |

**Parte V: el backoffice.**

| Capítulo | Qué añade |
|---|---|
| [25. Un tercer contexto que lee a dos](./25-backoffice) | La consola del personal, a través de los casos de uso de los otros contextos. |
| [26. Trabajos muertos y analítica](./26-dead-jobs-and-analytics) | El outbox visto desde fuera, y un puerto de analítica. |

**Parte VI: producción.**

| Capítulo | Qué añade |
|---|---|
| [27. Postgres, MySQL y migraciones en producción](./27-postgres) | Un servidor de base de datos, migraciones por dialecto, y ejecutarlas a mano. |
| [28. Observabilidad](./28-observability) | Trazas, a la consola o a OpenTelemetry. |
| [29. Ponerlo en marcha](./29-shipping) | El build, la configuración, y las reglas una vez más. |

Los apéndices reúnen lo que los capítulos enseñan de uno en uno:
[A. Las reglas de oro](./a-golden-rules), [B. Anatomía de un módulo y lint](./b-module-anatomy),
[C. Problemas comunes](./c-common-problems), [D. Escribir un store](./d-writing-a-store)
[E. Índice](./e-index), que dice qué capítulo enseña cada export de newt,
[F. Agregados](./f-aggregates), cómo guarda newt un agregado frente a otras formas, y
[G. La línea de comandos](./g-command-line), `newt init` y `newt add module`.

## Cómo trabajas

Necesitas [git](https://git-scm.com) y [Bun](https://bun.sh) 1.4.4 o posterior (la
comprobación de abajo usa su `bun check`). newt solo funciona con Bun: sus stores se
construyen sobre `bun:sqlite` y `Bun.SQL`, y su servidor sobre `Bun.serve`.

Clona el repositorio de newt y ve al comienzo del tutorial:

```sh
git clone https://github.com/aromero86/newt.git
cd newt
git checkout tutorial/00
bun install
```

`tutorial/00` es una etiqueta (*tag*): el repositorio tal como está antes del capítulo
1. Haz sobre ella una rama propia, para que tu trabajo tenga nombre:

```sh
git switch -c my-cooper
```

### Qué hay al empezar

El repositorio es un único workspace de Bun. En `tutorial/00` tiene:

```
package.json          the workspace: newt, newt-eslint, typescript, eslint, vitepress
tsconfig.json         the repository's TypeScript projects: for now only newt's
tsconfig.newt.json    newt's project: the framework and its tests
eslint.config.js      lints nothing yet: the framework's code is left out
packages/
  newt/               the framework: newt/core, newt/runtime, newt/http…, its `newt`
                      command and its AGENTS.md, the rules for coding agents
  newt-eslint/        the lint of an application built with newt
web/                  this site
```

El `package.json` de la raíz ya depende de `newt` (`"workspace:*"`) y tiene
`newt-eslint` entre sus dependencias de desarrollo. cooper importa el framework por su
nombre, `newt/core`, `newt/http`, exactamente como una aplicación que hubiera ejecutado
`bun add newt`: cada entrada es uno de los `exports` de `packages/newt/package.json`, y
nada más del paquete se puede importar.

No hay carpeta `cooper/`. La creas en el capítulo 1.

### Un capítulo, una etiqueta

Cada capítulo termina en una etiqueta: el capítulo 1 en `tutorial/01`, el 2 en
`tutorial/02`, y así hasta `tutorial/29`, que es cooper entero. Un capítulo muestra cada
línea que escribes, con su ruta encima. Un fichero mostrado entero es nuevo, o se
sustituye entero; un fichero mostrado por partes lleva `// …` donde sus otras líneas se
quedan como estaban, y el texto dice dónde va cada parte.

Cuando acabes un capítulo, compara lo que has escrito con su etiqueta:

```sh
git diff tutorial/03 -- cooper
```

Para ver todo lo que cambia un capítulo, antes o después de leerlo:

```sh
git diff tutorial/02 tutorial/03
```

Si te quedas atrás, o quieres saltarte un capítulo, toma el código de su etiqueta:

```sh
git checkout tutorial/03 -- cooper
```

Eso trae `cooper/` como lo tiene la etiqueta. Añade y sustituye ficheros, y deja en paz
los que tú tienes y la etiqueta no: `git diff tutorial/03 -- cooper` te los enseña.
Algunos capítulos también cambian ficheros de la raíz (`package.json`, `tsconfig*.json`,
`eslint.config.js`): el capítulo lo dice, y los tomas igual, y después ejecutas
`bun install`:

```sh
git checkout tutorial/03 -- cooper package.json bun.lock tsconfig.json tsconfig.backend.json eslint.config.js
bun install
```

Unos pocos capítulos copian ficheros del repositorio en vez de hacerte escribirlos (los
frontends, código de protocolo que el capítulo resume). Dicen exactamente qué rutas, y
de qué etiqueta.

### La comprobación

Todos los capítulos terminan con las mismas cuatro comprobaciones:

```sh
bun install && bun check && bun test cooper && bun run lint
```

- `bun check` comprueba los tipos de cada proyecto al que hace referencia el
  `tsconfig.json` de la raíz, como haría `tsc -b`: el de newt y, desde el capítulo 1, el
  del backend de cooper. Da los mismos errores que `tsc`, y termina con
  `✓ No type errors` si todo va bien.
- `bun test cooper` ejecuta los tests de cooper. La comprobación de cada capítulo es
  también un test, así que lo que pruebas a mano se vuelve a comprobar cada vez.
- `bun run lint` ejecuta ESLint con el preset de newt sobre el backend de cooper.

En `tutorial/00` todavía no hay cooper: ejecuta `bun test`, que corre los tests del
propio newt, para ver que el repositorio está sano antes de empezar.

Después cada capítulo tiene su propio "Compruébalo": el servidor arrancado a mano y
unas líneas de `curl` con lo que responden.

## En resumen

- cooper tiene tres contextos: `auth` (identidad y OAuth), `boards` (el SaaS, con un
  servidor MCP) y `backoffice` (la consola del personal). Construyes `boards` primero.
- Los miembros usan workspaces; el personal usa el backoffice. En `auth`, un workspace
  es un tenant y ser miembro es tener acceso a un producto.
- Clona, `git checkout tutorial/00`, `bun install`. Cada capítulo termina en
  `tutorial/NN`; `git diff tutorial/NN-1 tutorial/NN` lo enseña,
  `git checkout tutorial/NN -- cooper` te pone al día.
- La comprobación, al final de cada capítulo:
  `bun install && bun check && bun test cooper && bun run lint`.

Empieza por el [capítulo 1: el proyecto y un contexto](./01-project-and-context).
