# Preguntar dos veces: POST idempotentes

Ana va en un tren. Escribe el título de una tarjeta y pulsa *Crear*. La petición llega a
cooper, la tarjeta se guarda como #14, y la respuesta se pierde en un túnel. Su
navegador no ha visto volver nada, así que lo intenta otra vez, o Ana vuelve a pulsar el
botón. cooper recibe un segundo POST, idéntico al primero, y crea la #15. Ana ya tiene
la misma tarjeta dos veces.

El servidor no puede distinguir un segundo envío de una tarjeta nueva con el mismo
título: los dos son válidos. Solo el cliente sabe que son la misma petición. Así que lo
dice el cliente: manda cada envío con una cabecera `Idempotency-Key`, un valor propio,
nuevo en cada envío e igual cuando vuelve a mandar ese mismo envío. El servidor recuerda
la primera respuesta a cada clave, y a una petición que ya ha visto le da esa respuesta
otra vez, sin ejecutar nada.

newt se encarga de recordar. Este capítulo lo activa en la única ruta de boards que lo
necesita: crear una tarjeta.

## Qué rutas lo necesitan

Una petición es segura de enviar dos veces cuando hacerla dos veces es lo mismo que
hacerla una. La mayoría de las de boards lo son. Un `PATCH` que renombra una tarjeta a
*Plan* la deja llamada *Plan* por muchas veces que llegue. Asignar una tarjeta a bea dos
veces la deja asignada a bea. Un `DELETE` enviado otra vez no encuentra nada que borrar.
Un movimiento enviado dos veces deja la tarjeta en la misma columna, al final o en la
misma posición.

Un POST que **crea** algo no lo es: cada uno hace una cosa nueva. En cooper eso es una
tarjeta nueva (el nombre de un tablero nuevo ya está cogido la segunda vez, una columna
nueva cuenta contra las diez; una tarjeta no tiene ninguna de las dos cosas). Esa es la
ruta que recibe la opción.

## La tabla

