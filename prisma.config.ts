import "dotenv/config";
import { defineConfig } from "prisma/config";

const url = process.env.DATABASE_URL;
if (!url) throw new Error("DATABASE_URL no está definida. Agrégala como variable de entorno.");

export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    url,
    /* La base espejo que Prisma usa para calcular una migración nueva. Solo
       hace falta al escribir migraciones; en producción se corre
       `migrate deploy` y la clave ni aparece — vacía, Prisma la rechaza. */
    ...(process.env.DATABASE_URL_SHADOW ? { shadowDatabaseUrl: process.env.DATABASE_URL_SHADOW } : {})
  },
  migrations: { seed: "tsx prisma/seed.ts" }
});
