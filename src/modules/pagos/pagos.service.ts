/** Puente entre un pedido y la pasarela activa. */
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { PedidoConItems } from "../../repositories/pedidos.repository.js";
import { actualizarPedido } from "../../repositories/pedidos.repository.js";
import { pasarela, pasarelaActiva, pasarelaConfigurada, type InicioPago } from "../../services/pagos.js";

export async function iniciarPago(pedido: PedidoConItems): Promise<InicioPago> {
  if (!pasarelaConfigurada()) {
    logger.warn({ metodo: pasarelaActiva() }, "pasarela sin configurar");
  }

  const inicio = await pasarela().iniciar(
    {
      numero: pedido.numero,
      total: pedido.total,
      items: pedido.items.map((i) => ({ nombre: i.nombre, precio: i.precio, cantidad: i.cantidad }))
    },
    {
      retorno: `${env.SITIO_PUBLICO.replace(/\/$/, "")}/api/pago-retorno`,
      aviso: `${env.SITIO_PUBLICO.replace(/\/$/, "")}/api/pago-aviso`
    }
  );

  await actualizarPedido(pedido.numero, { pagoMetodo: pasarelaActiva(), pagoReferencia: inicio.referencia });
  return inicio;
}
