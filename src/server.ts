/** Arranque. Comprueba la configuración, levanta y se apaga con educación. */
import { crearApp } from "./app.js";
import { comprobarConfigCritica, env } from "./config/env.js";
import { logger } from "./config/logger.js";
import { cerrarBaseDeDatos, prisma } from "./repositories/prisma.js";
import { cargarAjustes, pararVigilancia, vigilarAjustes } from "./services/ajustes.js";

comprobarConfigCritica();

const app = crearApp();

const servidor = app.listen(env.PORT, () => {
  logger.info({ puerto: env.PORT, entorno: env.NODE_ENV }, "Econnet API en pie");
});

/**
 * Los ajustes del negocio, en memoria desde el primer segundo.
 *
 * No se espera a que carguen para levantar: si la base tarda o no está, la
 * tienda arranca igual con lo del entorno y los ajustes entran cuando entren.
 * Un servidor que no levanta porque no pudo leer una tarifa de envío es peor
 * que uno que levanta con la tarifa anterior.
 */
void cargarAjustes();
vigilarAjustes();

async function apagar(señal: string): Promise<void> {
  logger.info({ señal }, "apagando");
  pararVigilancia();
  servidor.close(() => {
    void cerrarBaseDeDatos().then(() => process.exit(0));
  });
  /* Si algo se queda colgado, no se espera eternamente. */
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on("SIGTERM", () => void apagar("SIGTERM"));
process.on("SIGINT", () => void apagar("SIGINT"));

process.on("unhandledRejection", (motivo) => {
  logger.error({ motivo }, "promesa sin capturar");
});

void prisma.$connect().catch((error: unknown) => {
  logger.error({ err: error }, "no se pudo conectar a la base de datos");
});
