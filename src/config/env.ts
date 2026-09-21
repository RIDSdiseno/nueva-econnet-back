/**
 * Configuración. Se valida con Zod al arrancar: si falta algo obligatorio en
 * producción, el proceso no levanta. Un servidor a medio configurar es peor
 * que un servidor caído, porque parece que funciona.
 */
import "dotenv/config";
import { z } from "zod";

/**
 * Un número del entorno.
 *
 * `z.coerce.number()` convierte la cadena vacía en **0**, y `.default()` solo
 * salta cuando la variable no existe. O sea: `LIMITE_PETICIONES=` en un `.env`
 * —que es como se deja una variable «sin poner»— daba un tope de cero
 * peticiones por IP, que es la tienda entera caída. Vacío se trata como
 * ausente. Es el mismo fallo que el de los precios, en otro sitio.
 */
const numero = (defecto: number) =>
  z.preprocess(
    (v) => (typeof v === "string" && v.trim() === "" ? undefined : v),
    z.coerce.number().int().nonnegative().default(defecto)
  );

const esquema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: numero(3000),
  LOG_LEVEL: z.enum(["trace", "debug", "info", "warn", "error", "fatal", "silent"]).default("info"),

  DATABASE_URL: z.string().min(1, "hace falta DATABASE_URL"),

  APP_SECRET: z.string().default(""),
  CORS_ORIGINS: z.string().default("http://localhost:5173"),
  SITIO_PUBLICO: z.string().default("http://localhost:5173"),

  CORREO_DRIVER: z.enum(["consola", "resend"]).default("consola"),
  RESEND_API_KEY: z.string().default(""),
  CORREO_REMITENTE: z.string().default("Econnet <hola@econnet.cl>"),
  CORREO_RESPONDER_A: z.string().default("ventas@econnet.cl"),
  CORREO_TOPE_DIARIO: numero(1),

  PASARELA: z.enum(["simulado", "webpay", "mercadopago"]).default("simulado"),
  WEBPAY_CODIGO_COMERCIO: z.string().default(""),
  WEBPAY_API_KEY: z.string().default(""),
  WEBPAY_BASE: z.string().default("https://webpay3gint.transbank.cl"),
  MP_ACCESS_TOKEN: z.string().default(""),
  MP_WEBHOOK_SECRET: z.string().default(""),
  MP_SANDBOX: z.string().default("1"),
  PAGO_TIMEOUT_MS: numero(8000),
  PAGO_CADUCA_HORAS: numero(48),

  ENVIO_TABLA: z.string().default(""),
  ENVIO_GRATIS: numero(0),

  CARRITO_DIAS: numero(7),
  CARRITO_ESPERA_HORAS: numero(4),
  CARRITO_MINIMO: numero(150000),

  /**
   * Tope por IP y ventana en lo que escribe (pedido, suscripción, cotización).
   * 30 y no 12: en Chile el móvil va con CGNAT y miles de personas comparten
   * una IP. Un tope bajo no frena al que abusa —cambia de IP— y sí bloquea a
   * clientes de verdad en mitad de una campaña.
   */
  LIMITE_PETICIONES: numero(30),
  LIMITE_VENTANA_MINUTOS: numero(10),
  TRABAJO_PRESUPUESTO_MS: numero(8000),
  TRABAJO_LOTE: numero(50),

  CRON_SECRET: z.string().default(""),

  /**
   * El panel de inventario. `ADMIN_CLAVE_HASH` es el resultado de
   * «npm run clave», nunca la clave en claro. Vacío = no hay panel, y sus
   * rutas responden 503: abierto por defecto sería un agujero, no una
   * comodidad.
   */
  ADMIN_CLAVE_HASH: z.string().default(""),
  ADMIN_SESION_HORAS: numero(8),
  /**
   * Intentos de clave por IP y ventana. Mucho más bajo que el de la tienda
   * porque lo que frena es probar claves, no comprar: aquí no hay clientes
   * legítimos detrás de una IP compartida, hay una persona que sabe la suya.
   */
  LIMITE_ENTRADAS: numero(10),
  CUPON_BIENVENIDA: z.string().default("BIENVENIDA10"),

  /**
   * Descuento por volumen, como «unidades:porcentaje» separado por «|»
   * (ej. "10:3|25:5|50:8"). Vacío = sin descuento, y la propuesta lo dice en
   * vez de inventarse un margen que nadie ha autorizado.
   */
  DESCUENTO_VOLUMEN: z.string().default(""),
  COTIZACION_VALIDA_DIAS: numero(15),
  COTIZACION_SEGUIMIENTOS: numero(3),
  WHATSAPP: z.string().default("")
});

