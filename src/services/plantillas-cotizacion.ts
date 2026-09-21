/**
 * Los correos de una cotización de empresa.
 *
 * Son transaccionales —los pidió la empresa— pero los recordatorios rozan lo
 * comercial, así que llevan baja igual. Cuesta menos una baja que una queja.
 *
 * El criterio de los tres recordatorios: cada uno tiene que **aportar algo**
 * (una alternativa, la fecha de caducidad, una salida limpia). Un «¿lo viste?»
 * repetido tres veces es lo que hace que te marquen como spam.
 */
import { clp } from "./dinero.js";
import { escapar } from "./texto.js";
import { chico, marco, p, PIE } from "./plantillas-marco.js";
import type { Mensaje } from "./correo.js";
import type { Propuesta } from "./propuestas.service.js";

export interface EnlacesCotizacion {
  ver: string;
  aceptar: string;
  baja: string;
  whatsapp: string;
}

const fecha = (d: Date): string => d.toLocaleDateString("es-CL", { day: "2-digit", month: "long", year: "numeric" });

function tabla(propuesta: Propuesta): string {
  const filas = propuesta.lineas
    .map(
      (l) => `<tr><td style="padding:8px 0;font-size:14px">
        ${escapar(l.nombre)} × ${l.cantidad}
        ${l.condicion ? `<br><span style="font-size:12px;color:#5A6683">Condición: ${escapar(l.condicion.toLowerCase())}</span>` : `<br><span style="font-size:12px;color:#9A7B2F">Condición por confirmar</span>`}
      </td>
      <td style="padding:8px 0;text-align:right;font-size:14px;vertical-align:top">${clp(l.importe)}</td></tr>`
    )
    .join("");

  const linea = (n: string, v: string) =>
    `<tr><td style="padding:4px 0;font-size:13.5px;color:#5A6683">${n}</td><td style="padding:4px 0;text-align:right;font-size:13.5px">${v}</td></tr>`;

  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:10px 0 14px">
  ${filas}
  <tr><td colspan="2" style="border-top:1px solid #E2E8F4;padding-top:8px"></td></tr>
  ${linea("Subtotal", clp(propuesta.subtotal))}
  ${propuesta.descuento ? linea(`Descuento por volumen (${propuesta.descuentoPorcentaje}%)`, `− ${clp(propuesta.descuento)}`) : ""}
  ${linea("Neto", clp(propuesta.neto))}
  ${linea("IVA 19%", clp(propuesta.iva))}
  <tr><td style="padding:8px 0;font-weight:700">Total con IVA</td>
      <td style="padding:8px 0;text-align:right;font-weight:700">${clp(propuesta.total)}</td></tr>
</table>`;
}

function huecos(propuesta: Propuesta): string {
  if (!propuesta.huecos.length) return "";
  return `<div style="border:1px solid #F0D9A8;background:#FDF7EA;border-radius:12px;padding:14px 16px;margin:4px 0 14px">
    <div style="font-size:13px;font-weight:600;color:#8A6A1F;margin-bottom:6px">Lo que falta por cerrar</div>
    ${propuesta.huecos.map((h) => `<div style="font-size:13px;color:#6B5A2E;line-height:1.5">· ${escapar(h)}</div>`).join("")}
  </div>`;
}

/* El pie lleva el remitente en texto plano a propósito: un transaccional sin
   quién lo manda no sale de aquí (lo comprueba `comprobarPieza`). */
const pieTexto = (enlaces: EnlacesCotizacion): string =>
  `\n\n—\n${PIE}\nVer la cotización: ${enlaces.ver}\nDarse de baja: ${enlaces.baja}`;

export function propuestaEnviada(
  numero: string,
  propuesta: Propuesta,
  enlaces: EnlacesCotizacion,
  empresa?: string | null
): Mensaje {
  const titulo = `Tu cotización ${numero}`;
  const alternativas = propuesta.alternativas.length
    ? chico(
        `Si prefieres otra opción: ${propuesta.alternativas
          .map((a) => `<b>${escapar(a.nombre)}</b> (${clp(a.precioUnitario)} por equipo)`)
          .join(" o ")}. Se cambia con un correo.`
      )
    : "";

  return {
    para: "",
    asunto: `${titulo}${empresa ? ` · ${empresa}` : ""}`,
    transaccional: true,
    html: marco({
      titulo,
      bloques: [
        p(
          `Acá está, con modelos concretos y precios de hoy. Perfil <b>${escapar(propuesta.etiquetaPerfil)}</b>, ${propuesta.lineas[0]?.cantidad ?? 0} equipos.`
        ),
        tabla(propuesta),
        huecos(propuesta),
        alternativas,
        chico(`Los precios valen hasta el <b>${fecha(propuesta.validaHasta)}</b>. Después hay que rehacerla: el dólar manda.`),
        chico("Incluye factura a nombre de tu empresa y garantía. El plazo de entrega lo confirmamos al aceptar.")
      ].filter(Boolean),
      cta: { texto: "Aceptar esta cotización", url: enlaces.aceptar },
      extra: enlaces.whatsapp
        ? `<p style="margin:14px 0 0;font-size:14px;color:#5A6683">¿Quieres ajustar algo antes? <a href="${enlaces.whatsapp}" style="color:#2B6BFF">Escríbenos por WhatsApp</a>.</p>`
        : "",
      pie: "Recibes esto porque pediste una cotización en econnet.cl."
    }),
    texto:
      `${titulo}\n\nPerfil ${propuesta.etiquetaPerfil} · ${propuesta.lineas[0]?.cantidad ?? 0} equipos\n\n` +
      propuesta.lineas.map((l) => `· ${l.nombre} × ${l.cantidad} — ${clp(l.importe)}`).join("\n") +
      `\n\nNeto ${clp(propuesta.neto)} · IVA ${clp(propuesta.iva)} · Total ${clp(propuesta.total)}` +
      (propuesta.huecos.length ? `\n\nPor cerrar:\n${propuesta.huecos.map((h) => `· ${h}`).join("\n")}` : "") +
      `\n\nVálida hasta el ${fecha(propuesta.validaHasta)}.\nAceptar: ${enlaces.aceptar}` +
      pieTexto(enlaces)
  };
}

/** Los tres recordatorios. Cada uno trae algo nuevo o no se manda. */
export function recordatorio(
  paso: number,
  numero: string,
  propuesta: Propuesta,
  enlaces: EnlacesCotizacion
): Mensaje | null {
  const comun = { para: "", bajaUrl: enlaces.baja };

  if (paso === 1) {
    const titulo = `¿Te sirve la ${numero}, o la ajustamos?`;
    return {
      ...comun,
      asunto: titulo,
      html: marco({
        titulo,
        bloques: [
          p("Dos cosas que suelen cambiar una cotización de empresa, por si te sirven:"),
          p(
            "<b>Bajar la condición.</b> En parques de diez o más, pasar a openbox o reacondicionado baja bastante el costo por puesto, y va con su condición declarada y su garantía."
          ),
          p("<b>Partir por tandas.</b> No hace falta cambiar todo de golpe: se renueva por áreas y se reparte el gasto."),
          chico(`Si prefieres que lo veamos por teléfono, responde a este correo con un horario.`)
        ],
        cta: { texto: "Ver la cotización", url: enlaces.ver },
        pie: "Recibes esto porque pediste una cotización en econnet.cl."
      }),
      texto: `${titulo}\n\nEn parques de diez o más, bajar la condición o renovar por tandas cambia el número.${pieTexto(enlaces)}`
    };
  }

  if (paso === 2) {
    const titulo = `La ${numero} vence el ${fecha(propuesta.validaHasta)}`;
    return {
      ...comun,
      asunto: titulo,
      html: marco({
        titulo,
        bloques: [
          p(
            `No es una táctica: los precios de esta cotización son los del día que la pedimos y el dólar los mueve. Después de esa fecha hay que rehacerla, y puede subir o bajar.`
          ),
          p(`Total con IVA: <b>${clp(propuesta.total)}</b>.`),
          chico("Si necesitas más tiempo, dilo y la reemitimos sin problema.")
        ],
        cta: { texto: "Aceptar esta cotización", url: enlaces.aceptar },
        pie: "Recibes esto porque pediste una cotización en econnet.cl."
      }),
      texto: `${titulo}\n\nTotal con IVA ${clp(propuesta.total)}.\nAceptar: ${enlaces.aceptar}${pieTexto(enlaces)}`
    };
  }

  if (paso === 3) {
    const titulo = "¿La archivamos?";
    return {
      ...comun,
      asunto: titulo,
      html: marco({
        titulo,
        bloques: [
          p(
            `Es el último correo por la ${escapar(numero)}. Si el proyecto se movió de fecha o eligieron otra cosa, está perfecto: nos dices y la archivamos sin insistir más.`
          ),
          p("Y si vuelve a levantarse en tres meses, la rehacemos con los precios de entonces."),
          chico("Gracias por habernos pedido el número.")
        ],
        cta: { texto: "Sigue en pie: aceptar", url: enlaces.aceptar },
        pie: "Recibes esto porque pediste una cotización en econnet.cl."
      }),
      texto: `${titulo}\n\nÚltimo correo por la ${numero}. Si eligieron otra cosa, la archivamos.${pieTexto(enlaces)}`
    };
  }

  return null;
}

/** El aviso a ventas. Lo que necesita para llamar, y nada más. */
export function avisoVentas(
  numero: string,
  propuesta: Propuesta,
  contacto: { correo: string; nombre?: string | null; empresa?: string | null; telefono?: string | null },
  destino: string,
  aceptada = false
): Mensaje {
  const titulo = aceptada ? `ACEPTADA · ${numero}` : `Cotización nueva · ${numero}`;
  return {
    para: destino,
    transaccional: true,
    asunto: `${titulo}${contacto.empresa ? ` · ${contacto.empresa}` : ""}`,
    html: marco({
      titulo,
      bloques: [
        p(
          `${escapar(contacto.nombre ?? "sin nombre")} &lt;${escapar(contacto.correo)}&gt;${contacto.telefono ? ` · ${escapar(contacto.telefono)}` : ""}`
        ),
        p(`${escapar(contacto.empresa ?? "empresa sin nombre")} · perfil ${escapar(propuesta.etiquetaPerfil)}`),
        tabla(propuesta),
        huecos(propuesta)
      ],
      pie: "Aviso interno."
    }),
    texto:
      `${titulo}\n${contacto.nombre ?? "sin nombre"} <${contacto.correo}> ${contacto.telefono ?? ""}\n` +
      `${contacto.empresa ?? "empresa sin nombre"} · ${propuesta.etiquetaPerfil}\n` +
      propuesta.lineas.map((l) => `· ${l.nombre} × ${l.cantidad} — ${clp(l.importe)}`).join("\n") +
      `\nTotal con IVA ${clp(propuesta.total)}` +
      (propuesta.huecos.length ? `\n\nPor cerrar:\n${propuesta.huecos.map((h) => `· ${h}`).join("\n")}` : "") +
      `\n\n—\n${PIE}`
  };
}
