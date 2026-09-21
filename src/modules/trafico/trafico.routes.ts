/**
 * Lo que consumen las plataformas de anuncios. Son ficheros, no una API: se
 * sirven con su tipo de contenido y con caché, porque Google los pide cada día.
 */
import { Router } from "express";
import { soloCron } from "../../middlewares/cron.js";
import { informe, merchantXml, metaCsv } from "../../services/feeds.service.js";
import { paridad } from "../../services/paridad.service.js";

export const rutasTrafico = Router();

const cache = "public, max-age=900, s-maxage=3600";

rutasTrafico.get("/feed/google.xml", async (_req, res) => {
  res.type("application/xml").set("Cache-Control", cache).send(await merchantXml());
});

rutasTrafico.get("/feed/meta.csv", async (_req, res) => {
  res.type("text/csv").set("Cache-Control", cache).send(await metaCsv());
});

/** Qué se puede anunciar y qué falta para poder hacerlo. */
rutasTrafico.get("/feed/informe", async (_req, res) => {
  res.json({ ok: true, informe: await informe() });
});

/**
 * Paridad de precios con los marketplaces. Cerrado con el mismo secreto que
 * los trabajos: enseña qué margen se está dejando y dónde, y eso no se publica.
 */
rutasTrafico.get("/informes/paridad", soloCron, async (_req, res) => {
  res.json({ ok: true, informe: await paridad() });
});
