/** Registro estructurado. Nunca escribe correos completos ni IP en claro. */
import pino from "pino";
import { env, esPrueba } from "./env.js";

export const logger = pino({
  level: esPrueba ? "silent" : env.LOG_LEVEL,
  redact: {
    paths: ["req.headers.authorization", "req.headers.cookie", "password", "*.password", "token"],
    censor: "[oculto]"
  },
  base: { servicio: "econnet-api" }
});
