/**
 * Validación de entrada con Zod. Todo lo que llega de fuera pasa por aquí,
 * aunque el frontend ya lo haya validado (principio 0.1 de la guía).
 *
 * Los esquemas usan `.strict()`: un campo de más es un error, no se ignora.
 * Así no entra nada por la puerta de atrás a un `create`.
 */
import type { RequestHandler } from "express";
import type { ZodTypeAny } from "zod";

export const validarCuerpo = (esquema: ZodTypeAny): RequestHandler => (req, _res, next) => {
  const resultado = esquema.safeParse(req.body);
  if (!resultado.success) return next(resultado.error);
  req.body = resultado.data;
  next();
};

export const validarConsulta = (esquema: ZodTypeAny): RequestHandler => (req, _res, next) => {
  const resultado = esquema.safeParse(req.query);
  if (!resultado.success) return next(resultado.error);
  Object.defineProperty(req, "consultaValidada", { value: resultado.data, writable: true, configurable: true });
  next();
};

declare module "express-serve-static-core" {
  interface Request {
    consultaValidada?: unknown;
  }
}
