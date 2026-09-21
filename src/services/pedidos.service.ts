/**
 * Pedidos. El único sitio donde se decide cuánto se cobra.
 *
 * Reglas que no se negocian:
 *  · El precio lo pone el servidor. Del navegador solo llegan ids y cantidades.
 *  · Solo se vende lo que tiene precio propio.
 *  · Si el stock o el despacho están por confirmar, **no se cobra**: el pedido
 *    queda en firme pero a la espera, y se le dice a la persona.
 *  · Crear un pedido es idempotente: dos clics no son dos pedidos.
 */
import type { Producto } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { transicionInvalida } from "../middlewares/errores.js";
import { buscarVarios } from "../repositories/catalogo.repository.js";
import { siguiente } from "../repositories/contador.repository.js";
import {
  actualizarPedido,
  buscarPedido,
  buscarPorIdempotencia,
  crearPedido,
  registrarEvento,
  tomarPagoUnaVez,
  type PedidoConItems
} from "../repositories/pedidos.repository.js";
import { consumirStockDePedido, liberarStock, liberarStockDePedido, reservarStock } from "../repositories/stock.repository.js";
import { CONSUMEN_STOCK, LIBERAN_STOCK, puedePasar } from "./estados-pedido.js";
import { precioReferencia, stockConocido } from "./catalogo.service.js";
import { aplicarCupon, consumir, devolver } from "./cupones.service.js";
import { desglosar, sumarLineas } from "./dinero.js";
import { cotizarEnvio, type CotizacionEnvio } from "./envios.js";

export interface LineaPedido {
  productoId: string;
  nombre: string;
  precio: number;
  cantidad: number;
  condicion: Producto["condicion"];
  stockConocido: boolean;
}

export interface DatosDespacho {
  modo: "DESPACHO" | "RETIRO";
  region?: string | null;
  comuna?: string | null;
  direccion?: string | null;
  notas?: string | null;
}

export interface Cuenta {
  lineas: LineaPedido[];
  rechazadas: Array<{ productoId: string; motivo: string }>;
  totales: { subtotal: number; descuento: number; envio: number | null; total: number; neto: number; iva: number };
  cuponCodigo: string | null;
  cuponMotivo: string;
  envio: CotizacionEnvio;
  stockPorConfirmar: boolean;
  sePuedeCobrar: boolean;
}

/** Convierte ids y cantidades en líneas con el precio del servidor. */
export async function armarLineas(
  entrantes: Array<{ productoId: string; cantidad: number }>
): Promise<{ lineas: LineaPedido[]; rechazadas: Cuenta["rechazadas"] }> {
  const productos = await buscarVarios(entrantes.slice(0, 30).map((l) => l.productoId));
  const porId = new Map(productos.map((p) => [p.id, p]));

  const lineas: LineaPedido[] = [];
  const rechazadas: Cuenta["rechazadas"] = [];

  for (const entrante of entrantes.slice(0, 30)) {
    const producto = porId.get(entrante.productoId);
    if (!producto) {
      rechazadas.push({ productoId: entrante.productoId, motivo: "no existe" });
      continue;
    }
    if (producto.archivado) {
      rechazadas.push({ productoId: producto.id, motivo: "ya no está a la venta" });
      continue;
    }
    const referencia = precioReferencia(producto);
    if (!referencia.propio || !referencia.valor) {
      rechazadas.push({ productoId: producto.id, motivo: "sin precio propio: se consulta, no se compra" });
      continue;
    }
    lineas.push({
      productoId: producto.id,
      nombre: `${producto.marca} ${producto.nombre}`,
      precio: referencia.valor,
      cantidad: Math.min(20, Math.max(1, Math.trunc(entrante.cantidad) || 1)),
      condicion: producto.condicion,
      stockConocido: stockConocido(producto)
    });
  }

  return { lineas, rechazadas };
}

export async function calcular(datos: {
  items: Array<{ productoId: string; cantidad: number }>;
  despacho: DatosDespacho;
  cupon?: string | null;
  correo?: string | null;
}): Promise<Cuenta> {
  const { lineas, rechazadas } = await armarLineas(datos.items);
  const subtotal = sumarLineas(lineas);

  const cupon = subtotal
    ? await aplicarCupon({ codigo: datos.cupon, subtotal, correo: datos.correo })
    : { ok: false, descuento: 0, cupon: null, motivo: "carrito vacío" };

  const baseEnvio = subtotal - cupon.descuento;
  const envio = cotizarEnvio({ modo: datos.despacho.modo, region: datos.despacho.region, subtotal: baseEnvio });

  const total = baseEnvio + (envio.costo ?? 0);
  const { neto, iva } = desglosar(total);
  const stockPorConfirmar = lineas.some((l) => !l.stockConocido);

  return {
    lineas,
    rechazadas,
    totales: { subtotal, descuento: cupon.descuento, envio: envio.costo, total, neto, iva },
    cuponCodigo: cupon.cupon?.codigo ?? null,
    cuponMotivo: cupon.motivo,
    envio,
    stockPorConfirmar,
    sePuedeCobrar: subtotal > 0 && !envio.porConfirmar && !stockPorConfirmar
  };
}

