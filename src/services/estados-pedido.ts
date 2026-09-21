/**
 * La máquina de estados de un pedido.
 *
 * Antes no existía: `cambiarEstado` escribía lo que le dijeran. Se podía pasar
 * de ENTREGADO a PENDIENTE_PAGO, o anular dos veces el mismo pedido — y cada
 * anulación devolvía otra vez las unidades al contador compartido, quitándoselas
 * a las reservas de pedidos vivos. Así se acaba vendiendo dos veces la misma
 * unidad.
 *
 * Aquí está escrito lo que puede pasar y lo que no. Lo que no está, no pasa.
 */
import type { EstadoPedido } from "@prisma/client";

export const TRANSICIONES: Record<EstadoPedido, EstadoPedido[]> = {
  /* Esperando que confirmemos stock o tarifa de despacho. */
  POR_CONFIRMAR: ["PENDIENTE_PAGO", "ANULADO", "REVISAR"],
  PENDIENTE_PAGO: ["PAGADO", "ANULADO", "REVISAR"],
  PAGADO: ["PREPARANDO", "DEVUELTO", "REVISAR"],
  PREPARANDO: ["DESPACHADO", "DEVUELTO", "REVISAR"],
  DESPACHADO: ["ENTREGADO", "DEVUELTO"],
  ENTREGADO: ["DEVUELTO"],
  /* Finales: de aquí no se sale. */
  ANULADO: [],
  DEVUELTO: [],
  /* Un pago que no cuadró: lo desatasca una persona. */
  REVISAR: ["PAGADO", "ANULADO", "PREPARANDO"]
};

/** Estados en los que el pedido ya no espera nada. */
export const FINALES: EstadoPedido[] = ["ENTREGADO", "ANULADO", "DEVUELTO"];

/** Los que liberan la reserva de stock al entrar. */
export const LIBERAN_STOCK: EstadoPedido[] = ["ANULADO"];

/** Los que consumen el stock físico al entrar. */
export const CONSUMEN_STOCK: EstadoPedido[] = ["PAGADO"];

export type ResultadoTransicion =
  | { ok: true; repetida: false }
  /** Ya estaba en ese estado: no se vuelve a ejecutar el efecto. */
  | { ok: true; repetida: true }
  | { ok: false; motivo: string };

export function puedePasar(desde: EstadoPedido, hasta: EstadoPedido): ResultadoTransicion {
  if (desde === hasta) return { ok: true, repetida: true };

  const permitidas = TRANSICIONES[desde] ?? [];
  if (!permitidas.includes(hasta)) {
    return {
      ok: false,
      motivo: permitidas.length
        ? `Un pedido ${desde} solo puede pasar a ${permitidas.join(", ")}.`
        : `Un pedido ${desde} ya está cerrado: no admite más cambios.`
    };
  }
  return { ok: true, repetida: false };
}
