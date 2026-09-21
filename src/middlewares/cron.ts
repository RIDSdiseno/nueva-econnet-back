/** Los trabajos programados se cierran con un secreto, comparado en tiempo constante. */
import { createHmac, timingSafeEqual } from "node:crypto";
import type { RequestHandler } from "express";
import { env, secreto } from "../config/env.js";
import { noAutorizado } from "./errores.js";

export const soloCron: RequestHandler = (req, _res, next) => {
  const esperado = env.CRON_SECRET;
  if (!esperado) return next(noAutorizado("Los trabajos están cerrados: falta CRON_SECRET"));

  const dado = String(req.header("authorization") ?? "").replace(/^Bearer /, "");
  const a = createHmac("sha256", secreto()).update(dado).digest();
  const b = createHmac("sha256", secreto()).update(esperado).digest();
  if (!timingSafeEqual(a, b)) return next(noAutorizado());
  next();
};
