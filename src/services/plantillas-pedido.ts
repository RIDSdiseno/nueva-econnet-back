/**
 * Los correos de un pedido. Transaccionales: no llevan baja porque no son
 * publicidad, pero identifican quién escribe y desde dónde.
 */
import { env } from "../config/env.js";
import { RUTAS_TIENDA } from "../config/rutas.js";
import { clp } from "./dinero.js";
import { escapar } from "./texto.js";
import type { Mensaje } from "./correo.js";
import { marco as marcoComun, p } from "./plantillas-marco.js";

export interface PedidoCorreo {
  /** Enlace firmado al seguimiento. Sin él se cae al enlace con el número. */
  urlSeguimiento?: string | null;
  numero: string;
  estado: string;
  subtotal: number;
  descuento: number;
  envio: number | null;
  total: number;
  neto: number;
  iva: number;
  documentoTipo: "BOLETA" | "FACTURA";
  despachoModo: "DESPACHO" | "RETIRO";
  despachoRegion?: string | null;
  despachoDireccion?: string | null;
  contactoNombre: string;
  contactoCorreo: string;
  contactoTelefono?: string | null;
  rut?: string | null;
  stockPorConfirmar: boolean;
  envioPorConfirmar: boolean;
  items: Array<{ nombre: string; precio: number; cantidad: number }>;
}

/** El enlace firmado al pedido. Va en todos: es lo que evita teclear nada. */
const verMiPedido = (pedido: PedidoCorreo): string =>
  pedido.urlSeguimiento
    ? `<p style="margin:14px 0 0;font-size:14px;color:#5A6683">Puedes <a href="${pedido.urlSeguimiento}" style="color:#2B6BFF">ver tu pedido cuando quieras</a>, sin teclear nada.</p>`
    : "";

