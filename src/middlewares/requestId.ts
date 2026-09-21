/** Un identificador por petición, para poder seguir una compra en el registro. */
import { randomUUID } from "node:crypto";
import type { RequestHandler } from "express";

declare module "express-serve-static-core" {
  interface Request {
    requestId?: string;
  }
}

export const requestId: RequestHandler = (req, res, next) => {
  const entrante = req.header("x-request-id");
  const id = entrante && /^[\w-]{8,64}$/.test(entrante) ? entrante : randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
};
