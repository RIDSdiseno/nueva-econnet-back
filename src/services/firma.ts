/**
 * Enlaces firmados: baja de la lista y parar la secuencia de un carrito.
 * HMAC-SHA256, comparación en tiempo constante y caducidad dentro del token.
 * Nada de ids adivinables en un correo.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import { secreto } from "../config/env.js";

export interface DatosFirmados {
  a: string;
  c?: string;
  k?: string;
  exp: number;
}

export function firmar(datos: Omit<DatosFirmados, "exp">, segundosDeVida = 60 * 60 * 24 * 60): string {
  const cuerpo = Buffer.from(
    JSON.stringify({ ...datos, exp: Math.floor(Date.now() / 1000) + segundosDeVida })
  ).toString("base64url");
  const mac = createHmac("sha256", secreto()).update(cuerpo).digest("base64url");
  return `${cuerpo}.${mac}`;
}

export function comprobar(token: unknown): DatosFirmados | null {
  if (typeof token !== "string" || !token.includes(".")) return null;
  const [cuerpo, mac] = token.split(".");
  if (!cuerpo || !mac) return null;

  const esperado = createHmac("sha256", secreto()).update(cuerpo).digest("base64url");
  const a = Buffer.from(mac);
  const b = Buffer.from(esperado);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  try {
    const datos = JSON.parse(Buffer.from(cuerpo, "base64url").toString("utf8")) as DatosFirmados;
    if (!datos.exp || datos.exp < Math.floor(Date.now() / 1000)) return null;
    return datos;
  } catch {
    return null;
  }
}

/** Identificador estable de una persona sin volver a guardar su correo. */
export const huella = (texto: string): string =>
  createHmac("sha256", secreto()).update(String(texto).trim().toLowerCase()).digest("hex").slice(0, 32);
