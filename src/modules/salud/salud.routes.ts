/**
 * Health checks (cap. 51 de la guía).
 *   /api/salud  liveness: ¿está vivo el proceso?  No toca dependencias.
 *   /api/listo  readiness: ¿puede atender?  Toca la base, y se cachea 5 s
 *               para que no se convierta en una prueba costosa.
 */
import { Router } from "express";
import { prisma } from "../../repositories/prisma.js";
import { logger } from "../../config/logger.js";
import { antiguedadAjustes } from "../../services/ajustes.js";

export const rutasSalud = Router();

const arrancado = Date.now();
let ultimaComprobacion = { cuando: 0, ok: false };

rutasSalud.get("/salud", (_req, res) => {
  res.json({ ok: true, estado: "vivo", segundosEnPie: Math.round((Date.now() - arrancado) / 1000) });
});

rutasSalud.get("/listo", async (_req, res) => {
  const ahora = Date.now();
  if (ahora - ultimaComprobacion.cuando > 5000) {
    try {
      await prisma.$queryRaw`SELECT 1`;
      ultimaComprobacion = { cuando: ahora, ok: true };
    } catch (error) {
      logger.error({ err: error }, "readiness: la base no responde");
      ultimaComprobacion = { cuando: ahora, ok: false };
    }
  }

  if (!ultimaComprobacion.ok) {
    res.status(503).json({ ok: false, estado: "no listo", dependencias: { baseDeDatos: false } });
    return;
  }
  /* Cuántos segundos hace que se leyeron los ajustes. Si esto crece sin
     parar, el refresco se cayó y el panel está cambiando cosas que nadie ve. */
  const ajustes = antiguedadAjustes();
  res.json({
    ok: true,
    estado: "listo",
    dependencias: { baseDeDatos: true, ajustesHace: ajustes < 0 ? null : Math.round(ajustes / 1000) }
  });
});
