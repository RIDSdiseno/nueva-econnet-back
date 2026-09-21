/**
 * El marco común de los correos transaccionales: cabecera, tarjeta blanca,
 * botón y pie con la dirección.
 *
 * Vive aparte porque ya estaba copiado en dos ficheros y este era el tercero.
 * Tres copias del mismo maquetado es donde empieza la deriva: se arregla el
 * ancho en uno y los otros dos se quedan rotos en Outlook.
 */
import { escapar } from "./texto.js";

export const PIE = "Econnet · La Concepción 65, oficina 1003, Providencia, Santiago · 08:30 a 18:00";

export const p = (t: string) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#35415F">${t}</p>`;
export const chico = (t: string) => `<p style="margin:0 0 12px;font-size:13.5px;line-height:1.55;color:#5A6683">${t}</p>`;

export interface Cta {
  texto: string;
  url: string;
}

export function marco(opciones: {
  titulo: string;
  bloques: string[];
  cta?: Cta | null;
  /** Lo que va dentro de la tarjeta, debajo del botón (WhatsApp, avisos). */
  extra?: string;
  /** Lo que va fuera, en letra pequeña (baja, motivo por el que recibe esto). */
  pie?: string;
}): string {
  const { titulo, bloques, cta, extra, pie } = opciones;
  return `<!doctype html><html lang="es-CL"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)}</title></head>
<body style="margin:0;background:#F4F6FA;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#16203A">
<div style="max-width:560px;margin:0 auto;padding:28px 20px">
  <div style="font-size:19px;font-weight:700;letter-spacing:-.03em;margin-bottom:22px">econnet</div>
  <div style="background:#fff;border:1px solid #E2E8F4;border-radius:16px;padding:26px 24px">
    <h1 style="margin:0 0 14px;font-size:21px;line-height:1.25">${escapar(titulo)}</h1>
    ${bloques.join("\n")}
    ${cta ? `<p style="margin:24px 0 4px"><a href="${cta.url}" style="display:inline-block;background:#2B6BFF;color:#fff;text-decoration:none;font-weight:600;font-size:15px;padding:13px 24px;border-radius:999px">${escapar(cta.texto)}</a></p>` : ""}
    ${extra ?? ""}
  </div>
  <p style="font-size:12px;line-height:1.6;color:#7A85A0;margin:18px 2px 0">
    ${PIE}${pie ? `<br>${pie}` : ""}
  </p>
</div>
</body></html>`;
}
