/**
 * El contador del límite por IP, en PostgreSQL.
 *
 * Por qué no en memoria: con más de una instancia detrás de un balanceador,
 * cada proceso cuenta por su cuenta y el límite real acaba siendo el número de
 * instancias por el configurado. El día del pico —que es justo cuando importa—
 * el límite no limita.
 *
 * Un solo `INSERT … ON CONFLICT` por petición: atómico, sin leer antes de
 * escribir, y con la ventana dentro de la misma fila.
 */
import { prisma } from "./prisma.js";

export interface Golpe {
  golpes: number;
  expira: Date;
}

/**
 * Suma uno y devuelve el total de la ventana. Si la ventana caducó, la fila se
 * reinicia en el mismo golpe: no hace falta un proceso de limpieza para que el
 * contador sea correcto.
 */
export async function sumarGolpe(clave: string, ventanaMs: number): Promise<Golpe> {
  const filas = await prisma.$queryRaw<Array<{ golpes: number; expira: Date }>>`
    INSERT INTO "LimitePeticion" (clave, golpes, expira)
    VALUES (${clave}, 1, now() + ${`${ventanaMs} milliseconds`}::interval)
    ON CONFLICT (clave) DO UPDATE SET
      golpes = CASE WHEN "LimitePeticion".expira <= now() THEN 1 ELSE "LimitePeticion".golpes + 1 END,
      expira = CASE WHEN "LimitePeticion".expira <= now() THEN now() + ${`${ventanaMs} milliseconds`}::interval ELSE "LimitePeticion".expira END
    RETURNING golpes, expira`;

  const fila = filas[0];
  return { golpes: fila?.golpes ?? 1, expira: fila?.expira ?? new Date(Date.now() + ventanaMs) };
}

export async function verGolpe(clave: string): Promise<Golpe | undefined> {
  const fila = await prisma.limitePeticion.findUnique({ where: { clave } });
  if (!fila || fila.expira <= new Date()) return undefined;
  return { golpes: fila.golpes, expira: fila.expira };
}

export async function restarGolpe(clave: string): Promise<void> {
  await prisma.$executeRaw`
    UPDATE "LimitePeticion" SET golpes = GREATEST(0, golpes - 1)
     WHERE clave = ${clave} AND expira > now()`;
}

export const olvidarClave = (clave: string): Promise<unknown> =>
  prisma.limitePeticion.deleteMany({ where: { clave } });

/** Barre las ventanas caducadas. Lo llama el cron; nada depende de ello. */
export const limpiarCaducadas = (): Promise<number> =>
  prisma.limitePeticion.deleteMany({ where: { expira: { lte: new Date() } } }).then((r) => r.count);
