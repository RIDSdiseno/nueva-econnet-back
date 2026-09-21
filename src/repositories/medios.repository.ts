/** Las fotografías. Lo único que lee y escribe la tabla `Medio`. */
import type { Medio } from "@prisma/client";
import { prisma } from "./prisma.js";

export const guardarMedio = (datos: { nombre: string; tipo: string; bytes: number; datos: Uint8Array<ArrayBuffer> }): Promise<Medio> =>
  prisma.medio.create({ data: datos });

export const leerMedio = (id: string): Promise<Medio | null> => prisma.medio.findUnique({ where: { id } });

/** Sin los bytes: listar la galería no tiene por qué traerse los megas. */
export const listarMedios = () =>
  prisma.medio.findMany({
    select: { id: true, nombre: true, tipo: true, bytes: true, creado: true },
    orderBy: { creado: "desc" },
    take: 500
  });

export const borrarMedio = (id: string): Promise<unknown> =>
  prisma.medio.delete({ where: { id } }).catch(() => null);