Las primeras respuestas se guardan en una tabla del store propio del contexto, así que
sobreviven a un reinicio y todos los procesos de boards ven las mismas. newt dice la
forma de la tabla en `KeptAnswer` (de `newt/http`); tú escribes su migración:

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00004_idempotency_key_up.sql
-- The first answer to each POST sent with an `Idempotency-Key`, as newt/http keeps it
-- (`KeptAnswer`): its id is the key's hash, with who sent it and where, and the
-- hash of the body it answered. The index is how the forgotten ones are removed.
CREATE TABLE idempotency_key (
  id TEXT PRIMARY KEY,
  version INTEGER NOT NULL,
  body_hash TEXT NOT NULL,
  status INTEGER NOT NULL,
  headers TEXT NOT NULL,
  body TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
CREATE INDEX idempotency_key_expires_at ON idempotency_key (expires_at);
```

```sql
-- cooper/backend/contexts/boards/migrations/sqlite/00004_idempotency_key_down.sql
DROP TABLE idempotency_key;
```

Cada fila es una clave:

- `id`: un hash de quién la envió, la ruta a la que se envió y la clave. La misma clave
  de bea, o enviada a las tarjetas de otro tablero, es otra fila: una persona no puede
  reproducir las respuestas de otra, y un cliente puede reutilizar una clave en otra
  dirección.
- `body_hash`: un hash del cuerpo de la petición, para distinguir una petición enviada
  otra vez de una distinta que reutilizó la clave.
- `status`, `headers`, `body`: la primera respuesta. `status` es 0 mientras la primera
  petición sigue ejecutándose.
- `expires_at`: cuándo se olvida la clave. El índice sobre ella es cómo se quitan las
  claves olvidadas.
- `version`, como toda fila: dos peticiones nunca cogen la misma clave a la vez.

## La ruta

En `card.routes.ts`, importa `KeptAnswer`:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
import type { KeptAnswer } from 'newt/http'
import type { BoardsBase } from '../../boards-base'
```

y dale al POST que crea una tarjeta su opción, `idempotency`, como tercer argumento de
la ruta:

```ts
// cooper/backend/contexts/boards/modules/card/card.routes.ts
  // A client may send it again with the same `Idempotency-Key` (its answer lost on the
  // way): it gets the card made the first time, kept in the store, not a second one.
  workspace.post('/boards/:boardId/cards', async request => {
    const input = await request.json() as CardCreateDTO
    return Response.json(await cards.create(request.params.boardId, input), { status: 201 })
  }, { idempotency: { table: base.store.table<KeptAnswer>('idempotency_key') } })
```

Ese es todo el código. El manejador de la ruta es el mismo; el caso de uso no sabe nada
de claves. `idempotency` es una opción de ruta como `public` y `cors`; un grupo o un
router entero también puede recibirla, y se aplica solo a sus POST. Admite:

- `table`: dónde se guardan las respuestas, `base.store.table<KeptAnswer>('idempotency_key')`.
- `ttlMs`: cuánto tiempo se recuerda una clave. Un día, si no se dice otra cosa.
- `clock`: lo que da la hora. El real, si no se dice otra cosa; el capítulo
  [19](./19-invitations-and-time) da a un contexto un reloj que un test puede mover.

## Qué hace

Una petición **sin** la cabecera se ejecuta como siempre: la opción no cambia nada para
un cliente que no manda claves.

Una petición **con** una clave que la tabla no tiene (o ha olvidado) la coge antes de
que se ejecute la ruta: una fila con `status` 0, el hash del cuerpo y una caducidad a un
minuto. Después se ejecuta la ruta.

- Si responde, y la respuesta no es un 5xx, la respuesta se guarda: su estado, sus
  cabeceras y su cuerpo, hasta `ttlMs` a partir de ese momento. El cliente la recibe
  como siempre.
- Si lanza un error (cualquiera: `card.too_many`, un error de validación, un tablero que
  no existe) o responde un 5xx, la fila se borra y el error se responde como siempre.
  **Lo que falla no se guarda**, así que la misma clave puede volver a intentarlo: una
  tarjeta rechazada porque el tablero estaba lleno puede crearse con la misma clave
  cuando haya sitio.

Una petición con una clave que la tabla **tiene**, de la misma persona a la misma ruta:

- **El mismo cuerpo, ya respondida**: recibe la respuesta guardada, estado, cabeceras y
  cuerpo, más una cabecera, `idempotent-replayed: true`. La ruta no se ejecuta. No hay
  segunda tarjeta.
- **El mismo cuerpo, todavía en marcha**: la primera petición aún no ha respondido (el
  cliente se cansó de esperar y la mandó otra vez). Es un **409**,
  `idempotency_key_in_use`: inténtalo de nuevo cuando termine. Si llegan a la vez dos
  peticiones con una clave nueva, una inserta la fila y la otra choca con ella, y recibe
  el mismo 409.
- **Otro cuerpo**: la clave se usó para una petición distinta. Es un error del cliente,
  y ejecutarla respondería dos cosas distintas a una clave. Es un **422**,
  `idempotency_key_reused`, tanto si la primera está respondida como si sigue en marcha.

El cuerpo se compara byte a byte, por su hash: un cliente manda un envío otra vez
exactamente como lo mandó la primera.

**Caducidad.** Una clave se recuerda durante `ttlMs` (un día) después de guardar su
respuesta; pasado ese tiempo, la misma clave es una petición nueva, y crearía una
tarjeta nueva. Un día es mucho más de lo que reintenta cualquier cliente. Mientras se
ejecuta la primera petición, su clave caduca al cabo de un minuto (o de `ttlMs`, si es
menos): si el proceso muere a medias, la clave no se queda retenida un día. Pasado ese
minuto, otra petición puede quedarse con la clave; si la primera acabara a pesar de
todo, lo que habría guardado se descarta, y la respuesta guardada es la de la segunda.

**Limpieza.** Las claves olvidadas se quitan según llegan las nuevas: una petición con
clave empieza borrando las filas cuyo `expires_at` ha pasado, como mucho una vez por
minuto para cada tabla. Para eso es el índice sobre `expires_at`. No hay ningún job que
programar.

### Los errores

Los dos son de newt, de `newt/http`, y se responden como cualquier otro:
`IdempotencyKeyInUse` es un `ConflictError` (409); `IdempotencyKeyReused` es un 422. Sus
mensajes son los propios de newt salvo que los cambies con `setMessages`, como hace
cooper con otros (capítulo [3](./03-pages-and-errors)); el `code` no cambia nunca, y es
lo que usa un cliente para actuar.

### El cliente

La clave la hace el cliente: una aleatoria nueva cada vez que la persona envía el
formulario (`crypto.randomUUID()`), conservada mientras ese envío se manda otra vez y
nunca reutilizada para otro. El frontend de cooper lo hace en su API de tarjetas, que el
capítulo [23](./23-frontends) recorre.

## Test

En `boards.context.test.ts`, después del test que guarda un tablero, sus columnas y sus
tarjetas, añade uno que envía dos veces con la misma clave y una con otra. Usa `fetch`
directamente, para mandar la cabecera y leer la de la respuesta:

```ts
// cooper/backend/contexts/boards/boards.context.test.ts
  test('creates a card once for a submit sent twice with the same Idempotency-Key', async () => {
    const id = (await call<{ id: string }>('POST', '/acme/boards', { name: 'Roadmap' })).body.id
    const todo = (await call<{ id: string }>('POST', `/acme/boards/${id}/columns`, { name: 'To do' })).body.id
    const submit = (key: string) => fetch(new URL(`/api/workspaces/acme/boards/${id}/cards`, server.url), {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-user': 'ana', 'idempotency-key': key },
      body: JSON.stringify({ columnId: todo, title: 'Plan' }),
    })

    const first = await submit('submit-1')
    const again = await submit('submit-1')
    expect([first.status, again.status, again.headers.get('idempotent-replayed')]).toEqual([201, 201, 'true'])
    expect(await again.json()).toEqual(await first.json())
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/cards`)).body).toHaveLength(1)

    expect((await submit('submit-2')).status).toBe(201)
    expect((await call<unknown[]>('GET', `/acme/boards/${id}/cards`)).body).toHaveLength(2)
  })
