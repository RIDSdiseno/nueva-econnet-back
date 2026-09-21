import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { RUTAS_TIENDA } from "../../config/rutas.js";
import { logger } from "../../config/logger.js";
import { comprobar, firmar } from "../../services/firma.js";
import { conflicto, ErrorApp, noEncontrado } from "../../middlewares/errores.js";
import { cambiarEstadoCarrito } from "../../services/carritos.service.js";
import { enviar } from "../../services/correo.js";
import { registrarLead } from "../../services/leads.service.js";
import { calcular, crear, seguir } from "../../services/pedidos.service.js";
import { iniciarPago } from "../pagos/pagos.service.js";
import { avisoInterno, pedidoPendienteDePago, pedidoPorConfirmar, type PedidoCorreo } from "../../services/plantillas-pedido.js";
import { normalizarCorreo, normalizarRut, pareceRobot } from "../../services/texto.js";
import type { PedidoConItems } from "../../repositories/pedidos.repository.js";
import type { CrearPedido, Totales } from "./pedidos.schemas.js";
import { ajuste } from "../../services/ajustes.js";

export const enlaceSeguimiento = (numero: string, correo: string): string =>
  `${env.SITIO_PUBLICO.replace(/\/$/, "")}${RUTAS_TIENDA.seguimiento}?t=${firmar({ a: "seguimiento", c: correo, k: numero }, 60 * 60 * 24 * 90)}`;

export const aPedidoCorreo = (pedido: PedidoConItems): PedidoCorreo => ({
  numero: pedido.numero,
  urlSeguimiento: enlaceSeguimiento(pedido.numero, pedido.contactoCorreo),
  estado: pedido.estado,
  subtotal: pedido.subtotal,
  descuento: pedido.descuento,
  envio: pedido.envio,
  total: pedido.total,
  neto: pedido.neto,
  iva: pedido.iva,
  documentoTipo: pedido.documentoTipo,
  despachoModo: pedido.despachoModo,
  despachoRegion: pedido.despachoRegion,
  despachoDireccion: pedido.despachoDireccion,
  contactoNombre: pedido.contactoNombre,
  contactoCorreo: pedido.contactoCorreo,
  contactoTelefono: pedido.contactoTelefono,
  rut: pedido.rut,
  stockPorConfirmar: pedido.stockPorConfirmar,
  envioPorConfirmar: pedido.envioPorConfirmar,
  items: pedido.items.map((i) => ({ nombre: i.nombre, precio: i.precio, cantidad: i.cantidad }))
});

export async function calcularTotales(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as Totales;
  const cuenta = await calcular({
    items: cuerpo.items,
    despacho: { modo: cuerpo.despacho.modo, region: cuerpo.despacho.region ?? null },
    cupon: cuerpo.cupon ?? null,
    correo: cuerpo.correo ? normalizarCorreo(cuerpo.correo) : null
  });

  res.json({
    ok: true,
    lineas: cuenta.lineas,
    rechazadas: cuenta.rechazadas,
    totales: cuenta.totales,
    envio: cuenta.envio,
    cupon: cuenta.cuponCodigo,
    cuponMotivo: cuenta.cuponMotivo,
    stockPorConfirmar: cuenta.stockPorConfirmar,
    sePuedeCobrar: cuenta.sePuedeCobrar
  });
}

