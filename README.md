# Planifier

Planificador personal de eventos: una lista de lo que viene y un calendario para colocarlo.
API en FastAPI con MongoDB y un frontend en JavaScript sin dependencias ni paso de compilación.

## Qué hace

- Cuentas con registro, inicio de sesión, cambio y recuperación de contraseña, y borrado de cuenta.
- Eventos con título, descripción, inicio y fin, todo el día, color, categoría, ubicación y enlace.
- Repeticiones diarias, semanales, mensuales y anuales, con fecha de fin. Al editar o borrar
  una repetición se elige entre toda la serie o solo ese día.
- Lista de eventos con búsqueda, filtro por categoría y orden; los eventos terminados se
  archivan solos.
- Calendario por día, semana, mes y año: arrastrar para mover, estirar para alargar y pulsar
  para crear.
- Avisos del navegador con antelación (mientras la pestaña esté abierta).
- Importar y exportar `.ics`.
- Deshacer tras eliminar.

## Requisitos

- Python 3.11 o superior (se desarrolla con 3.14).
- MongoDB.
- Node 20 o superior, solo para ejecutar los tests del frontend.

## Instalación

```bash
python -m venv venv
venv/bin/pip install -r requirements.txt
```

Crea un archivo `.env` en la raíz del repositorio:

```ini
JWT_SECRET=<cadena larga y aleatoria>
MONGODB_URI=mongodb://localhost:27017
DATABASE_NAME=planifier
```

Para generar el secreto: `python -c "import secrets; print(secrets.token_hex(32))"`.

| Variable | Obligatoria | Para qué sirve |
|---|---|---|
| `JWT_SECRET` | Sí | Firma los tokens de sesión. Sin ella la aplicación no arranca. |
| `MONGODB_URI` | No | Conexión a MongoDB. Por defecto, `localhost:27017`. |
| `DATABASE_NAME` | No | Nombre de la base de datos. Por defecto, `taskify_db`. |
| `APP_URL` | Para publicar | Dirección pública de la aplicación; se usa en el enlace de recuperación de contraseña. Por defecto, `http://127.0.0.1:8000`. |
| `SMTP_HOST` | Para publicar | Servidor de correo. Sin él, el enlace de recuperación solo se escribe en el log del servidor. |
| `SMTP_PORT` | No | Por defecto, `587` (STARTTLS). |
| `SMTP_USER`, `SMTP_PASSWORD` | No | Credenciales del servidor de correo. |
| `SMTP_FROM` | No | Remitente. Por defecto, `SMTP_USER`. |

## Uso

Ejecuta siempre desde la raíz del repositorio: el `.env` y los archivos estáticos se resuelven
desde el directorio actual.

```bash
venv/bin/uvicorn app.main:app --reload
```

- Aplicación: http://127.0.0.1:8000
- Documentación de la API: http://127.0.0.1:8000/docs

Al arrancar aparece un aviso de passlib sobre la versión de bcrypt
(`error reading bcrypt version`). Es inofensivo.

Atajos de teclado: `C` crea un evento y `/` enfoca la búsqueda en la lista. En el calendario,
`D`, `W`, `M` e `Y` cambian de vista, `T` vuelve a hoy y las flechas cambian de periodo.

## Tests

```bash
node --test tests/*.test.mjs
JWT_SECRET=x venv/bin/python -m unittest discover -s tests
```

Los tests de la API ejecutan la aplicación real sobre una base de datos en memoria
(`tests/fake_db.py`), así que no necesitan MongoDB. A cambio, no comprueban el comportamiento
de MongoDB en sí.

## Publicar

- Sirve la aplicación por HTTPS detrás de un proxy inverso, con un límite de tamaño de
  petición en el proxy. Los tokens y las contraseñas viajan en cada petición.
- Arranca sin `--reload` y con un solo proceso: el límite de intentos de inicio de sesión se
  guarda en memoria y no se comparte entre procesos.
- Si el proxy no está en la misma máquina, indica su dirección con `--forwarded-allow-ips`.
  De lo contrario, todos los usuarios compartirán la IP del proxy y el límite de intentos los
  bloqueará entre sí.
- Define `APP_URL` y `SMTP_HOST`, o la recuperación de contraseña no enviará nada.
- En Windows y en imágenes mínimas de Docker instala también `tzdata`. Sin la base de zonas
  horarias, los eventos de todo el día se importan y exportan en UTC.

```bash
venv/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
```

## Estructura

```
app/
  main.py        Arranque, índices de MongoDB y cabeceras de seguridad
  deps.py        Autenticación compartida por los routers
  core/          Configuración, tokens y contraseñas, .ics, correo
  db/            Cliente de MongoDB
  models/        Modelos de Pydantic
  routers/       /auth y /events
  static/        Frontend (módulos ES servidos tal cual)
tests/           Tests del frontend (.mjs) y de la API (.py)
```
