/**
 * Límite por IP, **compartido entre instancias**.
 *
 * El almacén vive en PostgreSQL (`LimitePeticion`), no en la memoria del
 * proceso: con tres instancias detrás de un balanceador, un contador en
 * memoria deja pasar el triple de lo configurado justo el día del pico.
 *
 * Si la base falla, el middleware **deja pasar** en vez de tirar la tienda:
 * un límite es una protección contra abuso, no contra el cliente. Queda en el
 * registro para que se vea.
 */
import rateLimit, { type Store } from "express-rate-limit";
import { env, esPrueba } from "../config/env.js";
import { logger } from "../config/logger.js";
import { restarGolpe, olvidarClave, sumarGolpe, verGolpe } from "../repositories/limites.repository.js";

function almacenEnPostgres(ventanaMs: number): Store {
  const prefijo = `v${ventanaMs}:`;

  return {
    localKeys: false,

    async increment(clave) {
      try {
        const { golpes, expira } = await sumarGolpe(prefijo + clave, ventanaMs);
        return { totalHits: golpes, resetTime: expira };
      } catch (error) {
        logger.error({ err: error }, "el límite por IP no pudo contar: se deja pasar");
        return { totalHits: 0, resetTime: new Date(Date.now() + ventanaMs) };
      }
    },

    async get(clave) {
      try {
        const fila = await verGolpe(prefijo + clave);
        return fila ? { totalHits: fila.golpes, resetTime: fila.expira } : undefined;
      } catch {
        return undefined;
      }
    },

    async decrement(clave) {
      await restarGolpe(prefijo + clave).catch(() => undefined);
    },

    async resetKey(clave) {
      await olvidarClave(prefijo + clave).catch(() => undefined);
    }
  };
}

export const limitePorIp = (porVentana = env.LIMITE_PETICIONES) => {
  const ventanaMs = env.LIMITE_VENTANA_MINUTOS * 60 * 1000;

  return rateLimit({
    windowMs: ventanaMs,
    limit: esPrueba ? 10_000 : porVentana,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    /* En pruebas el tope es tan alto que no se llega: se ahorra la base. */
    ...(esPrueba ? {} : { store: almacenEnPostgres(ventanaMs) }),
    message: { ok: false, error: { codigo: "demasiadas_peticiones", mensaje: "Demasiadas peticiones. Prueba en unos minutos." } }
  });
};