```

El segundo envío recibe el mismo 201 y la misma tarjeta, dice que fue reproducido, y el
tablero tiene una tarjeta. Una clave nueva es un envío nuevo: una segunda tarjeta.

## Compruébalo

```sh
bun install && bun check && bun test cooper && bun run lint
```

Luego, a mano. Arranca el backend (`bun cooper/backend/index.ts`): ejecuta la migración
00004 al abrirse. Crea un tablero con una columna, y manda dos veces el mismo envío:

```sh
API=http://localhost:3002/api/workspaces/acme
H='content-type: application/json'
BOARD=$(curl -s -X POST $API/boards -H "$H" -H 'x-user: ana' -d "{\"name\":\"Train $RANDOM\"}" | jq -r .id)
COLUMN=$(curl -s -X POST $API/boards/$BOARD/columns -H "$H" -H 'x-user: ana' -d '{"name":"To do"}' | jq -r .id)
KEY=$(uuidgen)
submit() { curl -si -X POST $API/boards/$BOARD/cards -H "$H" -H 'x-user: ana' -H "idempotency-key: $KEY" -d "$1"; }
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Plan\"}" | grep -i -E '^HTTP|^idempotent-replayed'
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Plan\"}" | grep -i -E '^HTTP|^idempotent-replayed'
curl -s $API/boards/$BOARD/cards -H 'x-user: ana' | jq length
```

```text
HTTP/1.1 201 Created
HTTP/1.1 201 Created
idempotent-replayed: true
1
```

La misma clave con otro cuerpo:

```sh
submit "{\"columnId\":\"$COLUMN\",\"title\":\"Design\"}" | tail -1
```

```text
{"error":"This Idempotency-Key was sent before with another body: send a new key for another request","code":"idempotency_key_reused"}
```

con estado 422.

## En resumen

- Un POST que crea algo no es seguro de enviar dos veces; el cliente marca cada envío
  con una `Idempotency-Key`, y la ruta recibe `{ idempotency: { table } }`.
- La primera respuesta se guarda en el store del contexto (`KeptAnswer`, con su
  migración), por persona, ruta y clave, durante un día salvo que `ttlMs` diga otra
  cosa; una petición enviada otra vez la recibe con `idempotent-replayed: true`, y no se
  ejecuta nada.
- Lo que falla (un error lanzado, un 5xx) no se guarda: la misma clave puede volver a
  intentarlo.
- La misma clave mientras la primera sigue en marcha es un 409
  (`idempotency_key_in_use`), como mucho durante un minuto; con otro cuerpo es un 422
  (`idempotency_key_reused`).
- Las claves olvidadas se quitan según llegan las nuevas, como mucho una vez por minuto:
  no hace falta ningún job.

Siguiente: [Eventos](./10-events).
