# A. Las reglas de oro

Todas las reglas de la guía en una página, agrupadas por tema, cada una con el capítulo
que la explica. Vuelve a ella de vez en cuando: es más corta que el código que mantiene en
orden.

## Las once que nunca se rompen

1. **Un módulo, una responsabilidad.** Si para describirlo necesitas un "y", son dos.
2. **Una ruta no piensa.** Lee la petición, llama a un caso de uso y responde.
3. **Solo la entidad se cambia a sí misma**, con métodos que dicen qué ha pasado.
4. **Solo el repositorio toca el store.**
5. **Una transacción es un guardado**, no un caso de uso entero.
6. **Un módulo lee de otros cuando quiere, pero escribe en otro solo desde un worker**,
   reaccionando a un evento.
7. **Lo irreversible (un email, un cobro) sale de un worker**, nunca de un caso de uso.
8. **Un worker puede ejecutarse más de una vez**, así que debe dar igual que lo haga.
9. **Las dependencias entre módulos nunca forman un círculo.** Tampoco entre contextos.
10. **Un módulo apunta a lo de otro solo por su id**, nunca por su entidad ni por su
    tabla.
11. **Ninguna lista se devuelve entera**: se pagina.

## Diseño

- La entidad de un módulo lleva su nombre (`card` → `Card`). Una entidad con otro nombre
  es una segunda responsabilidad. ([3](./03-first-module))
- Lo que se guarda junto, todo o nada, es un módulo. Lo demás se sigue por eventos.
  ([17](./17-modules-talk))
- Un módulo conoce los módulos de su `<m>.deps.ts`, y nunca quién depende de él.
  ([17](./17-modules-talk))
- Un contexto llega a otro solo por sus casos de uso y sus eventos, nunca por sus
  repositorios ni por su store. Cada contexto se abre después de los que usa.
  ([19](./19-several-contexts))
- Ni claves ajenas, ni `JOIN`, ni entidades entre módulos: un id.
  ([18](./18-references))

## Casos de uso

- Validar → cargar → decidir → cambiar la entidad → guardar una vez → devolver DTOs.
  ([4](./04-use-cases))
- Dos validaciones: la de la entrada, en el caso de uso (`<M>Schema.parse`); la del
  estado, en la entidad. ([4](./04-use-cases))
- Los métodos de la entidad reciben valores del dominio, no el DTO de entrada.
  ([3](./03-first-module))
- Lo que solo puede cambiar su dueño toma el actor (`currentActor()`), no un id.
  ([5](./05-who-and-where))
- Una lista recibe un `PageRequest` y devuelve `items`, `hasMore` y `total`, escritos uno
  a uno. ([4](./04-use-cases))
- Un caso de uso se repite ante un `ConcurrencyConflict`, hasta tres veces más. El que
  hace antes de guardar algo que no debe pasar dos veces dice
  `retryOnConflict: false`, con el motivo al lado. ([7](./07-concurrency))
- Una excepción a la regla de escritura se dice donde se vea:
  `@UseCase({ writesTo: ['access'] })`, con el motivo al lado.
  ([17](./17-modules-talk))
- La regla de escritura es por contexto: un caso de uso al que llama otro contexto es la
  raíz de lo que hace en el suyo. ([19](./19-several-contexts))

## Guardar

- Un guardado es una transacción: `persist`, o `save`/`saveRows` dentro del
  repositorio. Un módulo nunca abre una transacción propia. ([6](./06-transactions))
- Una regla sobre varias filas se comprueba en el `after` del guardado, y dice qué
  protege con `guard`. Sin él no compila. ([8](./08-rules-over-rows))
- Un valor que todos cambian a la vez no es un campo que se actualiza: se calcula a partir
  de filas que solo se añaden. ([9](./09-shared-counters))

## Eventos y workers

- Un evento existe solo si su transacción se confirmó. ([10](./10-events))
- Un evento de cada tipo por entidad y guardado: dos cambios antes de guardar son un solo
  `updated`. ([10](./10-events))
- Lo que importa, con `strategy: 'handler'`; lo que se puede perder, con
  `'fire-and-forget'`. ([11](./11-reacting))
- La cola de un handler es `<módulo>.<caso de uso>.on.<módulo>.<evento>`, y su callback
  llama a ese caso de uso. ([11](./11-reacting))
- Un worker llama a un caso de uso, sin actor (lo que necesite lo lee del evento), y puede
  repetirse. ([11](./11-reacting), [13](./13-repeatable-workers))
- Lo que falla a mitad se arregla hacia delante: reintentos o una compensación.
  ([15](./15-failures), [16](./16-sagas))
- Un evento solo crece. ([10](./10-events))

## Entrada y salida

- Una ruta no piensa. ([3](./03-first-module))
- Los datos se validan en la puerta, y los value objects los normalizan.
  ([3](./03-first-module))
- Un cliente filtra solo por lo que `defineFilter` le permite. Las reglas del sistema van
  al lado de su filtro, nunca dentro. ([23](./23-search))
- Los errores son clases con un `code` estable, una por fichero; su clase base decide el
  estado HTTP. ([3](./03-first-module))
- 404 cuando un 403 revelaría que algo existe. ([5](./05-who-and-where),
  [22](./22-backoffice))

## Datos

- `TableRepository` y criterios por defecto, Kysely para lo demás, y el SQL propio de un
  store solo cuando no hay otro camino, en un único sitio y marcado.
  ([22](./22-backoffice))
- Kysely no aplica el ámbito de un repositorio: escríbelo tú. ([22](./22-backoffice))
- La analítica solo añade, y cada fila lleva su id. ([22](./22-backoffice))
- Una migración aplicada no se edita nunca. ([24](./24-migrations))

## Tests

- Espera a los workers con `jobs.idle()`, nunca con un sleep, en el orden en que fluye el
  trabajo entre contextos. ([25](./25-tests))
- Prueba lo difícil: a la vez, dos veces, rechazado. ([25](./25-tests))
