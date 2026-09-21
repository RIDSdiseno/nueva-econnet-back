/** Los ajustes del negocio. Un upsert por clave, en una transacción. */
import type { Ajuste } from "@prisma/client";
import { prisma } from "./prisma.js";

export const leerAjustes = (): Promise<Ajuste[]> => prisma.ajuste.findMany();

export async function escribirAjustes(
  pares: Array<{ clave: string; valor: string; autor: string }>
): Promise<void> {
  await prisma.$transaction(
    pares.map(({ clave, valor, autor }) =>
      prisma.ajuste.upsert({
        where: { clave },
        create: { clave, valor, autor },
        update: { valor, autor }
      })
    )
  );
}
