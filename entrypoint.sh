#!/bin/sh
# Econnet · backend-api — arranque en Railway.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL no está definida." >&2
  exit 1
fi

# Las migraciones se ejecutan de forma no-fatal: si el CLI de Prisma falla
# al cargar prisma.config.ts en el runtime del contenedor, el servidor arranca
# igual. Las migraciones pendientes se aplican manualmente con «railway run».
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > .env
echo "[entrypoint] Ejecutando migraciones (no-fatal)..."
node_modules/.bin/prisma migrate deploy 2>&1 && echo "[entrypoint] Migraciones OK." \
  || echo "[entrypoint] Advertencia: migrate deploy falló. Aplica migraciones manualmente."
rm -f .env

echo "[entrypoint] Arrancando servidor..."
exec node dist/server.js
