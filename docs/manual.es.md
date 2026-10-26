# Construir un backend con newt

*Un manual paso a paso, de la primera línea a producción.*

---

## Índice

- [Prólogo](#prólogo)
- [Parte I · Las ideas](#parte-i--las-ideas)
- [Parte II · Primeros pasos](#parte-ii--primeros-pasos)
- [Parte III · Guardar sin miedo](#parte-iii--guardar-sin-miedo)
- [Parte IV · Eventos y consistencia eventual](#parte-iv--eventos-y-consistencia-eventual)
- [Parte V · Hacer crecer la aplicación](#parte-v--hacer-crecer-la-aplicación)
- [Parte VI · Dónde viven los datos](#parte-vi--dónde-viven-los-datos)
- [Parte VII · Calidad y producción](#parte-vii--calidad-y-producción)
- [Apéndices](#apéndices)

---

## Prólogo

Este manual enseña a construir un backend con `newt`. Va de lo sencillo
a lo complejo, como un libro: cada capítulo se apoya en el anterior, y al acabar
habrás construido una aplicación entera y sabrás por qué está hecha como está.

No explica cómo funciona el framework por dentro. Explica **cómo se usa**: qué
piezas hay, cómo se combinan, qué garantiza cada una y qué decisiones te toca tomar
a ti. Cuando el manual dice "el framework garantiza X", puedes confiar en ello sin
saber cómo lo consigue.

### Qué vamos a construir

**La Despensa**, la tienda online de un ultramarinos. Tiene:

- un **catálogo** de productos con su precio, su **marca** y su **categoría**, y una
  búsqueda con filtros;
- el **stock** de cada producto, que sube cuando llega mercancía y baja cuando se
  vende;
- **pedidos**: un cliente pide, la tienda reserva el stock en segundo plano y
  confirma el pedido, o lo rechaza si no queda; y si el cliente lo cancela, el stock
  vuelve;
- **avisos por email** cuando un pedido se confirma o se rechaza.

Es pequeña, pero tiene todos los problemas de una aplicación real: dos clientes que
compran las últimas unidades a la vez, un email que no se puede "deshacer", un
servidor que se cae a mitad de trabajo. Resolverlos bien es de lo que trata este
libro.

El código completo, con sus tests, está en
[`examples/despensa`](../examples/despensa). Puedes arrancarlo y seguir el manual
con él al lado:

```sh
# datos en ficheros, en data/despensa
bun examples/despensa/main.ts

# o en SQLite, en data/despensa.db
STORE=sqlite bun examples/despensa/main.ts
```

### Convenciones

- El código está en inglés (nombres, comentarios, mensajes); las explicaciones, en
  castellano.
- Los importes van en céntimos y sin decimales: 12,50 € es `1250`.
- Los diagramas usan [Mermaid](https://mermaid.js.org); GitHub y la mayoría de
  editores los dibujan.
- Necesitas [Bun](https://bun.sh) 1.4 o posterior. El framework solo funciona con Bun.

---

# Parte I · Las ideas

## 1. El mapa

Antes de escribir código, conviene tener el mapa. Un backend hecho con este
framework se compone de unas pocas piezas, siempre las mismas.

| Pieza | Qué es | En La Despensa |
|---|---|---|
| **Contexto** | Una parte de la aplicación con sus propios datos y su propio servidor. | `shop`: la tienda entera. |
| **Módulo** | Una responsabilidad dentro de un contexto: unos datos, sus reglas y lo que pasa cuando cambian. | `brand`, `category`, `product`, `stock-movement`, `order`, `notification`. |
| **Entidad** | Lo que un módulo guarda, con su comportamiento. | `Product`, `StockMovement`, `Order`. |
| **Caso de uso** | Cada cosa que se puede pedir a un módulo. | `product.create`, `order.place`. |
| **Repositorio** | Lo único que lee y escribe las entidades de un módulo. | `Product_Repository`. |
| **Store** | Donde el contexto guarda sus datos: ficheros, SQLite… | `FileStore` o `SqliteStore`. |
| **Evento** | Algo que ha pasado, contado a quien quiera escucharlo. | `order.placed`, `order.confirmed`. |
| **Worker** | Código que reacciona a un evento, después y por su cuenta. | Reservar el stock de un pedido, enviar un email. |

Así viaja una petición por estas piezas:

```mermaid
flowchart LR
    C([Cliente]) -->|POST /api/orders| R[Ruta]
    R -->|order.place| UC[Caso de uso]
    UC -->|crea| E[Entidad Order]
    UC -->|persist| REP[Repositorio]
    REP -->|transacción| S[(Store)]
    REP -. evento order.placed .-> W[Worker]
    W -->|order.fulfil| UC2[Otro caso de uso]
```

Fíjate en la flecha discontinua. La ruta responde al cliente en cuanto el pedido
está guardado; el worker trabaja después, por su cuenta. Esa separación entre
**lo que pasa ahora** y **lo que pasa enseguida** es la idea más importante del
libro, y tiene nombre: *consistencia eventual*. Le dedicaremos la Parte IV entera.

## 2. Las reglas que nunca se rompen

Unas pocas reglas mantienen el código ordenado mientras la aplicación crece. Aquí
van todas juntas. No hace falta entenderlas aún: cada una se explica en su capítulo,
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
10. **Un módulo apunta a lo de otro solo por su id**, nunca por la entidad ni por su tabla.
11. **Ninguna lista se devuelve entera**: se pagina.

---

# Parte II · Primeros pasos

## 3. Preparar el proyecto

Crea un proyecto con Bun y añade el framework y `zod`, con el que se describen los
datos:

```sh
mkdir despensa && cd despensa
bun init -y
bun add newt zod
```

El framework usa los decoradores estándar de TypeScript (`@UseCase()`). En tu
`tsconfig.json` **no** actives `experimentalDecorators`:

```json
{
  "compilerOptions": {
    "target": "ES2023",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "types": ["bun"],
    "strict": true,
    "noEmit": true
  }
}
```

La estructura de carpetas que usaremos es esta:

```
despensa/
├── main.ts                 arranca el servidor
├── shop.context.ts         el contexto: abre el store y los módulos
├── shop-base.ts            lo que recibe cada módulo
├── archived-from.ts        lee `?archived=` de una petición: una convención de la tienda
├── migrations/             los cambios de estructura de SQLite
└── modules/
    ├── brand/
    ├── category/
    ├── product/
    ├── stock-movement/
    ├── order/
    └── notification/
```

Cada módulo tiene su carpeta, y dentro siempre los mismos ficheros. Los iremos
creando uno a uno en el capítulo 5; el [Apéndice B](#b-anatomía-de-un-módulo) los
resume.

El framework se importa por estas puertas, y por ninguna más:

| Import | Para qué |
|---|---|
| `newt/core` | Lo esencial: módulos, entidades, casos de uso, eventos, errores, el actor, qué buscar (criterios) y los filtros que manda un cliente. |
| `newt/repository` | Los repositorios: donde un módulo lee y guarda sus entidades. |
| `newt/port-store` | El puerto de almacenamiento: lo que implementa un store. |
| `newt/runtime` | Un contexto en marcha: `Base`, `BoundedContext`. |
| `newt/port-outbox`, `newt/port-analytics` | Los puertos de los jobs y de la analítica: para quien escriba un adaptador. |
| `newt/sql` | Lo que comparten los stores SQL: para quien escriba uno. |
| `newt/adapter-files` | El store de ficheros. |
| `newt/adapter-sqlite` | El store de SQLite. |
| `newt/adapter-postgres` | El store de PostgreSQL. |
| `newt/adapter-mysql` | El store de MySQL. |
| `newt/kysely` | Consultas propias con Kysely, sobre el store (opcional). |
| `newt/http` | El router HTTP y el servidor (opcional). |
| `newt/port-store/contract`, `newt/port-analytics/contract` | Los contratos que comprueban un adaptador: para quien escriba uno. |

De momento usarás `newt/core`, `newt/repository`, `newt/port-store`, `newt/runtime`,
la de ficheros y la de HTTP. Las de los otros stores y la de Kysely aparecen en los
capítulos 24 y 26; las de puertos y contratos son para quien escriba un adaptador
(capítulo 28, y [`stores.md`](stores.md)).

## 4. El contexto y su base

### 4.1 La base: lo que recibe cada módulo

Cada módulo, al nacer, recibe la **base** de su contexto. En ella tiene todo lo
que necesita: el store donde se guardan los datos, el bus de eventos, la cola de
trabajos de los workers…

El framework te da una `Base`. Tu aplicación la amplía con lo que quiera dar a sus
módulos; en nuestro caso, un router HTTP para que cada módulo registre sus rutas:

```ts
// shop-base.ts
import { Base } from 'newt/runtime'
import type { Store } from 'newt/port-store'
import { HttpRouter } from 'newt/http'

export class ShopBase extends Base<Store> {
  readonly http = new HttpRouter()
}
```

`Base<Store>` dice que los módulos de la tienda funcionan con **cualquier** store.
Si algún día un módulo necesitara algo propio de SQLite, escribirías
`Base<SqliteStore>`. Mientras no haga falta, mejor así: podrás cambiar de store sin
tocar los módulos.

### 4.2 El contexto

El contexto abre el store, crea la base, inicializa los módulos y sabe arrancar y
pararse:

```ts
// shop.context.ts
import { BoundedContext } from 'newt/runtime'
import { FileStore } from 'newt/adapter-files'
import { serve } from 'newt/http'
import { ShopBase } from './shop-base'

export class Shop_Context extends BoundedContext<ShopBase> {

  private constructor(
    base: ShopBase,
    readonly modules: ReturnType<typeof initializeModules>,
  ) {
    super('shop', base)
  }

  static async open(): Promise<Shop_Context> {
    const store = await FileStore.open({ folder: 'data/despensa' })
    const base = new ShopBase({ name: 'shop', store })
    base.http.authenticateWith(async request => {
      const userId = request.headers.get('x-user')
      return userId ? { userId } : null
    })
    return new Shop_Context(base, initializeModules(base))
  }

  serve(port: number) {
    return serve({ port, router: this.base.http })
  }
}
```

Cuatro cosas que observar:

- **`FileStore.open`** abre (y crea, si no existe) una carpeta donde cada registro
  es un fichero JSON. Es perfecto para empezar: no hay nada que instalar, y puedes
  abrir los ficheros y ver tus datos. En el capítulo 24 pasaremos a SQLite cambiando
  una línea.
- **`authenticateWith`** le dice al router quién envía cada petición. Aquí, para no
  complicar el ejemplo, lo dice una cabecera `x-user`. Una aplicación real leería
  su cookie de sesión. Lo importante es lo que devuelve: un **actor**, es decir, quién
  está haciendo lo que se está haciendo. Le dedicamos el capítulo 7.
- **`initializeModules`** crea los módulos. Lo iremos rellenando según los
  escribamos.
- **`open()` no recibe nada todavía.** Según crezca la tienda, recibirá su
  configuración: el `mailer` de los avisos (capítulo 16) y qué store abrir (capítulo
  24). El ejemplo completo la recibe como `ShopConfig`: `Shop_Context.open(config)`.

### 4.3 Arrancar

```ts
// main.ts
import { Shop_Context } from './shop.context'

const context = await Shop_Context.open()
const server = context.serve(3000)
context.start()          // arranca los workers
console.log(`despensa listening on ${server.url}`)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await server.stop()   // deja de aceptar peticiones
    await context.stop()  // espera a los workers en curso y cierra el store
    process.exit(0)
  })
}
```

`context.start()` arranca el bucle que ejecuta los workers, en este mismo proceso.
`context.stop()` espera a que terminen los que están en marcha antes de cerrar: así
un reinicio no corta ningún trabajo a la mitad.

## 5. Tu primer módulo: el catálogo

Vamos a construir el módulo `product`, fichero a fichero. Es el corazón de La
Despensa y sirve de plantilla para todos los demás.

```
modules/product/
├── product.schema.ts         el contrato: qué datos entran y salen
├── product.ts                la entidad
├── events/                   lo que puede pasar
│   ├── product-created.ts
│   └── product-updated.ts
├── errors/                   lo que puede salir mal
│   ├── product-not-found.ts
│   └── product-name-taken.ts
├── product.repository.ts     cómo se guarda
├── product.deps.ts           los módulos que usa
├── product.module.ts         los casos de uso
└── product.routes.ts         la API HTTP
```

Un producto tiene nombre, precio, y opcionalmente una **marca** y una **categoría**.
Marcas y categorías son módulos propios (`brand`, `category`), más sencillos aún que
este: un nombre y poco más. Aquí el producto solo guarda sus ids; cómo se apunta de
un módulo a otro lo vemos con calma en el capítulo 20.

### 5.1 El contrato

Todo empieza por describir los datos con `zod`. Este fichero es el **contrato
público** del módulo: lo que entra en sus casos de uso y lo que sale de ellos.

```ts
// product.schema.ts
import { z } from 'zod'

export const ProductSchema = z.object({
  id: z.uuidv7(),
  name: z.string().trim().min(1).max(80),
  priceCents: z.number().int().min(0),
  brandId: z.string().nullable(),       // de otro módulo: solo su id
  categoryId: z.string().nullable(),
  archived: z.boolean(),
  createdAt: z.string().default(''),
  updatedAt: z.string().default(''),
})

export const ProductCreateSchema = ProductSchema.pick({
  name: true,
  priceCents: true,
}).extend({
  brandId: ProductSchema.shape.brandId.default(null),
  categoryId: ProductSchema.shape.categoryId.default(null),
})
export const ProductUpdateSchema = ProductSchema.pick({
  name: true,
  priceCents: true,
  brandId: true,
  categoryId: true,
  archived: true,
}).partial()
export const ProductFiltersSchema = z.object({
  archived: z.boolean().optional(),
})

export type ProductDTO = z.infer<typeof ProductSchema>
export type ProductCreateDTO = z.input<typeof ProductCreateSchema>
export type ProductUpdateDTO = z.input<typeof ProductUpdateSchema>
export type ProductFiltersDTO = z.infer<typeof ProductFiltersSchema>
```

- **`ProductSchema`** es el producto completo. Su tipo, `ProductDTO`, es lo que
  verán los demás módulos y la API: un *DTO* (objeto de transferencia), datos planos
  sin comportamiento.
- Los esquemas de **entrada** (`Create`, `Update`) solo tienen lo que el cliente puede
  mandar. Nadie manda un `id` ni unas fechas: los pone el sistema. Y se **derivan**
  del completo con `pick`: cada regla (un nombre de 1 a 80 letras) se escribe una
  sola vez.
- `archived` en lugar de borrar: un producto que ya no se vende sigue existiendo,
  porque hay pedidos antiguos que lo nombran.
- Todo lo que exporta el fichero empieza por el nombre de la entidad (`Product…`).
  Así se lee igual desde cualquier sitio.

### 5.2 La entidad

La entidad es el esquema **más su comportamiento**. Guarda los datos válidos, sabe
qué ha cambiado y anota lo que ha pasado.

```ts
// product.ts
import { Entity, type EntityInput } from 'newt/core'
import { Product_Created } from './events/product-created'
import { Product_Updated } from './events/product-updated'
import { ProductSchema, type ProductDTO } from './product.schema'

export * from './product.schema'

export class Product extends Entity<typeof ProductSchema> {

  private constructor(input: EntityInput<ProductDTO>, isNew: boolean) {
    super(ProductSchema, input, isNew)
  }

  /** Uno que ya estaba guardado, con su versión: no ha pasado nada. */
  static fromDTO(dto: ProductDTO & { version: number }): Product {
    return new Product(dto, false)
  }

  /** Uno nuevo: aquí recibe su id y sus fechas. */
  static create(input: {
    name: string
    priceCents: number
    brandId: string | null
    categoryId: string | null
  }): Product {
    const product = new Product({ ...input, archived: false }, true)
    product.trackEvent(new Product_Created(product.toDTO()))
    return product
  }

  update(changes: Partial<Pick<ProductDTO,
    'name' | 'priceCents' | 'brandId' | 'categoryId' | 'archived'
  >>): void {
    this.change(changes)
    const diff = this.getChanges()
    if (diff) {
      this.trackEvent(new Product_Updated({
        dto: this.toDTO(),
        changes: diff,
        previous: this.getPrevious()!,
      }))
    }
  }
}
```

Las ideas que hay detrás:

- **Dos puertas de entrada.** `create` para algo nuevo, `fromDTO` para algo que se
  lee del store: la fila, que trae su `version`, y sin ella no se puede construir
  (al guardarla, la versión dice si alguien la cambió entretanto). Si una entidad es nueva lo decide
  la puerta por la que entra, nunca si trae `id` o no.
- **Solo la entidad se cambia a sí misma.** `change()` es protegido: desde fuera no
  se puede llamar. Un caso de uso llama a `update()`, `archive()`… métodos con
  nombre de negocio. `change()` valida la entidad entera contra el esquema (también
  sus `refine`), guarda los valores que este devuelve (recortados, por defecto…) e
  ignora lo que no cambia de verdad.
- **Sabe qué cambia.** `getChanges()` da los campos que cambiaron, tal como quedan;
  `getPrevious()`, esos mismos campos tal como estaban al leerla. Juntos son la
  transición que hará el guardado.
- **Anota lo que pasa.** `trackEvent` apunta un evento. No se publica todavía: se
  publicará cuando la entidad se guarde, y solo si el guardado sale bien
  (capítulo 12).
- **Fuera de su módulo, una entidad no existe.** Los casos de uso devuelven
  `toDTO()`, nunca la entidad.
- **Tiene una versión**, que empieza en 0 y sube con cada guardado que la escribe. No
  la toques nunca: es la que protege de que dos personas se pisen (capítulo 9).

#### Sus métodos reciben datos de negocio, no el DTO de entrada

Fíjate en que `create` no recibe un `ProductCreateDTO`. Parece lo mismo, pero no lo
es:

- El **DTO de entrada** es el contrato de la API: lo que manda un cliente, *antes*
  de comprobarlo. Puede traer campos de más, textos sin recortar, cosas que no
  existen.
- Lo que recibe la entidad es lo que **necesita para nacer**, ya comprobado y a
  menudo **completado** por el caso de uso.

En el producto casi coinciden, pero en un pedido se ve la diferencia. El cliente
manda su email y las líneas (qué producto y cuántos). El pedido, para nacer,
necesita además **quién** lo hace y **a qué precio** va cada línea: dos cosas que
ningún cliente manda, porque no debe poder elegirlas. Las pone el caso de uso:

```ts
// el cliente manda esto (OrderPlaceDTO)
{ customerEmail: 'ana@ejemplo.es', lines: [{ productId, quantity: 2 }] }

// la entidad nace con esto (OrderPlacement)
Order.place({
  customerId: currentActor().userId,       // quién, del actor
  customerEmail,
  lines: priced,                           // cada línea, con su precio
})
```

La convención es sencilla:

- Si la entrada es **pequeña**, va escrita en línea, como en `Product.create`:
  `{ name, priceCents, … }`.
- Si **merece un nombre**, es un tipo con nombre de negocio en el fichero de la
  entidad: `OrderPlacement`, "lo que hace falta para hacer un pedido". Nunca con
  sufijo `DTO`, y nunca en el fichero del esquema, que es el contrato de la API.

```ts
// order.ts
/** Lo que hace falta para hacer un pedido: comprobado y con precios. */
export type OrderPlacement = {
  customerId: string
  customerEmail: string
  lines: OrderLineDTO[]
}
```

Así la API puede cambiar (un campo nuevo, otro nombre) sin tocar la entidad, y la
entidad no puede recibir por error algo sin comprobar.

### 5.3 Los eventos

Un evento es una clase pequeña con un nombre y un *payload* (lo que cuenta):

```ts
// events/product-created.ts
import type { DomainEvent } from 'newt/core'
import type { ProductDTO } from '../product.schema'

export class Product_Created implements DomainEvent<ProductDTO> {
  static readonly eventName = 'product.created'
  readonly name = Product_Created.eventName
  readonly occurredAt = new Date().toISOString()
  constructor(readonly payload: ProductDTO) {}
}
```

```ts
// events/product-updated.ts
/** Cómo queda, qué cambió y qué había antes. */
type ProductChange = {
  dto: ProductDTO
  changes: Partial<ProductDTO>
  previous: Partial<ProductDTO>
}

export class Product_Updated implements DomainEvent<ProductChange> {
  static readonly eventName = 'product.updated'
  // …igual que el anterior
}
```

El payload es JSON (`DomainEvent<T extends Json>`): una reacción `handler` lo recibe
del trabajo guardado, así que una fecha viaja como su texto ISO, nunca como `Date`. Y
es un `type`, no una `interface`, que TypeScript no acepta como JSON.

El nombre sigue la forma `<módulo>.<verbo en pasado>`. Para un `updated`, el payload
cuenta la **transición** entera:

- `dto`: el producto entero, tal como queda;
- `changes`: **solo** los campos que cambiaron, con su valor nuevo;
- `previous`: esos mismos campos, con el valor que tenían.

Si el precio pasa de 1000 a 1200, el evento dice `changes: { priceCents: 1200 }` y
`previous: { priceCents: 1000 }`. Quien escucha no tiene que volver a preguntar,
puede ignorar los cambios que no le interesan, y sabe de dónde venía cada uno (para
avisar de una subida de precio, por ejemplo).

**Cada tipo de evento se cuenta una vez por guardado.** Si un caso de uso llama dos
veces a `update` antes de guardar, no salen dos `product.updated`: el segundo
sustituye al primero, y el que se publica cuenta los dos cambios juntos, tal como
queda la entidad. Y si el segundo deshace el primero (de 1000 a 1200 y vuelta a
1000), no se guarda nada ni se publica nada: un cambio deshecho no es un cambio. Por
lo mismo, un evento va siempre con un cambio de la entidad: uno que no cambia nada no
se publica. Si en un mismo guardado te encuentras con dos tipos distintos (un
`created` y un `updated`), suele ser señal de que el caso de uso está haciendo dos
cosas.

### 5.4 Los errores

Cada cosa que puede salir mal es una clase con un `code` estable. La clase de la que
hereda decide el código HTTP:

```ts
// errors/product-not-found.ts
import { NotFoundError } from 'newt/core'

export class ProductNotFound extends NotFoundError {
  readonly code = 'product.not_found'
  constructor(id: string) {
    super(`There is no product ${id}`)
  }
}
```

```ts
// errors/product-name-taken.ts
import { ConflictError } from 'newt/core'

export class ProductNameTaken extends ConflictError {
  readonly code = 'product.name_taken'
  constructor(name: string) {
    super(`There is a product called ${name} already`)
  }
}
```

`NotFoundError` responde un 404 y `ConflictError` un 409. En el capítulo 22 está la
tabla completa.

### 5.5 El repositorio

El repositorio es **lo único** que lee y escribe productos. Cuando las entidades son
las filas de una tabla, como aquí, basta con heredar de `TableRepository` y decir
cómo una fila se convierte en entidad:

```ts
// product.repository.ts
import { TableRepository } from 'newt/repository'
import type { ShopBase } from '../../shop-base'
import { Product, type ProductDTO } from './product'

export type ProductRow = ProductDTO & { version: number }

export class Product_Repository
  extends TableRepository<Product, ProductRow, ShopBase> {

  constructor(base: ShopBase) {
    super(base, base.store.table<ProductRow>('product', {
      types: { archived: 'boolean' },
      unique: [['name']],
    }))
  }

  protected toEntity(row: ProductRow): Product {
    return Product.fromDTO(row)
  }
}
```

Con eso ya tienes `find`, `first`, `count`, `page` y `persist`. Las opciones de la
tabla se dicen **con las mismas palabras para cualquier store**: `types` avisa de los
campos que algunos stores no guardan tal cual (SQLite guarda los booleanos como 0 y
1), y `unique` dice qué campos no pueden repetirse. El store de ficheros lo comprueba
él; uno SQL lo sabe por el índice único de su migración (capítulo 25), y esta opción
la ignora.

Para buscar se usan **criterios**, campo a campo:

```ts
repo.find({ archived: false })                    // igual a
repo.find({ id: { in: ids } })                    // uno de estos
repo.count({ name: { ieq: 'aceite' } })           // sin mirar mayúsculas (de la A a la Z)
repo.find({ priceCents: { gte: 100, lt: 500 } })  // entre 1 € y 5 €
repo.page({ archived: false }, { size: 20 })      // una página
```

Los operadores son `eq`, `ne`, `in`, `gt`, `gte`, `lt`, `lte` e `ieq`. Un campo que
vale `undefined` no es ninguna condición: un filtro opcional no necesita `if`. Los
campos de un criterio se cumplen todos a la vez; para combinar grupos con "o" hay
`and` y `or`, que veremos en el capítulo 27.

### 5.6 El módulo y sus casos de uso

El módulo junta todo: el repositorio, los eventos que ofrece a los demás y sus
casos de uso.

```ts
// product.module.ts
import { eventsOf, Module, UseCase, type Page, type PageRequest } from 'newt/core'
// …imports del módulo

export class Product_Module extends Module {

  static initialize(
    base: ShopBase,
    deps: Product_Deps,
  ): Product_Module {
    const repo = new Product_Repository(base)
    const module = new Product_Module(base, repo, deps)
    registerProductRoutes(base, module)
    return module
  }

  readonly events

  private constructor(
    base: ShopBase,
    private readonly repo: Product_Repository,
    private readonly deps: Product_Deps,
  ) {
    super('product', base.invocations)
    this.events = eventsOf(base.bus, {
      created: Product_Created,
      updated: Product_Updated,
    })
  }

  @UseCase()
  async create(input: ProductCreateDTO): Promise<ProductDTO> {
    const { name, priceCents, brandId, categoryId } =
      ProductCreateSchema.parse(input)
    await this.assertNameFree(name)
    await this.assertReferences({ brandId, categoryId })  // capítulo 20
    const product = Product.create({
      name, priceCents, brandId, categoryId,
    })
    await this.repo.persist(product)
    return product.toDTO()
  }

  @UseCase()
  async update(id: string, input: ProductUpdateDTO): Promise<ProductDTO> {
    const changes = ProductUpdateSchema.parse(input)
    const product = await this.load(id)
    if (changes.name !== undefined) await this.assertNameFree(changes.name, id)
    await this.assertReferences(changes)
    product.update(changes)
    await this.repo.persist(product)
    return product.toDTO()
  }

  @UseCase()
  async list(
    filters: ProductFiltersDTO,
    page: PageRequest,
  ): Promise<Page<ProductDTO>> {
    const criteria = ProductFiltersSchema.parse(filters)
    const found = await this.repo.page(criteria, page)
    return {
      items: found.items.map(product => product.toDTO()),
      hasMore: found.hasMore,
      total: found.total,
    }
  }

  @UseCase()
  async get(id: string): Promise<ProductDTO> {
    return (await this.load(id)).toDTO()
  }

  private load(id: string): Promise<Product> {
    return this.resolve(
      () => this.repo.find({ id }),
      () => new ProductNotFound(id),
    )
  }

  private async assertNameFree(name: string, exceptId?: string): Promise<void> {
    const taken = await this.repo.count({
      name: { ieq: name },
      id: exceptId === undefined ? undefined : { ne: exceptId },
    })
    if (taken > 0) throw new ProductNameTaken(name)
  }
}
```

- `super('product', …)` da nombre al módulo, y **`@UseCase()`** convierte cada
  método en un caso de uso que se llama `product.create`, `product.update`… Esos
  nombres son los que verás en las trazas (capítulo 30).
- **`events`** reúne los eventos que el módulo ofrece a los demás.
  `eventsOf(base.bus, { created: Product_Created, … })` los construye con sus
  tipos, y desde fuera se leen como lo que son: `products.events.created`,
  `products.events.updated`. Lo usaremos en el capítulo 13.
- **`deps`** son los módulos que este usa: aquí `brand` y `category`, para
  comprobar que la marca y la categoría que manda el cliente existen. Se declaran en
  `product.deps.ts` y se explican en el capítulo 19.
- `static initialize` crea el módulo y registra sus rutas. Es lo que llama el contexto.
- Si al guardar alguien cambió el producto entretanto, el caso de uso se repite solo:
  lo veremos en el capítulo 9.

### 5.7 Las rutas

Una ruta lee la petición, llama a un caso de uso y responde. **Nada más.** Toda la
lógica vive en el caso de uso, para que funcione igual llamada desde HTTP, desde un
script o desde otro módulo.

```ts
// product.routes.ts
import { pageRequestFrom } from 'newt/http'
// `?archived=true|false`: una convención de la tienda, no del framework.
import { archivedFrom } from '../../archived-from'

export function registerProductRoutes(
  base: ShopBase,
  products: Product_Module,
): void {
  base.http.get('/products', async request => {
    const filters = { archived: archivedFrom(request) }
    return Response.json(await products.list(filters, pageRequestFrom(request)))
  })

  base.http.post('/products', async request => {
    const input = await request.json() as ProductCreateDTO
    return Response.json(await products.create(input), { status: 201 })
  })

  base.http.get('/products/:id', async request =>
    Response.json(await products.get(request.params.id)))

  base.http.patch('/products/:id', async request => {
    const input = await request.json() as ProductUpdateDTO
    return Response.json(await products.update(request.params.id, input))
  })
}
```

- Todas las rutas cuelgan de `/api`: `/products` es `/api/products`.
- El camino tipa los parámetros: en `/products/:id`, `request.params.id` existe y es
  un `string`.
- **Toda ruta exige un actor**, salvo que la registres con `{ public: true }`. Sin
  `x-user`, responde 401.
- No hay `try/catch`. Si el caso de uso lanza un `ProductNotFound`, el router
  responde 404 con `{ error, code }`. Un dato de entrada mal formado es un 400: un
  cuerpo que no es JSON (`malformed_body`), o uno que no pasa el esquema del caso de
  uso (`validation`, con sus `issues`). Un cuerpo JSON llega como
  `application/json` (o `…+json`); con otro `Content-Type` es un 415
  (`unsupported_media_type`). Cualquier otro error, un 500 que no cuenta nada de
  dentro.

### 5.8 Registrarlo

En el contexto, el módulo se inicializa en `initializeModules`, después de los
módulos que usa:

```ts
function initializeModules(base: ShopBase) {
  const brand = Brand_Module.initialize(base)
  const category = Category_Module.initialize(base)
  const product = Product_Module.initialize(base, { brand, category })
  return { brand, category, product }
}
```

`brand` y `category` se escriben igual que `product`, con menos campos: el
capítulo 20 los enseña.

### 5.9 Probarlo

```sh
$ curl -s -H 'x-user: ana' -H 'content-type: application/json' \
    -X POST localhost:3000/api/products \
    -d '{"name":"Aceite de oliva","priceCents":1000}'
{"id":"01a16de6-5178-…","name":"Aceite de oliva","priceCents":1000,
 "brandId":null,"categoryId":null,…}

$ curl -s -H 'x-user: ana' -H 'content-type: application/json' \
    -X POST localhost:3000/api/products \
    -d '{"name":"ACEITE DE OLIVA","priceCents":5}'
{"error":"There is a product called ACEITE DE OLIVA already",
 "code":"product.name_taken"}
```

Y en la carpeta del store:

```
data/despensa/product/01a16de6-5178-….json
```

Ábrelo: es tu producto, con un campo más, `version: 1`.

## 6. Casos de uso con criterio

Ya tienes un módulo funcionando. Antes de seguir, merece la pena detenerse en cómo
se escribe un buen caso de uso, porque todos siguen la misma forma.

### 6.1 La forma de un caso de uso

```mermaid
flowchart LR
    A[Validar la entrada] --> B[Cargar] --> C[Decidir]
    C --> D[Cambiar la entidad] --> E[Guardar] --> F[Devolver DTOs]
```

1. **Validar en la puerta**: `XCreateSchema.parse(input)`. A partir de aquí, los datos
   son de fiar.
2. **Cargar** lo que haga falta: la entidad, o datos de otros módulos a través de sus
   casos de uso.
3. **Decidir**: comprobar reglas ("¿está libre el nombre?").
4. **Cambiar la entidad** con sus métodos (`product.update(...)`).
5. **Guardar una vez, al final**: `repo.persist(...)`.
6. **Devolver DTOs**, nunca entidades.

### 6.2 Validar dos veces, a propósito

Si te fijas, un producto se valida **dos veces**: el caso de uso hace
`ProductCreateSchema.parse(input)`, y luego la entidad vuelve a comprobar cada campo
contra `ProductSchema`. No es un descuido. Son dos validaciones distintas, con dos
trabajos distintos:

| | En el caso de uso | En la entidad |
|---|---|---|
| Qué valida | Lo que **entra**: la petición del cliente | Su **estado**: lo que es un producto válido |
| Cómo es | Indulgente: recorta espacios, pone valores por defecto | Estricta: un dato inválido no entra nunca |
| Cuándo | Una vez, al llegar | En cada cambio, y también al leer del store |
| Si falla | Un 400, con lo que está mal, para el cliente | `InvalidEntity`, un error de programación: algo se coló. El cliente recibe un 500 que no cuenta nada; el log, el campo y el motivo |

La primera es para el cliente: le dice qué ha mandado mal. La segunda es la
garantía de que **ninguna** entidad inválida existe, venga de donde venga el cambio
(una ruta, un worker, un script, una fila vieja del store).

Y aun así, cada regla se escribe **una sola vez**: el esquema de entrada se deriva
del de la entidad con `pick`. Si mañana un nombre puede tener 120 letras, lo cambias
en `ProductSchema` y las dos validaciones lo saben.

### 6.3 Uno o ninguno: `resolve`

`this.resolve(buscar, siNoHay)` convierte una búsqueda en un resultado o un error. El
error lo eliges tú, porque depende de qué significa la falta:

- Si el id **es** lo que se pide (`GET /products/:id`), es un `NotFoundError` (404).
- Si el id va **dentro** de lo que se manda (un pedido que nombra un producto), es
  un `ReferenceNotFound` (400): lo que está mal es la petición.

### 6.4 Listas: siempre por páginas

Ninguna lista se devuelve entera. Un caso de uso que lista recibe un `PageRequest`
(`size`, `cursor`) y devuelve un `Page` (`items`, `hasMore`, `total`):

```ts
@UseCase()
async list(
  filters: ProductFiltersDTO,
  page: PageRequest,
): Promise<Page<ProductDTO>> {
  const criteria = ProductFiltersSchema.parse(filters)
  const found = await this.repo.page(criteria, page)
  return {
    items: found.items.map(product => product.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
}
```

El repositorio devuelve una página de **entidades**; el caso de uso la convierte en
una página de **DTOs**, escribiendo los tres campos uno a uno. Se podría abreviar,
pero así se lee exactamente lo que sale.

La ruta lee la página con `pageRequestFrom(request)`: `?size=20&cursor=<id>`. El
cursor es el id del último elemento que el cliente ya tiene. Como los ids son
UUIDv7, que se ordenan por fecha de creación, las páginas son estables aunque se
añadan productos mientras tanto.

```sh
GET /api/products?size=2
→ { items: [A, B], hasMore: true, total: 5 }

GET /api/products?size=2&cursor=<id de B>
→ { items: [C, D], hasMore: true, total: 5 }
```

Las páginas van de la más antigua a la más nueva. Para listados que se leen al
revés (la actividad, los últimos pedidos), pásale `{ newestFirst: true }`: empieza
por lo más nuevo y el cursor va hacia atrás.

```ts
const found = await this.repo.page(criteria, page, { newestFirst: true })
```

## 7. Quién y dónde: autenticación, autorización y ámbitos

Hasta ahora, quién hace cada cosa lo decía una cabecera `x-user`. Este capítulo
pone en orden tres preguntas que toda aplicación con usuarios tiene que responder:

- **¿Quién es?** La autenticación.
- **¿Puede hacer esto?** La autorización.
- **¿Sobre qué está trabajando?** Los ámbitos: el actor, y lo que tu aplicación
  añada, como el espacio de trabajo de una empresa.

### 7.1 El actor

Cada petición con sesión se ejecuta como su **actor**. Cualquier caso de uso, por
profundo que esté, sabe quién está actuando con `currentActor()`:

```ts
const order = Order.place({ customerId: currentActor().userId, … })
```

Nunca pases el id del usuario de mano en mano. Y cuando algo solo lo puede ver o
cambiar su dueño, el caso de uso **toma el actor, no un id**:

```ts
@UseCase()
async getMine(id: string): Promise<OrderDTO> {
  return (await this.resolve(
    () => this.repo.find({ id, customerId: currentActor().userId }),
    () => new OrderNotFound(id),
  )).toDTO()
}
```

Si `getMine` aceptara un `customerId` como parámetro, cualquiera podría leer los
pedidos de cualquiera. Así, un pedido ajeno es simplemente "no encontrado".

Fuera de HTTP (un script, una tarea programada), se actúa con `runAsActor`:

```ts
await runAsActor({ userId: 'admin' }, () =>
  shop.modules.product.create({ name: 'Sal', priceCents: 90 }))
```

### 7.2 Ampliar el actor

El framework solo sabe una cosa del actor: su `userId`. Si tu aplicación necesita
más (la sesión por la que entró, si es un asistente…), **amplía** el tipo `Actor`.
Se hace una vez, en un fichero que carguen todos los programas de la aplicación
(el servidor, los scripts, los tests):

```ts
// actor.ts
import 'newt/core'

declare module 'newt/core' {
  interface Actor {
    /** La sesión por la que entró; null con un token de acceso. */
    sessionId: string | null
  }
}
```

```ts
// shop-base.ts
import './actor'
```

A partir de ahí, TypeScript lo sabe en todas partes:

- `currentActor().sessionId` existe y es `string | null`;
- `authenticateWith` **tiene** que devolverlo, o no compila;
- y `runAsActor` también lo exige: `runAsActor({ userId, sessionId: null }, …)`.

Amplía el actor con **quién** es, nunca con **qué puede hacer**. Enseguida verás
por qué.

### 7.3 Autenticación: quién es

`authenticateWith` recibe la petición y devuelve el actor, o `null` si no hay
sesión (y entonces el router responde 401). En una aplicación real lee una cookie y
pregunta a un módulo de sesiones, **a través de un caso de uso**:

```ts
base.http.authenticateWith(async request => {
  const token = request.cookies.get('session')
  return token ? sessions.whoIs(token) : null
})
```

Y ese módulo guarda **solo el hash** de cada token, nunca el token:

```ts
// session.module.ts
@UseCase()
async start(userId: string): Promise<SecretToken> {
  const token = SecretToken.generate()
  const hash = SecretToken.hash(token)
  await this.repo.persist(Session.start({ userId, hash }))
  return token                       // va a la cookie, y nunca más aquí
}

@UseCase()
async whoIs(value: string): Promise<Actor | null> {
  const token = SecretToken.schema.safeParse(value)
  if (!token.success) return null
  const session = await this.repo.first({
    hash: SecretToken.hash(token.data),
  })
  return session ? { userId: session.userId, sessionId: session.id } : null
}
```

`SecretToken` es un value object del framework (capítulo 21): 32 bytes al azar,
y su `hash`. Si alguien se lleva una copia de la base de datos, no le sirve para
entrar como nadie: tiene hashes, no tokens.

### 7.4 Autorización: puede hacerlo

Saber quién es no dice qué puede hacer. Eso lo decide **el módulo que lo sabe**, y
se le pregunta **cada vez**, desde el caso de uso:

```ts
@UseCase()
async archive(workspaceId: string, id: string): Promise<void> {
  await this.deps.members.assertActive(workspaceId)  // si no, 404
  // …
}
```

Tres decisiones, y su porqué:

- **Los permisos no van en el actor.** El actor se calcula al entrar la petición; si
  llevara los permisos, quitarle uno a alguien no contaría hasta su próxima sesión.
  Preguntando al módulo cada vez, cuenta al instante.
- **Pregunta el caso de uso, no la ruta.** Así vale igual desde HTTP, un script o
  un asistente: no hay una puerta trasera que se olvidó de comprobar.
- **404, no 403.** A quien no es miembro de algo no se le dice "no puedes", se le
  dice "no existe". Una cosa privada no confiesa que existe.

### 7.5 Ámbitos: trabajar dentro de algo

Imagina que La Despensa crece y la usan varias tiendas, cada una con sus productos.
Casi todo lo que se hace, se hace **dentro de una tienda**: el espacio de trabajo
(*workspace*). Podrías pasar un `workspaceId` a cada caso de uso y comprobar en cada
uno que el actor es miembro… y olvidarlo en uno.

El framework te deja definir **ámbitos** (*scopes*): un valor que viaja con el
trabajo igual que el actor, puesto una vez donde el trabajo entra y leído en
cualquier punto por debajo. El actor es uno de ellos; los demás los define tu
aplicación con `defineScope`:

```ts
// workspace.ts
import { defineScope } from 'newt/core'

export type Workspace = {
  workspaceId: string
  role: 'admin' | 'member'
}

export const workspace = defineScope<Workspace>('workspace')
```

Un ámbito tiene tres métodos: `run(valor, fn)` ejecuta `fn` dentro de él,
`current()` lo lee (y lanza un error si no hay ninguno) y `find()` lo lee si lo hay.

Para no repetir la comprobación en cada ruta, las rutas que comparten prefijo
pueden compartir un **middleware** con `http.group`. El middleware se ejecuta
después de comprobar la sesión, alrededor de cada ruta del grupo: puede responder
él (un error) o seguir con `next()`, aquí dentro del ámbito:

```ts
const workspaces = base.http.group(
  '/workspaces/:workspaceId',
  async (request, next) => workspace.run(
    await members.enter(request.params.workspaceId),  // 404 si no es miembro
    next,
  ),
)

workspaces.get('/products', async request =>
  Response.json(await products.list(…, pageRequestFrom(request))))
```

Y el caso de uso lo lee sin que nadie se lo pase:

```ts
@UseCase()
async list(filters: ProductFiltersDTO, page: PageRequest) {
  const { workspaceId } = workspace.current()
  const found = await this.repo.page({ ...filters, workspaceId }, page)
  // …
}
```

La pertenencia se comprueba **una vez**, para todas las rutas del grupo, y ningún
caso de uso puede olvidarla: sin espacio de trabajo en el ámbito, `current()` lanza
un error en lugar de devolver los productos de nadie.

Aún queda algo que se puede olvidar: añadir el `workspaceId` a cada consulta. Si las
filas de una tabla son de un espacio de trabajo, díselo al repositorio con `scope`,
y lo hará él en todas. El producto pasa a llevar su `workspaceId`, en el esquema y
en la fila, y un nombre ya no es único en toda la tabla, sino en su espacio:

```ts
// product.repository.ts
constructor(base: ShopBase) {
  super(base, base.store.table<ProductRow>('product', {
    types: { archived: 'boolean' },
    unique: [['workspaceId', 'name']],
  }), {
    scope: { field: 'workspaceId', current: () => workspace.current().workspaceId },
  })
}
```

Y el caso de uso ya no lo nombra:

```ts
@UseCase()
async list(filters: ProductFiltersDTO, page: PageRequest) {
  const found = await this.repo.page(filters, page)
  // …
}
```

- `find`, `first`, `count` y `page` **solo ven las filas del espacio actual**,
  digan lo que digan sus criterios.
- Guardar una entidad de **otro** espacio es un error, no una escritura.
- **Fuera de un ámbito, `current()` lanza un error** y el repositorio no lee nada:
  un worker entra en el ámbito antes de usarlo (`runInWorkspace`, más abajo).
- Lo que mira entre espacios **a propósito** (otro contexto que pregunta en qué
  espacio está un cliente) usa `findInEveryScope`, un método protegido: queda dentro
  del repositorio, con un nombre que se ve en una revisión.
- Lo protegido son **esos métodos**. Lo que el repositorio escriba o lea por su
  cuenta (`this.table`, Kysely, `saveRows`, los `after` de un guardado) pone el
  filtro él mismo.

Lo que no llega por el router entra en el ámbito por su cuenta, con `run`:

- **Un script** sabe en qué espacio trabaja: `workspace.run({ … }, () => …)`.
- **Un worker** nunca hereda un ámbito (se ejecuta solo, más tarde). Sabe cuál es
  por su evento, y entra en él. Lo cómodo es una función de tu aplicación:

```ts
export function runInWorkspace<T>(workspaceId: string, fn: () => Promise<T>) {
  return workspace.run({ workspaceId, role: 'admin' }, fn)
}
```

### 7.6 Cuando no hace falta nada más

Todo lo de la sección anterior es **opcional**, y lo define tu aplicación: el
framework no sabe qué es un espacio de trabajo. Una aplicación con usuarios y nada
más, como La Despensa, no define ningún ámbito: el actor le basta. Otra puede tener
el actor y un espacio de trabajo; otra, el actor y un cliente (*tenant*). Cada una
define los que necesita, con las mismas tres piezas: `defineScope`, `http.group` y
`run`.

---

# Parte III · Guardar sin miedo

## 8. Transacciones

### 8.1 Qué es una transacción

Una transacción es un conjunto de escrituras que ocurren **todas o ninguna**. Si a
mitad algo falla (un error, un corte de luz), no queda nada a medias: es como si
no hubiera empezado.

En este framework, **una transacción es un guardado**: cada llamada a
`repo.persist(...)`.

```mermaid
sequenceDiagram
    participant UC as Caso de uso
    participant R as Repositorio
    participant S as Store
    UC->>R: persist(order)
    R->>S: empieza la transacción
    R->>S: escribe el pedido
    R->>S: escribe los trabajos de sus eventos
    R->>S: confirma (commit)
    S-->>R: hecho
    R-->>UC: guardado
    Note over R,S: Si algo falla antes del commit, no queda nada escrito
```

Dentro de esa transacción el framework escribe la entidad **y los trabajos de los
workers que sus eventos despiertan**. Las dos cosas quedan guardadas juntas, o no
queda ninguna. Esta garantía es la base de la Parte IV.

### 8.2 Varias entidades a la vez

`persist` acepta varias entidades **del mismo módulo**, y las guarda en una sola
transacción:

```ts
await this.repo.persist(nueva, reemplazada)    // las dos, o ninguna
```

Lo que tiene que guardarse junto, todo o nada, es **un agregado**, y un agregado es
**un módulo**. Si dos módulos necesitan cambiar siempre a la vez, en realidad son
uno solo. Si no, uno sigue al otro mediante eventos.

### 8.3 Por qué no una transacción por caso de uso

Podría parecer más sencillo envolver el caso de uso entero en una transacción.
No se hace, por dos motivos:

- **Un caso de uso puede leer de otros módulos**, y cada módulo guarda solo lo suyo.
  Una transacción gigante que cruzara módulos los ataría entre sí.
- **Las transacciones cortas no se estorban.** En SQLite y en ficheros, mientras
  dura una, las demás esperan su turno; en Postgres y MySQL corren a la vez, pero se
  bloquean en lo que tocan. Un caso de uso que leyera, pensara y llamara a otros con
  la transacción abierta haría esperar a todo el mundo.

La consecuencia práctica es una regla: **guarda una vez, al final**. Y si un caso de
uso no puede evitar guardar en varios pasos, pon primero lo que pueda fallar y haz
que cada paso se pueda repetir sin daño (lo veremos en el capítulo 15).

## 9. Cuando dos personas tocan lo mismo

### 9.1 El problema

Ana y Bea abren a la vez la ficha del aceite. Ana cambia el precio a 11 €; Bea, el
nombre a "Aceite virgen extra". Las dos guardan. ¿Qué queda?

Sin protección, la segunda en guardar pisaría a la primera con lo que leyó, y el
cambio de Ana desaparecería sin que nadie se enterase.

### 9.2 La versión

Cada fila guardada tiene una **versión** que sube con cada guardado que la escribe.
Al guardar, el framework comprueba que la fila sigue en la versión que se leyó. Si
alguien la ha guardado entre medias, la versión ya no coincide y el guardado falla
con un **`ConcurrencyConflict`** (409), sin escribir nada.

```mermaid
sequenceDiagram
    participant A as Ana
    participant B as Bea
    participant S as Store
    A->>S: lee el aceite (versión 3)
    B->>S: lee el aceite (versión 3)
    A->>S: guarda el precio, si sigue en la 3
    S-->>A: hecho: ahora versión 4
    B->>S: guarda el nombre, si sigue en la 3
    S-->>B: ConcurrencyConflict: está en la 4
```

Nadie pierde nada en silencio.

### 9.3 Reintentar solo

Que Bea reciba un error es correcto, pero en la mayoría de casos lo razonable es
**volver a intentarlo**: leer el producto de nuevo, ya con el precio de Ana, aplicar
el cambio de nombre y guardar. Eso hace todo caso de uso, sin que se lo pidas:

```ts
@UseCase()
async update(id: string, input: ProductUpdateDTO): Promise<ProductDTO> {
  const changes = ProductUpdateSchema.parse(input)
  const product = await this.load(id)       // vuelve a cargar en cada intento
  product.update(changes)
  await this.repo.persist(product)
  return product.toDTO()
}
```

Ante un conflicto, el caso de uso se ejecuta de nuevo **desde el principio**, hasta
tres veces más. Al final quedan los dos cambios. Si llama a otro caso de uso, solo
reintenta el primero de la cadena, con todo lo que llama: el de dentro deja pasar el
conflicto hasta él, y se ejecuta de nuevo en cada intento del de fuera.

Funciona porque un caso de uso **carga, cambia y guarda, y no hace nada
irreversible antes de guardar**: lo irreversible sale de los workers. Un caso de uso
que mandara un email y después guardara lo mandaría dos veces al reintentar (y por
eso los emails salen de los workers: capítulo 16).

Si uno tiene que hacer algo antes de guardar que no debe pasar dos veces (llamar a
otro contexto, que ya guardó lo suyo), se dice donde se ve, con el motivo al lado. Vale
para toda la cadena: ninguno reintenta, tampoco los que lo llamaron, aunque sean de
otro contexto:

```ts
// Abre la sesión en auth antes de guardar: repetirlo abriría otra.
@UseCase({ retryOnConflict: false })
async signIn(input: SignInDTO): Promise<SessionDTO> { … }
```

### 9.4 Nuevos que chocan

Lo mismo pasa con las altas. Si dos personas crean a la vez un producto con el mismo
nombre, y la tabla dice que `name` es único, el guardado de una de las dos choca:
un `ConcurrencyConflict`.

Por eso en el catálogo hay dos defensas, y cada una tiene su papel:

- el `unique` de la tabla es la **garantía** cuando dos llegan a la vez, para el
  valor exacto: `Arroz` y `ARROZ` a la vez pasarían las dos. Si eso importa, guarda
  también el nombre normalizado (en minúsculas) y haz único ese;
- `assertNameFree` comprueba antes de guardar y da un **error claro**
  (`product.name_taken`). Como el caso de uso se repite tras el choque, también la
  que llegó segunda acaba recibiendo ese error, no el conflicto.

Sin la comprobación previa, un nombre repetido se intentaría cuatro veces para nada
antes de devolver el conflicto: el choque con un valor único no se arregla
reintentando.

## 10. Reglas que abarcan varias filas

### 10.1 Lo que la versión no protege

La versión protege **una fila**. Pero algunas reglas hablan de **varias**:

- "El stock de un producto nunca baja de cero" (la suma de todos sus movimientos).
- "Un cliente no puede tener dos notas con el mismo título."
- "Un equipo siempre conserva al menos un administrador."

Imagina que quedan 3 unidades de aceite y llegan a la vez dos pedidos de 2. Si cada
uno comprueba antes de guardar ("¿hay 2? sí"), los dos pasan, y el stock acaba en -1:

```mermaid
sequenceDiagram
    participant P1 as Pedido 1
    participant P2 as Pedido 2
    participant S as Store
    P1->>S: ¿cuánto stock? 3
    P2->>S: ¿cuánto stock? 3
    P1->>S: guarda -2
    P2->>S: guarda -2
    Note over S: stock = -1 ✗
```

La comprobación previa no basta, porque entre comprobar y guardar puede colarse otro.

### 10.2 La solución: comprobar dentro del guardado, y decir qué se protege

El guardado acepta tres opciones que actúan **dentro de su transacción**:

- **`guard`** dice **qué protege** el guardado, con unas claves que tú eliges
  (`stock:<id del producto>`);
- **`before`** escribe lo que tiene que ir primero;
- **`after`** se ejecuta después de escribir: comprueba la regla y, si no se cumple,
  lanza un error que **deshace todo**.

La promesa del store es esta: **dos guardados con la misma clave nunca se
entrelazan**. Uno espera a que el otro confirme o deshaga, y solo entonces empieza
a escribir y a comprobar. Lo que el `after` lee es la verdad, y lo seguirá siendo
hasta que confirme.

```ts
// stock-movement.repository.ts, lo esencial (el capítulo 15 le añade que una
// misma operación no se apunte dos veces)
async persistKeepingStock(movements: StockMovement[]): Promise<void> {
  const products = [...new Set(movements.map(m => m.productId))]
  await this.save(movements, movement => this.write(movement), {
    guard: products.map(productId => `stock:${productId}`),
    after: async () => {
      for (const productId of products) {
        if (await this.levelOf(productId) < 0) {
          throw new NotEnoughStock(productId)
        }
      }
    },
  })
}
```

`save` es el guardado en bruto que hay detrás de `persist`: recibe las entidades,
cómo escribir cada una (`this.write` es la escritura que ya trae `TableRepository`) y
las opciones.

La clave es por producto, no una sola para todo el stock: dos pedidos que se llevan
las últimas unidades del aceite se turnan, pero un pedido de aceite y otro de arroz
no se esperan nunca.

¿Por qué hay que decirlo, si en SQLite ya se turnan? Porque **no todos los stores
son iguales**, y tus módulos no deberían saber en cuál corren:

| Store | Sin `guard` | Con `guard` |
|---|---|---|
| Ficheros, SQLite | Las transacciones ya van de una en una. | Igual: la clave ya está protegida. |
| Postgres, MySQL | Las transacciones corren a la vez: dos `after` podrían ver el stock antes de que el otro confirme. | Un cerrojo por clave: los guardados con la misma clave se turnan. |

Declarar el `guard` cuesta una línea y hace que la regla se cumpla en cualquier
store. Cambiar de SQLite a Postgres (capítulo 24) no te obliga a revisar nada.

Por eso un guardado con `after` **tiene que** decir su `guard`: sin él no compila.
Si el `after` no comprueba ninguna regla entre filas (solo escribe lo que se sigue
del guardado), escribe `guard: []`, y quien lo lea sabrá que no hace falta ninguno.

Recuerda el reparto:

- **la versión protege una fila**: nadie pisa una entidad que otro cambió
  (capítulo 9);
- **el `guard` protege una regla entre varias filas**: nadie se cuela entre tu
  escritura y tu comprobación.

Fuera de eso, cada store usa su aislamiento normal; no hace falta pedir nada más
estricto.

Ahora la historia acaba bien:

```mermaid
sequenceDiagram
    participant P1 as Pedido 1
    participant P2 as Pedido 2
    participant S as Store
    P1->>S: transacción: escribe -2, comprueba: 1 ≥ 0 ✓, confirma
    P2->>S: transacción: escribe -2, comprueba: -1 < 0 ✗, deshace
    S-->>P2: NotEnoughStock
    Note over S: stock = 1 ✓
```

**Guía práctica**: comprueba antes en el caso de uso, para dar una respuesta clara en
el caso normal, y **vuelve a comprobar en el `after`**, que es la garantía.

## 11. Valores que todos cambian a la vez

¿Por qué el stock de La Despensa es un módulo de **movimientos** y no un campo
`stock` en el producto?

Porque un valor que muchos cambian a la vez, como un stock o un saldo, **choca
consigo mismo**. Cada venta tendría que leer el producto, restar y guardar, y
cualquier venta simultánea provocaría un `ConcurrencyConflict`. Con mucho tráfico,
los reintentos se acumulan.

La solución es no actualizar nunca el valor, sino **añadir movimientos**:

| Movimiento | Cantidad | Referencia |
|---|---|---|
| Llega mercancía | +5 | `received` |
| Pedido de Ana | -3 | id del pedido |
| Pedido de Bea | -1 | id del pedido |
| **Stock** | **= 1** | (la suma) |

- Añadir es insertar una fila nueva, y **dos inserciones nunca chocan**.
- El stock es la suma de los movimientos de un producto.
- La regla "nunca por debajo de cero" es un `after` que suma, protegido por el
  `guard` del producto (capítulo 10).
- Y el **historial viene gratis**: sabes qué entró, qué salió y por qué.

```ts
// stock-movement.repository.ts
async levelOf(productId: string): Promise<number> {
  const movements = await this.table.find({ productId })
  return movements.reduce((sum, movement) => sum + movement.quantity, 0)
}
```

Un movimiento, una vez guardado, no se cambia nunca. Un error se corrige con otro
movimiento.

---

# Parte IV · Eventos y consistencia eventual

## 12. Eventos: contar lo que pasó

### 12.1 Qué es un evento

Un evento es **algo que ya ha pasado**, contado en pasado: `order.placed` (se ha
hecho un pedido), `order.confirmed` (se ha confirmado). Quien lo publica no sabe
quién lo escucha, ni le importa.

Los eventos son la forma en que un módulo provoca reacciones en otros sin
conocerlos. El módulo de pedidos no sabe que existe uno de avisos por email; solo
cuenta que un pedido se ha confirmado. El de avisos escucha y actúa.

### 12.2 Cuándo se publica

Ya lo viste en el capítulo 5: la entidad **anota** sus eventos con `trackEvent`, y el
repositorio los publica al guardarla. El momento exacto importa mucho:

> **Un evento se publica cuando la transacción que lo guardó se confirma.
> Si la transacción se deshace, el evento no existe.**

```mermaid
flowchart TD
    A[order.place crea el pedido<br/>y anota order.placed]
    A --> B[persist: transacción]
    B --> C{¿Se confirma?}
    C -->|Sí| D[order.placed se publica]
    C -->|No| E[Nada: ni pedido ni evento]
```

Así nadie reacciona nunca a algo que no llegó a guardarse.

### 12.3 Un evento de cada clase por guardado

Imagina un caso de uso que cambia el nombre de un producto y, dos líneas después, su
precio, y lo guarda una vez. ¿Se cuentan dos `product.updated`? No:

> **Cada entidad cuenta, como mucho, un evento de cada clase (de cada nombre) por guardado.**

Si la entidad anota otra vez un evento de una clase que ya tenía anotado, el nuevo
**sustituye** al anterior. Como el evento se construye con todo lo que ha cambiado
desde que se cargó, el último lo cuenta todo: un solo `product.updated` con el
nombre y el precio.

¿Y dos clases distintas en un mismo guardado, por ejemplo `order.confirmed` y
`order.cancelled`? Se pueden, pero casi siempre es una pista de que **el caso de uso
hace dos cosas**. Lo normal es que cada caso de uso lleve a la entidad de un estado
a otro, y lo cuente una vez.

### 12.4 Qué cuenta un `updated`: el antes y el después

Un evento `created` lleva la entidad entera, como DTO. Un `updated` lleva más,
porque a quien lo escucha casi siempre le importa **qué** cambió:

```ts
// product.ts
update(changes: Partial<Pick<ProductDTO,
  'name' | 'priceCents' | 'brandId' | 'categoryId' | 'archived'>>): void {
  this.change(changes)
  const diff = this.getChanges()
  if (diff) this.trackEvent(new Product_Updated({
    dto: this.toDTO(),               // cómo queda, entero
    changes: diff,                   // los campos que cambiaron
    previous: this.getPrevious()!,   // y qué valían antes
  }))
}
```

Cada campo cuenta su transición: `previous.priceCents` → `changes.priceCents`. Un
worker que guarda el historial de precios puede escribir "de 4,50 € a 4,95 €" sin
buscar nada.

Fíjate en el `if (diff)`: si nada cambió de verdad (alguien guardó el mismo precio),
no hay evento.

### 12.5 Ofrecer los eventos: `events`

Cada módulo expone sus eventos bajo `events`, que es por donde los demás se
suscriben. Se construyen con `eventsOf`, a partir de las clases de sus eventos:

```ts
// order.module.ts
readonly events

private constructor(base: ShopBase, …) {
  super('order', base.invocations)
  this.events = eventsOf(base.bus, {
    placed: Order_Placed,
    confirmed: Order_Confirmed,
    rejected: Order_Rejected,
    cancelled: Order_Cancelled,
  })
}
```

Desde fuera se leen como lo que son: `orders.events.placed`,
`orders.events.confirmed`. Y vienen tipados: quien se suscribe a
`orders.events.confirmed` recibe un `OrderDTO`.

## 13. Reaccionar a un evento

### 13.1 Siempre igual: suscribirse

Un módulo reacciona a un evento de otro (o al suyo) **suscribiéndose**, y siempre
de la misma forma:

```ts
deps.<módulo>.events.<evento>.subscribe(callback, opciones)
```

Las opciones dicen la **estrategia**, y no tienen valor por defecto: cada vez
eliges a propósito. Hay dos, y elegir bien es crucial:

| | `'fire-and-forget'` | `'handler'` |
|---|---|---|
| **Cuándo se ejecuta** | Justo después del commit. | Justo después del commit. |
| **Si falla** | Se pierde. | Se reintenta, con esperas cada vez más largas. |
| **Si el servidor se cae antes** | Se pierde. | Se ejecuta al volver. |
| **Dónde vive** | En memoria. | Un *trabajo* guardado en el store. |
| **Para qué** | Lo que no importa perder: refrescar una caché, una métrica. | **Todo lo que importa**: reservar stock, enviar un email, actualizar otro módulo. |

La primera es tan sencilla como suena:

```ts
products.events.updated.subscribe(() => cache.clear(), {
  strategy: 'fire-and-forget',
})
```

La segunda es la que usarás casi siempre. Si tienes dudas, usa `'handler'`: casi
todo lo que hace un backend "importa".

Cada estrategia tiene sus propias opciones, y TypeScript solo te deja escribir las
suyas: `'fire-and-forget'` no lleva más; `'handler'` lleva su `queue` y, si hace
falta, `attempts`.

### 13.2 Un `handler`: un módulo reacciona con uno de sus casos de uso

Las reacciones de un módulo viven en su fichero `<módulo>.workers.ts`:

```ts
// order.workers.ts
export function registerOrderWorkers(orders: Order_Module): void {
  orders.events.placed.subscribe(order => orders.fulfil(order.id), {
    strategy: 'handler',
    queue: 'order.fulfil.on.order.placed',
  })
  orders.events.cancelled.subscribe(order => orders.releaseStock(order.id), {
    strategy: 'handler',
    queue: 'order.releaseStock.on.order.cancelled',
  })
}
```

Se lee así: "cuando se haga un pedido, el módulo de pedidos lo cumple
(`fulfil`)"; "cuando se cancele, devuelve su stock (`releaseStock`)".

- **El callback** recibe lo que trae el evento y **llama a un caso de uso** del
  módulo que reacciona, con lo que ese caso de uso necesita: aquí, el id del pedido.
- Puede decidir **si el evento le concierne**. Por ejemplo, reaccionar a
  `product.updated` solo cuando cambió el precio:

  ```ts
  deps.product.events.updated.subscribe(async ({ changes, dto }) => {
    if ('priceCents' in changes) await prices.record(dto)
  }, { strategy: 'handler', queue: 'priceChange.record.on.product.updated' })
  ```

  Es una condición sobre el evento, nunca lógica de negocio: esa va en el caso de
  uso.
- **`queue`** es el nombre de su cola (lo vemos en el 13.4) y **`attempts`**,
  cuántas veces se intenta antes de rendirse (5 por defecto).

Cuando el evento trae justo lo que el caso de uso recibe, se pasa tal cual:

```ts
// notification.workers.ts
deps.order.events.confirmed.subscribe(
  order => notification.orderConfirmed(order),
  {
    strategy: 'handler',
    queue: 'notification.orderConfirmed.on.order.confirmed',
  },
)
```

### 13.3 Un trabajo, guardado con el cambio

Cada reacción `'handler'` es un **trabajo** que el framework escribe **en la misma
transacción que el cambio que la provoca**. Por eso el cambio y su trabajo pendiente
quedan guardados juntos, o ninguno de los dos. Después, el proceso de workers lo
recoge y lo ejecuta.

```mermaid
flowchart LR
    subgraph T[Una transacción]
      P[Pedido guardado]
      J[Trabajo: cumplir el pedido]
    end
    T -->|commit| W[Worker]
    W -->|ejecuta| F[order.fulfil]
    F -->|si falla| W
```

### 13.4 El nombre de su cola

Los trabajos de cada reacción esperan en una **cola**, y la cola tiene un nombre que
la identifica aunque el servidor se reinicie. Lo escribes tú, entero, y siempre con
la misma forma: el módulo que reacciona, su caso de uso y el evento.

```
<módulo que reacciona>.<caso de uso>.on.<módulo que cuenta>.<evento>

order.fulfil.on.order.placed
order.releaseStock.on.order.cancelled
notification.orderConfirmed.on.order.confirmed
```

Leído en voz alta dice exactamente lo que hace. Y como un evento puede tener varias
reacciones en un mismo módulo (dos casos de uso distintos), cada una tiene su cola.

El framework comprueba la forma al suscribirse: si la cola no termina en el evento
al que te suscribes (`.on.order.placed`), o no empieza por `<módulo>.<caso de uso>`,
falla al arrancar, no en producción a medianoche.

Hay una consecuencia: **cambiar el nombre de la cola** (porque renombraste el caso de
uso o el módulo) deja los trabajos que estuvieran pendientes esperando en la cola
vieja, que ya nadie atiende. Para que no pase en silencio, el worker lo comprueba
al arrancar y después cada minuto, y avisa una vez de cada cola con trabajos que
ningún worker ha atendido en cinco minutos (justo después de desplegar, el proceso
viejo la atendía hace nada: el aviso llega unos minutos más tarde):

```
[JobQueue] 3 job(s) of 'order.fulfil.on.order.placed' wait, and no worker
serves that queue: was its handler renamed or removed?
```

Si renombras, hazlo cuando esa cola esté vacía, o mueve sus trabajos pendientes con
una migración.

### 13.5 Un worker llama a un caso de uso

Un worker no escribe directamente: **llama a un caso de uso** de su módulo. Así la
lógica vive en un solo sitio, y el caso de uso se puede probar, trazar y llamar desde
donde haga falta. El callback no hace nada más.

Además, un worker se ejecuta **sin actor**: ni el usuario que provocó el evento, ni
ningún otro. `currentActor()` lanza `NoActor` dentro de él, y el trabajo se
reintentaría hasta morir. Si `order.fulfil` necesitara saber quién hizo el pedido,
lo leería del pedido (`customerId`). Si un caso de uso que llama necesita un actor,
el worker lo pone él con `runAsActor({ userId: 'system' }, …)` (con los campos que
tu `Actor` añada, capítulo 7.2). Lo de "sin actor" vale porque los workers arrancan
fuera de cualquier petición: `context.start()` no se llama dentro de `runAsActor`.

## 14. Consistencia eventual, con un pedido de verdad

### 14.1 Dos formas de estar al día

Cuando haces un pedido en La Despensa, pueden pasar dos cosas:

- **Consistencia inmediata**: la petición reserva el stock, confirma el pedido y
  solo entonces responde. Cuando el cliente recibe la respuesta, todo está hecho.
- **Consistencia eventual**: la petición guarda el pedido como *pendiente* y responde
  enseguida. Un worker reserva el stock y lo confirma **un instante después**. Durante
  ese instante, el pedido existe pero aún no está confirmado.

La Despensa usa la segunda. Parece más complicada. ¿Por qué hacerlo así?

- **El pedido y el stock son módulos distintos.** Hacerlo todo de golpe obligaría a
  meterlos en la misma transacción, atándolos para siempre.
- **La petición no espera a nadie.** Si reservar el stock tardara (o, en otra
  aplicación, cobrar con una pasarela externa), el cliente no lo sufriría.
- **Nada se pierde.** Si el servidor se cae justo después de aceptar el pedido, el
  trabajo de cumplirlo ya está guardado y se hará al volver.

### 14.2 El viaje de un pedido

```mermaid
sequenceDiagram
    autonumber
    actor C as Cliente
    participant API as order.place
    participant S as Store
    participant W as Worker
    participant ST as stockMovement.reserve
    participant N as Worker de avisos

    C->>API: POST /api/orders
    API->>S: transacción: pedido (pending) + trabajo "cumplir"
    API-->>C: 202 { status: "pending" }
    Note over C: El cliente ya tiene respuesta

    S-->>W: commit: hay un trabajo
    W->>ST: reservar el stock del pedido
    ST->>S: transacción: movimientos -N (si hay stock)
    W->>S: transacción: pedido confirmed + trabajo "avisar"
    S-->>N: commit: hay un trabajo
    N->>N: envía el email de confirmación

    C->>API: GET /api/orders/:id
    API-->>C: { status: "confirmed" }
```

Cada flecha hacia el store es **una transacción corta** e independiente. Y cada vez que
una de ellas deja un trabajo pendiente, ese trabajo está guardado con ella.

El pedido pasa por estos estados:

```mermaid
stateDiagram-v2
    [*] --> pending: order.place
    pending --> confirmed: hay stock
    pending --> rejected: no hay stock
    pending --> cancelled: el cliente lo cancela
    confirmed --> cancelled: el cliente lo cancela
    confirmed --> [*]
    rejected --> [*]
    cancelled --> [*]
```

La cancelación tiene su propio capítulo, el 18. De momento, quédate con el camino
feliz.

### 14.3 El código

El caso de uso que recibe el pedido solo lo valida, le pone precio y lo guarda:

```ts
@UseCase()
async place(input: OrderPlaceDTO): Promise<OrderDTO> {
  const { customerEmail, lines } = OrderPlaceSchema.parse(input)
  const ids = lines.map(line => line.productId)
  const found = await this.deps.product.findByIds(ids)
  const products = new Map(found.map(product => [product.id, product]))
  const priced = lines.map(line => {
    const product = products.get(line.productId)
    if (!product) throw new ReferenceNotFound('product', line.productId)
    if (product.archived) throw new ProductNotForSale(product.id)
    return { ...line, priceCents: product.priceCents }
  })
  const order = Order.place({
    customerId: currentActor().userId,
    customerEmail,
    lines: priced,
  })
  await this.repo.persist(order)       // pedido + trabajo "cumplir", juntos
  return order.toDTO()                 // status: 'pending'
}
```

`Order.place` no recibe el `OrderPlaceDTO` que llegó por HTTP, sino un
`OrderPlacement`: lo que hace falta para hacer un pedido, ya comprobado y con
precio (capítulo 5).

La ruta responde **202 Accepted** (aceptado, pero no terminado) en vez de 201:

```ts
base.http.post('/orders', async request => {
  const input = await request.json() as OrderPlaceDTO
  return Response.json(await orders.place(input), { status: 202 })
})
```

El worker llama a `fulfil`, que reserva el stock y confirma, o rechaza si no hay:

```ts
@UseCase()
async fulfil(id: string): Promise<void> {
  const order = await this.resolve(
    () => this.repo.find({ id }),
    () => new OrderNotFound(id),
  )
  if (order.isCancelled) return this.deps.stockMovement.release(order.id)
  if (!order.isPending) return
  try {
    await this.deps.stockMovement.reserve(order.lines, order.id)
    order.confirm()
  } catch (error) {
    if (!(error instanceof NotEnoughStock)) throw error
    order.reject(error.message)
  }
  await this.repo.persist(order)
}
```

Fíjate en el `throw error` del final del `catch`: un `NotEnoughStock` es una
respuesta de negocio (se rechaza el pedido), pero cualquier otro error es un fallo,
y lanzarlo hace que el trabajo **se reintente más tarde**. La línea de
`isCancelled` la explica el capítulo 18.

`fulfil` escribe en otro módulo (el stock) y puede hacerlo porque **se ejecuta en un
worker**. El capítulo 19 cuenta por qué esa es la regla.

### 14.4 Qué ve el cliente, y cómo diseñar para ello

Con consistencia eventual, el cliente recibe un pedido `pending`. El frontend tiene
que estar preparado para ese estado intermedio:

- **Muéstralo tal cual**: "Pedido recibido, lo estamos confirmando…".
- **Pregunta de nuevo** al cabo de un momento (`GET /api/orders/:id`), o recarga la
  lista cuando el usuario vuelva a ella. En La Despensa, la confirmación tarda unos
  milisegundos.
- **No prometas lo que aún no ha pasado**: no digas "confirmado" hasta que lo esté.

Pasa lo mismo con cualquier dato que mantenga un worker. Si un worker mantiene un
índice de búsqueda, un producto recién creado puede tardar un instante en aparecer
en las búsquedas. Eso no es un error: es la consistencia eventual, y la interfaz
debe contar con ella.

### 14.5 Qué garantiza el framework (y qué no)

| Garantía | Qué significa |
|---|---|
| **El trabajo se guarda con el cambio** | Si el pedido existe, su trabajo "cumplir" existe. Nunca uno sin el otro. |
| **Se ejecuta después del commit** | Un worker nunca ve un cambio que luego se deshizo. |
| **Se reintenta si falla** | Con esperas crecientes, hasta agotar sus intentos (5 por defecto). |
| **Sobrevive a reinicios** | Lo pendiente sigue pendiente al volver. |
| **Al menos una vez** | Un trabajo puede ejecutarse **más de una vez**. |

La última fila es la que más trabajo te da, y se lleva el capítulo siguiente entero.

### 14.6 ¿Y si el servidor se cae?

Repasemos cada momento del viaje de un pedido:

```mermaid
flowchart TD
    A[Cae antes del commit de order.place]
    A1[No hay pedido ni trabajo.<br/>El cliente recibe un error y reintenta.]
    A --> A1
    B[Cae después del commit, antes del worker]
    B1[Al volver, el trabajo pendiente se ejecuta.]
    B --> B1
    C[Cae a mitad de fulfil, tras reservar el stock]
    C1[Se reintenta. reserve ve que ya reservó<br/>y no hace nada. Se confirma.]
    C --> C1
    D[Cae tras confirmar, antes de enviar el email]
    D1[El aviso se guardó con la confirmación.<br/>Se envía al volver.]
    D --> D1
```

En ningún caso se pierde un pedido ni se reserva el stock dos veces. El caso C solo
funciona porque `reserve` está escrito para poder repetirse sin daño. Ese es el tema
del capítulo siguiente.

## 15. Workers que se pueden repetir

### 15.1 Por qué un trabajo puede repetirse

Un worker termina su tarea, y justo antes de anotar "hecho", el servidor se cae. Al
volver, el trabajo sigue pendiente, y se ejecuta otra vez. No hay forma de evitarlo
del todo: entre hacer algo y anotar que se hizo siempre hay un instante.

Por eso **todo worker debe ser idempotente**: ejecutarlo dos veces tiene que dar el
mismo resultado que ejecutarlo una.

### 15.2 Tres técnicas

**1. Mirar el estado antes de actuar.** `fulfil` empieza comprobando que el pedido
sigue pendiente. Si ya está confirmado o rechazado, no hace nada:

```ts
if (!order.isPending) return
```

Y la propia entidad se protege: `confirm()` sobre un pedido ya confirmado no cambia
nada ni anota otro evento.

**2. Una referencia que identifica la operación.** Los movimientos de una reserva
llevan como referencia el id del pedido. Antes de reservar, `reserve` mira si ya
existen:

```ts
@UseCase()
async reserve(
  lines: StockMovementLineDTO[],
  reference: string,
): Promise<void> {
  // Ya reservado: nada que hacer.
  if (await this.repo.count({ reference }) > 0) return
  await this.repo.persistKeepingStock(lines.map(line =>
    StockMovement.record({
      productId: line.productId,
      quantity: -line.quantity,
      reference,
    })))
}
```

Esa comprobación basta cuando las ejecuciones van una detrás de otra. Pero dos a la
vez (un reintento que llega mientras la primera aún corre) pasan las dos por ella
antes de que ninguna guarde. Por eso la de verdad va **dentro del guardado**, con un
`guard` por operación, como el del stock del capítulo 10: la segunda espera a la
primera, ve sus movimientos y se deshace sin apuntar nada.

```ts
// stock-movement.repository.ts
async persistKeepingStock(movements: StockMovement[]): Promise<boolean> {
  if (movements.length === 0) return false
  const products = [...new Set(movements.map(m => m.productId))]
  const reference = movements[0]!.reference
  try {
    await this.save(movements, movement => this.write(movement), {
      guard: [`movements:${reference}`, ...products.map(p => `stock:${p}`)],
      after: async () => {
        // Ya la apuntó otra ejecución: esta es una repetición.
        if (await this.count({ reference }) > movements.length) throw new AlreadyRecorded()
        for (const productId of products) {
          if (await this.levelOf(productId) < 0) throw new NotEnoughStock(productId)
        }
      },
    })
    return true
  } catch (error) {
    if (error instanceof AlreadyRecorded) return false
    throw error
  }
}
```

La comprobación de antes se queda como atajo: una repetición que llega sola no
intenta guardar nada.

**3. Escribir "el resultado", no "el cambio".** "Pon el stock de la caché a 7" se
puede repetir; "suma 1 a la caché" no. Cuando un worker mantiene una copia de datos,
que la sobrescriba entera.

### 15.3 Lista de comprobación

Antes de dar por bueno un worker, pregúntate:

- [ ] Si se ejecuta dos veces seguidas, ¿el resultado es el mismo?
- [ ] Si se ejecuta tarde (cuando el dato ya cambió otra vez), ¿hace algo sensato?
- [ ] Si falla a mitad, ¿el reintento termina bien?
- [ ] ¿Distingue un "no" de negocio (que no se reintenta) de un fallo (que sí)?

Los tests de La Despensa comprueban la primera pregunta explícitamente:

```ts
test('fulfils an order once, however many times its work runs', async () => {
  // …el pedido ya se cumplió
  await shop.modules.order.fulfil(orderId)                  // otra vez
  await shop.modules.stockMovement.reserve(lines, orderId)  // y otra
  expect(await level(oil)).toBe(3)        // el stock solo bajó una vez
})
```

## 16. Lo irreversible sale de un worker

Un email no se puede "desenviar". Un cobro tampoco se deshace con un rollback. Por eso:

> **Lo que no se puede deshacer sale de un worker, después del evento de aquello de
> lo que trata. Nunca desde un caso de uso.**

Si el caso de uso `fulfil` enviara el email y después fallara al guardar, el cliente
recibiría "pedido confirmado" de un pedido que no lo está. Desde un worker, el email
solo sale cuando la confirmación ya está guardada.

En La Despensa, los avisos son un módulo propio que **no guarda nada**: solo escucha
y cuenta.

```ts
// notification.workers.ts
export function registerNotificationWorkers(
  notification: Notification_Module,
  deps: Notification_Deps,
): void {
  deps.order.events.confirmed.subscribe(
    order => notification.orderConfirmed(order),
    {
      strategy: 'handler',
      queue: 'notification.orderConfirmed.on.order.confirmed',
    },
  )
  deps.order.events.rejected.subscribe(
    order => notification.orderRejected(order),
    {
      strategy: 'handler',
      queue: 'notification.orderRejected.on.order.rejected',
    },
  )
}
```

```ts
// notification.module.ts
@UseCase()
async orderConfirmed(order: OrderDTO): Promise<void> {
  await this.options.mailer.send({
    to: order.customerEmail,
    subject: 'Your order is confirmed',
    text: `Order ${order.id}: ${(order.totalCents / 100).toFixed(2)} €.`,
  })
}
```

El `mailer` llega como **opción** del módulo: en producción, un servidor SMTP; en los
tests, una lista donde se apuntan los emails. El módulo no sabe cuál es.

¿Y la idempotencia? Un email puede llegar, raramente, **dos veces** (si el servidor
cae justo después de enviarlo). Para casi todas las aplicaciones eso es aceptable. Si
no lo fuera (un cobro), el worker apuntaría lo que ya hizo, con una referencia, antes
de repetirlo. Es la técnica 2 del capítulo anterior.

## 17. Cuando algo falla

### 17.1 Reintentos

Si el caso de uso de un `handler` lanza un error, su trabajo vuelve a la cola y se
reintenta más tarde, cada vez esperando más: 10 segundos, 20, 40, 80… hasta un máximo
de 15 minutos entre uno y otro. Por defecto tiene **5 intentos**: un trabajo que falla
siempre muere unos dos minutos y medio después del primer fallo, así que una caída
corta de un servidor de correo ya lo mata. Para aguantar más, sube `attempts` (y,
para todo el contexto, `jobs.backoffMs` y `jobs.maxBackoffMs` de la base):

```ts
orders.events.placed.subscribe(order => orders.fulfil(order.id), {
  strategy: 'handler',
  queue: 'order.fulfil.on.order.placed',
  attempts: 10,
})
```

Mientras se ejecuta, un trabajo es de su worker. Si ese worker muere, pasado un
minuto el trabajo queda libre y lo recoge otro.

### 17.2 Trabajos muertos

Un trabajo que agota sus intentos queda **muerto** (`dead`), con el último error
apuntado. No se borra: alguien tiene que mirarlo. Puedes listarlos desde un script o
una página de administración:

```ts
const jobs = await shop.base.store.outbox.list()
const dead = jobs.filter(job => job.status === 'dead')
for (const job of dead) console.log(job.queue, job.lastError)
```

Los trabajos terminados (`done`) se guardan una semana como historial y después se
borran solos.

### 17.3 Un evento solo crece

Un trabajo guarda el evento **tal como se publicó**, y puede ejecutarse después de un
despliegue con el código nuevo. Por eso:

> **La forma de un evento solo crece**: se le pueden añadir campos opcionales, pero
> nunca quitar, renombrar ni cambiar de significado.

Si de verdad necesitas romper su forma, el mismo despliegue tiene que traer una
migración que reescriba los trabajos pendientes de ese evento.

### 17.4 Lo que no es un error

No todo lo que sale "mal" es un fallo. Que no haya stock no es un error del sistema:
es una respuesta (`rejected`). Por eso `fulfil` captura `NotEnoughStock` y relanza el
resto. Reintentar un "no" de negocio solo serviría para obtener el mismo "no" cinco
veces.

## 18. Fallar a mitad: sagas y compensaciones

### 18.1 Dos transacciones, un hueco entre ellas

Mira otra vez `fulfil`. Hace dos cosas, y cada una se guarda en **su propia
transacción**:

1. `stockMovement.reserve` guarda los movimientos que sacan el stock.
2. `this.repo.persist(order)` guarda el pedido confirmado.

¿Qué pasa si la primera va bien y la segunda falla? Por ejemplo, el servidor se cae
justo entre las dos, o alguien ha tocado el pedido y el guardado choca tantas veces
que el caso de uso deja de reintentarlo. El stock está
reservado, y el pedido sigue `pending`. Durante un rato, los datos no cuadran.

No se pueden meter las dos en una transacción: son módulos distintos, y eso los
ataría para siempre (capítulo 8). Lo que se hace es **asegurarse de que el flujo
acaba llegando al final**.

### 18.2 Converger: reintentar hasta terminar

`fulfil` se ejecuta desde un worker. Un conflicto lo reintenta primero el propio caso
de uso (capítulo 9); si aun así falla, o falla por otra cosa, su trabajo se reintenta
(capítulo 17).
En el reintento:

- `reserve` ve que ya hay movimientos con la referencia del pedido, y no hace nada
  (capítulo 15).
- El pedido sigue `pending`, así que se confirma y se guarda.

El hueco se cierra solo. A esto se le llama **converger**: da igual en qué punto
falle, repetir el trabajo lleva siempre al mismo final. Funciona por dos cosas a la
vez: **cada paso se puede repetir sin daño** y **el trabajo se repite hasta
completarse**. Quita una de las dos y el flujo se puede quedar a medias para siempre.

¿Y si se agotan los intentos? El trabajo queda muerto, y eso significa algo concreto:
**un flujo atascado a mitad**. No es un log más: alguien tiene que mirarlo, arreglar
la causa y relanzarlo con `store.outbox.retry(id)`, que lo devuelve a la cola como
nuevo: sin intentos y para ya.

### 18.3 Cuando otro camino detiene el flujo

Reintentar sirve cuando el flujo solo puede ir hacia delante. Pero a veces **otro
camino lo detiene**: el cliente cancela el pedido. Si el stock ya estaba reservado,
hay que devolverlo.

Deshacer un paso que ya se guardó no es un rollback: aquella transacción ya se
confirmó. Es **otro paso**, que hace lo contrario: una **compensación**. Un flujo de
varios pasos, cada uno con su compensación, es una **saga**.

En La Despensa, la compensación de `reserve` es `release`:

```ts
// stock-movement.module.ts
@UseCase()
async release(reference: string): Promise<void> {
  const released = `release:${reference}`
  // Ya devuelto: nada que hacer.
  if (await this.repo.count({ reference: released }) > 0) return
  const reserved = await this.repo.find({ reference })
  // Nunca se reservó: nada que devolver.
  if (reserved.length === 0) return
  await this.repo.persistKeepingStock(reserved.map(movement =>
    StockMovement.record({
      productId: movement.productId,
      quantity: -movement.quantity,
      reference: released,
    })))
}
```

No borra los movimientos de la reserva: escribe otros que los anulan, y la historia
queda entera. Y se puede repetir, incluso dos veces a la vez: guarda con
`persistKeepingStock`, que apunta cada operación una sola vez (capítulo 15).

### 18.4 Cancelar un pedido

La cancelación se cuenta como cualquier otro cambio de estado. La entidad decide si
se puede:

```ts
// order.ts
cancel(): void {
  if (this.isCancelled) return
  if (this.data.status === 'rejected') {
    throw new OrderNotCancellable(this.id)
  }
  this.change({ status: 'cancelled' })
  this.trackEvent(new Order_Cancelled(this.toDTO()))
}
```

El caso de uso solo cancela y guarda. **No toca el stock**: eso es escribir en otro
módulo, y desde una petición no se hace (capítulo 19):

```ts
// order.module.ts
@UseCase()
async cancelMine(id: string): Promise<OrderDTO> {
  const order = await this.loadMine(id)
  order.cancel()
  await this.repo.persist(order)
  return order.toDTO()
}
```

La compensación sale de un worker, que reacciona a `order.cancelled`:

```ts
// order.workers.ts
orders.events.cancelled.subscribe(order => orders.releaseStock(order.id), {
  strategy: 'handler',
  queue: 'order.releaseStock.on.order.cancelled',
})
```

```ts
// order.module.ts
@UseCase()
async releaseStock(id: string): Promise<void> {
  await this.deps.stockMovement.release(id)
}
```

La ruta es `POST /api/orders/:id/cancel`, y responde con el pedido ya `cancelled`. El
stock vuelve un instante después.

### 18.5 Las carreras: cancelar mientras se cumple

Hay un caso delicado. El cliente cancela justo mientras `fulfil` está reservando.
Puede pasar en cualquier orden:

| Qué pasa | Cómo acaba |
|---|---|
| Se cancela **antes** de que `fulfil` empiece. | `fulfil` ve el pedido cancelado y llama a `release`, que no encuentra nada que devolver. |
| Se cancela **después** de reservar. | El worker de `order.cancelled` llama a `release`, y el stock vuelve. |
| Se cancela **mientras** `fulfil` reserva. | `fulfil` choca al guardar (el pedido cambió), se reintenta, ve que está cancelado y llama a `release`. |

Por eso `fulfil` empieza con esta línea:

```ts
if (order.isCancelled) return this.deps.stockMovement.release(order.id)
```

Y por eso `release` tiene que poder ejecutarse **antes** de que haya nada reservado, y
varias veces: en las carreras, puede llegar por dos caminos.

### 18.6 Las cuatro reglas

Cuando un flujo cruza varios módulos:

1. **Cada paso se puede repetir sin daño.** Con una referencia que identifica la
   operación (el id del pedido).
2. **Los pasos avanzan desde workers**, que se reintentan hasta completarse. Desde
   una petición, un fallo a mitad se quedaría a mitad.
3. **Si otro camino puede detener el flujo, cada paso tiene su compensación**: otro
   paso que lo deshace, lanzado desde un worker sobre el evento que lo detiene. Se
   puede repetir, y se puede ejecutar aunque el paso nunca llegara a hacerse.
4. **Un trabajo muerto es un flujo atascado.** Vigílalos: alguien tiene que
   mirarlos.

Los tests de La Despensa lo comprueban: un pedido cancelado devuelve su stock una
sola vez, por muchas veces que se ejecute su trabajo.

---

# Parte V · Hacer crecer la aplicación

## 19. Módulos que hablan entre sí

### 19.1 Leer de cualquiera, escribir solo desde un worker

Un módulo habla con otro de dos formas, y solo de dos:

| Forma | Cuándo | Ejemplo |
|---|---|---|
| **Llamar a un caso de uso** | Cuando necesitas la respuesta **ahora**: lecturas y comprobaciones. | `order.place` pregunta los precios a `product.findByIds`. |
| **Escuchar un evento** | Cuando algo es **consecuencia** de otra cosa. | Confirmar un pedido provoca un email. |

Leer de otro módulo se puede siempre, desde donde sea. **Escribir** en otro
módulo, en cambio, tiene una regla:

> Un módulo escribe en otro **solo desde un worker** que reacciona a un evento.

¿Por qué tanto empeño? Porque cada módulo guarda en **su propia transacción**.
Imagina que `order.place` reservara el stock él mismo, antes de guardar el pedido:

```ts
// ✗ Así no
@UseCase()
async place(input: OrderPlaceDTO): Promise<OrderDTO> {
  // …
  const order = Order.place({ customerId, customerEmail, lines: priced })
  await this.deps.stockMovement.reserve(order.lines, order.id)  // guardado
  await this.repo.persist(order)                                // y si falla?
  return order.toDTO()
}
```

La reserva ya está guardada cuando se intenta guardar el pedido. Si ese segundo
guardado falla (un disco lleno, el servidor que se reinicia, un conflicto que se
repite tras los reintentos), queda
stock reservado para un pedido que no existe. Y nadie lo arregla: la petición ya
devolvió su error, y nada la vuelve a intentar.

Ahora mira lo que hace La Despensa. `place` guarda solo el pedido, con su evento
`placed`. Un worker reacciona y llama a `fulfil`, que reserva y confirma:

```ts
// order.workers.ts
orders.events.placed.subscribe(order => orders.fulfil(order.id), {
  strategy: 'handler',
  queue: 'order.fulfil.on.order.placed',
})
```

Si `fulfil` falla a la mitad, su trabajo **se repite** hasta que termina. Como
reservar dos veces para el mismo pedido no reserva el doble (capítulo 15), repetir
es inofensivo, y el pedido acaba confirmado o rechazado. Siempre.

| Escribir en otro módulo desde… | Si falla a la mitad… |
|---|---|
| un caso de uso fuera de un worker (una petición, un script, un test) | queda a medias, y nadie lo termina |
| un caso de uso que llamó un worker | su trabajo se repite hasta que termina |

Por eso lo que un worker escribe en otro módulo debe poder repetirse sin daño: es
lo que el capítulo 15 llama **idempotente**. En el capítulo 18 verás qué pasa
cuando lo que falla es un paso que ya no se puede repetir.

### 19.2 El framework lo vigila

No hace falta que te acuerdes de la regla: el framework la comprueba mientras la
aplicación funciona. Si un caso de uso de `order`, fuera de un worker, acaba
guardando algo de `stockMovement`, falla con:

```
[write rule] order.place writes to shop.stockMovement outside a worker: write it
from a worker reacting to an event, or list it in its writesTo
```

Lo que hace al encontrarlo lo decide la opción `writeRule` de la base:

| `writeRule` | Qué hace | Para |
|---|---|---|
| `'error'` | Lanza un error: el guardado no se hace. Es lo que hace si no dices nada. | Siempre. |
| `'warn'` | Un aviso en la consola, una vez por caso de uso y módulo en que escribe. | Una aplicación que se está pasando a la regla. |
| `'off'` | Nada. | Casi nunca. |

```ts
const base = new ShopBase({ name: 'shop', store, writeRule: 'warn' })  // mientras te pasas a la regla
```

Como por defecto es un error, una escritura fuera de sitio rompe un test en lugar de
esconderse en un aviso.

A veces saltarse la regla está justificado: dos módulos que, por lo que sea, deben
escribirse en la misma petición, aceptando el riesgo. Entonces se dice **donde se
ve**, en el caso de uso, con el porqué al lado:

```ts
// Crear un espacio y su primer administrador va junto: sin administrador,
// nadie podría entrar a arreglarlo.
@UseCase({ writesTo: ['workspaceMember'] })
async create(input: WorkspaceCreateDTO): Promise<WorkspaceDTO> { … }
```

El `writesTo` vale para todo lo que se escribe **por debajo** de ese caso de uso,
lo llame quien lo llame. Si `onboarding.start` llama a `workspace.create`, el
miembro se guarda igual; a `onboarding.start` solo le toca declarar lo que escribe
él al llamar: `@UseCase({ writesTo: ['workspace'] })`.

### 19.3 Las dependencias

Un módulo declara los módulos que conoce en su fichero `.deps.ts`:

```ts
// order.deps.ts
export interface Order_Deps {
  product: Product_Module
  stockMovement: StockMovement_Module
}
```

y los recibe al inicializarse. El contexto los crea **en orden**, cada uno después de
los que usa:

```ts
function initializeModules(base: ShopBase, mailer: Mailer) {
  const brand = Brand_Module.initialize(base)
  const category = Category_Module.initialize(base)
  const product = Product_Module.initialize(base, { brand, category })
  const stockMovement = StockMovement_Module.initialize(base, { product })
  const order = Order_Module.initialize(base, { product, stockMovement })
  const notification = Notification_Module.initialize(
    base,
    { order },
    { mailer },
  )
  return { brand, category, product, stockMovement, order, notification }
}
```

Las dependencias de La Despensa no forman ningún círculo (son un grafo sin ciclos):

```mermaid
flowchart BT
    product --> brand
    product --> category
    stock[stock-movement] --> product
    order --> product
    order --> stock
    notification --> order
```

### 19.4 Las reglas

- Un módulo puede usar los casos de uso y escuchar los eventos de los módulos que
  conoce. **Nada más**: nunca su repositorio, sus tablas ni su entidad. Para leer
  datos de otro módulo, pregúntale con un caso de uso.
- **Lee de otro cuando quieras; escribe en otro solo desde un worker.** La regla es
  de cada contexto: un caso de uso de otro contexto es su API (capítulo 23).
- **Las dependencias nunca forman un círculo.** Si dos módulos parecen
  necesitarse mutuamente, uno de los dos deja de llamar y pasa a escuchar.
- **Un módulo no sabe quién depende de él.** `order` no sabe que existe
  `notification`; es `notification` quien conoce a `order` y escucha sus eventos.

Observa cómo se resolvió en La Despensa la pregunta "¿quién confirma el pedido?". El
stock no conoce los pedidos: solo sabe reservar unidades para una referencia. Es el
pedido quien, desde su worker, pide la reserva y se confirma a sí mismo. Si el stock
avisara al pedido, habría un círculo.

## 20. Referencias entre módulos

### 20.1 Un producto, su marca y su categoría

En La Despensa cada producto tiene una **marca** y una **categoría**. Marcas y
categorías son módulos propios, `brand` y `category`, porque tienen su vida: se
crean, se borran, tienen sus reglas.

¿Cómo guarda un producto su marca? Con su **id**, y nada más:

```ts
// product.schema.ts
export const ProductSchema = z.object({
  // …
  brandId: z.string().nullable(),
  categoryId: z.string().nullable(),
})
```

Nunca la entidad `Brand` dentro del producto, nunca una columna que copie su
nombre, nunca un JOIN a la tabla de marcas. Es la forma que propone Vaughn Vernon
para los agregados: **uno apunta a otro por su identidad**. Cada módulo sigue
siendo dueño de sus datos, y puede cambiar cómo los guarda sin que nadie se entere.

Esto deja tres preguntas: cómo saber que la marca existe al guardar, qué pasa
cuando se borra, y cómo enseñar su nombre.

### 20.2 Al escribir: comprobar que existe

Cuando alguien crea un producto con una marca, el caso de uso pregunta al módulo de
marcas si existe. Es una **lectura**, así que puede hacerla desde donde sea:

```ts
// product.module.ts
@UseCase()
async create(input: ProductCreateDTO): Promise<ProductDTO> {
  const { name, priceCents, brandId, categoryId } =
    ProductCreateSchema.parse(input)
  await this.assertNameFree(name)
  await this.assertReferences({ brandId, categoryId })
  const product = Product.create({ name, priceCents, brandId, categoryId })
  await this.repo.persist(product)
  return product.toDTO()
}

private async assertReferences(references: {
  brandId?: string | null,
  categoryId?: string | null,
}): Promise<void> {
  await this.resolveRefs(
    { brandId: references.brandId, categoryId: references.categoryId },
    { brandId: this.deps.brand, categoryId: this.deps.category },
  )
}
```

`resolveRefs` pregunta a cada módulo por su id. Para que pueda, `brand` y
`category` ofrecen un caso de uso `find` que devuelve **referencias**: un id y un
nombre.

```ts
// brand.module.ts
/** For other modules: the ones with these ids, as references. */
@UseCase()
async find(criteria: { id: string[] }): Promise<Ref[]> { … }
```

Las respuestas posibles:

| Lo que llega | Qué pasa |
|---|---|
| un id que existe | sigue adelante |
| un id que no existe | `ReferenceNotFound`, un 400: la petición está mal |
| `null` | "sin marca": no pregunta nada |
| nada (en un cambio parcial) | no lo mira: la marca se queda como estaba |

Cuando solo necesitas saber que algo existe, sin su nombre, hay otro caso de uso más
directo: `brand.assertExists(id)`, que lanza `BrandNotFound` si no está.

### 20.3 Al borrar: un worker limpia

Alguien borra la marca *Lácteos del Norte*. Sus productos siguen apuntando a ella.
¿Quién los arregla?

El módulo `brand` no puede: no sabe que existen productos (recuerda: un módulo no
sabe quién depende de él). Y aunque supiera, escribir en `product` desde una
petición rompería la regla del capítulo 19. Así que es `product` quien **escucha**
el evento `deleted` de las marcas, desde un worker:

```ts
// product.workers.ts
export function registerProductWorkers(
  products: Product_Module,
  deps: Product_Deps,
): void {
  deps.brand.events.deleted.subscribe(brand => products.forgetBrand(brand.id), {
    strategy: 'handler',
    queue: 'product.forgetBrand.on.brand.deleted',
  })
  deps.category.events.deleted.subscribe(
    category => products.forgetCategory(category.id),
    {
      strategy: 'handler',
      queue: 'product.forgetCategory.on.category.deleted',
    },
  )
}
```

```ts
// product.module.ts
/** A brand was deleted: its products are left without one. */
@UseCase()
async forgetBrand(brandId: string): Promise<void> {
  const products = await this.repo.find({ brandId })
  for (const product of products) product.update({ brandId: null })
  await this.repo.persist(...products)
}
```

Fíjate en dos detalles:

- **Busca los productos cuando corre**, no antes. El evento solo dice qué marca se
  borró; los productos que la tienen se miran en ese momento, así que no se escapa
  ninguno que cambiara entre medias.
- **Se puede repetir.** Si el trabajo se ejecuta dos veces, la segunda no encuentra
  productos con esa marca y no hace nada.

### 20.4 Al enseñar: componer, no unir

La pantalla del catálogo quiere mostrar "Yogur natural · Lácteos del Norte", no
`brandId: "k3x9…"`. Tienes dos caminos, y ninguno es un JOIN:

- **Composición en el cliente.** El cliente pide los productos y las marcas (son
  pocas), y las junta él. Es lo más sencillo, y basta casi siempre.
- **Un modelo de lectura.** Si hiciera falta buscar o listar por nombre de marca a
  gran escala, un worker escucharía los eventos de marcas y productos y mantendría
  una tabla pensada para esa pantalla (capítulo 28).

### 20.5 Lo que se acepta

Entre que `create` comprueba la marca y guarda el producto, alguien podría borrar
esa marca. O el worker de limpieza podría tardar un momento en correr. Durante ese
rato, un producto apunta a una marca que ya no existe.

**Se acepta.** Es el precio de que cada módulo sea dueño de lo suyo, y es pequeño:
el evento `deleted` llegará, el worker correrá, y el producto quedará sin marca. Un
cliente que pida esa marca en ese instante recibirá un 404, igual que si la hubiera
pedido un segundo después de borrarla.

## 21. Value objects

### 21.1 Valores con reglas propias

Algunos valores tienen reglas: un email se guarda en minúsculas y sin espacios; un
código de producto tiene un formato. Un **value object** define esas reglas en un solo
sitio: un tipo y una constante con el mismo nombre.

El framework trae dos: `Email` y `SecretToken`.

```ts
export type Email = string & z.$brand<'Email'>

export const Email = {
  schema: z.email()
    .max(254)
    .refine(email => email === email.toLowerCase())
    .brand<'Email'>(),
  // Recorta, pasa a minúsculas, y valida o lanza InvalidEmail.
  from(value: string): Email { … },
}
```

- **`from`** convierte lo que alguien escribió en el valor, o lanza un error de
  validación (400): `InvalidEmail`, o `InvalidSecretToken`, que nunca repite el
  token recibido.
- **`schema`** describe cómo se guarda. Va en el esquema de la entidad.

### 21.2 El brand: que el compilador te cuide

En ejecución, un `Email` es un `string`. Pero para TypeScript, un `string` cualquiera
**no es** un `Email` hasta que pasa por `Email.from` o por `Email.schema`. A eso se
le llama *brand*.

```ts
function send(to: Email) { … }

send('Ana@Ejemplo.es ')              // ✗ no compila: string sin comprobar
send(Email.from('Ana@Ejemplo.es '))  // ✓ 'ana@ejemplo.es'
```

Así es imposible guardar un email sin normalizar por despiste.

### 21.3 Dónde se aplica `from`

El esquema de **entrada** es permisivo: acepta el email como lo escriba la persona,
con espacios alrededor y en mayúsculas: le quita los espacios y comprueba que sea un
email.
Es la entidad quien lo normaliza al crearse:

```ts
// order.schema.ts
export const OrderSchema = z.object({
  customerEmail: Email.schema,        // como se guarda
  // …
})
export const OrderPlaceSchema = z.object({
  customerEmail: z.string().trim().pipe(z.email()),   // como llega: con espacios, en mayúsculas
  // …
})

// order.ts
export type OrderPlacement = {
  customerId: string
  /** As typed: it is kept as an `Email`. */
  customerEmail: string
  lines: OrderLineDTO[]
}

static place(input: OrderPlacement): Order {
  const customerEmail = Email.from(input.customerEmail)
  const order = new Order({ ...input, customerEmail, … }, true)
  // …
}
```

Por eso, en los tests de La Despensa, un pedido con `' ana@Shop.test'` guarda
`ana@shop.test`, y a esa dirección van sus avisos.

Si consultas con Kysely (capítulo 26), di el tipo en la interfaz de la tabla, y no
necesitarás ningún cast: `customerEmail: Email`.

### 21.4 Tus propios value objects

Uno que comparten varios módulos vive en la aplicación; uno que solo usa un módulo,
en su carpeta `value-objects/`. Comprueba su forma con `satisfies ValueObject<…>`:

```ts
import { ValidationError, type ValueObject } from 'newt/core'
import { z } from 'zod'

export class InvalidProductCode extends ValidationError {
  readonly code = 'product.invalid_code'
  constructor(value: string) {
    super(`'${value}' is not a product code`)
  }
}

export type ProductCode = string & z.$brand<'ProductCode'>

export const ProductCode = {
  schema: z.string()
    .regex(/^[A-Z0-9]+(-[A-Z0-9]+)*$/)
    .max(20)
    .brand<'ProductCode'>(),
  from(value: string): ProductCode {
    const code = value.trim().toUpperCase()
    if (!ProductCode.schema.safeParse(code).success) {
      throw new InvalidProductCode(value)
    }
    return code as ProductCode
  },
} satisfies ValueObject<ProductCode, string>
```

## 22. Errores y mensajes

### 22.1 Cada error, su clase

Los errores de un módulo viven en su carpeta `errors/`, uno por fichero, con un `code`
estable. La clase base decide el código HTTP:

| Base | HTTP | Cuándo |
|---|---|---|
| `NotFoundError` | 404 | Lo que se pide no existe. |
| `ValidationError` | 400 | La entrada está mal. |
| `ReferenceNotFound` | 400 | Un id **dentro** de la entrada no apunta a nada. |
| `UnauthorizedError` | 401 | No hay sesión. |
| `ForbiddenError` | 403 | Hay sesión, pero no tiene permiso. |
| `ConflictError` | 409 | El estado actual no lo permite. |
| `ConcurrencyConflict` | 409 | Alguien lo guardó mientras tanto. |

Bajo `/api`, el cliente recibe siempre `{ error, code }` (y, si el cuerpo no pasó el
esquema, sus `issues`). Su código decide qué hacer con el `code`, que nunca cambia; el
`error` es para leerlo una persona. Fuera de `/api` no hay API: una dirección que no
es de nadie la contesta el frontend, o un `404` de texto si no hay frontend.

### 22.2 Los mensajes del framework, en tu idioma

Los errores propios del framework hablan inglés. Una aplicación en castellano los
traduce **una vez, al arrancar**:

```ts
import { setMessages } from 'newt/core'

setMessages({
  concurrency_conflict: () =>
    'Alguien lo ha cambiado mientras tanto. Vuelve a intentarlo.',
  reference_not_found: ({ resource, id }) =>
    `La referencia ${resource} ${id} no existe`,
  not_signed_in: () => 'Inicia sesión para continuar',
  invalid_email: ({ email }) => `'${email}' no es un email válido`,
  invalid_secret_token: () => 'El token no es válido',
  route_not_found: ({ method, path }) =>
    `No hay ninguna ruta para ${method} ${path}`,
  method_not_allowed: ({ method, path }) =>
    `${method} no está permitido en ${path}`,
  validation: () => 'La petición no es válida',
  malformed_body: () => 'El cuerpo de la petición no es JSON válido',
  unsupported_media_type: () =>
    'El cuerpo de la petición tiene que enviarse como application/json',
  filter_too_deep: ({ max }) => `Un filtro anida como mucho ${max} grupos`,
  filter_too_many_conditions: ({ max }) =>
    `Un filtro tiene como mucho ${max} condiciones`,
  internal: () => 'Algo ha fallado',
})
```

Los mensajes de tus propios errores los escribes tú, en el idioma de tu aplicación.

## 23. Varios contextos

La Despensa tiene un solo contexto. Una aplicación más grande puede tener varios: uno
para las cuentas (`auth`), uno para la trastienda, uno para los clientes…

- **Cada contexto tiene su store**, sus módulos y su servidor (en su puerto y, en
  producción, en su dominio).
- **Los contextos dependen entre sí sin círculos**: cada uno se abre después de los
  que usa, y los recibe.
- **Un contexto llega a otro solo por sus casos de uso y sus eventos**, nunca por su
  store.

```ts
// Una aplicación con dos contextos: cada uno recibe su configuración y los que usa.
const auth = await Auth_Context.open(config.auth)
const backoffice = await Backoffice_Context.open(config.backoffice, auth)   // usa auth
```

Llamar a otro contexto es como llamar a una API externa. Lo que él guarda queda
guardado pase lo que pase después en el tuyo. Llámalo **después** de lo que pueda
fallar, y haz que la llamada se pueda repetir.

Por eso la regla de escritura (capítulo 19) no cruza contextos. El caso de uso al
que llamas es la **raíz** de lo que hace en el suyo, como si lo llamara alguien de
fuera: puede escribir en su módulo, y dentro de su contexto la regla se cumple como
siempre.

---

# Parte VI · Dónde viven los datos

## 24. Elegir un store

| | Ficheros (`FileStore`) | SQLite (`SqliteStore`) | Postgres y MySQL |
|---|---|---|---|
| **Qué es** | Un JSON por registro, en carpetas. | Una base de datos SQLite, en un fichero. | Un servidor de base de datos. |
| **Instalar** | Nada. | Nada (viene con Bun). | El servidor; el driver viene con Bun. |
| **Ver los datos** | Abre los ficheros. | Cualquier cliente de SQLite. | El cliente de cada uno. |
| **Tamaño** | Miles de registros. | Millones. | Millones, y varias máquinas. |
| **Transacciones** | Una cada vez. | Una cada vez. | Muchas a la vez. |
| **Estructura** | No hay: cada tabla es una carpeta. | Migraciones SQL. | Migraciones SQL, en su dialecto. |
| **Ideal para** | Prototipos, herramientas pequeñas, tests. | Producción en una máquina. | Producción con mucho tráfico o varios servidores. |

Como los módulos de La Despensa solo usan lo que todo store sabe hacer (tablas y
criterios), **cambiar de store es cambiar una línea** en el contexto:

```ts
function openStore(store: ShopConfig['store']): Promise<Store> {
  return store.kind === 'files'
    ? FileStore.open({ folder: store.folder })
    : SqliteStore.open({
        path: store.path,
        migrations: join(import.meta.dir, 'migrations'),
      })
}
```

Los tests de La Despensa ejecutan todos sus escenarios **contra los dos stores**.

Para tests, `SqliteStore.open({ path: ':memory:' })` crea una base de datos temporal
que desaparece al cerrarla, y que se comporta exactamente igual que una en disco.

Por eso merece la pena describir las tablas con las opciones neutras del capítulo 5
(`types`, `unique`): cada store usa lo que necesita e ignora el resto.

### 24.1 Postgres y MySQL

Cuando una máquina se queda pequeña, o quieres varios servidores sobre los mismos
datos, el framework trae dos stores más. Se abren con una URL:

```ts
import { join } from 'node:path'
import { PostgresStore } from 'newt/adapter-postgres'
import { MySqlStore } from 'newt/adapter-mysql'

const postgres = await PostgresStore.open({
  url: 'postgres://user:password@host:5432/despensa',
  migrations: join(import.meta.dir, 'migrations/postgres'),
})

const mysql = await MySqlStore.open({
  // MySQL 8.4 solo acepta conexiones por TLS.
  url: 'mysql://user:password@host:3306/despensa?sslmode=require',
  migrations: join(import.meta.dir, 'migrations/mysql'),
})
```

Lo que cambia respecto a SQLite:

- **Las transacciones van a la vez**, como las lleva la base de datos. Las claves de
  `guard` (capítulo 10) siguen cumpliendo su promesa: dos guardados con la misma
  clave nunca se mezclan. Los que guardan claves distintas no se esperan.
- Si la base de datos abandona una transacción (un *deadlock*), es un
  `ConcurrencyConflict`, y el caso de uso se repite.
- **Las migraciones se escriben en el SQL de cada uno**: una carpeta por base de
  datos, con los mismos pares de ficheros.
- **`ieq` compara igual en todos**: ignora mayúsculas solo de la A a la Z, como
  SQLite. "OLIVA" es igual a "oliva", pero "AZÚCAR" no lo es a "azúcar": "Ú" y "ú"
  quedan fuera de esa regla, en todos los stores por igual.

Los módulos no cambian. Si sus repositorios son portables (capítulo 26), pasar de
SQLite a Postgres es un store nuevo y sus migraciones.

## 25. Migraciones

La estructura de los datos cambia con la aplicación. Las migraciones son esos
cambios, aplicados en orden y recordados por el store. Abrir un store con `open`
aplica las pendientes: un contexto nunca arranca con datos viejos.

### 25.1 En SQL

Cada migración son dos ficheros SQL en la carpeta del contexto, numerados:

```
migrations/
├── 00001_shop_up.sql      lo que cambia
└── 00001_shop_down.sql    cómo deshacerlo
```

```sql
-- 00001_shop_up.sql
CREATE TABLE product (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  price_cents INTEGER NOT NULL,
  brand_id TEXT,
  category_id TEXT,
  archived INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  version INTEGER NOT NULL
);
```

`brand_id` no es una clave ajena: la marca es de otro módulo, y un módulo no ata sus
tablas a las de otro (capítulo 20).

Reglas:

- **Cada campo de la entidad es una columna** con su nombre en *snake_case*
  (`priceCents` → `price_cents`). Toda tabla de entidad tiene `id TEXT PRIMARY KEY`
  y `version INTEGER NOT NULL`.
- **Un valor único es un índice único.** Si borras con borrado lógico, hazlo parcial:
  `CREATE UNIQUE INDEX … WHERE deleted_at IS NULL`.
- **Una migración aplicada no se edita nunca**: un cambio es una migración nueva.
- **Los datos sobreviven a todas las migraciones**: una columna nueva lleva un valor
  por defecto, y una tabla que cambia de forma copia sus filas. En SQLite las
  migraciones corren con las claves ajenas apagadas, así que rehacer una tabla
  (crear la nueva, copiar, borrar la vieja, renombrar) no borra las filas que
  apuntan a ella; si alguna queda apuntando a nada, la migración falla.
- **Dos migraciones con el mismo número** (dos ramas que se juntan) no arrancan:
  renumera una.
- `down` deshace exactamente lo que hizo `up`.

Postgres y MySQL usan los mismos pares de ficheros, cada uno en su dialecto
(`BOOLEAN` y `JSONB` en Postgres; `VARCHAR(36)` y columnas `utf8mb4_bin` en MySQL).
[`stores.md`](stores.md) cuenta los detalles de cada uno.

Un fichero puede tener varias sentencias, y también triggers y funciones con sus
propios `;` dentro: SQLite lo ejecuta sentencia a sentencia, con el trigger de una
pieza, y en Postgres un cuerpo entre
`$$ … $$` va de una pieza. En MySQL cada `;` cierra una sentencia, así que un trigger
de MySQL tiene que ser de una sola (`FOR EACH ROW SET NEW.x = …`), sin `BEGIN … END`.

Las pendientes se aplican en una transacción. En SQLite y Postgres es todo o nada. En
MySQL cada cambio de estructura (`CREATE`, `ALTER`, `DROP`…) se confirma al momento,
con todo lo anterior: unas migraciones solo de datos (`INSERT`, `UPDATE`…) son todo o
nada, pero si algo falla después de un cambio de estructura, lo confirmado se queda
(las migraciones anteriores, anotadas como aplicadas, y los cambios de estructura de
la que falló, sin anotar).

En Postgres y MySQL, dos procesos que arrancan a la vez se turnan: el segundo espera
al primero y encuentra sus migraciones aplicadas. Y dos ficheros con el mismo número
y distinto nombre (dos ramas que se juntan) son un error: renumera una de las dos.

### 25.2 En ficheros

En ficheros no hay estructura que cambiar: una migración **transforma registros**.
Es una función TypeScript:

```ts
import type { FileMigration } from 'newt/adapter-files'

const productsHaveACategory: FileMigration = {
  version: 1,
  name: 'product-category',
  up: async store => {
    const products = store.collection('product')
    for (const product of await products.all()) {
      await products.put({ ...product, categoryId: null })
    }
  },
  down: async store => {
    const products = store.collection('product')
    for (const { categoryId: _, ...product } of await products.all()) {
      await products.put(product)
    }
  },
}

const store = await FileStore.open({
  folder: 'data/despensa',
  migrations: [productsHaveACategory],
})
```

## 26. Consultas que una tabla no sabe hacer

`TableRepository` y sus criterios cubren lo habitual. Para lo demás (una suma, un
`JOIN` entre tablas del mismo módulo, una consulta con agrupaciones), la manera
recomendada es **Kysely**, un *query builder* con tipos, sobre la conexión del store.

Añade Kysely a tu proyecto (`bun add kysely`) y dale a tu base una instancia con
`kyselyFor`:

```ts
// shop-base.ts, en una variante de La Despensa solo con SQLite
import { Base } from 'newt/runtime'
import { HttpRouter } from 'newt/http'
import { kyselyFor } from 'newt/kysely'
import type { SqliteStore } from 'newt/adapter-sqlite'

type ShopDatabase = {
  stock_movement: { id: string, productId: string, quantity: number }
}

export class ShopBase extends Base<SqliteStore> {
  readonly http = new HttpRouter()
  readonly db = kyselyFor<ShopDatabase>(this.store)
}
```

Kysely pide un store SQL (SQLite, Postgres o MySQL): con él, el contexto deja de
poder abrirse sobre ficheros. Es el segundo escalón de la lista del 26.1.

Y un repositorio la usa:

```ts
// Una versión de levelOf que suma en SQL en vez de en memoria
async levelOf(productId: string): Promise<number> {
  const { level } = await this.base.db
    .selectFrom('stock_movement')
    .select(eb => eb.fn.sum<number>('quantity').as('level'))
    .where('productId', '=', productId)
    .executeTakeFirstOrThrow()
  return Number(level ?? 0)
}
```

Tres cosas que saber:

- **Los campos se llaman como en la fila** (`productId`), no como la columna
  (`product_id`): Kysely los traduce por el camino. Las tablas sí se llaman como son
  (`stock_movement`).
- **Se ejecuta dentro de la transacción en curso**, como todo lo que hace el
  repositorio. Las transacciones de Kysely están prohibidas: las transacciones
  siempre son las del store. En un repositorio, una escritura con Kysely va dentro de
  `saveRows` (o del `save` de sus entidades); fuera, en `store.transaction`.
- **La misma consulta vale en SQLite, Postgres y MySQL.** En SQLite y en MySQL, un
  booleano vuelve como 0 o 1, y en SQLite una lista o un objeto vuelve como su texto
  JSON: `SqliteRow<Row>` lo dice en los tipos. Una suma vuelve como texto en Postgres
  y MySQL (`'5'`), y un `COUNT` en Postgres: pásalos por `Number(…)`. Lo que no es igual es
  lo que cuenta una escritura: en Postgres y MySQL, `numUpdatedRows` y
  `numDeletedRows` valen `0n` y no hay `insertId`. Si necesitas saber si escribió
  algo, pídelo con `returning` (Postgres) o vuelve a leer.

Con ficheros, la puerta es `store.collection(name)`: `get`, `all`, `put` y `remove`.

Y cuando las entidades no son las filas de una tabla (una entidad repartida en dos
tablas, por ejemplo), hereda de `Repository` en vez de `TableRepository` y escribe tú
cada entidad dentro de `save`. Sigues teniendo la transacción, la versión y los
eventos.

Y si lo que escribes no es de ninguna entidad (una proyección, un índice de
búsqueda, una tabla de enlace que se reescribe entera), usa `saveRows`. Escribe como
un guardado: en una transacción, bajo la regla de escritura (capítulo 19) y
protegiendo lo que diga su `guard`:

```ts
// note.repository.ts, en el ejemplo de notes
async recordActivity(noteId: string, what: string, at: string): Promise<void> {
  // El id de un registro en ficheros es letras, números, '.', '-' y '_': la fecha, en dígitos.
  const id = `${noteId}.${what}.${at.replace(/[^0-9]/g, '')}`
  await this.saveRows(() => this.store.collection('activity').put({ id, noteId, what, at }))
}
```

Un repositorio escribe por `save` o por `saveRows`, nunca en una transacción propia
(`store.transaction`): así cada escritura pasa por la regla y por su `guard`. La
excepción es `this.table.patch(id, cambios)`, para apuntar que algo pasó sin cambiar
la entidad (un `lastUsedAt`): no toca la versión, así que dos peticiones a la vez no
chocan.

### 26.1 La regla de la portabilidad

Cada paso por esta lista te ata un poco más a un store. Baja solo cuando el anterior
no llegue:

1. **`TableRepository` y criterios**, por defecto. Valen en todos los stores, también
   en ficheros.
2. **Kysely**, para lo que un criterio no sabe decir. Vale en todos los stores SQL.
3. **El SQL propio de un store**, solo cuando no hay otro camino (la búsqueda de
   texto completo de SQLite, por ejemplo). Ponlo en un único sitio, y márcalo con un
   comentario que diga que es de ese store y por qué.

```ts
// SQLite only: FTS5 full-text search; Postgres would use tsvector here.
async searchText(words: string): Promise<string[]> {
  // ...
}
```

Así, el día que cambies de store, sabrás exactamente qué reescribir: lo marcado. El
resto se queda como está.

## 27. Búsquedas: filtros

### 27.1 Criterios con grupos

Los criterios del capítulo 5 piden que todo se cumpla a la vez. Para decir "esto **o**
aquello", los criterios se agrupan con `and` (todos) y `or` (al menos uno), y los
grupos se anidan:

```ts
// Los baratos, o los de Acme que no estén archivados
await this.repo.find({
  or: [
    { priceCents: { lt: 500 } },
    { and: [{ brandId: acme }, { archived: false }] },
  ],
})
```

Todos los stores los entienden igual.

### 27.2 Lo que el cliente puede pedir: `defineFilter`

Un criterio es para el código del módulo, y puede pedirlo todo. Un **filtro** es lo
que envía un cliente, y forma parte del contrato público: tiene que estar cerrado.
`defineFilter` declara qué campos puede filtrar un cliente, con qué operadores, y
hasta dónde:

```ts
// product.schema.ts
export const ProductFilter = defineFilter({
  price: {
    field: 'priceCents',
    value: z.number().int(),
    ops: ['eq', 'lt', 'lte', 'gt', 'gte'],
  },
  name: { field: 'name', value: z.string(), ops: ['eq', 'ieq'] },
  brand: { field: 'brandId', value: z.string(), ops: ['eq', 'in'] },
  category: { field: 'categoryId', value: z.string(), ops: ['eq', 'in'] },
}, { maxDepth: 3, maxConditions: 10 })

/** Lo que envía el cliente: el frontend importa este tipo. */
export type ProductFilterDTO = z.infer<typeof ProductFilter.schema>
```

- Cada **nombre público** (`price`) apunta a un campo de la fila (`priceCents`): el
  contrato no enseña cómo guardas los datos.
- Un campo o un operador que no esté declarado es un **400**.
- **`maxDepth`** limita cuántos grupos anidados caben, y **`maxConditions`**, cuántas
  condiciones en total. Una lista de `in` tiene como mucho 100 valores.

El cliente envía un árbol como este:

```json
{
  "or": [
    { "field": "price", "op": "lt", "value": 100 },
    { "field": "brand", "op": "eq", "value": "0193…" }
  ]
}
```

### 27.3 El caso de uso y la ruta

```ts
@UseCase()
async search(filter: unknown, page: PageRequest): Promise<Page<ProductDTO>> {
  const criteria = ProductFilter.toCriteria<ProductRow>(
    ProductFilter.schema.parse(filter),
  )
  const found = await this.repo.page(
    { and: [criteria, { archived: false }] },
    page,
  )
  return {
    items: found.items.map(product => product.toDTO()),
    hasMore: found.hasMore,
    total: found.total,
  }
}
```

Lo que impone el sistema (aquí, que no salgan los archivados) va **al lado** del
filtro del cliente, en un `and`. Así no hay filtro que lo esquive.

Un árbol de condiciones no cabe bien en una URL, así que viaja en el cuerpo:

```ts
base.http.post('/products/search', async request =>
  Response.json(
    await products.search(await request.json(), pageRequestFrom(request)),
  ))
```

### 27.4 Cuidado con el rendimiento

Cada operador que ofreces es una consulta que cualquiera puede lanzar. Un `or` entre
campos distintos impide a la base de datos usar sus índices, y la obliga a mirar
todas las filas. Ofrece solo lo que tus datos pueden responder deprisa, pon límites
bajos, y amplíalos cuando un caso real lo pida.

## 28. Datos fuera de una transacción: proyecciones y analítica

A veces quieres datos en un sitio que no tiene transacciones: un motor de búsqueda,
una base analítica como ClickHouse, un almacén de ficheros. No pueden guardar un
cambio y sus trabajos juntos, así que no pueden ser el store de un contexto. Pero sí
pueden guardar **proyecciones**: copias de datos, pensadas para leerlas.

```mermaid
flowchart LR
    S[(Store del contexto)] -->|order.confirmed| W[Worker: un handler]
    W -->|append por id| CH[("Analítica: ventas")]
    Q[Informe de ventas] --> CH
```

- La **verdad** vive en el store del contexto, con sus transacciones.
- Un **worker** (un `handler`) sigue los eventos y escribe la proyección.
- Como el trabajo puede repetirse, escribe de forma idempotente: con el id del evento
  o del pedido, de modo que repetirlo no duplica nada.
- La proyección va **un poco por detrás**: es consistencia eventual otra vez.

### 28.1 El puerto de analítica

Para los datos que se leen mucho de golpe (ventas por mes, por producto, por cliente),
el framework define un puerto, `Analytics`, con una sola forma de escribir: **añadir**.

```ts
export interface Analytics {
  append(dataset: string, rows: AnalyticsRow[]): Promise<void>
  close(): Promise<void>
}
```

- **Solo se añade**: una fila, una vez dentro, no cambia ni se va. Lo que cambia
  después es una fila nueva que lo cuenta (una devolución es otra línea, en negativo).
- **Cada fila lleva su `id`** (el de la línea del pedido, por ejemplo). Una fila cuyo
  id ya está no se añade otra vez: si el worker se repite, no duplica ventas.
- **Leer es cosa de cada adaptador**, en el lenguaje de su base de datos: las
  consultas analíticas no caben en unos criterios.

Un worker la alimenta a partir de los eventos. El módulo recibe el `Analytics` en sus
opciones (`<m>-options.ts`), como `notification` recibe su `mailer`:

```ts
@UseCase()
async recordSale(order: OrderDTO): Promise<void> {
  await this.options.analytics.append('sale_line', order.lines.map((line, index) => ({
    id: `${order.id}:${index}`,
    productId: line.productId,
    quantity: line.quantity,
    day: order.updatedAt.slice(0, 10),
  })))
}

// en su fichero de workers
orders.events.confirmed.subscribe(order => sales.recordSale(order), {
  strategy: 'handler',
  queue: 'sales.recordSale.on.order.confirmed',
})
```

El framework todavía no trae adaptadores (ClickHouse y DuckDB vendrán). Para los
tests está `MemoryAnalytics`, en `newt/port-analytics/contract`, y quien escriba un
adaptador lo comprueba con `describeAnalyticsContract`.

---

# Parte VII · Calidad y producción

## 29. Tests

### 29.1 Probar la aplicación entera

La forma más fiel de probar es la de un cliente: abrir el contexto en una carpeta
temporal, servirlo en un puerto libre y hacer peticiones.

```ts
beforeEach(async () => {
  folder = await mkdtemp(join(tmpdir(), 'despensa-'))
  mails = []
  shop = await Shop_Context.open({
    store: { kind: 'files', folder },
    mailer: { send: async mail => { mails.push(mail) } },
  })
  server = shop.serve(0)        // puerto 0: uno libre
  shop.start()
})

afterEach(async () => {
  await server.stop()
  await shop.stop()
  await rm(folder, { recursive: true })
})
```

Un caso de uso que escribe en otro módulo fuera de un worker (capítulo 19)
**falla**: es lo que hace la regla si no dices nada. Así te enteras en cuanto lo
escribes, no en producción.

### 29.2 Esperar a los workers

Con consistencia eventual, justo después de hacer un pedido el worker aún no lo ha
confirmado. En un test, **espera a que no quede trabajo listo**:

```ts
test('takes an order at once, and confirms it in the background', async () => {
  const oil = await product('Olive oil', 1_000)
  await call('POST', `/stock/${oil}/received`, { quantity: 5 })

  const placed = await order(oil, 3)
  expect(placed.body).toMatchObject({ status: 'pending' })

  await shop.base.jobs.idle()        // hasta que no queda nada listo por hacer

  const read = await call('GET', `/orders/${placed.body.id}`)
  expect(read.body).toMatchObject({ status: 'confirmed' })
})
```

`jobs.idle()` es la herramienta de los tests y de los scripts. Nunca esperes a un
worker con un `sleep`. (Una reacción `'fire-and-forget'` no es un trabajo, e `idle()`
no la espera: un test que la escucha sí necesita un instante.) Espera a que no quede
ningún trabajo **listo** ni en marcha: uno que falló y espera su reintento (a los 10
segundos, y después más) sigue pendiente cuando `idle()` vuelve. Si un test provoca fallos,
mira el estado de sus trabajos con `shop.base.store.outbox.list()`.

### 29.3 Probar lo difícil

Los tests que más valen son los de las situaciones que el capítulo 10 y el 15
temían:

- **Concurrencia**: dos pedidos a la vez por las últimas unidades → uno confirmado y
  otro rechazado, y el stock nunca negativo.
- **Repetición**: ejecutar un worker dos veces → el mismo resultado. Cancelar un
  pedido devuelve el stock una sola vez, aunque su trabajo corra dos veces.
- **Los dos stores**: los mismos escenarios contra ficheros y contra SQLite, con
  `describe.each`.

```ts
test('gives the last units to one of two orders placed at once', async () => {
  await call('POST', `/stock/${oil}/received`, { quantity: 3 })

  const placed = await Promise.all([order(oil, 2, 'ana'), order(oil, 2, 'bea')])
  await shop.base.jobs.idle()

  // …uno confirmed y otro rejected
  expect(await level(oil)).toBe(1)
})
```

Un test que no puede fallar no prueba nada: rompe el código a propósito una vez y
mira cómo falla.

## 30. Observabilidad

Cada llamada a un caso de uso es un **span** de una traza, con su nombre
(`order.place`), su contexto y su módulo. Un caso de uso llamado desde otro es un span
dentro del suyo. Los reintentos por conflicto quedan anotados, y un error que no es
de negocio marca el span.

El worker también deja los suyos, con nombres que empiezan por `job.`: `job.claim`
cada vez que busca trabajo (tras cada guardado que publica un evento, tras cada
trabajo que acaba y, al menos, cada 5 s mientras haya algún `handler`), `job.renew`,
`job.close`, `job.seen` y `job.purge`. Un tracer que no los quiera ver los filtra
por el nombre.

Para recogerlos, pasa un `Tracer` a la base:

```ts
import type { Tracer } from 'newt/core'

const tracer: Tracer = {
  async startActiveSpan(name, attributes, fn) {
    const started = performance.now()
    try {
      return await fn({
        setError: error => console.error(name, error),
        addEvent: () => {},
        end: () => {},
      })
    } finally {
      const ms = (performance.now() - started).toFixed(1)
      console.log(`${name} ${ms} ms`, attributes)
    }
  },
}

const base = new ShopBase({ name: 'shop', store, tracer })
```

Un adaptador para OpenTelemetry implementa esa misma interfaz. Sin tracer, no se
registra nada.

## 31. En producción

### 31.1 Arrancar y parar

- Al arrancar: abre los contextos (cada uno aplica sus migraciones), sirve y arranca
  los workers (`context.start()`).
- Al parar (`SIGTERM`): deja de aceptar peticiones (`server.stop()`) y después
  `context.stop()`, que espera a los workers en marcha y cierra el store. Lo que quede
  pendiente seguirá pendiente al volver.
- El framework **avisa** si hay trabajos esperando en una cola que ningún worker
  atiende desde hace cinco minutos: casi siempre, un caso de uso o un módulo
  renombrado (capítulo 13). Tras un despliegue, el aviso llega a los pocos minutos.

### 31.2 Scripts

Un script (una importación, una corrección de datos) abre los contextos como el
servidor, y actúa con `runAsActor`. Si sus cambios despiertan workers, arráncalos y
espera a que acaben antes de cerrar:

```ts
const shop = await Shop_Context.open(config)
shop.start()
await runAsActor({ userId: 'import' }, async () => {
  for (const row of rows) await shop.modules.product.create(row)
})
await shop.base.jobs.idle()
await shop.stop()
```

Si tu aplicación tiene más ámbitos que el actor (un espacio de trabajo, por ejemplo),
el script entra también en ellos, como explica el capítulo 7.

### 31.3 Varios procesos

Un servidor y un script pueden trabajar a la vez sobre el mismo store. Todos los
stores lo permiten: con ficheros y SQLite, las transacciones de uno esperan a las del
otro; con Postgres y MySQL van a la vez, y `guard` protege lo que debe ir por turnos.
Con ficheros, los procesos tienen que estar en la misma máquina.

La espera entre procesos tiene un límite: 5 s en SQLite (`database is locked`) y
10 s con ficheros (`The store is locked by …`). Ninguno de los dos es un
`ConcurrencyConflict`, así que no se reintenta solo: una transacción larga de un
script hace fallar las peticiones del servidor que esperan tras ella. Haz los
scripts en transacciones cortas, una por fila o por lote pequeño.

### 31.4 Migrar a mano

Abrir con `open` migra solo. Para hacerlo a mano (ver qué hay pendiente, deshacer la
última), abre con `connect`, que no migra, y usa `store.migrations`: `up()` aplica
las tuyas y después las del framework, como `open`.

```ts
const store = await SqliteStore.connect({
  path: 'data/despensa.db',
  migrations: 'examples/despensa/migrations',   // relativa a donde ejecutas
})
// { applied: ['00001_shop'], pending: [] }
console.log(await store.migrations.status())
await store.close()
```

Una carpeta de migraciones que no existe es un error al migrar (al abrir con `open`),
no una base de datos sin migraciones: una ruta mal escrita no deja un store vacío sin
avisar.

---

# Apéndices

## A. Las reglas de oro, en una página

**Las once del capítulo 2** siguen siendo las primeras. Esta página las reparte por
temas y añade las que han ido saliendo.

**Diseño**
- Un módulo, una responsabilidad. Su entidad tiene su nombre.
- Lo que se guarda junto es un módulo. Lo demás se sigue por eventos.
- Las dependencias entre módulos y entre contextos nunca forman un círculo.
- Un módulo apunta a lo de otro solo por su id: nunca la entidad, nunca su tabla, ni
  un `JOIN` a ella.

**Casos de uso**
- Validar → cargar → decidir → cambiar la entidad → guardar una vez → devolver DTOs.
- Dos validaciones: la de la entrada, en el caso de uso; la del estado, en la entidad.
- Los métodos de la entidad reciben datos del dominio, no el DTO de entrada.
- Lo que es de su dueño toma el actor, no un id.
- Ninguna lista se devuelve entera; `items`, `hasMore` y `total`, escritos uno a uno.
- `retryOnConflict: false`, con el motivo al lado, en lo que hace algo irrepetible
  antes de guardar.
- Un módulo lee de otros cuando quiere, pero escribe en otro solo desde un worker.

**Guardar**
- Una transacción es un guardado.
- Una regla sobre varias filas se comprueba en el `after`, y declara lo que guarda
  con `guard`.
- Un valor que todos cambian es un módulo de movimientos.

**Eventos y workers**
- Un evento existe solo si su transacción se confirmó.
- Un evento de cada tipo por entidad y guardado. Dos tipos en un guardado suelen ser
  un caso de uso que hace dos cosas.
- Lo que importa, con `strategy: 'handler'`; lo prescindible, con `'fire-and-forget'`.
- Un worker llama a un caso de uso, sin actor (lo que necesite lo lee del evento) y
  puede repetirse.
- Lo irreversible sale de un worker.
- Lo que falla a mitad se arregla hacia delante: reintentos o una compensación.
- Un evento solo crece.

**Entrada y salida**
- Una ruta no piensa.
- Los datos se validan en la puerta y los value objects normalizan.
- Un cliente filtra solo por lo que `defineFilter` le permite.
- Los errores son clases con un `code` estable.

**Datos**
- `TableRepository` por defecto, Kysely para lo demás, y el SQL de un store solo
  cuando no hay otro camino, aislado y marcado.
- La analítica solo añade, y cada fila lleva su id.

## B. Anatomía de un módulo

`modules/<módulo>/`, en *kebab-case*:

| Fichero | Qué contiene |
|---|---|
| `<m>.schema.ts` | Los esquemas, los DTOs y sus filtros: el contrato público. |
| `<m>.ts` | La entidad. Reexporta el esquema. |
| `<m>.repository.ts` | Lo único que toca el store. |
| `<m>.module.ts` | Los casos de uso y sus eventos (`this.events = eventsOf(…)`). `static initialize`. |
| `<m>.routes.ts` | Sus rutas, si tiene. |
| `<m>.workers.ts` | Sus reacciones a eventos (`events.<evento>.subscribe(…)`), si tiene. |
| `<m>.deps.ts` | Los módulos que conoce, si conoce alguno. |
| `<m>-options.ts` | Sus opciones, si tiene. |
| `events/<m>-<verbo>.ts` | Un evento por fichero. |
| `errors/<error>.ts` | Un error por fichero. |
| `value-objects/<nombre>.ts` | Sus value objects, si tiene. |
| `services/<nombre>.ts` | La lógica que comparten sus casos de uso, un fichero cada una. |
| `*.test.ts` | Sus tests, junto a lo que prueban. |

[`newt-eslint`](../packages/newt-eslint) lo comprueba: la anatomía, que un módulo
solo llegue a otro por lo que ofrece, y el nombre de la cola de cada `handler`.
También que un módulo no abra transacciones propias, que ninguna promesa se quede
sin `await` y, si le dices tus contextos, que cada uno solo importe los que dice
usar.

Nombres: carpeta `purchase-order`, clase `PurchaseOrder_Module`, entidad
`PurchaseOrder`, tabla `purchase_order`, caso de uso `purchaseOrder.confirm`, evento
`purchaseOrder.confirmed`, error `purchase-order-not-found.ts`, cola de un worker
`notification.orderConfirmed.on.order.confirmed`.

## C. Problemas frecuentes

**"Someone changed it in the meantime" (`ConcurrencyConflict`) en un caso de uso.**
Dos guardados de lo mismo a la vez, y el caso de uso ya lo intentó cuatro veces (o
dice `retryOnConflict: false`). Si es un alta que choca con un valor único, es la
protección funcionando: el usuario debe elegir otro valor.

**El worker no se ejecuta.**
¿Has llamado a `context.start()`? ¿La reacción tiene `strategy: 'handler'`, y no
`'fire-and-forget'`? En un test, ¿esperas con `jobs.idle()`?

**"N job(s) of '…' wait, and no worker serves that queue".**
Hay trabajos pendientes en una cola que ningún worker atiende desde hace cinco
minutos. El nombre de la cola dice el módulo, el caso de uso y el evento
(`notification.orderConfirmed.on.order.confirmed`), así que cambiarlo al renombrar
cualquiera de los tres deja los trabajos viejos esperando con el nombre antiguo.
Vuelve a poner el nombre, o escribe un script que haga lo que debían hacer esos
trabajos.

**"[write rule] … writes to … outside a worker".**
Un caso de uso de un módulo ha guardado en otro sin pasar por un worker. Si falla a
mitad, nada lo terminará (capítulo 19). Haz que el segundo módulo reaccione a un
evento del primero con un `handler`. Si la excepción está justificada, dila donde
se vea: `@UseCase({ writesTo: ['otroModulo'] })`, con el motivo al lado. Con
`writeRule: 'warn'` es un aviso en vez de un error.

**Dos pedidos se llevan las mismas últimas unidades.**
La regla que mira varias filas no declara lo que guarda. Añade su clave al guardado:
`guard: ['stock:<id>']` (capítulo 10). En ficheros y SQLite parece funcionar sin ella,
porque todo va por turnos; en Postgres y MySQL, no.

**Un trabajo está `dead`.**
Agotó sus intentos. Mira su `lastError` en `store.outbox.list()`, corrige la causa y
relánzalo con `store.outbox.retry(id)` (o escribe un script que haga lo que debía
hacer). Un trabajo muerto es un flujo atascado a mitad: el capítulo 18 cuenta cómo
pensarlo.

**"A write runs inside `store.transaction`".**
Has intentado escribir con la conexión de un `SqliteStore` fuera de un guardado. En
un repositorio, las escrituras van dentro de `persist`, de `save` o de `saveRows`;
fuera de él (un script, una migración), dentro de `store.transaction(…)`. Postgres y
MySQL no lo comprueban: una escritura fuera de una transacción se hace al momento,
sola. Hazlas igual dentro de una, para que el código valga para cualquier store.

**"Waited 30000 ms for the store".**
Algo esperó demasiado su turno. La causa habitual es código que se ejecuta dentro de
una transacción y vuelve a pedir el store desde fuera de ella, de modo que se espera a
sí mismo. Pasa al guardar desde un callback que no está en la cadena de `await` del
guardado (un `EventEmitter`, un temporizador lanzado antes). Mueve ese trabajo a un
worker.

**Un producto recién creado no aparece en otra parte.**
Si esa otra parte la mantiene un worker, es consistencia eventual: aparecerá enseguida.
Diseña la interfaz para ese instante (capítulo 14).

**Un producto apunta a una marca que ya no existe.**
Durante un momento es normal: entre que se borra la marca y el worker la quita de sus
productos. Si dura, mira si el trabajo de `forgetBrand` está muerto (capítulo 20).

**Un pedido se queda en `pending`.**
Su trabajo está esperando, reintentándose o muerto. Míralo en `store.outbox.list()`.

---

*Fin.*
