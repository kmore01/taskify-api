# TODO

Lo que queda pendiente, ordenado por lo que más aporta.

## Funcionalidad

1. **Avisos con la pestaña cerrada.** El aviso "X minutos antes" ya existe, pero solo salta con la app abierta. Hace falta push (service worker) o correo.
2. **Repeticiones complejas** (cada 2 semanas, días concretos), también al importar `.ics`. Hoy se importan sin repetir.
3. **"Este y los siguientes"** al editar o borrar una serie (ahora: toda la serie o solo este).
4. **Recordatorios en `.ics`** (`VALARM`) al exportar e importar.

## Robustez

5. **Límite de intentos compartido.** El de login y el de "olvidé la contraseña" viven en memoria de un proceso; con varios workers hay que moverlos a Redis o Mongo.
6. **Tests contra MongoDB real.** Los de la API usan una base en memoria (`tests/fake_db.py`).
7. **Correo:** configurar `SMTP_HOST` y `APP_URL` en `.env`; sin ellos el enlace de recuperación solo se escribe en el log del servidor.

## Limpieza

8. **Migrar la colección `tasks` a `events`** (`db.tasks.renameCollection("events")`) y renombrar la carpeta del repo.
9. Dividir `calendar.js` en vistas, arrastre y popovers, cuando haga falta.

## Hecho

Eventos recurrentes con fecha de fin y excepciones, avisos con antelación, ubicación y enlace, `.ics`, búsqueda y filtro por categoría, `start`/`end`, sesión renovable, cambio y recuperación de contraseña, borrado de cuenta, deshacer al eliminar, títulos duplicados, tests de la API y `requirements.txt` completo.
