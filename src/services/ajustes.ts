/**
 * Los ajustes del negocio, editables desde el panel y sin volver a desplegar.
 *
 * **Por qué no son variables de entorno y por qué no son `await`.**
 *
 * Que la tarifa de Valparaíso viva en el entorno significa que cambiarla es un
 * despliegue, y un despliegue es una persona técnica: el dueño del negocio no
 * puede tocar su propio precio de envío. Así que viven en la base.
 *
 * Pero leerlos con `await` obligaba a volver asíncronas `envios.ts`,
 * `carritos.service.ts` y `propuestas.service.ts` —el camino del dinero, que
 * es justo el código que más caro sale tocar—. En vez de eso se cargan enteros
 * en memoria al arrancar, se refrescan cada medio minuto y se refrescan
 * también en cuanto el panel escribe. La lectura es un acceso a un mapa.
 *
 * Lo que se paga por ello: con varias instancias, un cambio tarda hasta 30
 * segundos en verse en todas. Para una tarifa de envío o un número de WhatsApp
 * eso no es nada. Para un secreto lo sería — y por eso **aquí no hay
 * secretos**: las credenciales de pago, `APP_SECRET`, `CRON_SECRET` y el hash
 * de la clave del panel siguen en el entorno.
 */
import { env, esPrueba } from "../config/env.js";
import { logger } from "../config/logger.js";
import { leerAjustes, escribirAjustes } from "../repositories/ajustes.repository.js";

export type TipoAjuste = "texto" | "numero" | "tabla" | "largo";

export interface DefinicionAjuste {
  clave: string;
  grupo: "Envíos" | "Empresas" | "Contacto" | "Datos legales" | "Carrito";
  etiqueta: string;
  ayuda: string;
  tipo: TipoAjuste;
  ejemplo?: string;
  /** Qué pasa exactamente si se deja vacío. No «se usa un valor por defecto». */
  siFalta: string;
  /** De dónde sale mientras nadie lo haya puesto en el panel. */
  delEntorno: () => string;
}

export const CATALOGO_AJUSTES: DefinicionAjuste[] = [
  {
    clave: "ENVIO_TABLA",
    grupo: "Envíos",
    etiqueta: "Tarifas por región",
    ayuda: "Una región por línea: «Región:precio» o «Región:precio:díashábiles».",
    tipo: "tabla",
    ejemplo: "Metropolitana de Santiago:4990:2\nValparaíso:7990:3",
    siFalta: "No se cobra despacho y el pedido queda por confirmar. No se inventa una tarifa.",
    delEntorno: () => env.ENVIO_TABLA
  },
  {
    clave: "ENVIO_GRATIS",
    grupo: "Envíos",
    etiqueta: "Envío gratis desde",
    ayuda: "Importe con IVA a partir del cual el despacho no se cobra. 0 = nunca.",
    tipo: "numero",
    siFalta: "Nunca hay envío gratis.",
    delEntorno: () => String(env.ENVIO_GRATIS)
  },
  {
    clave: "DESCUENTO_VOLUMEN",
    grupo: "Empresas",
    etiqueta: "Descuento por volumen",
    ayuda: "Tramos «unidades:porcentaje» separados por «|».",
    tipo: "texto",
    ejemplo: "10:3|25:5|50:8",
    siFalta: "Toda cotización sale a precio de lista, y la propuesta lo dice por escrito.",
    delEntorno: () => env.DESCUENTO_VOLUMEN
  },
  {
    clave: "COTIZACION_VALIDA_DIAS",
    grupo: "Empresas",
    etiqueta: "Días de validez de una cotización",
    ayuda: "Desde que se emite hasta que caduca.",
    tipo: "numero",
    siFalta: "15 días.",
    delEntorno: () => String(env.COTIZACION_VALIDA_DIAS)
  },
  {
    clave: "COTIZACION_SEGUIMIENTOS",
    grupo: "Empresas",
    etiqueta: "Recordatorios por cotización",
    ayuda: "Cuántos correos de seguimiento como máximo. 0 = ninguno.",
    tipo: "numero",
    siFalta: "3 recordatorios.",
    delEntorno: () => String(env.COTIZACION_SEGUIMIENTOS)
  },
  {
    clave: "CARRITO_MINIMO",
    grupo: "Carrito",
    etiqueta: "Valor mínimo para perseguir un carrito",
    ayuda: "Por debajo de esto no se manda la secuencia de carrito abandonado.",
    tipo: "numero",
    siFalta: "$150.000.",
    delEntorno: () => String(env.CARRITO_MINIMO)
  },
  {
    clave: "CUPON_BIENVENIDA",
    grupo: "Carrito",
    etiqueta: "Cupón de bienvenida",
    ayuda: "El código que se manda al suscribirse. Tiene que existir de verdad en la tienda.",
    tipo: "texto",
    siFalta: "El correo de bienvenida habla de «descuento» sin prometer un porcentaje.",
    delEntorno: () => env.CUPON_BIENVENIDA
  },
  {
    clave: "WHATSAPP",
    grupo: "Contacto",
    etiqueta: "WhatsApp de asesoría",
    ayuda: "Solo dígitos, con código de país. Ej.: 56912345678.",
    tipo: "texto",
    siFalta: "No se pinta ningún botón de WhatsApp. Un botón que no contesta cuesta más que no tenerlo.",
    delEntorno: () => env.WHATSAPP
  },
  {
    clave: "CORREO_RESPONDER_A",
    grupo: "Contacto",
    etiqueta: "Correo de ventas",
    ayuda: "A donde llegan los avisos de pedido y de cotización, y a donde responde el cliente.",
    tipo: "texto",
    siFalta: "Los avisos internos no se mandan a nadie.",
    delEntorno: () => env.CORREO_RESPONDER_A
  },
  {
    clave: "RAZON_SOCIAL",
    grupo: "Datos legales",
    etiqueta: "Razón social",
    ayuda: "El nombre con el que se factura, no el nombre comercial.",
    tipo: "texto",
    siFalta: "La página legal enseña el hueco en ámbar. No se inventa un nombre.",
    delEntorno: () => ""
  },
  {
    clave: "RUT_EMPRESA",
    grupo: "Datos legales",
    etiqueta: "RUT",
    ayuda: "Con guion y dígito verificador.",
    tipo: "texto",
    siFalta: "La página legal enseña el hueco. Sin RUT publicado no se puede vender en regla.",
    delEntorno: () => ""
  },
  {
    clave: "DIRECCION",
    grupo: "Datos legales",
    etiqueta: "Dirección",
    ayuda: "La del domicilio comercial, que es la que va en las condiciones.",
    tipo: "texto",
    siFalta: "La página legal enseña el hueco.",
    delEntorno: () => ""
  },
  {
    clave: "TELEFONO",
    grupo: "Datos legales",
    etiqueta: "Teléfono de contacto",
    ayuda: "El que se publica. Puede ser distinto del WhatsApp.",
    tipo: "texto",
    siFalta: "No se publica teléfono.",
    delEntorno: () => ""
  },
  {
    clave: "HORARIO",
    grupo: "Datos legales",
    etiqueta: "Horario de atención",
    ayuda: "Tal como se quiere leer en la web.",
    tipo: "texto",
    ejemplo: "Lunes a viernes de 08:30 a 18:00",
    siFalta: "No se publica horario.",
    delEntorno: () => ""
  }
];

