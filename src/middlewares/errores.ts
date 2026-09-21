/**
 * Errores con una sola forma. El contrato de la API es:
 *   éxito  → { ok: true, ...datos }
 *   fallo  → { ok: false, error: { codigo, mensaje, detalles? }, requestId }
 *
 * Nada de filtrar la traza al cliente: eso va al registro, no a la respuesta.
 */
import type { ErrorRequestHandler, RequestHandler } from "express";
import { ZodError } from "zod";
import { logger } from "../config/logger.js";
import { esProduccion } from "../config/env.js";

export class ErrorApp extends Error {
  constructor(
    public readonly estado: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown
  ) {
    super(mensaje);
    this.name = "ErrorApp";
  }
}

export const noEncontrado = (mensaje = "No existe ese recurso") => new ErrorApp(404, "no_encontrado", mensaje);
export const peticionInvalida = (mensaje: string, detalles?: unknown) =>
  new ErrorApp(400, "peticion_invalida", mensaje, detalles);
export const conflicto = (mensaje: string, detalles?: unknown) => new ErrorApp(409, "conflicto", mensaje, detalles);
/** Una transición de estado que la máquina no permite. */
export const transicionInvalida = (mensaje: string) => new ErrorApp(409, "transicion_invalida", mensaje);
export const noAutorizado = (mensaje = "No autorizado") => new ErrorApp(401, "no_autorizado", mensaje);

export const rutaNoEncontrada: RequestHandler = (_req, _res, next) => {
  next(noEncontrado("Esa ruta no existe"));
};

/**
 * Los errores que pone `express.json()` antes de que el cuerpo llegue a nadie:
 * un JSON mal escrito y un cuerpo más grande que el tope.
 *
 * Son culpa de quien llama, no nuestra, y caían en el manejador genérico como
 * **500**. Un 500 le dice al cliente «vuelve a intentarlo» cuando lo que tiene
 * que hacer es arreglar lo que manda, ensucia las alertas de error del
 * servidor, y a un atacante le sugiere que ha encontrado algo. Lo encontró una
 * auditoría externa.
 */
function errorDeCuerpo(err: unknown): ErrorApp | null {
  const tipo = (err as { type?: string }).type;
  if (tipo === "entity.too.large") {
    return new ErrorApp(413, "cuerpo_demasiado_grande", "Lo que mandaste es demasiado grande.");
  }
  if (tipo === "entity.parse.failed" || (err instanceof SyntaxError && "body" in (err as object))) {
    return peticionInvalida("El cuerpo no es un JSON válido.");
  }
  return null;
}

export const manejadorDeErrores: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = res.getHeader("x-request-id");

  const deCuerpo = errorDeCuerpo(err);
  if (deCuerpo) {
    res.status(deCuerpo.estado).json({
      ok: false,
      error: { codigo: deCuerpo.codigo, mensaje: deCuerpo.message },
      requestId
    });
    return;
  }

  if (err instanceof ZodError) {
    const detalles = err.issues.map((i) => ({ campo: i.path.join("."), mensaje: i.message }));
    res.status(400).json({ ok: false, error: { codigo: "peticion_invalida", mensaje: "Revisa los datos enviados.", detalles }, requestId });
    return;
  }

  if (err instanceof ErrorApp) {
    if (err.estado >= 500) logger.error({ err, ruta: req.path }, "error de aplicación");
    res.status(err.estado).json({
      ok: false,
      error: { codigo: err.codigo, mensaje: err.message, ...(err.detalles ? { detalles: err.detalles } : {}) },
      requestId
    });
    return;
  }

  logger.error({ err, ruta: req.path }, "error no controlado");
  res.status(500).json({
    ok: false,
    error: {
      codigo: "error_interno",
      mensaje: "Algo se rompió de nuestro lado.",
      ...(esProduccion ? {} : { detalles: String((err as Error)?.message ?? err) })
    },
    requestId
  });
};
