/**
 * La vuelta del navegador y el webhook.
 *
 * Nada de lo que llega por aquí se cree: se le pregunta a la pasarela cuál es
 * el estado real de la transacción. La vuelta del navegador se falsifica
 * escribiendo una URL; la respuesta de la API, no.
 */
import type { Request, Response } from "express";
import { env, esProduccion } from "../../config/env.js";
import { logger } from "../../config/logger.js";
import { noEncontrado, peticionInvalida } from "../../middlewares/errores.js";
import { buscarPedido, cambiarEstado, marcarPagado } from "../../services/pedidos.service.js";
import { enviar } from "../../services/correo.js";
import { avisoInterno, pagoRecibido } from "../../services/plantillas-pedido.js";
import { firmaMercadoPagoValida, mercadopago, pasarela, pasarelaActiva } from "../../services/pagos.js";
import { aPedidoCorreo } from "../pedidos/pedidos.controller.js";
import { ajuste } from "../../services/ajustes.js";

const aLaGracias = (res: Response, numero: string, estado: string): void => {
  const destino = `${env.SITIO_PUBLICO.replace(/\/$/, "")}/tienda/gracias?n=${encodeURIComponent(numero)}&e=${estado}`;
  res.redirect(303, destino);
};

async function avisarPago(numero: string): Promise<void> {
  const pedido = await buscarPedido(numero);
  if (!pedido) return;
  const correo = aPedidoCorreo(pedido);
  await enviar(pagoRecibido(correo));
  if (ajuste("CORREO_RESPONDER_A")) await enviar(avisoInterno(correo, ajuste("CORREO_RESPONDER_A")));
}

export async function retornoDePago(req: Request, res: Response): Promise<void> {
  const datos = { ...(req.query as Record<string, string>), ...((req.body ?? {}) as Record<string, string>) };

  /* Webpay: la persona anuló en el formulario de la tarjeta. */
  if (datos.TBK_TOKEN || datos.TBK_ID_SESION) {
    const numero = datos.TBK_ID_SESION ?? "";
    if (numero) await cambiarEstado(numero, "ANULADO", "Anulada por la persona en la pasarela").catch(() => null);
    return aLaGracias(res, numero, "anulado");
  }

  let confirmacion;
  try {
    confirmacion = await pasarela().confirmar({
      token: datos.token_ws,
      pagoId: datos.payment_id ?? datos.collection_id,
      numero: datos.numero ?? datos.external_reference
    });
  } catch (error) {
    logger.error({ err: error }, "la pasarela no respondió al confirmar");
    const numero = datos.numero ?? datos.external_reference ?? "";
    if (numero) await cambiarEstado(numero, "REVISAR", "La pasarela no respondió al confirmar").catch(() => null);
    return aLaGracias(res, numero, "revisar");
  }

  const numero = confirmacion.numero;
  if (!numero) throw peticionInvalida("No sabemos de qué pedido es este pago");

  const pedido = await buscarPedido(numero);
  if (!pedido) throw noEncontrado("No existe ese pedido");

  if (!confirmacion.ok) {
    await cambiarEstado(numero, "PENDIENTE_PAGO", `Pago rechazado: ${confirmacion.motivo ?? ""}`);
    return aLaGracias(res, numero, "rechazado");
  }

  /* En simulado el monto lo pone el pedido: no hay pasarela que lo diga. */
  const monto = pasarelaActiva() === "simulado" ? pedido.total : (confirmacion.monto ?? -1);
  const resultado = await marcarPagado(numero, {
    metodo: confirmacion.metodo,
    referencia: confirmacion.referencia,
    monto,
    bruto: confirmacion.bruto
  });

  if (!resultado.ok) return aLaGracias(res, numero, "revisar");
  if (!resultado.repetido) await avisarPago(numero);
  return aLaGracias(res, numero, "pagado");
}

/**
 * Webhook. Contesta 200 casi siempre a propósito: un 500 hace que la pasarela
 * reintente en bucle. Lo que no se pudo procesar queda en el registro.
 */
export async function avisoDePago(req: Request, res: Response): Promise<void> {
  const cuerpo = (req.body ?? {}) as { type?: string; data?: { id?: string } };
  const consulta = req.query as Record<string, string>;

  /**
   * `null` = no hay secreto configurado, así que no se puede comprobar nada.
   * En producción eso no se deja pasar: el arranque ya lo exige, y aquí se
   * cierra por si alguien lo quitó en caliente. Fuera de producción se avisa
   * y se sigue, para poder probar el flujo sin credenciales.
   */
  const firma = firmaMercadoPagoValida(req.headers as Record<string, unknown>, consulta);
  if (firma === false) {
    logger.warn("aviso de pago con firma que no cuadra");
    res.json({ ok: true, ignorado: "firma" });
    return;
  }
  if (firma === null && esProduccion) {
    logger.error("aviso de pago sin poder comprobar la firma: falta MP_WEBHOOK_SECRET");
    res.json({ ok: true, ignorado: "sin secreto de webhook" });
    return;
  }

  const tipo = cuerpo.type ?? consulta.type;
  const pagoId = cuerpo.data?.id ?? consulta["data.id"] ?? consulta.id;
  if (tipo !== "payment" || !pagoId) {
    res.json({ ok: true, ignorado: "no es un pago" });
    return;
  }

  let confirmacion;
  try {
    confirmacion = await mercadopago.confirmar({ pagoId });
  } catch (error) {
    logger.error({ err: error }, "no se pudo consultar el pago avisado");
    res.json({ ok: true, reintentar: true });
    return;
  }

  if (!confirmacion.ok || !confirmacion.numero) {
    res.json({ ok: true, estado: confirmacion.motivo ?? "sin número" });
    return;
  }

  const resultado = await marcarPagado(confirmacion.numero, {
    metodo: "mercadopago",
    referencia: confirmacion.referencia,
    monto: confirmacion.monto ?? -1,
    bruto: confirmacion.bruto
  });

  if (resultado.ok && !resultado.repetido) await avisarPago(confirmacion.numero);
  res.json({ ok: true, procesado: true });
}
