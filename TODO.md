# TODO

Recomendaciones ordenadas por lo que más aportan a un calendario de eventos.

## Funcionalidad

1. ~~Eventos recurrentes~~ (hecho: diario, semanal, mensual, anual). Pendiente: fecha de fin de la serie, excepciones y editar "solo este".
2. **Recordatorios fiables.** Ahora los avisos solo funcionan con la pestaña abierta. Lo mínimo útil es un campo "avisar X minutos antes" por evento.
3. **Ubicación y enlace** (campos opcionales).
4. ~~Exportar e importar `.ics`~~ (hecho). Pendiente: repeticiones complejas (cada 2 semanas, días concretos) y recordatorios.
5. **Búsqueda y filtro por categoría en la lista.** El calendario ya oculta categorías, pero la lista no filtra por ellas.

## Limpieza pendiente

6. ~~Renombrar `date`/`deadline` a `start`/`end` y quitar el completado manual~~ (hecho).
7. **Migrar la colección `tasks` a `events`** (`db.tasks.renameCollection("events")`) y renombrar la carpeta del repo.

## Robustez

8. **Sesión:** el token caduca a los 30 minutos y no hay renovación. Añadir refresh token o alargar la duración.
9. **Tests mínimos de la API** con `pytest` y `httpx` (~10 tests: auth, CRUD, rango de fechas, "terminado = completado").
10. **`requirements.txt` completo.** Faltan `fastapi`, `bcrypt` y otros. Fijar la versión de `bcrypt` (el aviso de passlib sugiere incompatibilidad).
11. **Límite de intentos en login** y validación de contraseña mínima.
12. **Permitir títulos duplicados:** hoy no se pueden repetir, y para eventos es una restricción poco natural.

## Mantenimiento

13. Dividir `calendar.js` (más de 2.100 líneas) en vistas, arrastre y popovers, cuando haga falta.

## Prioridad sugerida

Recurrentes (1), `start`/`end` con migración (6) y tests (9).
