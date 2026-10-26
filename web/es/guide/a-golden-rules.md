# A. Las reglas de oro

Todas las reglas que ha enseñado el tutorial, en una página, cada una en una línea con el
capítulo que la enseña. Vuelve a ella de vez en cuando: es más corta que el código que
mantiene ordenado.

## Las que nunca se rompen

1. **Un módulo, una responsabilidad.** Si describirlo necesita una "y", son dos. ([2](./02-first-module))
2. **Una ruta no piensa.** Lee la petición, llama a un caso de uso con el cuerpo tal como llegó, y responde; el caso de uso lo valida (`newt/route-body`). ([2](./02-first-module))
3. **Solo la entidad se cambia a sí misma**, con métodos que dicen qué ha pasado. ([2](./02-first-module))
4. **Solo el repositorio toca el store.** ([2](./02-first-module))
5. **Una transacción es un guardado**, nunca un caso de uso entero. ([6](./06-rules-over-rows))
6. **Un caso de uso escribe en otro módulo solo desde un worker**, reaccionando a un evento, y una transacción guarda un solo módulo, también la de un worker; una excepción dice `writesTo`, con su motivo. ([8](./08-two-people-one-card), [13](./13-another-context))
7. **Lo que no se puede deshacer sale de un worker** (un email, una llamada a otro sistema), nunca del caso de uso que hace el cambio. ([12](./12-failures))
8. **Un job puede ejecutarse más de una vez**, así que una segunda ejecución no debe encontrar nada que hacer. ([11](./11-reacting))
9. **Los módulos y los contextos nunca dependen unos de otros en un ciclo.** ([1](./01-project-and-context), [20](./20-wiring-contexts))
10. **Un módulo apunta a las cosas de otro solo por id**, nunca por su entidad ni por su tabla. ([7](./07-cards-and-a-counter))
11. **Ninguna lista se devuelve entera salvo que una regla del dominio la acote** (como mucho 10 columnas, 500 tarjetas); todas las demás van por páginas. ([3](./03-pages-and-errors))

## El proyecto y sus módulos

- El backend es un proyecto TypeScript propio que importa newt por su nombre; decoradores estándar, nunca `experimentalDecorators`. ([1](./01-project-and-context))
- Un contexto abre su store, crea su base e inicializa sus módulos; recibe su config y nunca lee el entorno. ([1](./01-project-and-context))
- Todos los módulos tienen los mismos archivos, con su nombre ([apéndice B](./b-module-anatomy)); el lint los mantiene así, y `newt add module` los escribe ([apéndice G](./g-command-line)). ([2](./02-first-module))
- El `AGENTS.md` de la aplicación dice lo que es propio de ella (contextos, convenciones, comandos) y manda a los agentes de programación a las reglas de newt, que viajan con el paquete; `newt init` lo escribe. ([1](./01-project-and-context))
- El `*.schema.ts` de un módulo es su contrato: los esquemas de entrada toman solo lo que envía un cliente, y reutilizan las reglas del esquema completo; de newt toma solo `newt/contract` (`newt/schema-imports`). ([2](./02-first-module), [23](./23-frontends))
- Un objeto de valor guarda las reglas de un valor en un solo sitio: `from` perdona lo que alguien escribió, `schema` es estricto con lo que se guarda. ([2](./02-first-module))
- Un módulo llega a otro solo a través de su módulo, su esquema, sus eventos, sus errores y sus objetos de valor (`newt/module-boundaries`). ([6](./06-rules-over-rows))
- Un módulo comprueba sus referencias llamando a los casos de uso del otro módulo, nunca a sus tablas. ([7](./07-cards-and-a-counter))

## Casos de uso

- Valida, carga, decide, cambia la entidad, guarda una vez, devuelve DTOs. ([2](./02-first-module))
- Todo método público de un módulo es un `@UseCase`; lo que no lo es, es `private` (`newt/use-case`). ([2](./02-first-module))
- Un caso de uso al que llama una ruta recibe su entrada como `unknown` y la valida con su esquema de entrada. ([2](./02-first-module))
- Valida dos veces: la entrada en el caso de uso (un 400), el estado en la entidad (`InvalidEntity`, un 500: un bug). ([3](./03-pages-and-errors))
- **Quién** es el actor: `currentActor()`, nunca un id de usuario pasado a mano. ([4](./04-who-and-where))
- Extiende `Actor` para quién es alguien y cómo ha entrado (`via`), nunca para lo que puede hacer. ([4](./04-who-and-where), [24](./24-mcp-server))
- **Puede** se pregunta cada vez, al módulo que lo sabe; un extraño recibe un 404, no un 403. ([4](./04-who-and-where))
- Una lista recibe un `PageRequest` y devuelve una `Page`; `mapPage` convierte entidades en DTOs. ([3](./03-pages-and-errors))
- Un caso de uso se ejecuta otra vez ante un `ConcurrencyConflict`, hasta tres veces más, así que no hace nada que no se pueda deshacer antes de guardar. ([8](./08-two-people-one-card))
- Uno que no debe ejecutarse dos veces dice `retryOnConflict: false`, con su motivo; lo que llama entonces maneja sus propios conflictos. ([8](./08-two-people-one-card), [18](./18-tenants-and-access))
- Una ruta pública se ejecuta como nadie; para mostrar más a quien ha iniciado sesión usa `runAsActor`, y el caso de uso pregunta `findCurrentActor()`. ([21](./21-oauth-server))
- El tiempo es una dependencia: pide `now()`, nunca `new Date()`; un test le da un reloj a la base. ([19](./19-invitations-and-time))