export interface ResultadoCrear {
  ok: boolean;
  repetido?: boolean;
  pedido?: PedidoConItems;
  error?: string;
  problemas?: Array<{ productoId: string; pedidas: number; quedan: number }>;
  cuponMotivo?: string;
  /** El total subió entre la pantalla y el pedido: hay que volver a enseñarlo. */
  totalCambio?: { esperaba: number; ahora: number };
}

async function numeroNuevo(): Promise<string> {
  const año = new Date().getFullYear();
  const n = await siguiente(`pedidos:${año}`);
  return `ECN-${año}-${String(n).padStart(5, "0")}`;
}

export async function crear(datos: {
  items: Array<{ productoId: string; cantidad: number }>;
  /** Lo que el checkout tenía en pantalla. Solo sirve para frenar, no para fijar. */
  totalEsperado?: number;
  contacto: { nombre: string; correo: string; telefono?: string | null };
  /** Cuándo aceptó las condiciones de compra. */
  terminosEn?: Date;
  despacho: DatosDespacho;
  documento: { tipo: "BOLETA" | "FACTURA"; rut?: string | null; razonSocial?: string | null; giro?: string | null; direccion?: string | null };
  cupon?: string | null;
  carritoId?: string | null;
  idempotencia?: string | null;
}): Promise<ResultadoCrear> {
  if (datos.idempotencia) {
    const previo = await buscarPorIdempotencia(datos.idempotencia);
    if (previo) return { ok: true, repetido: true, pedido: previo };
  }

  const cuenta = await calcular({
    items: datos.items,
    despacho: datos.despacho,
    cupon: datos.cupon,
    correo: datos.contacto.correo
  });

  if (!cuenta.lineas.length) {
    return { ok: false, error: "No hay nada que se pueda comprar en el carrito." };
  }

  const reserva = await reservarStock(cuenta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })));
  if (!reserva.ok) {
    return { ok: false, error: "Se acabó el stock de algún equipo mientras comprabas.", problemas: reserva.problemas };
  }

  /* El cupón se consume aquí, no al validarlo. Si ya no queda, se sigue sin él. */
  let cuponCodigo = cuenta.cuponCodigo;
  let cuponMotivo = cuenta.cuponMotivo;
  let totales = cuenta.totales;

  if (cuponCodigo) {
    const cupon = await aplicarCupon({ codigo: cuponCodigo, subtotal: totales.subtotal, correo: datos.contacto.correo });
    const entro = cupon.cupon ? await consumir(cupon.cupon, datos.contacto.correo) : false;
    if (!entro) {
      cuponCodigo = null;
      cuponMotivo = "El cupón se agotó justo antes de cerrar el pedido.";
      const sinCupon = await calcular({ items: datos.items, despacho: datos.despacho, cupon: null, correo: datos.contacto.correo });
      totales = sinCupon.totales;
    }
  }

  /**
   * **Nunca se cobra más de lo que la persona vio.**
   *
   * Entre que el checkout enseñó el total y llega el pedido puede pasar algo
   * —el caso real es un cupón que se agota justo en medio— y el total sube. El
   * pedido se creaba con el total nuevo y se mandaba a la pasarela en la misma
   * petición: el cliente veía un importe en pantalla y la pasarela le pedía
   * otro. En Chile el precio exhibido obliga (Ley 19.496), así que eso no es
   * un detalle de experiencia.
   *
   * `totalEsperado` es lo único que se acepta del navegador sobre dinero, y
   * solo puede hacer una cosa: **impedir la venta**. Nunca fija un precio, así
   * que mandarlo manipulado no sirve para pagar menos, solo para no comprar.
   * Si baja, se sigue: cobrar menos de lo enseñado no perjudica a nadie.
   */
  if (datos.totalEsperado !== undefined && totales.total > datos.totalEsperado) {
    /* El stock ya está reservado en este punto: si no se devuelve, quedan
       unidades retenidas por un pedido que nunca existió, y eso son ventas
       que no se pueden hacer hasta que caduque algo que no hay. */
    await liberarStock(cuenta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })));
    return {
      ok: false,
      error: "El total cambió antes de cerrar el pedido. Revísalo antes de pagar.",
      cuponMotivo,
      totalCambio: { esperaba: datos.totalEsperado, ahora: totales.total }
    };
  }

  const estado = cuenta.sePuedeCobrar ? "PENDIENTE_PAGO" : "POR_CONFIRMAR";
  const numero = await numeroNuevo();

  try {
    const pedido = await crearPedido({
      numero,
      estado,
      subtotal: totales.subtotal,
      descuento: totales.descuento,
      envio: totales.envio,
      total: totales.total,
      neto: totales.neto,
      iva: totales.iva,
      cuponCodigo,
      contactoNombre: datos.contacto.nombre,
      contactoCorreo: datos.contacto.correo,
      contactoTelefono: datos.contacto.telefono ?? null,
      despachoModo: datos.despacho.modo,
      despachoRegion: datos.despacho.region ?? null,
      despachoComuna: datos.despacho.comuna ?? null,
      despachoDireccion: datos.despacho.direccion ?? null,
      despachoNotas: datos.despacho.notas ?? null,
      /* Fecha de aceptación de las condiciones: la prueba, si alguien reclama. */
      terminosEn: datos.terminosEn ?? new Date(),
      documentoTipo: datos.documento.tipo,
      rut: datos.documento.rut ?? null,
      razonSocial: datos.documento.razonSocial ?? null,
      giro: datos.documento.giro ?? null,
      direccionFactura: datos.documento.direccion ?? null,
      stockPorConfirmar: cuenta.stockPorConfirmar,
      envioPorConfirmar: cuenta.envio.porConfirmar,
      pagoEstado: estado === "PENDIENTE_PAGO" ? "pendiente" : "no-corresponde",
      pagoMonto: totales.total,
      idempotencia: datos.idempotencia ?? null,
      ...(datos.carritoId ? { carrito: { connect: { id: datos.carritoId } } } : {}),
      caducaEn: estado === "PENDIENTE_PAGO" ? new Date(Date.now() + env.PAGO_CADUCA_HORAS * 3600 * 1000) : null,
      items: {
        create: cuenta.lineas.map((l) => ({
          productoId: l.productoId,
          nombre: l.nombre,
          precio: l.precio,
          cantidad: l.cantidad,
          condicion: l.condicion
        }))
      },
      eventos: { create: [{ estado, nota: "Pedido creado" }] }
    });

    logger.info({ numero, estado, total: totales.total }, "pedido creado");
    return { ok: true, pedido, cuponMotivo };
  } catch (error) {
    /* Si el pedido no llegó a existir, el stock no se queda reservado. */
    await liberarStock(cuenta.lineas.map((l) => ({ productoId: l.productoId, cantidad: l.cantidad })));
    if (cuponCodigo) await devolver(cuponCodigo, datos.contacto.correo);
    throw error;
  }
}

