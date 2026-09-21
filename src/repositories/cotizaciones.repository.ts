/**
 * Cotizaciones de empresa. Mismo patrón que los carritos: la agenda de
 * seguimiento se pide por índice y se toma con FOR UPDATE SKIP LOCKED, para
 * que dos ejecuciones del cron no manden el mismo recordatorio dos veces.
 */
import { Prisma, type Cotizacion, type EstadoCotizacion } from "@prisma/client";
import { prisma } from "./prisma.js";

export const crearCotizacion = (datos: Prisma.CotizacionUncheckedCreateInput): Promise<Cotizacion> =>
  prisma.cotizacion.create({ data: datos });

export const buscarCotizacion = (numero: string): Promise<Cotizacion | null> =>
  prisma.cotizacion.findUnique({ where: { numero } });

export const cambiarEstadoCotizacion = (
  numero: string,
  estado: EstadoCotizacion,
  extra: Partial<Prisma.CotizacionUncheckedUpdateInput> = {}
): Promise<Cotizacion> => prisma.cotizacion.update({ where: { numero }, data: { estado, ...extra } });

export const programarSeguimiento = (numero: string, seguimiento: number, cuando: Date | null): Promise<Cotizacion> =>
  prisma.cotizacion.update({ where: { numero }, data: { seguimiento, proximoCorreo: cuando } });

/**
 * A quién le toca recordatorio hoy. Solo las vivas: una aceptada o perdida no
 * se persigue, y perseguirla es la forma más rápida de perder al cliente.
 */
export async function tomarCotizacionesDelDia(lote: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ numero: string }>>`
    UPDATE "Cotizacion" SET "proximoCorreo" = "proximoCorreo" + interval '1 hour'
     WHERE numero IN (
       SELECT numero FROM "Cotizacion"
        WHERE estado IN ('ENVIADA', 'VISTA')
          AND "proximoCorreo" IS NOT NULL
          AND "proximoCorreo" <= now()
        ORDER BY "proximoCorreo"
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING numero`;
  return filas.map((f) => f.numero);
}

/** Las que se pasaron de la fecha de validez y siguen abiertas. */
export async function caducarCotizaciones(lote: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ numero: string }>>`
    UPDATE "Cotizacion" SET estado = 'CADUCADA', "proximoCorreo" = NULL
     WHERE numero IN (
       SELECT numero FROM "Cotizacion"
        WHERE estado IN ('ENVIADA', 'VISTA')
          AND "validaHasta" < now()
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING numero`;
  return filas.map((f) => f.numero);
}

/** Las cotizaciones para el panel, con búsqueda por número, empresa o correo. */
export const buscarCotizaciones = (opciones: { estado?: EstadoCotizacion; texto?: string; cuantos?: number }) =>
  prisma.cotizacion.findMany({
    where: {
      ...(opciones.estado ? { estado: opciones.estado } : {}),
      ...(opciones.texto
        ? {
            OR: [
              { numero: { contains: opciones.texto, mode: "insensitive" as const } },
              { correo: { contains: opciones.texto, mode: "insensitive" as const } },
              { empresa: { contains: opciones.texto, mode: "insensitive" as const } },
              { nombre: { contains: opciones.texto, mode: "insensitive" as const } }
            ]
          }
        : {})
    },
    orderBy: { creado: "desc" },
    take: Math.min(opciones.cuantos ?? 100, 200)
  });

export async function contarCotizacionesPorEstado(): Promise<Record<string, number>> {
  const filas = await prisma.cotizacion.groupBy({ by: ["estado"], _count: { _all: true } });
  return Object.fromEntries(filas.map((f) => [f.estado, f._count._all]));
}
