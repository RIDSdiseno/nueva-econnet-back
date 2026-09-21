/**
 * Reservas de stock.
 *
 * **La reserva es atómica dentro del propio UPDATE.** No se lee, se suma y se
 * escribe: se suma con la condición puesta en el WHERE, y si no entra, no
 * afecta ninguna fila. Con dos personas comprando la última unidad a la vez,
 * solo una se la lleva. Todo dentro de una transacción: o entran todas las
 * líneas o no entra ninguna.
 */
import { prisma } from "./prisma.js";

export interface LineaReserva {
  productoId: string;
  cantidad: number;
}

export interface ResultadoReserva {
  ok: boolean;
  problemas: Array<{ productoId: string; pedidas: number; quedan: number }>;
}

export async function reservarStock(lineas: LineaReserva[]): Promise<ResultadoReserva> {
  return prisma.$transaction(async (tx) => {
    const problemas: ResultadoReserva["problemas"] = [];

    for (const linea of lineas) {
      const afectadas = await tx.$executeRaw`
        UPDATE "Producto"
           SET reservadas = reservadas + ${linea.cantidad}
         WHERE id = ${linea.productoId}
           AND ("stockUnidades" IS NULL OR reservadas + ${linea.cantidad} <= "stockUnidades")`;

      if (afectadas === 0) {
        const producto = await tx.producto.findUnique({ where: { id: linea.productoId } });
        problemas.push({
          productoId: linea.productoId,
          pedidas: linea.cantidad,
          quedan: Math.max(0, (producto?.stockUnidades ?? 0) - (producto?.reservadas ?? 0))
        });
      }
    }

    if (problemas.length) throw new ErrorSinStock(problemas);
    return { ok: true, problemas: [] };
  }).catch((error: unknown) => {
    if (error instanceof ErrorSinStock) return { ok: false, problemas: error.problemas };
    throw error;
  });
}

class ErrorSinStock extends Error {
  constructor(public readonly problemas: ResultadoReserva["problemas"]) {
    super("sin stock");
  }
}

export async function liberarStock(lineas: LineaReserva[]): Promise<void> {
  await prisma.$transaction(
    lineas.map((linea) =>
      prisma.$executeRaw`
        UPDATE "Producto"
           SET reservadas = GREATEST(0, reservadas - ${linea.cantidad})
         WHERE id = ${linea.productoId}`
    )
  );
}

export const reservadasDe = async (productoId: string): Promise<number> =>
  (await prisma.producto.findUnique({ where: { id: productoId } }))?.reservadas ?? 0;

/**
 * El pedido se pagó: lo reservado sale del stock físico.
 *
 * Reservar no descuenta: aparta. Si al pagar no se descuenta, el inventario
 * miente para siempre —el contador de unidades no baja nunca— y cualquier
 * reposición se calcula sobre una cifra falsa.
 *
 * La idempotencia vive en el propio pedido: `stockEstado` pasa de RESERVADO a
 * CONSUMIDO con un UPDATE condicional, y solo quien gana esa transición toca
 * los productos. Un webhook repetido no descuenta dos veces.
 */
export async function consumirStockDePedido(numero: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const gano = await tx.$executeRaw`
      UPDATE "Pedido" SET "stockEstado" = 'CONSUMIDO'
       WHERE numero = ${numero} AND "stockEstado" = 'RESERVADO'`;
    if (gano === 0) return false;

    const items = await tx.pedidoItem.findMany({ where: { pedido: { numero } } });
    for (const item of items) {
      await tx.$executeRaw`
        UPDATE "Producto"
           SET reservadas = GREATEST(0, reservadas - ${item.cantidad}),
               "stockUnidades" = CASE
                 WHEN "stockUnidades" IS NULL THEN NULL
                 ELSE GREATEST(0, "stockUnidades" - ${item.cantidad})
               END,
               "stockEstado" = CASE
                 WHEN "stockUnidades" IS NOT NULL AND "stockUnidades" - ${item.cantidad} <= 0 THEN 'SIN_EXISTENCIAS'::"EstadoStock"
                 ELSE "stockEstado"
               END
         WHERE id = ${item.productoId}`;
    }
    return true;
  });
}

/**
 * El pedido murió (anulado o caducado): lo reservado vuelve a estar libre.
 *
 * Misma idempotencia. Sin ella, anular dos veces el mismo pedido devolvía dos
 * veces las unidades al contador compartido — y las segundas se las quitaba a
 * las reservas de otros pedidos vivos, que es como se acaba vendiendo dos
 * veces la misma unidad.
 */
export async function liberarStockDePedido(numero: string): Promise<boolean> {
  return prisma.$transaction(async (tx) => {
    const gano = await tx.$executeRaw`
      UPDATE "Pedido" SET "stockEstado" = 'LIBERADO'
       WHERE numero = ${numero} AND "stockEstado" = 'RESERVADO'`;
    if (gano === 0) return false;

    const items = await tx.pedidoItem.findMany({ where: { pedido: { numero } } });
    for (const item of items) {
      await tx.$executeRaw`
        UPDATE "Producto" SET reservadas = GREATEST(0, reservadas - ${item.cantidad})
         WHERE id = ${item.productoId}`;
    }
    return true;
  });
}