const POR_CLAVE = new Map(CATALOGO_AJUSTES.map((d) => [d.clave, d]));
export const esAjusteConocido = (clave: string): boolean => POR_CLAVE.has(clave);

/** Lo que hay puesto en el panel. Vacío hasta que se carga. */
let guardados = new Map<string, string>();
let cargadoEn = 0;

export async function cargarAjustes(): Promise<void> {
  try {
    const filas = await leerAjustes();
    guardados = new Map(filas.map((f) => [f.clave, f.valor]));
    cargadoEn = Date.now();
  } catch (error) {
    /* Una base que no contesta no puede impedir que la tienda arranque: se
       sigue con lo del entorno, y queda dicho en el registro. */
    logger.error({ err: error }, "no se pudieron leer los ajustes: se usan los del entorno");
  }
}

/** El valor efectivo: lo del panel si lo hay, si no lo del entorno. */
export function ajuste(clave: string): string {
  const puesto = guardados.get(clave);
  if (puesto !== undefined && puesto !== "") return puesto;
  return POR_CLAVE.get(clave)?.delEntorno() ?? "";
}

export function numeroAjuste(clave: string, porDefecto = 0): number {
  const leido = Number(ajuste(clave));
  return Number.isFinite(leido) ? leido : porDefecto;
}

/** De dónde sale cada valor ahora mismo. El panel lo enseña, y evita discusiones. */
export function origenDe(clave: string): "panel" | "entorno" | "vacío" {
  const puesto = guardados.get(clave);
  if (puesto !== undefined && puesto !== "") return "panel";
  return POR_CLAVE.get(clave)?.delEntorno() ? "entorno" : "vacío";
}

export async function guardarAjustes(pares: Record<string, string>, autor = "panel"): Promise<string[]> {
  const validos = Object.entries(pares).filter(([clave]) => POR_CLAVE.has(clave));
  if (!validos.length) return [];
  await escribirAjustes(validos.map(([clave, valor]) => ({ clave, valor: valor.trim(), autor })));
  await cargarAjustes();
  return validos.map(([clave]) => clave);
}

/**
 * El refresco periódico. No se arranca en pruebas: allí cada prueba carga los
 * suyos y un temporizador de fondo las volvería impredecibles.
 */
let reloj: NodeJS.Timeout | null = null;

export function vigilarAjustes(cadaMs = 30_000): void {
  if (esPrueba || reloj) return;
  reloj = setInterval(() => void cargarAjustes(), cadaMs);
  reloj.unref();
}

export function pararVigilancia(): void {
  if (reloj) clearInterval(reloj);
  reloj = null;
}

/** Cuánto hace que se leyeron. Lo enseña `/api/listo`. */
export const antiguedadAjustes = (): number => (cargadoEn ? Date.now() - cargadoEn : -1);

/** Solo para pruebas: pone valores sin pasar por la base. */
export function ponerAjustesEnMemoria(pares: Record<string, string>): void {
  guardados = new Map(Object.entries(pares));
  cargadoEn = Date.now();
}

/**
 * Parte una tabla de ajuste en sus trozos.
 *
 * Acepta **salto de línea y barra vertical** porque las dos existen de verdad:
 * la variable de entorno se escribe en una línea con `|`, y el panel usa un
 * cuadro de texto donde lo natural es una región por línea. Antes solo valía
 * `|`, así que una tarifa escrita en el panel —con saltos— se guardaba entera
 * como una sola región inexistente y el despacho quedaba «por confirmar» sin
 * que nada diera error. Lo cazó una prueba de extremo a extremo.
 */
export const trozosDeTabla = (valor: string): string[] =>
  valor
    .split(/[|\n\r]+/)
    .map((t) => t.trim())
    .filter(Boolean);
