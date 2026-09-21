/** Personas, consentimiento y enlaces firmados de los correos. */
import { env } from "../config/env.js";
import { firmar } from "./firma.js";
import { RUTAS_TIENDA } from "../config/rutas.js";
import type { Enlaces } from "./plantillas.js";
import { TEXTO_CONSENTIMIENTO } from "./plantillas.js";
import { darDeBaja, guardarLead, puedeRecibir } from "../repositories/leads.repository.js";
import { ajuste } from "./ajustes.js";

export { puedeRecibir, darDeBaja };

export const registrarLead = (datos: {
  correo: string;
  nombre?: string | null;
  origen: string;
  etiquetas?: string[];
}) => guardarLead({ ...datos, consiente: true, textoConsentimiento: TEXTO_CONSENTIMIENTO });

export function enlacesDe(correo: string, opciones: { carritoId?: string | null } = {}): Enlaces {
  const base = env.SITIO_PUBLICO;
  return {
    sitio: base,
    baja: `${base}/api/baja?t=${firmar({ a: "baja", c: correo })}`,
    parar: opciones.carritoId ? `${base}/api/baja?t=${firmar({ a: "parar", c: correo, k: opciones.carritoId })}` : null,
    carrito: opciones.carritoId ? `${base}${RUTAS_TIENDA.carrito}?c=${encodeURIComponent(opciones.carritoId)}` : base,
    guia: `${base}${RUTAS_TIENDA.guia}`,
    whatsapp: ajuste("WHATSAPP") ? `https://wa.me/${ajuste("WHATSAPP")}` : ""
  };
}
