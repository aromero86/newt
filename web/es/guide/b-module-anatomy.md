# B. Anatomía de un módulo

Todos los módulos de cooper tienen los mismos ficheros, con su nombre, así que quien abre
uno sabe dónde está cada cosa. Un módulo es una carpeta dentro del `modules/` de su
contexto, en *kebab-case*: `cooper/backend/contexts/<contexto>/modules/<módulo>/`.

## Los ficheros

| Fichero | Qué contiene |
|---|---|
| `<m>.schema.ts` | Los esquemas de zod, los tipos de los DTOs y los filtros: el **contrato público** del módulo. Lo importan otros módulos, otros contextos y los clientes de la API. |
| `<m>.ts` | La entidad, una clase que hereda de `Entity`. Reexporta el esquema. |
| `<m>.repository.ts` | Lo único que toca el store. |
| `<m>.module.ts` | `<M>_Module`: sus casos de uso y sus `events` (`eventsOf(base.bus, { … })`), y `static initialize`. |
| `<m>.routes.ts` | Sus rutas, si tiene. |
| `<m>.workers.ts` | Sus reacciones a eventos (`deps.<módulo>.events.<evento>.subscribe(…)`), si tiene. |
| `<m>.deps.ts` | `<M>_Deps`: los módulos que conoce y los puertos que necesita de fuera de su contexto, importados como tipos. |
| `<m>-options.ts` | `<M>_Options`: con qué lo configura su contexto (un mailer, una URL, unos días). |
| `events/<m>-<verbo>.ts` | Un evento por fichero. |
| `errors/<error>.ts` | Un error por fichero. |
| `value-objects/<nombre>.ts` | Sus value objects, si tiene. |
| `services/<nombre>.ts` | La lógica que comparten sus casos de uso, un fichero cada una. |
| `*.test.ts` | Sus tests, junto a lo que prueban. |

Solo `<m>.module.ts` está siempre. El `card` de boards los tiene casi todos:

```
cooper/backend/contexts/boards/modules/card/
  card.schema.ts       CardSchema, CardFilter, CardDTO…
  card.ts              Card, la entidad
  card.repository.ts   persistNew, persistOrder, search, countByWorkspace…
  card.module.ts       Card_Module: create, move, assign, search…
  card.routes.ts       bajo /workspaces/:workspaceId
  card.workers.ts      avisar al asignado; desasignar a quien se fue
  card.deps.ts         board, column, member y los eventos de acceso de auth
  card-options.ts      el mailer, la URL pública de boards
  card.test.ts
  events/              card-created.ts, card-moved.ts, card-assigned.ts…
  errors/              card-not-found.ts, column-not-empty.ts…
```

Y el `workspace` del backoffice no guarda nada, así que no tiene entidad ni repositorio:
un módulo, sus deps, sus rutas, su esquema y su test.

## Lo que comprueba el lint

El `eslint.config.js` de cooper aplica el preset de `newt-eslint` al backend y a los
scripts, con sus contextos:

```js
// eslint.config.js
const BACKEND = newt({
  contexts: { folder: 'cooper/backend/contexts', uses: { auth: [], boards: ['auth'], backoffice: ['auth', 'boards'] } },
})
```

En cada fichero bajo una carpeta `modules/<módulo>/`:

- **`newt/module-anatomy`**: solo los ficheros y carpetas de la tabla de arriba, con el
  nombre del módulo; el fichero de un evento empieza por el nombre del módulo.
- **`newt/module-boundaries`**: un módulo importa de otro solo su módulo, su esquema,
  sus eventos, sus errores y sus value objects. Nunca su entidad, su repositorio, sus
  rutas ni sus workers, ni su carpeta.
- **`newt/queue-name`**: la cola de un handler es
  `<módulo>.<caso de uso>.on.<módulo>.<evento>`, empieza por el módulo que reacciona, y
  su callback llama a ese caso de uso.
- **Ninguna transacción propia**: se rechaza `transaction`, llamado o sacado. Un módulo
  escribe con el `save` o el `saveRows` de su repositorio.

En todo el backend:

- **`@typescript-eslint/no-floating-promises`**: ninguna promesa sin `await`.
- **`newt/context-boundaries`**: un contexto importa solo los contextos que le da
  `uses`. boards puede importar auth; auth no importa ninguno. El preset rechaza un
  `uses` con un círculo.

```bash
bun run lint
```

## Nombres

Para un módulo de autorizaciones OAuth, como el que tiene auth:

| Qué | Nombre |
|---|---|
| Carpeta | `oauth-grant` |
| Clase del módulo | `OauthGrant_Module` |
| Nombre del módulo (`super('…')`) | `oauthGrant` |
| Entidad | `OauthGrant` |
| Repositorio | `OauthGrant_Repository` |
| Tabla | `oauth_grant` |
| Caso de uso | `oauthGrant.redeem` |
| Evento | `oauthGrant.replayed`, clase `OauthGrant_Replayed`, fichero `events/oauth-grant-replayed.ts` |
| Error | `errors/invalid-grant.ts`, código `oauthGrant.invalid_grant` |
| Cola de un worker | `token.revokeGrant.on.oauthGrant.replayed` |

La cola dice quién reacciona (`token`), con qué (`revokeGrant`) y a qué evento
(`oauthGrant.replayed`). Renombrar cualquiera de los tres renombra la cola, y deja los
jobs que ya esperaban con el nombre antiguo ([capítulo 11](./11-reacting)).

Un contexto tiene unos pocos ficheros propios junto a `modules/`: `<contexto>.context.ts`
(lo abre), `initialize-modules.ts` (cada módulo después de los que usa), su base y el tipo
de su configuración, `migrations/` y `testing/`.
