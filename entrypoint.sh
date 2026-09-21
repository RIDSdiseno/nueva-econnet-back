#!/bin/sh
# Econnet · backend-api — arranque en Railway.
# Ejecuta las migraciones pendientes antes de levantar el servidor.
# Si migrate deploy falla (ej: DATABASE_URL incorrecta), el contenedor muere
# con un código de error claro en lugar de arrancar a medias.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL no está definida." >&2
  echo "[entrypoint] En Railway: Variables → Add Reference → PostgreSQL → DATABASE_URL" >&2
  exit 1
fi

echo "[entrypoint] Ejecutando migraciones..."
node_modules/.bin/prisma migrate deploy

echo "[entrypoint] Arrancando servidor..."
exec node dist/server.js
