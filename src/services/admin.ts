/**
 * La puerta del panel de inventario.
 *
 * Una clave, no un token pegado en la URL: la clave se guarda **hasheada**
 * (scrypt con sal por clave) en `ADMIN_CLAVE_HASH`, y lo que viaja después es
 * una sesión firmada con caducidad dentro. Si alguien lee la variable de
 * entorno, no tiene la clave; si alguien intercepta la cookie, caduca sola.
 *
 * Sin `ADMIN_CLAVE_HASH` configurado el panel **no existe**: las rutas
 * responden 503. Un panel abierto por defecto es peor que no tener panel.
 */
import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { env } from "../config/env.js";
import { comprobar, firmar } from "./firma.js";

const scrypt = promisify(scryptCallback) as (
  clave: string | Buffer,
  sal: string | Buffer,
  largo: number
) => Promise<Buffer>;

const LARGO = 64;
/** Etiqueta del formato, por si algún día se cambia de algoritmo. */
const PREFIJO = "scrypt";

export const panelConfigurado = (): boolean => env.ADMIN_CLAVE_HASH.startsWith(`${PREFIJO}$`);

/** Genera el valor que va en `ADMIN_CLAVE_HASH`. Lo usa `npm run clave`. */
export async function hashDeClave(clave: string): Promise<string> {
  const sal = randomBytes(16);
  const derivada = await scrypt(clave, sal, LARGO);
  return `${PREFIJO}$${sal.toString("base64url")}$${derivada.toString("base64url")}`;
}

/**
 * Comprueba la clave en tiempo constante. Un `===` sobre el hash filtra por
 * cuánto tarda en fallar cuántos caracteres iniciales acertaste.
 */
export async function claveCorrecta(clave: unknown): Promise<boolean> {
  if (typeof clave !== "string" || !clave) return false;
  if (!panelConfigurado()) return false;

  const [, salTexto, esperadoTexto] = env.ADMIN_CLAVE_HASH.split("$");
  if (!salTexto || !esperadoTexto) return false;

  const esperado = Buffer.from(esperadoTexto, "base64url");
  if (esperado.length !== LARGO) return false;

  const derivada = await scrypt(clave, Buffer.from(salTexto, "base64url"), LARGO);
  return timingSafeEqual(derivada, esperado);
}

/** Una sesión es un token firmado con caducidad: el servidor no guarda nada. */
export const abrirSesion = (): string =>
  firmar({ a: "panel", k: randomBytes(8).toString("base64url") }, env.ADMIN_SESION_HORAS * 3600);

export function sesionValida(token: unknown): boolean {
  const datos = comprobar(token);
  return datos !== null && datos.a === "panel";
}

export const SEGUNDOS_DE_SESION = (): number => env.ADMIN_SESION_HORAS * 3600;
