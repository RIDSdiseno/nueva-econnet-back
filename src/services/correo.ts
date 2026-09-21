/**
 * Envío de correo. Dos drivers: consola (desarrollo y pruebas) y Resend.
 *
 * Reglas que el propio código impone:
 *  · Ningún correo comercial sale sin enlace de baja (art. 28 B de la Ley
 *    19.496). La función revienta antes de enviarlo.
 *  · Un transaccional no lleva baja, pero identifica quién escribe.
 *  · Tope duro por persona y día, contado en la base de datos.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../repositories/prisma.js";
import { huella } from "./firma.js";
import { ajuste } from "./ajustes.js";

export interface Mensaje {
  para: string;
  asunto: string;
  html: string;
  texto: string;
  bajaUrl?: string | null;
  transaccional?: boolean;
}

export interface ResultadoEnvio {
  enviado: boolean;
  driver?: string;
  motivo?: string;
}

const enviados: Mensaje[] = [];
export const correosEnviados = (): readonly Mensaje[] => enviados;
export const limpiarCorreosEnviados = (): void => {
  enviados.length = 0;
};

export function comprobarPieza(mensaje: Mensaje): void {
  if (!mensaje.para) throw new Error("correo sin destinatario");
  if (!mensaje.asunto) throw new Error("correo sin asunto");
  if (!mensaje.texto) throw new Error("correo sin versión en texto plano");

  if (mensaje.transaccional) {
    if (!/Econnet/i.test(mensaje.texto)) throw new Error("correo transaccional sin remitente identificado");
    return;
  }
  if (!/baja|cese|dejar de recibir/i.test(mensaje.texto)) {
    throw new Error("correo sin enlace de baja: no sale de aquí");
  }
}

/** Tope por persona y día, atómico: el contador vive en Postgres. */
async function pasaDelTope(para: string): Promise<boolean> {
  const dia = new Date().toISOString().slice(0, 10);
  const fila = await prisma.correoDiario.upsert({
    where: { correoHash_dia: { correoHash: huella(para), dia } },
    create: { correoHash: huella(para), dia, cantidad: 1 },
    update: { cantidad: { increment: 1 } }
  });
  return fila.cantidad > env.CORREO_TOPE_DIARIO;
}

export async function enviar(mensaje: Mensaje, opciones: { saltarTope?: boolean } = {}): Promise<ResultadoEnvio> {
  comprobarPieza(mensaje);

  if (!opciones.saltarTope && !mensaje.transaccional && (await pasaDelTope(mensaje.para))) {
    logger.warn({ asunto: mensaje.asunto }, "tope diario alcanzado, no se envía");
    return { enviado: false, motivo: "tope diario" };
  }

  if (env.CORREO_DRIVER === "consola") {
    enviados.push(mensaje);
    logger.info({ asunto: mensaje.asunto }, "correo (consola)");
    return { enviado: true, driver: "consola" };
  }

  const respuesta = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: env.CORREO_REMITENTE,
      to: [mensaje.para],
      reply_to: ajuste("CORREO_RESPONDER_A"),
      subject: mensaje.asunto,
      html: mensaje.html,
      text: mensaje.texto,
      headers: mensaje.bajaUrl
        ? { "List-Unsubscribe": `<${mensaje.bajaUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" }
        : undefined
    }),
    signal: AbortSignal.timeout(10_000)
  });

  if (!respuesta.ok) {
    logger.error({ estado: respuesta.status }, "resend falló");
    return { enviado: false, motivo: `resend ${respuesta.status}` };
  }
  return { enviado: true, driver: "resend" };
}
