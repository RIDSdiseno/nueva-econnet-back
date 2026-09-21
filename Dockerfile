# Econnet · backend-api. Multi-stage y usuario no root, como pide la guía §6.
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# prisma generate solo lee el schema, no se conecta a la DB.
# DATABASE_URL dummy evita el error de validación en prisma.config.ts.
RUN DATABASE_URL=postgresql://build:build@localhost:5432/build npx prisma generate && npm run build

FROM node:24-alpine AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
# CLI de Prisma necesario para «prisma migrate deploy» al arrancar.
# Se copia desde la etapa de build para no instalar devDependencies en producción.
COPY --from=build /app/node_modules/prisma ./node_modules/prisma
COPY --from=build /app/node_modules/.bin/prisma ./node_modules/.bin/prisma
COPY entrypoint.sh ./entrypoint.sh
RUN chmod +x entrypoint.sh
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s --start-period=60s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/salud').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "entrypoint.sh"]
