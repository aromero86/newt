# La línea de comandos

newt trae un comando, `newt`, que prepara una aplicación para los agentes de
programación y escribe el esqueleto de un módulo. Escribe ficheros y no importa
ninguna pieza de newt. Nunca sobrescribe un fichero: lo que ya existe lo nombra y lo
deja como estaba.

```sh
bunx newt init                                   # in an application's folder
bunx newt add module src/contexts/shop order     # a module's skeleton
bunx newt help
```

## `newt init`

Ejecútalo en la carpeta de una aplicación. Escribe tres ficheros.

| Fichero | Qué contiene |
|---|---|
| `AGENTS.md` | Las instrucciones propias de la aplicación para los agentes (Codex, Cursor, Copilot, Claude Code…): secciones que rellenar sobre el proyecto, sus contextos, sus convenciones y sus comandos. Su primera línea manda a los agentes a `node_modules/newt/AGENTS.md`. |
| `CLAUDE.md` | Dos líneas, `@AGENTS.md` y `@node_modules/newt/AGENTS.md`: Claude Code importa los dos ficheros a su memoria. |
| `eslint.config.js` | El lint de newt (`newt()` de `newt-eslint`), solo si no hay configuración de ESLint en esta carpeta ni en ninguna de arriba. |

`node_modules/newt/AGENTS.md` es el de newt: las reglas del framework, la anatomía de
un módulo, un fragmento de cada pieza, qué hacer ante cada error que lanza newt, las
reglas del lint, los comandos y una definición de "hecho". Viaja con el paquete, así
que siempre describe la versión instalada: actualizar newt lo actualiza. El
`AGENTS.md` de la aplicación dice solo lo que es propio de ella.

Los dos ficheros se buscan en la carpeta y en las de arriba, igual que instala Bun y
que ESLint busca su configuración. Una aplicación dentro de un monorepo apunta al
`node_modules` de la raíz y conserva el lint de la raíz: `newt init` dice qué
configuración encontró y que el preset de newt va en ella.

Termina imprimiendo lo que queda por hacer: instalar newt y su lint, rellenar
`AGENTS.md` y añadir el primer módulo.

## `newt add module <carpeta-del-contexto> <nombre>`

Escribe el esqueleto de un módulo en `<carpeta-del-contexto>/modules/<nombre>/`, con
la anatomía y los nombres que pide el lint de newt. `<nombre>` va en kebab-case:
`price-change` da `PriceChange_Module`, el prefijo de los casos de uso `priceChange`, la
tabla `price_change` y las rutas `/price-changes`.

| Fichero | Qué contiene |
|---|---|
| `<nombre>.schema.ts` | El contrato del módulo con zod: la entidad y lo que envía un cliente. |
| `<nombre>.ts` | La entidad. |
| `<nombre>.repository.ts` | Su repositorio, con `scope: 'none'` y una nota: decídelo, el scope de un tenant o ninguno y por qué. |
| `<nombre>.module.ts` | El módulo, con dos casos de uso, `create` y `get`. |
| `<nombre>.deps.ts` | Los módulos que usa, vacío. |
| `<nombre>.routes.ts` | Sus rutas, que pasan el cuerpo al caso de uso tal como llegó. |
| `events/<nombre>-created.ts` | El evento que cuenta `create`. |
| `errors/<nombre>-not-found.ts` | El error que lanza `get`. |
| `<nombre>.test.ts` | Sus tests, sobre un store de ficheros. |

El esqueleto compila, pasa el lint y sus propios tests. Lo que no sabe te toca a ti: el
scope de su repositorio, una migración para su tabla y su sitio en el
`initialize-modules.ts` del contexto. El comando imprime esos pasos.
