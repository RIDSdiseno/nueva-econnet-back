/**
 * Antes de cada prueba: base limpia y configuración de pruebas.
 * Truncar es más rápido que volver a migrar y deja las secuencias a cero.
 */
import { beforeEach, afterAll } from "vitest";

/**
 * La configuración de las pruebas se **impone**, no se hereda. Con `??` cada
 * variable del intérprete de quien las corre se colaba dentro: un
 * `ENVIO_TABLA` exportado para levantar el servidor en local tumbaba la prueba
 * de «sin tarifa no se cobra el despacho», y un `CRON_SECRET` distinto tumbaba
 * la del cron. Una prueba que depende de quién la ejecuta no prueba nada.
 *
 * La única que viene de fuera es la base de datos, que es de cada máquina.
 */
process.env.NODE_ENV = "test";
process.env.DATABASE_URL = process.env.DATABASE_URL_TEST ?? process.env.DATABASE_URL ?? "";
process.env.APP_SECRET = "secreto-de-pruebas-larguisimo-0123456789abcdef";
process.env.CRON_SECRET = "cron-de-pruebas";
process.env.CORREO_DRIVER = "consola";
process.env.CORREO_TOPE_DIARIO = "2";
process.env.PASARELA = "simulado";
process.env.SITIO_PUBLICO = "http://localhost:5173";
process.env.CORS_ORIGINS = "http://localhost:5173";
process.env.ORIGENES = "http://localhost:5173";
/* Sin tarifas de despacho: es el estado real hoy y lo que varias pruebas miran. */
process.env.ENVIO_TABLA = "";
process.env.ENVIO_GRATIS = "0";
/**
 * El panel de inventario, abierto con una clave conocida solo aquí. El hash
 * va escrito porque scrypt tarda a propósito: calcularlo en cada arranque de
 * la batería sería medio segundo regalado por fichero de pruebas.
 */
export const CLAVE_PANEL = "clave-de-pruebas-del-panel";
process.env.ADMIN_CLAVE_HASH =
  "scrypt$IiXJyAAc6aDlW5_CIXVhmg$iB4wRlBdtuf-kpOLvtnb8cFRb4g1p57r-9qbuKAPj6yBNexh_90XhlXU5PtSnd1zvE8jvUfl8uyAmZfGUQ_zOQ";

const { prisma } = await import("../src/repositories/prisma.js");
const { limpiarCorreosEnviados } = await import("../src/services/correo.js");
const { cargarAjustes } = await import("../src/services/ajustes.js");

const TABLAS = [
  "PedidoEvento", "PedidoItem", "Pedido", "CarritoItem", "Carrito",
  "CuponUso", "Cupon", "Cotizacion", "CorreoEncolado", "CorreoDiario",
  "Lead", "Contador", "CambioProducto", "Producto", "LimitePeticion", "Ajuste", "Medio"
];

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${TABLAS.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
  limpiarCorreosEnviados();
  /* Los ajustes se releen tras vaciar la tabla: si no, una prueba que guarda
     una tarifa de envío se la deja puesta a la siguiente. */
  await cargarAjustes();
});

afterAll(async () => {
  await prisma.$disconnect();
});