export interface ResultadoPago {
  ok: boolean;
  repetido?: boolean;
  motivo?: string;
  pedido?: PedidoConItems;
}

/** Marca pagado una sola vez y comprueba que el monto cuadre con el nuestro. */
export async function marcarPagado(
  numero: string,
  pago: { metodo: string; referencia?: string | null; monto: number; bruto?: unknown }
): Promise<ResultadoPago> {
  const pedido = await buscarPedido(numero);
  if (!pedido) return { ok: false, motivo: "no existe el pedido" };
  if (pedido.estado === "PAGADO") return { ok: true, repetido: true, pedido };

  const primero = await tomarPagoUnaVez(numero);
  if (!primero) {
    /**
     * Otro proceso ya tomó este pago. Puede haber terminado —y entonces el
     * pedido está PAGADO— o estar a medias: una pasarela reintenta el webhook
     * en milisegundos y las tres llegadas se pisan.
     *
     * Leer y contestar «no» sin esperar era decirle a la pasarela que el pago
     * falló cuando en realidad se estaba aplicando: reintento en bucle, y un
     * pedido bueno acabando en REVISAR. Se espera un poco a que el que ganó
     * termine, y si no termina se dice que sigue en curso, no que falló.
     */
    for (let intento = 0; intento < 10; intento++) {
      const actual = await buscarPedido(numero);
      if (actual?.estado === "PAGADO") return { ok: true, repetido: true, pedido: actual };
      if (actual && actual.estado !== "PENDIENTE_PAGO" && actual.estado !== "POR_CONFIRMAR") {
        /* Terminó en otra cosa (descuadre → REVISAR): eso ya no es repetición. */
        return { ok: false, motivo: `el pago terminó en ${actual.estado}`, pedido: actual };
      }
      await new Promise((listo) => setTimeout(listo, 50));
    }
    logger.warn({ numero }, "pago en curso por otro proceso: no se confirma todavía");
    return { ok: false, motivo: "pago en curso", pedido: await buscarPedido(numero) ?? pedido };
  }

  if (Math.round(pago.monto) !== pedido.total) {
    const revisar = await actualizarPedido(numero, {
      estado: "REVISAR",
      pagoEstado: "descuadre",
      pagoMetodo: pago.metodo,
      pagoReferencia: pago.referencia ?? null,
      pagoBruto: (pago.bruto ?? null) as never
    });
    await registrarEvento(numero, "REVISAR", `El monto pagado (${pago.monto}) no cuadra con el del pedido (${pedido.total}).`);
    logger.error({ numero, pagado: pago.monto, pedido: pedido.total }, "descuadre de monto");
    return { ok: false, motivo: "descuadre de monto", pedido: revisar };
  }

  const pagado = await actualizarPedido(numero, {
    estado: "PAGADO",
    pagoEstado: "pagado",
    pagoMetodo: pago.metodo,
    pagoReferencia: pago.referencia ?? null,
    pagoMonto: Math.round(pago.monto),
    pagoFecha: new Date(),
    pagoBruto: (pago.bruto ?? null) as never,
    caducaEn: null
  });
  /* Lo apartado sale del inventario. Idempotente: si ya se consumió, no repite. */
  const consumido = await consumirStockDePedido(numero);
  await registrarEvento(numero, "PAGADO", consumido ? `${pago.metodo} · stock descontado` : pago.metodo);
  logger.info({ numero, metodo: pago.metodo, consumido }, "pedido pagado");
  return { ok: true, pedido: pagado };
}

