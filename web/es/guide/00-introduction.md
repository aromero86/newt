# Introducción

Esta guía te enseña a construir un backend con newt. Va de lo sencillo a lo complejo,
como un libro: cada capítulo se apoya en el anterior, y al acabar habrás leído el
backend de una aplicación entera y sabrás por qué está hecho como está.

No explica cómo funciona el framework por dentro. Explica **cómo se usa**: qué piezas
hay, cómo se combinan, qué garantiza cada una y qué decisiones te tocan a ti. Cuando
la guía dice "el framework garantiza X", puedes fiarte sin saber cómo lo consigue.

## Lo que vas a leer: cooper

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

cooper también tiene tres frontends web, uno por contexto, en `cooper/frontend`. Esta
guía no los trata: va del backend.

## Lo que vas a aprender

| Parte | Capítulos | Qué enseña |
|---|---|---|
| Primeros pasos | [1](./01-the-project) – [4](./04-use-cases) | El proyecto, un contexto, tu primer módulo, los casos de uso. |
| Quién y dónde | [5](./05-who-and-where) | El actor, el inicio de sesión, los permisos, el ámbito del workspace. |
| Guardar sin miedo | [6](./06-transactions) – [9](./09-shared-counters) | Transacciones, dos personas cambiando una tarjeta, reglas sobre varias filas, contadores que todos cambian. |
| Eventos | [10](./10-events) – [16](./16-sagas) | Eventos, workers, consistencia eventual, workers que se pueden repetir, emails, fallos, sagas. |
| Crecer | [17](./17-modules-talk) – [19](./19-several-contexts) | Módulos que hablan, referencias, varios contextos. |
| Lo propio de cooper | [20](./20-oauth-server) – [22](./22-backoffice) | Un servidor OAuth, un servidor MCP, el backoffice. |
| Datos y producción | [23](./23-search) – [26](./26-production) | Búsquedas, migraciones, tests, producción. |

Todos los capítulos siguen los mismos pasos: el problema, lo que newt te da para
resolverlo, el código (copiado de cooper, con su ruta encima), cómo comprobar que
funciona y la regla que conviene recordar.

## Arrancarlo

