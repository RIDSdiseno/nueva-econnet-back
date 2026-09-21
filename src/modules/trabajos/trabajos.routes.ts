/** Trabajos programados. Cerrados con CRON_SECRET y comparación constante. */
import { Router } from "express";
import { soloCron } from "../../middlewares/cron.js";
import { drenarCola, pendientes } from "../../services/cola-correo.js";
import { caducarPedidos, limpiarLimites, procesarCarritos, seguirCotizaciones } from "../../services/trabajos.service.js";

export const rutasTrabajos = Router();

rutasTrabajos.post("/trabajos/carritos", soloCron, async (req, res) => {
  const seco = req.query.seco === "1";
  const informe = await procesarCarritos(seco ? { presupuestoMs: 0 } : {});
  const caducados = seco ? null : await caducarPedidos();
  const cotizaciones = seco ? null : await seguirCotizaciones();
  const correo = seco ? null : await drenarCola({ presupuestoMs: 2500 });
  const limites = seco ? null : await limpiarLimites();
  res.json({ ok: true, informe, caducados, cotizaciones, correo, limites });
});

rutasTrabajos.post("/trabajos/cotizaciones", soloCron, async (_req, res) => {
  res.json({ ok: true, informe: await seguirCotizaciones() });
});

rutasTrabajos.post("/trabajos/correos", soloCron, async (req, res) => {
  if (req.query.solo === "contar") {
    res.json({ ok: true, pendientes: await pendientes() });
    return;
  }
  res.json({ ok: true, informe: await drenarCola() });
});

rutasTrabajos.post("/trabajos/caducar", soloCron, async (_req, res) => {
  res.json({ ok: true, informe: await caducarPedidos() });
});
