/**
 * Preparación global: la base de pruebas se migra una vez por ejecución.
 * Es una base aparte (econnet_test): las pruebas nunca tocan datos de nadie.
 */
import { execSync } from "node:child_process";

export default function preparar(): void {
  const url = process.env.DATABASE_URL_TEST;
  if (!url) throw new Error("Falta DATABASE_URL_TEST para correr las pruebas");

  execSync("npx prisma migrate deploy --schema=prisma/schema.prisma", {
    env: { ...process.env, DATABASE_URL: url },
    stdio: "ignore"
  });
}
