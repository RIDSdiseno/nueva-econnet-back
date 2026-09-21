/**
 * Los correos de captación y la secuencia de carrito abandonado.
 *
 * Regla de esta carpeta: cada correo tiene que valer por sí solo aunque nadie
 * compre. Si solo dice «oye, que te dejaste esto», no se manda: eso es ruido,
 * y el ruido lo paga la reputación del dominio.
 */
import { clp } from "./dinero.js";
import { escapar } from "./texto.js";
import type { Mensaje } from "./correo.js";
import { ajuste } from "./ajustes.js";

const PIE = "Econnet · La Concepción 65, oficina 1003, Providencia, Santiago · 08:30 a 18:00";

export interface Enlaces {
  sitio: string;
  baja: string;
  parar: string | null;
  carrito: string;
  guia: string;
  whatsapp: string;
}

export interface ProductoCorreo {
  marca: string;
  nombre: string;
  condicion: string | null;
  precioVenta: number | null;
  ram: string | null;
  almacenamiento: string | null;
  gpu: string | null;
  so: string | null;
  /* Pueden faltar: un equipo recién dado de alta todavía no los tiene escritos. */
  para: string | null;
  noPara: string | null;
}

export const TEXTO_CONSENTIMIENTO =
  "Acepto recibir correos de Econnet con recomendaciones y ofertas, y sé que puedo darme de baja en cualquier momento.";

export const TRADUCE: Record<string, string> = {
  ram: "Cuántas cosas puedes tener abiertas a la vez sin que se ponga lento.",
  almacenamiento: "Cuánto cabe y qué tan rápido abre. NVMe es el rápido.",
  gpu: "Quién dibuja: juego, 3D y edición. Si no haces eso, no la necesitas."
};

const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#35415F">${t}</p>`;
const chico = (t: string) => `<p style="margin:0 0 12px;font-size:13.5px;line-height:1.55;color:#5A6683">${t}</p>`;

function marco(opciones: { titulo: string; bloques: string[]; enlaces: Enlaces; cta?: { texto: string; url: string } | null }): string {
  const { titulo, bloques, enlaces, cta } = opciones;
  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)}</title></head>
<body style="margin:0;background:#F4F6FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16203A">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <div style="font-size:19px;font-weight:700;letter-spacing:-.03em;margin-bottom:22px">econnet</div>
  <div style="background:#fff;border:1px solid #E2E8F4;border-radius:16px;padding:26px 24px">
    <h1 style="margin:0 0 14px;font-size:21px;line-height:1.25">${escapar(titulo)}</h1>
    ${bloques.join("\n")}
    ${cta ? `<p style="margin:24px 0 4px"><a href="${cta.url}" style="display:inline-block;background:#2B6BFF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:999px">${escapar(cta.texto)}</a></p>` : ""}
    ${enlaces.whatsapp ? `<p style="margin:14px 0 0;font-size:14px;color:#5A6683">¿Prefieres preguntar? <a href="${enlaces.whatsapp}" style="color:#2B6BFF">Escríbenos por WhatsApp</a>.</p>` : ""}
  </div>
  <p style="font-size:12px;line-height:1.6;color:#7A85A0;margin:18px 2px 0">
    ${PIE}<br>Recibes esto porque dejaste tu correo en econnet.cl.
    ${enlaces.parar ? `<a href="${enlaces.parar}" style="color:#7A85A0">Parar los avisos de este carrito</a> · ` : ""}
    <a href="${enlaces.baja}" style="color:#7A85A0">Darme de baja de todos los correos</a>
  </p>
</div></body></html>`;
}

const textoPlano = (lineas: Array<string | null>, enlaces: Enlaces): string =>
  lineas.filter(Boolean).join("\n\n") +
  `\n\n—\n${PIE}` +
  (enlaces.parar ? `\nParar los avisos de este carrito: ${enlaces.parar}` : "") +
  `\nDarse de baja de todos los correos: ${enlaces.baja}`;

function ficha(prod: ProductoCorreo): string {
  const precio = prod.precioVenta ? clp(prod.precioVenta) : "precio por confirmar";
  const specs = [prod.ram, prod.almacenamiento, prod.so].filter(Boolean).join(" · ");
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:6px 0 16px"><tr>
  <td style="border:1px solid #E2E8F4;border-radius:12px;padding:14px 16px">
    <div style="font-size:15px;font-weight:600">${escapar(`${prod.marca} ${prod.nombre}`)}</div>
    <div style="font-size:13px;color:#5A6683;margin-top:3px">${escapar(specs)}</div>
    <div style="font-size:17px;font-weight:700;margin-top:8px">${precio}</div>
    ${prod.condicion ? `<div style="font-size:12px;color:#5A6683;margin-top:4px">Condición: ${escapar(prod.condicion)}</div>` : ""}
  </td></tr></table>`;
}

