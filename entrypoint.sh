#!/bin/sh
# Econnet · backend-api — arranque en Railway.
# Sin set -e: el servidor debe arrancar aunque las migraciones fallen.

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL no está definida." >&2
  exit 1
fi

# Intentar migraciones. Si el CLI de Prisma no puede cargar prisma.config.ts
# en el contenedor, el fallo es ignorado: las tablas ya existen en Railway.
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > .env 2>/dev/null || true
echo "[entrypoint] Ejecutando migraciones..."
node_modules/.bin/prisma migrate deploy 2>&1 || echo "[entrypoint] migrate deploy falló (no crítico)."
rm -f .env 2>/dev/null || true

echo "[entrypoint] Arrancando servidor..."
exec node dist/server.js