const leido = esquema.safeParse(process.env);
if (!leido.success) {
  const detalle = leido.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join(" · ");
  throw new Error(`Configuración inválida — ${detalle}`);
}

export const env = leido.data;
export const esProduccion = env.NODE_ENV === "production";
export const esPrueba = env.NODE_ENV === "test";

/** Lo que en producción no puede faltar. Falla cerrado, no con un aviso. */
export function comprobarConfigCritica(): void {
  const faltan: string[] = [];
  if (env.APP_SECRET.length < 32) faltan.push("APP_SECRET (32+ caracteres)");
  if (env.CORREO_DRIVER === "resend" && !env.RESEND_API_KEY) faltan.push("RESEND_API_KEY");
  if (env.PASARELA === "webpay" && (!env.WEBPAY_CODIGO_COMERCIO || !env.WEBPAY_API_KEY)) {
    faltan.push("WEBPAY_CODIGO_COMERCIO y WEBPAY_API_KEY");
  }
  /**
   * En producción no se cobra de mentira. `simulado` devuelve «pagado» sin
   * cobrar nada: sirve para desarrollar y para las pruebas, y si se despliega
   * así la tienda entrega equipos que nadie pagó.
   */
  if (esProduccion && env.PASARELA === "simulado") {
    faltan.push("PASARELA real (webpay o mercadopago): «simulado» no cobra");
  }
  if (env.PASARELA === "mercadopago" && !env.MP_ACCESS_TOKEN) faltan.push("MP_ACCESS_TOKEN");
  /**
   * Sin secreto de webhook, `firmaMercadoPagoValida` devuelve null y el aviso
   * entra sin comprobar la firma. No basta con que después se le pregunte a la
   * pasarela: eso es la segunda barrera, no la primera.
   */
  if (env.PASARELA === "mercadopago" && !env.MP_WEBHOOK_SECRET) faltan.push("MP_WEBHOOK_SECRET");
  if (!env.CRON_SECRET) faltan.push("CRON_SECRET");

  if (faltan.length && esProduccion) {
    throw new Error(`Falta configuración obligatoria en producción: ${faltan.join(", ")}`);
  }
}

/**
 * Secreto efectivo. En producción no hay red de seguridad, a propósito.
 *
 * Y **fuera de producción tampoco, salvo en las pruebas**. El valor de relleno
 * es una constante que está escrita en el repositorio: un `staging` o un
 * `preview` desplegado con `NODE_ENV=development` y sin `APP_SECRET` tendría
 * las sesiones del panel y los enlaces firmados de baja y de cotización
 * falsificables por cualquiera que sepa leer este fichero. Lo señaló una
 * auditoría externa.
 *
 * En `test` sí se usa: una batería que exige configurar un secreto no prueba
 * nada más que eso.
 */
export function secreto(): string {
  if (env.APP_SECRET) return env.APP_SECRET;
  if (esPrueba) return "pruebas-sin-secreto-no-sale-de-aqui-000000000000";
  throw new Error(
    "APP_SECRET sin definir. Hace falta también fuera de producción: firma las sesiones del panel y los enlaces de los correos."
  );
}

export const origenesPermitidos = env.CORS_ORIGINS.split(",").map((o) => o.trim()).filter(Boolean);