## Guardar

- Todo repositorio dice su scope: el `{ field, current }` de un tenant, o `'none'` con el motivo en un comentario; si falta, no compila. ([2](./02-first-module), [4](./04-who-and-where))
- Cada fila tiene una versión; guardar una que alguien ha guardado después es un `ConcurrencyConflict` (409), y no se escribe nada. ([8](./08-two-people-one-card))
- Una regla sobre varias filas se comprueba en el `after` del guardado, que nombra lo que protege en `guard`, con claves tan estrechas como la regla. ([6](./06-rules-over-rows))
- Un guardado que lee filas y no protege nada se rechaza (la regla del guard): `guard: []` cuando no hace falta. ([6](./06-rules-over-rows))
- Comprueba primero en el caso de uso para dar la respuesta clara; un índice único tiene la última palabra (`DuplicateValue`). ([6](./06-rules-over-rows), [18](./18-tenants-and-access))
- Un valor que todos cambian a la vez vive en una fila propia, que se toma en el `before` del guardado bajo un `guard`. ([7](./07-cards-and-a-counter))
- Un valor que nunca debe volver atrás se guarda en una fila que solo crece, no se deriva de filas que se pueden borrar. ([7](./07-cards-and-a-counter))
- Una fila creada entretanto no tiene versión: comprueba el orden completo en `after` y llama a `this.conflict()`. ([8](./08-two-people-one-card))
- Varias entidades de un mismo módulo guardadas a la vez son un solo `save`: todas o ninguna. ([8](./08-two-people-one-card))
- Las filas que nunca dirán nada se van para siempre con `purge(criteria)`, o con `saveRows` alrededor de varias tablas. ([14](./14-sagas))
- Una entidad con un secreto tiene un esquema público; guarda un hash, nunca el secreto. ([17](./17-auth))

## Pedir dos veces

- Un POST que crea algo recibe `{ idempotency: { table } }`; el cliente envía una `Idempotency-Key` nueva por envío, la misma cuando lo envía otra vez. ([9](./09-idempotent-posts), [23](./23-frontends))
- Lo que falla no se guarda: la misma clave puede volver a intentarlo. ([9](./09-idempotent-posts))

## Eventos y workers

- Un evento es `<módulo>.<verbo en pasado>`, anotado por la entidad con `trackEvent`, solo si algo ha cambiado. ([10](./10-events))
- Lo que un listener necesita y solo conoce el momento (quién actuó) va en el payload: un listener no tiene actor. ([10](./10-events))
- Un evento se oye solo cuando su guardado se confirma. `fire-and-forget` es para lo que se puede perder; lo que importa es `'handler'`, un job en el outbox. ([10](./10-events), [11](./11-reacting))
- La cola de un handler es `<módulo>.<caso de uso>.on.<módulo>.<evento>`; renombrarla deja atrás sus jobs pendientes. ([11](./11-reacting))
- Un job se ejecuta sin actor y sin scope: lee quién es del payload y entra él mismo en el espacio de trabajo. ([11](./11-reacting), [13](./13-another-context))
- Un worker que se ejecuta tarde vuelve a leer aquello de lo que trata antes de actuar. ([12](./12-failures))
- Lo que sale del proceso lleva una clave sacada del id de su evento (la `key` de un email), para que un job ejecutado dos veces lo envíe una. ([12](./12-failures))
- Un módulo que sigue a otro sigue también sus propios eventos: cada seguidor comprueba el otro lado después de su propio commit, así que el que corre el último ve los dos. ([13](./13-another-context))
- `when` decide, a partir del payload, qué eventos tienen un job; las reglas de negocio se quedan en el caso de uso. ([12](./12-failures), [13](./13-another-context))
- El trabajo sobre varios módulos es una saga desde un worker: cada paso encuentra lo que hizo una ejecución anterior, y la saga solo avanza. ([14](./14-sagas))
- Un job muerto es trabajo atascado a medias: arregla la causa, y luego reinténtalo. ([12](./12-failures), [26](./26-dead-jobs-and-analytics))
- Lo que toca a una hora es una programación (`base.schedules.define`), avisada una vez por tick entre procesos. ([19](./19-invitations-and-time))
- Un secreto se hace donde sale, nunca se guarda en un job. ([19](./19-invitations-and-time))

