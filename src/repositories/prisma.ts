/**
 * El cliente de base de datos. Único punto donde se abre la conexión.
 * Prisma 7 exige un adaptador de driver: aquí, pg sobre PostgreSQL.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { env } from "../config/env.js";

const adaptador = new PrismaPg({ connectionString: env.DATABASE_URL });

export const prisma = new PrismaClient({ adapter: adaptador });

export type TransaccionPrisma = Omit<
  PrismaClient,
  "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends"
>;

export async function cerrarBaseDeDatos(): Promise<void> {
  await prisma.$disconnect();
}
