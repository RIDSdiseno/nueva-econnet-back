/**
 * Cierra el panel de inventario.
 *
 * La sesión viaja en una cookie `HttpOnly`: JavaScript no la lee, así que un
 * XSS en cualquier página de la tienda no se lleva la sesión del panel.
 * `SameSite=Strict` significa que una petición nacida en otra web no la manda,
 * y eso ya es la mitad del CSRF; la otra mitad es la cabecera obligatoria
 * `X-Panel`, que un formulario cruzado no puede poner sin pasar por CORS.
 */
import type { Request, RequestHandler } from "express";
import { esProduccion } from "../config/env.js";
import { ErrorApp, noAutorizado } from "./errores.js";
import { panelConfigurado, SEGUNDOS_DE_SESION, sesionValida } from "../services/admin.js";

export const COOKIE = "econnet_panel";

/** Express no parsea cookies y aquí solo hace falta una. Sin dependencia. */
export function cookieDe(req: Request, nombre: string): string | null {
  const crudo = req.headers.cookie;
  if (!crudo) return null;
  for (const trozo of crudo.split(";")) {
    const corte = trozo.indexOf("=");
    if (corte < 0) continue;
    if (trozo.slice(0, corte).trim() !== nombre) continue;
    return decodeURIComponent(trozo.slice(corte + 1).trim());
  }
  return null;
}

const atributos = (segundos: number): string =>
  [
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    ...(esProduccion ? ["Secure"] : []),
    `Max-Age=${segundos}`
  ].join("; ");

export const galletaDeSesion = (token: string): string =>
  `${COOKIE}=${encodeURIComponent(token)}; ${atributos(SEGUNDOS_DE_SESION())}`;

export const galletaBorrada = (): string => `${COOKIE}=; ${atributos(0)}`;

/** 503 si nadie configuró el panel: no es «no autorizado», es «no existe». */
export const panelDisponible: RequestHandler = (_req, _res, next) => {
  if (!panelConfigurado()) {
    return next(
      new ErrorApp(
        503,
        "panel_no_configurado",
        "El panel está cerrado: falta ADMIN_CLAVE_HASH. Genérala con «npm run clave»."
      )
    );
  }
  next();
};

export const soloPanel: RequestHandler = (req, _res, next) => {
  if (!sesionValida(cookieDe(req, COOKIE))) return next(noAutorizado("Entra al panel para hacer esto"));
  /* Cabecera obligatoria en lo que escribe: una web ajena no puede ponerla. */
  if (req.method !== "GET" && req.header("x-panel") !== "1") {
    return next(noAutorizado("Petición sin origen reconocible"));
  }
  next();
};
