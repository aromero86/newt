# Contra cooper

Todos los tests hasta ahora preguntaban a una aplicación construida para el test. Este
capítulo pregunta a cooper: cooper arrancado como se ejecuta en producción, en un
proceso propio, con su endpoint de monitor encendido; el monitor lo registra, ve que
responde, lee de qué está hecho y lo cataloga. Después el monitor recibe su imagen, para
ejecutarse junto a cooper, y su comando, para ejecutarse en cualquier sitio.

Al final tendrás estos ficheros:

```
package.json                          cambia: newt-monitor, para que `bunx newt-monitor` lo ejecute
Dockerfile                            cambia: el package.json del monitor
docs.Dockerfile                       cambia: lo mismo
monitor.Dockerfile                    la imagen del monitor
packages/newt-monitor/
  README.md                           qué es, cómo se ejecuta, su API
  src/against-cooper.test.ts          el monitor, contra cooper
```

## cooper, como se ejecuta

cooper sirve su endpoint de monitor cuando se le da una clave
([apéndice H de la guía](../guide/h-describe-application)): `COOPER_MONITOR_KEY`, en
`COOPER_MONITOR_PORT`. El test lo arranca como un proceso, con todas las bases de datos
en memoria y todos los puertos libres, y espera hasta que dice que el endpoint escucha:

```ts
// packages/newt-monitor/src/against-cooper.test.ts
  cooper = Bun.spawn(['bun', 'cooper/backend/index.ts'], {
    cwd: ROOT,
    stdout: 'pipe',
    env: {
      ...process.env,
      COOPER_AUTH_PORT: String(freePort()),
      COOPER_BOARDS_PORT: String(freePort()),
      COOPER_BACKOFFICE_PORT: String(freePort()),
      COOPER_AUTH_DATABASE: ':memory:',
      COOPER_BOARDS_DATABASE: ':memory:',
      COOPER_BACKOFFICE_DATABASE: ':memory:',
      COOPER_MONITOR_KEY: COOPER_KEY,
      COOPER_MONITOR_PORT: String(port),
    },
  })
```

El monitor no importa nada de cooper: llega a él por HTTP, firmando cada petición, como
llega a cualquier aplicación.

## Lo que encuentra

```ts
// packages/newt-monitor/src/against-cooper.test.ts
    const structure = await (await as(`/api/apps/${id}/structure`)).json() as StructureVersionDTO
    expect(structure.description.contexts.map(context => [context.name, context.uses])).toEqual([['auth', []], ['boards', ['auth']], ['backoffice', ['auth', 'boards']]])
```

Los contextos de los que está hecho cooper, cada uno con los que usa: lo que declara el
`contexts.uses` de newt-eslint, encontrado mientras se ejecuta. Su catálogo tiene
`boards/card.create`, y la programación nocturna de auth con su cron. Y cooper rechaza
cualquier otra clave: no se guarda nada.

## La imagen

La imagen del monitor instala el workspace y copia solo newt y el monitor:

```
# monitor.Dockerfile
COPY package.json bun.lock ./
COPY packages/newt/package.json packages/newt/
COPY packages/newt-eslint/package.json packages/newt-eslint/
COPY packages/newt-graph/package.json packages/newt-graph/
COPY packages/newt-monitor/package.json packages/newt-monitor/
RUN bun install --frozen-lockfile --production

COPY packages/newt packages/newt
COPY packages/newt-monitor packages/newt-monitor

ENV NODE_ENV=production
ENV NEWT_MONITOR_DATA=/app/data/newt-monitor.db
EXPOSE 4800
CMD ["bun", "packages/newt-monitor/bin/newt-monitor.ts"]
```

`bun install --frozen-lockfile` necesita el `package.json` de cada workspace: un paquete
nuevo en `packages/` es una línea más en cada imagen del repositorio, también en la de
cooper y en la de la documentación, o su siguiente build falla.

Su base de datos está en `/app/data`: un volumen persistente. Sin su usuario, su
contraseña y su secreto, no arranca:

```
newt-monitor: it cannot start:
  NEWT_MONITOR_USER: Invalid input: expected string, received undefined
  NEWT_MONITOR_PASSWORD: Invalid input: expected string, received undefined
  NEWT_MONITOR_SECRET: Invalid input: expected string, received undefined
```

## Junto a cooper

En la misma red que cooper (la de Coolify, por ejemplo), el monitor llega al endpoint de
cooper por su nombre en esa red, en un puerto al que no apunta ninguna dirección pública
(`http://cooper:3010`). El monitor tiene un dominio propio, para que su administrador
pueda iniciar sesión; el endpoint de cooper no tiene ninguno.

## El comando

El repositorio depende del paquete (`"newt-monitor": "workspace:*"`), así que su comando
está ahí:

```sh
NEWT_MONITOR_USER=ana NEWT_MONITOR_PASSWORD='a long password' \
NEWT_MONITOR_SECRET="$(openssl rand -base64 48)" bunx newt-monitor
```

## Compruébalo

```sh
bun check
bun test
bun run lint
bun run docs:check
docker build -f monitor.Dockerfile -t newt-monitor .
```

## Lo que es ahora el monitor

Una aplicación construida con newt, de un contexto y cinco módulos, que vigila otras sin
abrir nunca sus datos:

| Módulo | Su única responsabilidad |
|---|---|
| `session` | Quién está dentro: un usuario, una sesión en una cookie. |
| `app` | Las aplicaciones: dónde están, sus claves selladas, su vida. |
| `connection` | Hablar con cada una, con firma, y si responde. |
| `structure` | De qué está hecha cada una, una versión cada vez que cambia. |
| `catalog` | Cada parte que tuvo alguna versión, cuándo llegó y cuándo se fue. |

Siguiente: [sus páginas](./13-its-pages).

## Lo que hay que recordar

- Prueba contra lo real una vez, de punta a punta, como se ejecuta: su propio proceso,
  por la red.
- Un paquete nuevo del workspace es una línea en cada imagen del repositorio.
- Un endpoint de monitor no tiene dirección pública; el monitor tiene una, detrás de su
  inicio de sesión.