## Contextos

- Lo que un contexto necesita de otro es un puerto en sus propias palabras, en el `.deps.ts` del módulo; un test le da un falso. ([4](./04-who-and-where), [13](./13-another-context))
- Un contexto recibe puertos y un `Pick` de los módulos del otro, nunca su contexto, su base ni su store. ([20](./20-wiring-contexts))
- Una suscripción al emisor de otro contexto es un job del outbox de ese contexto, ejecutado por su worker. ([20](./20-wiring-contexts))
- Las escrituras en otro contexto empiezan en un punto de entrada (una ruta); una llamada a otro contexto es como una API externa. ([20](./20-wiring-contexts))
- Un contexto que lee dos los lee a través de sus casos de uso, nunca de sus stores. ([25](./25-backoffice))
- Cada contexto importa solo los contextos que nombra su `uses` (`newt/context-boundaries`). ([17](./17-auth), [20](./20-wiring-contexts))

## Consultas

- Los criterios son para el código del propio módulo; lo que no pueden decir es Kysely, en el repositorio de la tabla que lee. ([15](./15-kysely))
- Kysely no aplica el scope del repositorio: escribe tú el `where` del espacio de trabajo. ([15](./15-kysely))
- Un cliente filtra solo por lo que permite `defineFilter`; las reglas del sistema van junto a su filtro, nunca dentro. ([15](./15-kysely), [18](./18-tenants-and-access))
- Una consulta para la página y su total; nunca ids traídos para enviarlos de vuelta en un `in`. ([15](./15-kysely))
- La búsqueda de texto vive detrás de un puerto propio, demostrado por una suite de contrato; una proyección va un momento por detrás, y las reglas nunca la leen. ([16](./16-search-port))
- Los jobs de una proyección pueden llegar en cualquier orden: guarda la copia más nueva, y una eliminada deja una lápida para que una copia tardía no la traiga de vuelta. ([16](./16-search-port))
- Una lectura a través de todos los scopes es `findInEveryScope`, con un nombre que lo dice. ([4](./04-who-and-where))
- Las analíticas solo añaden, y cada fila tiene su id. ([26](./26-dead-jobs-and-analytics))

## Entrada y salida

- Una ruta nunca captura: lo que lanza se convierte en `{ error, code }` con el estado de su clase base. ([3](./03-pages-and-errors))
- Un cliente actúa según `code`, que nunca cambia; `setMessages`, una vez al arrancar, pone los mensajes de newt en tus palabras. ([3](./03-pages-and-errors))
- Las rutas para las que nadie puede haber iniciado sesión dicen `{ public: true }`; una sesión vive en una cookie `httpOnly`. ([17](./17-auth))
- Un router tiene un solo autenticador, puesto por el módulo que conoce las sesiones. ([22](./22-web-session))
- Las direcciones con un formato propio son un router en la raíz (`prefix: ''`), que responde a los errores a su manera con `onError`, incluido el 405 de un método que la ruta no tiene. ([21](./21-oauth-server), [24](./24-mcp-server))
- Una ruta a la que llaman otros orígenes lo dice con `cors`, y nunca con cookies. ([21](./21-oauth-server))
- El navegador carga `newt/contract`, nunca `newt/core`. ([23](./23-frontends))
- Una herramienta MCP es otra puerta a los mismos casos de uso; no añade reglas. ([24](./24-mcp-server))

## Migraciones y producción

- Un cambio de forma es una migración nueva; una ya aplicada nunca se edita (se comprueba su checksum, y `status` nombra la que cambió). ([5](./05-sqlite), [18](./18-tenants-and-access), [27](./27-postgres))
- Cada dialecto tiene su propia carpeta de migraciones; `open` migra, `connect` no. ([27](./27-postgres))
- Un solo tracer para todos los contextos de un proceso. ([28](./28-observability))
- Un servidor drena al detenerse: su health responde 503 durante `drainMs` antes de cerrar. ([29](./29-shipping))

## Tests

- Espera a los workers con `jobs.idle()`, nunca con un sleep, en el orden en que el trabajo fluye entre contextos. ([11](./11-reacting), [20](./20-wiring-contexts))
- Mueve el tiempo con el reloj de la base y `schedules.tick()`. ([19](./19-invitations-and-time))
- Prueba los casos difíciles: a la vez, dos veces, rechazado, límites superados. ([7](./07-cards-and-a-counter), [8](./08-two-people-one-card))
- Un puerto se demuestra con una suite de contrato que ejecuta cada adaptador. ([16](./16-search-port), [D](./d-writing-a-store))
