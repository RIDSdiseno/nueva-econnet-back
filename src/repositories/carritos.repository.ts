/**
 * Carritos. Lo que hace que esto aguante cien mil carritos es la columna
 * `proximoCorreo` con índice: el motor pregunta «a quién le toca hoy» en vez
 * de recorrer todos los carritos que existen.
 */
import type { Carrito, CarritoItem, Producto } from "@prisma/client";
import { prisma } from "./prisma.js";

export type CarritoConItems = Carrito & { items: Array<CarritoItem & { producto: Producto }> };

const incluirItems = { items: { include: { producto: true } } } as const;

export const buscarCarrito = (id: string): Promise<CarritoConItems | null> =>
  prisma.carrito.findUnique({ where: { id }, include: incluirItems });

export async function guardarCarrito(datos: {
  id?: string | null;
  lineas: Array<{ productoId: string; cantidad: number }>;
  valor: number;
  correo?: string | null;
  consiente?: boolean;
  proximoCorreo?: Date | null;
}): Promise<CarritoConItems> {
  const estado = datos.lineas.length ? "ABIERTO" : "VACIO";

  const carrito = datos.id
    ? await prisma.carrito.findUnique({ where: { id: datos.id } })
    : null;

  const id = carrito
    ? (
        await prisma.carrito.update({
          where: { id: carrito.id },
          data: {
            valor: datos.valor,
            correo: datos.correo ?? carrito.correo,
            consiente: datos.consiente ?? carrito.consiente,
            estado: carrito.estado === "COMPRADO" ? "COMPRADO" : estado,
            ...(datos.proximoCorreo !== undefined && !carrito.proximoCorreo
              ? { proximoCorreo: datos.proximoCorreo, diaSecuencia: 0 }
              : {})
          }
        })
      ).id
    : (
        await prisma.carrito.create({
          data: {
            ...(datos.id ? { id: datos.id } : {}),
            valor: datos.valor,
            correo: datos.correo ?? null,
            consiente: datos.consiente ?? false,
            estado,
            proximoCorreo: datos.proximoCorreo ?? null
          }
        })
      ).id;

  await prisma.carritoItem.deleteMany({ where: { carritoId: id } });
  if (datos.lineas.length) {
    await prisma.carritoItem.createMany({
      data: datos.lineas.map((l) => ({ carritoId: id, productoId: l.productoId, cantidad: l.cantidad }))
    });
  }

  return (await buscarCarrito(id)) as CarritoConItems;
}

export const cambiarEstadoCarrito = (id: string, estado: Carrito["estado"]): Promise<Carrito> =>
  prisma.carrito.update({ where: { id }, data: { estado, proximoCorreo: estado === "ABIERTO" ? undefined : null } });

export const programarCarrito = (id: string, dia: number, cuando: Date): Promise<Carrito> =>
  prisma.carrito.update({ where: { id }, data: { diaSecuencia: dia, proximoCorreo: cuando } });

export const cerrarSecuencia = (id: string): Promise<Carrito> =>
  prisma.carrito.update({ where: { id }, data: { estado: "TERMINADA", proximoCorreo: null } });

/**
 * Los carritos a los que hoy les toca correo, tomados en lote y bloqueados
 * para que dos trabajadores a la vez no manden el mismo dos veces.
 */
export async function tomarCarritosDelDia(lote: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    UPDATE "Carrito" SET "proximoCorreo" = "proximoCorreo" + interval '1 hour'
     WHERE id IN (
       SELECT id FROM "Carrito"
        WHERE estado = 'ABIERTO'
          AND consiente = true
          AND correo IS NOT NULL
          AND "proximoCorreo" IS NOT NULL
          AND "proximoCorreo" <= now()
        ORDER BY "proximoCorreo"
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING id`;
  return filas.map((f) => f.id);
}
