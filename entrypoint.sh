#!/bin/sh
# Econnet · backend-api — arranque en Railway.
# Ejecuta las migraciones pendientes antes de levantar el servidor.
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "[entrypoint] ERROR: DATABASE_URL no está definida." >&2
  echo "[entrypoint] En Railway: Variables → Add Reference → PostgreSQL → DATABASE_URL" >&2
  exit 1
fi

# prisma.config.ts usa «import dotenv/config» para leer la URL.
# En producción no hay .env, así que lo creamos temporalmente para que
# el runner TypeScript interno de Prisma pueda cargar DATABASE_URL.
printf 'DATABASE_URL=%s\n' "$DATABASE_URL" > .env

echo "[entrypoint] Ejecutando migraciones..."
node_modules/.bin/prisma migrate deploy
rm -f .env

echo "[entrypoint] Arrancando servidor..."
exec node dist/server.js