export function bienvenida(enlaces: Enlaces): Mensaje {
  const titulo = `Tu ${ajuste("CUPON_BIENVENIDA") ? "10%" : "descuento"} de bienvenida`;
  return {
    para: "",
    asunto: titulo,
    html: marco({
      titulo,
      enlaces,
      bloques: [
        p(`Acá está: <b>${escapar(ajuste("CUPON_BIENVENIDA"))}</b>. Se usa en el carrito y vale para tu primera compra.`),
        p("Y ya que estás: lo que hacemos distinto no es el precio, es decirte <b>para quién no es</b> cada equipo. Si nos cuentas qué haces en el día, te decimos cuál te sirve — y cuál te sobra."),
        chico("Si te escribimos, será una vez por semana como mucho, y siempre con algo dentro.")
      ],
      cta: { texto: "Ver los equipos", url: enlaces.sitio }
    }),
    texto: textoPlano([titulo, `Cupón: ${ajuste("CUPON_BIENVENIDA")}`, enlaces.sitio], enlaces)
  };
}

export function guia(enlaces: Enlaces): Mensaje {
  const titulo = "Tu guía: cómo elegir sin saber de especificaciones";
  return {
    para: "",
    asunto: titulo,
    html: marco({
      titulo,
      enlaces,
      bloques: [
        p("Está dentro del enlace y se lee en diez minutos: qué significa cada especificación en tu día real, qué pedir según lo que hagas y los cuatro errores que hacen que un equipo se quede corto al segundo año."),
        p("No hay que registrarse para leerla y se puede reenviar a quien la necesite.")
      ],
      cta: { texto: "Abrir la guía", url: enlaces.guia }
    }),
    texto: textoPlano([titulo, `Guía: ${enlaces.guia}`], enlaces)
  };
}

export function resultadoTest(enlaces: Enlaces, recomendados: ProductoCorreo[]): Mensaje {
  const titulo = "Tus tres equipos, por escrito";
  return {
    para: "",
    asunto: titulo,
    html: marco({
      titulo,
      enlaces,
      bloques: [
        p("Para que no dependa de que te acuerdes:"),
        ...recomendados.map(ficha),
        chico("Si ninguno te convence, respóndeme a este correo y te busco otra cosa. Va a una persona, no a un buzón.")
      ],
      cta: { texto: "Ver el detalle", url: enlaces.sitio }
    }),
    texto: textoPlano([titulo, ...recomendados.map((r) => `- ${r.marca} ${r.nombre}`)], enlaces)
  };
}

export function cotizacionRecibida(enlaces: Enlaces, resumen: string): Mensaje {
  const titulo = "Recibimos tu cotización";
  return {
    para: "",
    asunto: titulo,
    html: marco({
      titulo,
      enlaces,
      bloques: [p("Esto es lo que nos dijiste:"), chico(escapar(resumen)), p("Te llega la propuesta con modelos, plazos y factura en <b>24 horas hábiles</b>.")],
      cta: null
    }),
    texto: textoPlano([titulo, resumen, "Propuesta en 24 horas hábiles."], enlaces)
  };
}

/* ---------------------------------------------- carrito abandonado ------- */

export interface ContextoSecuencia {
  dia: number;
  prod: ProductoCorreo | null;
  alternativas: ProductoCorreo[];
  enlaces: Enlaces;
}

export const DIAS_SECUENCIA = 7;