export async function crearPedidoControlador(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as CrearPedido;

  if (pareceRobot(cuerpo)) {
    res.json({ ok: true, mensaje: "Listo." });
    return;
  }

  const correo = normalizarCorreo(cuerpo.correo);
  const resultado = await crear({
    items: cuerpo.items,
    contacto: { nombre: cuerpo.nombre, correo, telefono: cuerpo.telefono ?? null },
    terminosEn: new Date(),
    despacho: {
      modo: cuerpo.despacho.modo,
      region: cuerpo.despacho.region ?? null,
      comuna: cuerpo.despacho.comuna ?? null,
      direccion: cuerpo.despacho.direccion ?? null,
      notas: cuerpo.despacho.notas ?? null
    },
    documento: {
      tipo: cuerpo.documento.tipo,
      rut: cuerpo.documento.rut ? normalizarRut(cuerpo.documento.rut) : null,
      razonSocial: cuerpo.documento.razonSocial ?? null,
      giro: cuerpo.documento.giro ?? null,
      direccion: cuerpo.documento.direccion ?? null
    },
    cupon: cuerpo.cupon ?? null,
    carritoId: cuerpo.carritoId ?? null,
    idempotencia: cuerpo.idempotencia,
    totalEsperado: cuerpo.totalEsperado
  });

  if (!resultado.ok || !resultado.pedido) {
    /* El total subió entre la pantalla y el pedido: se devuelve el nuevo para
       que la tienda lo enseñe y la persona confirme. No se cobra a ciegas. */
    if (resultado.totalCambio) {
      throw new ErrorApp(409, "total_cambio", resultado.error ?? "El total cambió.", {
        ...resultado.totalCambio,
        ...(resultado.cuponMotivo ? { motivo: resultado.cuponMotivo } : {})
      });
    }
    throw conflicto(resultado.error ?? "No se pudo crear el pedido", resultado.problemas);
  }

  const pedido = resultado.pedido;
  if (resultado.repetido) {
    res.json({ ok: true, repetido: true, numero: pedido.numero, estado: pedido.estado, totales: { total: pedido.total } });
    return;
  }

  if (cuerpo.carritoId) {
    await cambiarEstadoCarrito(cuerpo.carritoId, "COMPRADO").catch(() => undefined);
  }
  if (cuerpo.consentimiento === true) {
    await registrarLead({ correo, nombre: cuerpo.nombre, origen: "compra", etiquetas: ["cliente"] });
  }

  let pago = null;
  if (pedido.estado === "PENDIENTE_PAGO") {
    try {
      pago = await iniciarPago(pedido);
    } catch (error) {
      logger.error({ err: error, numero: pedido.numero }, "no se pudo arrancar el pago");
    }
  }

  const correoPedido = aPedidoCorreo(pedido);
  const pieza =
    pedido.estado === "POR_CONFIRMAR"
      ? pedidoPorConfirmar(correoPedido)
      : pedidoPendienteDePago(correoPedido, pago && pago.tipo === "redirect" ? pago.url : null);

  await enviar(pieza);
  if (ajuste("CORREO_RESPONDER_A")) await enviar(avisoInterno(correoPedido, ajuste("CORREO_RESPONDER_A")));

  res.status(201).json({
    ok: true,
    numero: pedido.numero,
    estado: pedido.estado,
    totales: {
      subtotal: pedido.subtotal,
      descuento: pedido.descuento,
      envio: pedido.envio,
      total: pedido.total,
      neto: pedido.neto,
      iva: pedido.iva
    },
    porConfirmar: { stock: pedido.stockPorConfirmar, envio: pedido.envioPorConfirmar },
    cuponMotivo: resultado.cuponMotivo ?? null,
    pago,
    ...(pago ? {} : { aviso: pedido.estado === "PENDIENTE_PAGO" ? "Te mandamos el enlace de pago por correo." : undefined })
  });
}

export async function seguimiento(req: Request, res: Response): Promise<void> {
  const consulta = req.consultaValidada as { t?: string; numero?: string; correo?: string };

  /* Con enlace firmado no hace falta teclear nada, y no se puede adivinar el
     pedido de otro: la firma ata el número al correo con el que se compró. */
  let numero = consulta.numero ?? "";
  let correo = consulta.correo ?? "";
  if (consulta.t) {
    const datos = comprobar(consulta.t);
    if (!datos || datos.a !== "seguimiento" || !datos.c || !datos.k) {
      throw noEncontrado("Ese enlace ya no vale. Busca tu pedido con el número y tu correo.");
    }
    numero = datos.k;
    correo = datos.c;
  }

  const pedido = await seguir(numero.toUpperCase(), correo);
  /* Mismo mensaje exista o no: así no se puede averiguar qué números existen. */
  if (!pedido) throw noEncontrado("No encontramos un pedido con ese número y ese correo.");
  res.json({ ok: true, pedido });
}
