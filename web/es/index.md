---
layout: home
hero:
  name: newt
  text: Un framework de backend para Bun
  tagline: Contextos, casos de uso, entidades y eventos de dominio con un outbox transaccional, en stores que puedes cambiar.
  actions:
    - theme: brand
      text: Construye cooper, paso a paso
      link: /es/guide/00-introduction
    - theme: alt
      text: Referencia
      link: /es/reference/rules
features:
  - title: Reglas que comprueba la máquina
    details: Un caso de uso escribe en su propio módulo, un módulo por transacción, un guardado que lee filas lleva su guard. newt rechaza lo demás al ejecutarse, y su lint antes de ejecutar.
    link: /es/guide/b-module-anatomy
    linkText: La anatomía y el lint
  - title: Guardados de los que fiarte
    details: Cada fila tiene una versión; dos personas que cambian lo mismo no pierden ningún cambio. Un conflicto vuelve a ejecutar el caso de uso solo, y una regla sobre varias filas se cumple en cualquier store.
    link: /es/guide/08-two-people-one-card
    linkText: Dos personas, una tarjeta
  - title: Eventos que nunca se pierden
    details: Un evento se escribe en la misma transacción que el cambio que lo cuenta. Un worker ejecuta cada reacción hasta que sale bien, con reintentos, espera creciente y jobs muertos que puedes reintentar.
    link: /es/guide/11-reacting
    linkText: El outbox
  - title: Stores que puedes cambiar
    details: SQLite, ficheros, Postgres y MySQL detrás de un mismo puerto. Los módulos no saben cuál es; una suite de contrato demuestra que un store tuyo cumple cada promesa.
    link: /es/guide/05-sqlite
    linkText: De ficheros a SQLite
  - title: Un tiempo que puedes mover
    details: Un reloj por contexto marca las fechas, los jobs y los crons. Un cron salta una sola vez aunque haya varios procesos, y un test mueve el reloj en vez de esperar.
    link: /es/guide/19-invitations-and-time
    linkText: Invitaciones y tiempo
  - title: HTTP cerrado por defecto
    details: Toda ruta pide sesión salvo que diga lo contrario. CORS, POST idempotentes, errores con forma OAuth y un health que responde 503 mientras el servidor termina.
    link: /es/guide/09-idempotent-posts
    linkText: Preguntar dos veces
  - title: Listo para agentes de código
    details: newt trae un AGENTS.md que se versiona con el código. newt init lleva a los agentes de una aplicación hasta él; newt add module escribe un módulo que el lint ya acepta.
    link: /es/guide/g-command-line
    linkText: La línea de comandos
  - title: Tu sistema, dibujado
    details: newt-graph lee una aplicación y dibuja sus contextos, módulos, casos de uso y eventos. Elige un caso de uso y mira cómo viajan sus efectos, worker tras worker.
    link: /es/guide/g-command-line
    linkText: newt-graph
  - title: Tu sistema, vigilado
    details: newt-monitor vigila aplicaciones newt en marcha, nunca sus datos. Cada una le dice de qué está hecha, a peticiones firmadas con una clave que nunca viaja; guarda cada versión, y cuándo llegó y se fue cada parte.
    link: /es/monitor/00-introduction
    linkText: Construye el monitor
  - title: Apréndelo construyendo
    details: Treinta capítulos construyen cooper, un Trello pequeño con un servidor OAuth, un servidor MCP y un backoffice. Cada capítulo acaba en una etiqueta de git que funciona y pasa sus tests.
    link: /es/guide/00-introduction
    linkText: Empezar
---
