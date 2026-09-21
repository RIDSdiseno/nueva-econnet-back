/**
 * Cupones. El consumo es atómico: el contador sube dentro de un UPDATE con la
 * condición puesta, así que con mil personas usando el mismo cupón de
 * lanzamiento a la vez, el número 1.001 no entra.
 */
import { Prisma, type Cupon } from "@prisma/client";
import { prisma } from "./prisma.js";

export const buscarCupon = (codigo: string): Promise<Cupon | null> =>
  prisma.cupon.findUnique({ where: { codigo: codigo.trim().toUpperCase() } });

export const crearCupon = (datos: {
  codigo: string;
  tipo: "PORCENTAJE" | "MONTO";
  valor: number;
  minimo?: number;
  caduca?: Date | null;
  usos?: number | null;
  unoPorCorreo?: boolean;
}): Promise<Cupon> =>
  prisma.cupon.create({
    data: {
      codigo: datos.codigo.trim().toUpperCase(),
      tipo: datos.tipo,
      valor: datos.valor,
      minimo: datos.minimo ?? 0,
      caduca: datos.caduca ?? null,
      usos: datos.usos ?? null,
      unoPorCorreo: datos.unoPorCorreo ?? true
    }
  });

export const yaLoUso = async (codigo: string, correoHash: string): Promise<boolean> =>
  (await prisma.cuponUso.findUnique({ where: { cuponCodigo_correoHash: { cuponCodigo: codigo, correoHash } } })) !== null;

/** Devuelve false si al final no quedaba hueco: quien llama recalcula sin cupón. */
export async function consumirCupon(cupon: Cupon, correoHash: string | null): Promise<boolean> {
  try {
    return await prisma.$transaction(async (tx) => {
      if (cupon.usos !== null) {
        const afectadas = await tx.$executeRaw`
          UPDATE "Cupon" SET usados = usados + 1
           WHERE codigo = ${cupon.codigo} AND (usos IS NULL OR usados < usos)`;
        if (afectadas === 0) return false;
      } else {
        await tx.cupon.update({ where: { codigo: cupon.codigo }, data: { usados: { increment: 1 } } });
      }

      if (cupon.unoPorCorreo && correoHash) {
        await tx.cuponUso.create({ data: { cuponCodigo: cupon.codigo, correoHash } });
      }
      return true;
    });
  } catch (error) {
    /* Choque en la clave única = esa persona ya lo usó. */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") return false;
    throw error;
  }
}

export async function devolverCupon(codigo: string, correoHash: string | null): Promise<void> {
  await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`UPDATE "Cupon" SET usados = GREATEST(0, usados - 1) WHERE codigo = ${codigo}`;
    if (correoHash) {
      await tx.cuponUso.deleteMany({ where: { cuponCodigo: codigo, correoHash } });
    }
  });
}
