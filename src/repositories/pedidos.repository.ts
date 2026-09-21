/** Pedidos. Lectura, escritura y el historial de estados. */
import type { EstadoPedido, Pedido, PedidoItem, Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";

export type PedidoConItems = Pedido & { items: PedidoItem[] };

const incluir = { items: true } as const;

export const buscarPedido = (numero: string): Promise<PedidoConItems | null> =>
  prisma.pedido.findUnique({ where: { numero }, include: incluir });

export const buscarPorIdempotencia = (clave: string): Promise<PedidoConItems | null> =>
  prisma.pedido.findUnique({ where: { idempotencia: clave }, include: incluir });

export const crearPedido = (datos: Prisma.PedidoCreateInput): Promise<PedidoConItems> =>
  prisma.pedido.create({ data: datos, include: incluir });

export const actualizarPedido = (numero: string, datos: Prisma.PedidoUpdateInput): Promise<PedidoConItems> =>
  prisma.pedido.update({ where: { numero }, data: datos, include: incluir });

export async function registrarEvento(numero: string, estado: EstadoPedido, nota = ""): Promise<void> {
  const pedido = await prisma.pedido.findUnique({ where: { numero } });
  if (!pedido) return;
  await prisma.pedidoEvento.create({ data: { pedidoId: pedido.id, estado, nota } });
}

export const eventosDe = (pedidoId: string) =>
  prisma.pedidoEvento.findMany({ where: { pedidoId }, orderBy: { fecha: "asc" } });

/**
 * Marca el pago una sola vez, pase lo que pase: la pasarela puede avisar dos
 * veces, o avisar mientras la persona vuelve por su cuenta. Gana quien llegue
 * primero, y el segundo se entera de que ya estaba hecho.
 */
export async function tomarPagoUnaVez(numero: string): Promise<boolean> {
  const afectadas = await prisma.$executeRaw`
    UPDATE "Pedido" SET "pagoEstado" = 'procesando'
     WHERE numero = ${numero} AND ("pagoEstado" IS NULL OR "pagoEstado" = 'pendiente')`;
  return afectadas === 1;
}

/** Pedidos que esperan pago y ya se pasaron de plazo. En lote y con bloqueo. */
export async function tomarPedidosCaducados(lote: number): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ numero: string }>>`
    UPDATE "Pedido" SET "caducaEn" = NULL
     WHERE id IN (
       SELECT id FROM "Pedido"
        WHERE estado = 'PENDIENTE_PAGO' AND "caducaEn" IS NOT NULL AND "caducaEn" <= now()
        ORDER BY "caducaEn"
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
     )
     RETURNING numero`;
  return filas.map((f) => f.numero);
}

export const listarPedidos = (estado?: EstadoPedido) =>
  prisma.pedido.findMany({
    where: estado ? { estado } : {},
    orderBy: { creado: "desc" },
    include: incluir,
    take: 200
  });

/**
 * Los pedidos para el panel, con búsqueda por número, nombre o correo.
 * Insensible a mayúsculas porque nadie teclea un correo como lo escribió.
 */
export const buscarPedidos = (opciones: { estado?: EstadoPedido; texto?: string; cuantos?: number }) =>
  prisma.pedido.findMany({
    where: {
      ...(opciones.estado ? { estado: opciones.estado } : {}),
      ...(opciones.texto
        ? {
            OR: [
              { numero: { contains: opciones.texto, mode: "insensitive" as const } },
              { contactoNombre: { contains: opciones.texto, mode: "insensitive" as const } },
              { contactoCorreo: { contains: opciones.texto, mode: "insensitive" as const } },
              { rut: { contains: opciones.texto, mode: "insensitive" as const } }
            ]
          }
        : {})
    },
    orderBy: { creado: "desc" },
    include: incluir,
    take: Math.min(opciones.cuantos ?? 100, 200)
  });

/** Cuántos hay en cada estado. Es la cabecera del panel de pedidos. */
export async function contarPorEstado(): Promise<Record<string, number>> {
  const filas = await prisma.pedido.groupBy({ by: ["estado"], _count: { _all: true } });
  return Object.fromEntries(filas.map((f) => [f.estado, f._count._all]));
}

/** Lo vendido y lo cobrado en una ventana. Sin inventar: solo lo que está PAGADO en adelante. */
export async function ventasDesde(desde: Date): Promise<{ pedidos: number; total: number; neto: number }> {
  const r = await prisma.pedido.aggregate({
    where: { creado: { gte: desde }, estado: { in: ["PAGADO", "PREPARANDO", "DESPACHADO", "ENTREGADO"] } },
    _count: { _all: true },
    _sum: { total: true, neto: true }
  });
  return { pedidos: r._count._all, total: r._sum.total ?? 0, neto: r._sum.neto ?? 0 };
}