Necesitas [Bun](https://bun.sh) 1.4 o posterior. newt solo funciona con Bun.

```bash
bun install
bun run cooper:seed
bun run cooper
```

`bun run cooper:seed` escribe los datos de demostración a través de los casos de uso
de los contextos, como lo haría cualquiera: una cuenta del personal, el workspace Acme
de Ana con dos tableros (Welcome y Launch), y Bob, que entró en Acme aceptando la
invitación de Ana. Puedes ejecutarlo otra vez: lo que ya está se queda. Los emails que
envía salen por la consola. Al terminar imprime:

```
cooper is seeded. Every account's password is
  cooper-demo

  staff@cooper.dev   the staff: the backoffice, http://localhost:5173
  ana@cooper.dev     Acme's admin, http://localhost:5172: its boards Welcome and Launch
  bob@cooper.dev     a member of Acme, who accepted Ana's invitation

  MCP server         http://localhost:5172/mcp (OAuth: sign in as Ana or Bob)
```

`bun run cooper` arranca el backend (los tres contextos en un proceso, cada uno en su
puerto) y un servidor de Vite por frontend, y reinicia el backend con cada cambio.
Cuando todo responde, imprime dónde vive cada app:

```
  auth        http://localhost:5171  (API on port 3001)
  boards      http://localhost:5172  (API on port 3002)
  backoffice  http://localhost:5173  (API on port 3003)
```

Abre `http://localhost:5172` y entra como `ana@cooper.dev` con `cooper-demo`. Pulsa
Ctrl+C para pararlo todo. Lo que guarda cooper va a `data/`, un fichero SQLite por
contexto: borra la carpeta para empezar de cero.

::: tip Consejo
Cada puerto y cada URL se pueden cambiar con una variable de entorno
(`COOPER_BOARDS_PORT`, `COOPER_BOARDS_PUBLIC_URL`…). El capítulo [2](./02-a-context)
enseña dónde se leen.
:::

## El mapa del repositorio

Solo el backend, que es de lo que va la guía:

```
packages/
  newt/                   el framework: newt/core, newt/runtime, newt/http…
  newt-eslint/            el lint de una aplicación hecha con newt
cooper/
  backend/
    index.ts              abre los contextos, sirve cada uno, los para
    config.ts             la configuración, de variables de entorno
    open-contexts.ts      abre auth, boards y backoffice, en ese orden
    shared/               lo que usan todos los contextos: su base, su servidor, el actor, la sesión web,
                          el outbox, un mailer, un tracer, los mensajes de newt con palabras de cooper
    contexts/
      auth/               cuentas, workspaces, accesos, invitaciones, el servidor OAuth
      boards/             tableros, columnas y tarjetas; el servidor MCP en mcp/
      backoffice/         la consola del personal
  scripts/
    dev.ts                bun run cooper
    seed.ts               bun run cooper:seed
    migrations.ts         bun run cooper:migrations
data/                     los ficheros SQLite (fuera de git)
```

Dentro de un contexto hay siempre las mismas piezas, y dentro de cada uno de sus
módulos, los mismos ficheros. Este es `boards`, el contexto que construirás primero:

```
cooper/backend/contexts/boards/
  boards.context.ts       el contexto: abre su store, sus módulos y su servidor
  boards-base.ts          lo que recibe cada uno de sus módulos
  boards-config.ts        su configuración
  initialize-modules.ts   sus módulos, cada uno después de los que usa
  migrations/             sus tablas, en SQL
  modules/
    board/  column/  card/  member/  workspace/  activity/
  mcp/                    su servidor MCP
  testing/                lo que abren sus tests
```

## Las piezas

Antes de escribir código conviene tener el mapa de las piezas. Un backend hecho con
newt se compone siempre de las mismas pocas:

| Pieza | Qué es | En cooper |
|---|---|---|
| **Contexto** | Una parte de la aplicación con sus propios datos y su propio servidor. | `auth`, `boards`, `backoffice`. |
| **Módulo** | Una responsabilidad dentro de un contexto: unos datos, sus reglas y lo que pasa cuando cambian. | `board`, `column`, `card`, `tenant`, `access`… |
| **Entidad** | Lo que guarda un módulo, con su comportamiento. | `Board`, `Card`, `Tenant`. |
| **Caso de uso** | Cada cosa que se le puede pedir a un módulo. | `board.create`, `card.move`. |
| **Repositorio** | Lo único que lee y escribe las entidades de un módulo. | `Board_Repository`. |
| **Store** | Donde un contexto guarda sus datos. | SQLite, un fichero por contexto. |
| **Evento** | Algo que ha pasado, contado a quien quiera escucharlo. | `card.assigned`, `tenant.created`. |
| **Worker** | Código que reacciona a un evento, después y por su cuenta. | Avisar por email a quien le asignan una tarjeta. |

Así viaja una petición por ellas:

```
cliente ── POST /api/workspaces/:id/cards/:cardId/assign ──▶ ruta
ruta ── card.assign ──▶ caso de uso ── cambia ──▶ Card (entidad)
caso de uso ── persist ──▶ repositorio ── transacción ──▶ store
                           repositorio ┄┄ evento card.assigned ┄┄▶ worker ── envía el email
```

Fíjate en la flecha de puntos. La ruta responde al cliente en cuanto la tarjeta está
guardada; el worker trabaja después, por su cuenta. Esa separación entre **lo que pasa
ahora** y **lo que pasa enseguida** es la idea más importante de esta guía. Tiene
nombre, *consistencia eventual*, y los capítulos [10](./10-events) a
[16](./16-sagas) tratan de ella.

## Las reglas que nunca se rompen

Unas pocas reglas mantienen el código ordenado mientras la aplicación crece. Aquí van
todas juntas. No hace falta que las entiendas aún: cada una se explica en su capítulo,
y conviene volver a esta lista de vez en cuando.

1. **Un módulo, una responsabilidad.** Si para describirlo necesitas un "y", son dos.
2. **Una ruta no piensa.** Lee la petición, llama a un caso de uso y responde.
3. **Solo la entidad se cambia a sí misma**, con métodos que dicen qué ha pasado.
4. **Solo el repositorio toca el store.**
5. **Una transacción es un guardado**, no un caso de uso entero.
6. **Un módulo lee de otros cuando quiere, pero escribe en otro solo desde un
   worker**, reaccionando a un evento.
7. **Lo irreversible (un email, un cobro) sale de un worker**, nunca de un caso de uso.
8. **Un worker puede ejecutarse más de una vez**, así que debe dar igual que lo haga.
9. **Las dependencias entre módulos nunca forman un círculo.**
10. **Un módulo apunta a lo de otro solo por su id**, nunca por la entidad ni por su
    tabla.
11. **Ninguna lista se devuelve entera**: se pagina.

## En resumen

- cooper tiene tres contextos: `auth` (identidad y OAuth), `boards` (el SaaS, con un
  servidor MCP) y `backoffice` (la consola del personal).
- Los miembros usan workspaces; el personal usa el backoffice. En `auth`, un workspace
  es un tenant, y ser miembro es tener acceso a un producto.
- `bun install`, `bun run cooper:seed`, `bun run cooper`; contraseña `cooper-demo`.
- La guía va del backend: `cooper/backend` y el framework, en `packages/newt`.