/**
 * Cambia el estado de un pedido respetando la máquina de estados.
 *
 * Tres garantías:
 *  · una transición que no está escrita no ocurre;
 *  · repetir la misma no vuelve a ejecutar su efecto (anular dos veces no
 *    libera dos veces el stock);
 *  · el efecto sobre el stock lo decide el estado al que se entra, no quien
 *    llama.
 */
export async function cambiarEstado(
  numero: string,
  estado: PedidoConItems["estado"],
  nota = ""
): Promise<PedidoConItems | null> {
  const pedido = await buscarPedido(numero);
  if (!pedido) return null;

  const paso = puedePasar(pedido.estado, estado);
  if (!paso.ok) {
    logger.warn({ numero, desde: pedido.estado, hasta: estado }, "transición de estado no permitida");
    throw transicionInvalida(paso.motivo);
  }
  if (paso.repetida) return pedido;

  if (LIBERAN_STOCK.includes(estado)) await liberarStockDePedido(numero);
  if (CONSUMEN_STOCK.includes(estado)) await consumirStockDePedido(numero);

  const actualizado = await actualizarPedido(numero, {
    estado,
    ...(LIBERAN_STOCK.includes(estado) ? { caducaEn: null } : {}),
    /**
     * Marcar PAGADO a mano —una transferencia, un pago en tienda— dejaba el
     * pedido «pagado» con `pagoEstado: "pendiente"` y sin fecha: dos campos
     * que se contradicen, y el que mira el pago ve que no está pagado. Se
     * anota como lo que es, **a mano**, sin inventar un método ni una
     * referencia que no existen. Lo señaló una auditoría externa.
     */
    ...(estado === "PAGADO" && pedido.pagoEstado !== "pagado"
      ? { pagoEstado: "pagado", pagoMetodo: pedido.pagoMetodo ?? "manual", pagoFecha: new Date() }
      : {}),
    /* Y al revés: anulado o devuelto, el pago deja de estar «pendiente». */
    ...(LIBERAN_STOCK.includes(estado) && pedido.pagoEstado === "pendiente"
      ? { pagoEstado: "no-corresponde" }
      : {})
  });
  await registrarEvento(numero, estado, nota);
  return actualizado;
}

/** Consulta pública: hace falta el número Y el correo. */
export async function seguir(numero: string, correo: string) {
  const pedido = await buscarPedido(numero);
  if (!pedido) return null;
  if (pedido.contactoCorreo.toLowerCase() !== correo.trim().toLowerCase()) return null;

  return {
    numero: pedido.numero,
    estado: pedido.estado,
    creado: pedido.creado,
    items: pedido.items.map((i) => ({ nombre: i.nombre, cantidad: i.cantidad })),
    totales: { subtotal: pedido.subtotal, descuento: pedido.descuento, envio: pedido.envio, total: pedido.total },
    despacho: { modo: pedido.despachoModo, region: pedido.despachoRegion },
    porConfirmar: { stock: pedido.stockPorConfirmar, envio: pedido.envioPorConfirmar }
  };
}

export { buscarPedido };
