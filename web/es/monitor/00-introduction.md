# El monitor

newt-monitor vigila aplicaciones de newt mientras se ejecutan: qué contextos tiene cada
una, sus módulos, sus casos de uso y sus eventos, y cómo cambia eso de un despliegue al
siguiente. Es una aplicación de newt, y esta guía lo construye, capítulo a capítulo,
como [el tutorial](../guide/00-introduction) construye cooper.

Nunca abre la base de datos de una aplicación. Cada aplicación le dice de qué está
hecha, a través de `newt/monitor` ([apéndice H](../guide/h-describe-application)): un
endpoint en un puerto propio, que solo responde a peticiones firmadas con una clave que
comparten los dos. La clave nunca viaja.

## Lo que hace cuando está construido

- Una persona inicia sesión en él, con un usuario y una contraseña de su entorno.
- Guarda las aplicaciones que vigila: un nombre, dónde está su endpoint de monitor y su
  clave, cifrada con un secreto propio. Una aplicación se archiva antes de poder
  borrarla, y borrarla se lleva todo lo que se sabe de ella.
- Habla con cada una, firmando cada petición, y sabe si responde.
- Cada hora, o cuando se le pide, lee la estructura de cada una, y guarda una versión
  cada vez que cambia.
- Su catálogo guarda cada contexto, módulo, caso de uso y evento que tuvo alguna
  versión: cuándo apareció, cuándo se vio por última vez, y cuándo se fue.

Estos capítulos construyen su API; el último, cómo se construyen y se sirven sus
páginas.

## Cómo funciona la guía

Cada capítulo lleva newt-monitor a una etiqueta, `monitor/NN`: su código al final del
capítulo, el que muestran todos sus bloques (`// packages/newt-monitor/…`). Haz checkout
de una para empezar desde ahí:

```sh
git checkout monitor/04
```

Se apoya en lo que enseña [el tutorial](../guide/00-introduction): contextos, módulos,
entidades, casos de uso, eventos y workers, programaciones. Cada capítulo dice qué parte de
newt usa, y señala el capítulo del tutorial que la enseña.

## Los capítulos

1. [Un monitor hecho con newt](./01-a-monitor-built-with-newt): el paquete, su
   contexto, su configuración, y `bunx newt-monitor`.
2. [Iniciar sesión](./02-signing-in): un usuario y una contraseña, una sesión en una cookie.
3. [Un secreto que cifra](./03-a-secret-that-encrypts): las claves de las aplicaciones, selladas.
4. [Las aplicaciones](./04-the-applications): registrar, listar, cambiar; un nombre es de una sola.
5. [Archivar, restaurar, borrar](./05-archive-restore-delete): la vida de una aplicación; nada se pierde hasta que se borra.
6. [Hablar con una aplicación](./06-talking-to-an-application): un puerto, peticiones firmadas, si responde.
7. [No guardar lo que no conecta](./07-not-saving-what-does-not-connect): pregunta primero, y guarda lo que funcionó.
8. [Versiones de la estructura](./08-versions-of-the-structure): una nueva solo cuando cambia.
9. [Cada hora, y un botón](./09-every-hour-and-a-button): una programación, workers y una ruta.
10. [El catálogo](./10-the-catalog): cada parte que tuvo alguna versión, cuándo llegó y cuándo se fue.
11. [Borrar de verdad](./11-deleting-for-real): cada módulo olvida lo suyo; un job avisado tarde no hace nada.
12. [Contra cooper](./12-against-cooper): lo de verdad, de principio a fin; su imagen y su comando.
13. [Sus páginas](./13-its-pages): su frontend, construido y servido por el propio monitor.

Siguiente: [un monitor hecho con newt](./01-a-monitor-built-with-newt).