export function correoDeSecuencia(ctx: ContextoSecuencia): Mensaje | null {
  const { dia, prod, alternativas, enlaces } = ctx;
  const nombre = prod ? `${prod.marca} ${prod.nombre}` : "carrito";

  const piezas: Record<number, { asunto: string; titulo: string; bloques: string[]; cta: { texto: string; url: string } | null }> = {
    1: {
      asunto: `Te guardamos el ${nombre}`,
      titulo: "Te lo guardamos",
      bloques: [
        p("Sigue reservado en tu carrito. Antes de que decidas, lo que no dice la ficha:"),
        prod ? ficha(prod) : "",
        prod?.para ? p(`<b>Para quién es:</b> ${escapar(prod.para)}`) : "",
        prod?.noPara ? chico(`<b>Para quién no es:</b> ${escapar(prod.noPara)}`) : "",
        p("Si estás entre dos, dinos cuál es el otro y te decimos cuál conviene. Incluso si es el más barato.")
      ],
      cta: { texto: "Volver al carrito", url: enlaces.carrito }
    },
    2: {
      asunto: "Qué significa, en tu día, lo que lleva dentro",
      titulo: "La ficha técnica, traducida",
      bloques: [
        prod?.ram ? p(`<b>${escapar(prod.ram)}</b> — ${escapar(TRADUCE.ram ?? "")}`) : "",
        prod?.almacenamiento ? p(`<b>${escapar(prod.almacenamiento)}</b> — ${escapar(TRADUCE.almacenamiento ?? "")}`) : "",
        prod?.gpu ? p(`<b>${escapar(prod.gpu)}</b> — ${escapar(TRADUCE.gpu ?? "")}`) : "",
        p("Si algo de esto te sobra, hay una versión más barata que hace lo mismo para lo que tú haces. Pregúntanos y te la decimos.")
      ],
      cta: { texto: "Ver el equipo", url: enlaces.carrito }
    },
    3: {
      asunto: "Dos alternativas, por si el tuyo no era",
      titulo: "Dos alternativas",
      bloques: [
        p("Una más económica y una con más músculo. Mismo criterio: lo que sirve para lo que haces."),
        ...alternativas.map(ficha),
        chico("Si ninguna encaja, respóndenos con lo que necesitas y lo buscamos en el catálogo completo.")
      ],
      cta: { texto: "Comparar los tres", url: enlaces.carrito }
    },
    4: {
      asunto: "Nuevo, openbox o reacondicionado: qué cambia de verdad",
      titulo: "La condición, dicha por delante",
      bloques: [
        p("<b>Nuevo</b>: sellado, garantía completa de marca.<br><b>Openbox</b>: caja abierta, equipo sin uso.<br><b>Reacondicionado</b>: revisado y probado, con uso previo.<br><b>Seminuevo</b>: uso mínimo, estética con detalles."),
        prod?.condicion ? p(`El que tienes en el carrito es <b>${escapar(prod.condicion)}</b>.`) : p("La condición de cada equipo va escrita en su ficha, antes del precio."),
        chico("Todo sale con garantía y con boleta o factura a nombre de tu empresa si la necesitas.")
      ],
      cta: { texto: "Volver al carrito", url: enlaces.carrito }
    },
    5: {
      asunto: "Factura, cuotas y despacho",
      titulo: "Las tres preguntas de siempre",
      bloques: [
        p("<b>¿Factura?</b> Sí, a nombre de tu empresa, y sirve para el crédito fiscal."),
        p("<b>¿Cómo se paga?</b> Webpay, Mercado Pago o transferencia. Las cuotas las pone tu banco en el checkout."),
        p("<b>¿Y el despacho?</b> A todo Chile. Te confirmamos el plazo antes de cobrarte, no después."),
        chico("¿Son varios equipos? Ahí conviene cotizar: por volumen el precio cambia.")
      ],
      cta: { texto: "Terminar la compra", url: enlaces.carrito }
    },
    6: {
      asunto: "¿Sigue en pie?",
      titulo: "¿Sigue en pie?",
      bloques: [
        p("Es una pregunta de verdad. Si ya compraste en otro lado o cambiaste de idea, dilo y paramos los avisos hoy mismo."),
        p("Y si lo que pasa es que hay algo que no te cuadra (el precio, el plazo, la condición del equipo), dínoslo: eso sí lo podemos mirar.")
      ],
      cta: { texto: "Sigo interesado", url: enlaces.carrito }
    },
    7: {
      asunto: "Último por este carrito",
      titulo: "Este es el último",
      bloques: [
        p("No te escribimos más por este carrito. Queda guardado por si lo retomas, y si necesitas ayuda para elegir, ahí seguimos."),
        chico("Si te sirve, quédate con la idea central: no compres por especificaciones, compra por lo que vas a hacer con el equipo.")
      ],
      cta: { texto: "Ver el carrito", url: enlaces.carrito }
    }
  };

  const pieza = piezas[dia];
  if (!pieza) return null;

  return {
    para: "",
    asunto: pieza.asunto,
    html: marco({ titulo: pieza.titulo, bloques: pieza.bloques.filter(Boolean), enlaces, cta: pieza.cta }),
    texto: textoPlano([pieza.asunto, pieza.titulo, enlaces.carrito], enlaces)
  };
}
