/**
 * Cómo se ve un pedido y una cotización **desde dentro**.
 *
 * Aparte de los controladores porque son un contrato: el panel depende de
 * estas formas, y tenerlas en un sitio evita que cada ruta devuelva un pedido
 * ligeramente distinto. Y aparte de las vistas públicas porque aquí sí van el
 * teléfono, la dirección y el RUT — datos que la ficha pública no enseña.
 */
import type { Cotizacion } from "@prisma/client";
import type { PedidoConItems } from "../../repositories/pedidos.repository.js";

export function aPedidoPanel(p: PedidoConItems) {
  return {
    numero: p.numero,
    estado: p.estado,
    creado: p.creado.toISOString(),
    actualizado: p.actualizado.toISOString(),
    cliente: {
      nombre: p.contactoNombre,
      correo: p.contactoCorreo,
      telefono: p.contactoTelefono,
      rut: p.rut,
      razonSocial: p.razonSocial
    },
    despacho: {
      modo: p.despachoModo,
      region: p.despachoRegion,
      comuna: p.despachoComuna,
      direccion: p.despachoDireccion,
      notas: p.despachoNotas,
      porConfirmar: p.envioPorConfirmar
    },
    documento: p.documentoTipo,
    totales: { subtotal: p.subtotal, descuento: p.descuento, envio: p.envio, neto: p.neto, iva: p.iva, total: p.total },
    pago: { metodo: p.pagoMetodo, estado: p.pagoEstado, referencia: p.pagoReferencia, monto: p.pagoMonto, fecha: p.pagoFecha?.toISOString() ?? null },
    stock: { estado: p.stockEstado, porConfirmar: p.stockPorConfirmar },
    /* La fecha de aceptación de condiciones: es la prueba, y por eso se
       enseña donde se atiende la reclamación. */
    terminosEn: p.terminosEn?.toISOString() ?? null,
    caducaEn: p.caducaEn?.toISOString() ?? null,
    items: p.items.map((i) => ({
      productoId: i.productoId,
      nombre: i.nombre,
      precio: i.precio,
      cantidad: i.cantidad,
      condicion: i.condicion
    }))
  };
}

export function aCotizacionPanel(c: Cotizacion) {
  return {
    numero: c.numero,
    estado: c.estado,
    creado: c.creado.toISOString(),
    validaHasta: c.validaHasta.toISOString(),
    empresa: c.empresa,
    nombre: c.nombre,
    correo: c.correo,
    rut: c.rut,
    telefono: c.telefono,
    equipos: c.equipos,
    perfil: c.perfil,
    presupuesto: c.presupuesto,
    accesorios: c.accesorios,
    totales: { neto: c.neto, iva: c.iva, descuento: c.descuento, total: c.total },
    seguimiento: c.seguimiento,
    proximoCorreo: c.proximoCorreo?.toISOString() ?? null
  };
}