function tabla(pedido: PedidoCorreo): string {
  const filas = pedido.items
    .map(
      (i) => `<tr><td style="padding:8px 0;font-size:14px">${escapar(i.nombre)} × ${i.cantidad}</td>
      <td style="padding:8px 0;text-align:right;font-size:14px">${clp(i.precio * i.cantidad)}</td></tr>`
    )
    .join("");
  const linea = (n: string, v: string) =>
    `<tr><td style="padding:4px 0;font-size:13.5px;color:#5A6683">${n}</td><td style="padding:4px 0;text-align:right;font-size:13.5px">${v}</td></tr>`;

  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:8px 0 14px">
  ${filas}
  <tr><td colspan="2" style="border-top:1px solid #E2E8F4;padding-top:8px"></td></tr>
  ${linea("Subtotal", clp(pedido.subtotal))}
  ${pedido.descuento ? linea("Descuento", `− ${clp(pedido.descuento)}`) : ""}
  ${linea("Despacho", pedido.envio === null ? "por confirmar" : pedido.envio ? clp(pedido.envio) : "sin costo")}
  <tr><td style="padding:8px 0;font-weight:700">Total</td>
      <td style="padding:8px 0;text-align:right;font-weight:700">${pedido.envio === null ? `${clp(pedido.total)} + despacho` : clp(pedido.total)}</td></tr>
  ${pedido.documentoTipo === "FACTURA" ? linea("Neto / IVA", `${clp(pedido.neto)} / ${clp(pedido.iva)}`) : ""}
</table>`;
}

const texto = (pedido: PedidoCorreo, lineas: string[]): string =>
  [
    ...lineas,
    "",
    `Pedido ${pedido.numero}`,
    ...pedido.items.map((i) => `- ${i.nombre} x${i.cantidad}: ${clp(i.precio * i.cantidad)}`),
    `Total: ${pedido.envio === null ? `${clp(pedido.total)} + despacho por confirmar` : clp(pedido.total)}`,
    "",
    "Econnet · La Concepción 65, oficina 1003, Providencia, Santiago."
  ].join("\n");

export function pedidoPorConfirmar(pedido: PedidoCorreo): Mensaje {
  const razones: string[] = [];
  if (pedido.stockPorConfirmar) razones.push("confirmar el stock con el proveedor");
  if (pedido.envioPorConfirmar) razones.push("calcular el costo del despacho a tu región");
  const titulo = `Recibimos tu pedido ${pedido.numero}`;

  return {
    para: pedido.contactoCorreo,
    transaccional: true,
    asunto: titulo,
    html: marco(titulo, [
      p(`Está anotado y <b>todavía no te hemos cobrado nada</b>. Antes tenemos que ${escapar(razones.join(" y "))}.`),
      tabla(pedido),
      p("Te escribimos con el total cerrado y el enlace de pago. Si algo no calza, respóndenos a este correo."),
      verMiPedido(pedido)
    ]),
    texto: texto(pedido, [
      titulo,
      `Todavía no te hemos cobrado nada: falta ${razones.join(" y ")}.`,
      pedido.urlSeguimiento ? `Ver tu pedido: ${pedido.urlSeguimiento}` : ""
    ])
  };
}

export function pedidoPendienteDePago(pedido: PedidoCorreo, urlPago?: string | null): Mensaje {
  const titulo = `Tu pedido ${pedido.numero} está esperando el pago`;
  return {
    para: pedido.contactoCorreo,
    transaccional: true,
    asunto: titulo,
    html: marco(
      titulo,
      [p("Lo dejamos reservado. En cuanto se acredite el pago te confirmamos el despacho."), tabla(pedido), verMiPedido(pedido)],
      urlPago ? { texto: "Pagar ahora", url: urlPago } : null
    ),
    texto: texto(pedido, [
      titulo,
      urlPago ? `Pagar: ${urlPago}` : "",
      pedido.urlSeguimiento ? `Ver tu pedido: ${pedido.urlSeguimiento}` : ""
    ])
  };
}

export function pagoRecibido(pedido: PedidoCorreo): Mensaje {
  const titulo = `Pago recibido · pedido ${pedido.numero}`;
  const retiro = pedido.despachoModo === "RETIRO";
  return {
    para: pedido.contactoCorreo,
    transaccional: true,
    asunto: titulo,
    html: marco(
      titulo,
      [
        p(
          retiro
            ? "Listo. Te avisamos en cuanto esté preparado para que lo retires en La Concepción 65, oficina 1003, Providencia."
            : "Listo. Lo preparamos y te avisamos con el seguimiento en cuanto salga."
        ),
        tabla(pedido),
        p(`Cualquier cosa, responde a este correo con el número <b>${escapar(pedido.numero)}</b>.`)
      ],
      { texto: "Ver mi pedido", url: pedido.urlSeguimiento ?? `${env.SITIO_PUBLICO}${RUTAS_TIENDA.seguimiento}?n=${encodeURIComponent(pedido.numero)}` }
    ),
    texto: texto(pedido, [titulo, retiro ? "Te avisamos cuando puedas retirarlo." : "Lo preparamos y te mandamos el seguimiento."])
  };
}

export function pedidoDespachado(pedido: PedidoCorreo, seguimiento = ""): Mensaje {
  const titulo = `Tu pedido ${pedido.numero} va en camino`;
  return {
    para: pedido.contactoCorreo,
    transaccional: true,
    asunto: titulo,
    html: marco(titulo, [p(seguimiento ? `Seguimiento: <b>${escapar(seguimiento)}</b>` : "Salió de nuestra oficina."), tabla(pedido)]),
    texto: texto(pedido, [titulo, seguimiento ? `Seguimiento: ${seguimiento}` : ""])
  };
}

export function avisoInterno(pedido: PedidoCorreo, destino: string): Mensaje {
  const entrega =
    pedido.despachoModo === "RETIRO"
      ? "Retiro en oficina"
      : `Despacho a ${pedido.despachoRegion ?? "?"} · ${pedido.despachoDireccion ?? ""}`;

  return {
    para: destino,
    transaccional: true,
    asunto: `Pedido ${pedido.numero} · ${pedido.estado} · ${clp(pedido.total)}`,
    html: marco(`Pedido ${pedido.numero}`, [
      p(`Estado: <b>${escapar(pedido.estado)}</b>`),
      tabla(pedido),
      p(`${escapar(pedido.contactoNombre)} · ${escapar(pedido.contactoCorreo)} · ${escapar(pedido.contactoTelefono ?? "sin teléfono")}`),
      p(escapar(entrega)),
      p(`Documento: ${escapar(pedido.documentoTipo)} ${escapar(pedido.rut ?? "")}`)
    ]),
    texto: texto(pedido, [`Pedido ${pedido.numero} (${pedido.estado})`, `${pedido.contactoNombre} <${pedido.contactoCorreo}>`, entrega])
  };
}

/** El marco de un pedido: mismo maquetado común, con su pie transaccional. */
function marco(titulo: string, bloques: string[], cta?: { texto: string; url: string } | null): string {
  return marcoComun({ titulo, bloques, cta, pie: "Este correo es por tu pedido, no es publicidad." });
}
