/** Puente entre un pedido y la pasarela activa o elegida. */
import { env } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import type { PedidoConItems } from "../../repositories/pedidos.repository.js";
import { actualizarPedido } from "../../repositories/pedidos.repository.js";
import {
  pasarela,
  pasarelaActiva,
  pasarelaConfigurada,
  obtenerPasarela,
  type InicioPago,
  type NombrePasarela
} from "../../services/pagos.js";

export async function iniciarPago(pedido: PedidoConItems, pasarelaElegida?: NombrePasarela): Promise<InicioPago> {
  const p = pasarelaElegida ? obtenerPasarela(pasarelaElegida) : pasarela();
  const activa = pasarelaElegida ?? pasarelaActiva();

  if (!pasarelaElegida && !pasarelaConfigurada()) {
    logger.warn({ metodo: activa }, "pasarela sin configurar");
  }

  const inicio = await p.iniciar(
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

  await actualizarPedido(pedido.numero, { pagoMetodo: activa, pagoReferencia: inicio.referencia });
  return inicio;
}
