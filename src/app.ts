/**
 * La aplicación Express. Solo ensambla: no hay lógica de negocio aquí.
 * El orden de los middlewares importa — identificador, cabeceras, CORS,
 * cuerpo, rutas, 404 y, al final de todo, el manejador de errores.
 */
import express, { type Express } from "express";
import { pinoHttp } from "pino-http";
import { logger } from "./config/logger.js";
import { esPrueba } from "./config/env.js";
import { manejadorDeErrores, rutaNoEncontrada } from "./middlewares/errores.js";
import { requestId } from "./middlewares/requestId.js";
import { cabeceras, corsMiddleware } from "./middlewares/seguridad.js";
import { rutasAdmin } from "./modules/admin/admin.routes.js";
import { rutasCaptacion } from "./modules/captacion/captacion.routes.js";
import { rutasNegocio } from "./modules/negocio/negocio.routes.js";
import { rutasCotizaciones } from "./modules/cotizaciones/cotizaciones.routes.js";
import { rutasTrafico } from "./modules/trafico/trafico.routes.js";
import { rutasCarritos } from "./modules/carritos/carritos.routes.js";
import { rutasCatalogo } from "./modules/catalogo/catalogo.routes.js";
import { rutasPagos } from "./modules/pagos/pagos.routes.js";
import { rutasPedidos } from "./modules/pedidos/pedidos.routes.js";
import { rutasSalud } from "./modules/salud/salud.routes.js";
import { rutasTrabajos } from "./modules/trabajos/trabajos.routes.js";

export function crearApp(): Express {
  const app = express();

  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(requestId);
  if (!esPrueba) {
    app.use(pinoHttp({ logger }));
  }
  app.use(cabeceras);
  app.use(corsMiddleware);
  app.use(express.json({ limit: "32kb" }));

  app.use("/api", rutasSalud);
  app.use("/api", rutasNegocio);
  app.use("/api", rutasCatalogo);
  app.use("/api", rutasCarritos);
  app.use("/api", rutasPedidos);
  app.use("/api", rutasPagos);
  app.use("/api", rutasCaptacion);
  app.use("/api", rutasCotizaciones);
  app.use("/api", rutasTrafico);
  app.use("/api", rutasTrabajos);
  /* El panel va al final: es el único que escribe el catálogo, y el único
     que exige sesión. Nada de lo de arriba depende de él. */
  app.use("/api", rutasAdmin);

  app.use(rutaNoEncontrada);
  app.use(manejadorDeErrores);

  return app;
}
