/**
 * Despacho. Las 16 regiones y el retiro en oficina.
 *
 * Los costos NO están inventados: salen de ENVIO_TABLA. Mientras esté vacía,
 * la tienda dice «por confirmar» y **no cobra** ese pedido. Poner una cifra
 * inventada en un checkout es lo que no se hace.
 */
import { ajuste, numeroAjuste, trozosDeTabla } from "./ajustes.js";

export const REGIONES = [
  "Arica y Parinacota", "Tarapacá", "Antofagasta", "Atacama", "Coquimbo",
  "Valparaíso", "Metropolitana de Santiago", "Libertador General Bernardo O'Higgins",
  "Maule", "Ñuble", "Biobío", "La Araucanía", "Los Ríos", "Los Lagos",
  "Aysén del General Carlos Ibáñez del Campo", "Magallanes y de la Antártica Chilena"
] as const;

export type Region = (typeof REGIONES)[number];

export const RETIRO = {
  nombre: "Retiro en oficina",
  detalle: "La Concepción 65, oficina 1003, Providencia · lunes a viernes de 08:30 a 18:00",
  costo: 0
} as const;

export interface CotizacionEnvio {
  costo: number | null;
  porConfirmar: boolean;
  nota: string;
  /** Plazo declarado por el courier, en días hábiles. `null` = no consta. */
  diasEstimados: number | null;
}

export interface Tarifa {
  precio: number;
  diasEstimados: number | null;
}

/**
 * `ENVIO_TABLA` acepta `Región:precio` o `Región:precio:díasHábiles`, separados
 * por `|`. El plazo es opcional: si no se declara, la tienda **no promete
 * ninguno** en vez de poner una cifra plausible. Un plazo inventado es la
 * primera causa de reclamo en el SERNAC.
 */
function tarifas(): Record<string, Tarifa> {
  const mapa: Record<string, Tarifa> = {};
  for (const trozo of trozosDeTabla(ajuste("ENVIO_TABLA"))) {
    const [region, valor, dias] = trozo.split(":");
    const precio = Number(valor);
    if (!region || !Number.isFinite(precio)) continue;
    const plazo = Number(dias);
    mapa[region.trim()] = { precio, diasEstimados: Number.isFinite(plazo) && plazo > 0 ? plazo : null };
  }
  return mapa;
}

export const hayTarifas = (): boolean => Object.keys(tarifas()).length > 0;

export function cotizarEnvio(opciones: { modo: "DESPACHO" | "RETIRO"; region?: string | null; subtotal?: number }): CotizacionEnvio {
  if (opciones.modo === "RETIRO") return { costo: 0, porConfirmar: false, nota: RETIRO.detalle, diasEstimados: null };

  const region = opciones.region ?? "";
  if (!(REGIONES as readonly string[]).includes(region)) {
    return { costo: null, porConfirmar: true, nota: "Región no reconocida", diasEstimados: null };
  }

  const tabla = tarifas();
  const tarifa = region in tabla ? tabla[region] : tabla["*"];
  if (tarifa === undefined) {
    return {
      costo: null,
      porConfirmar: true,
      nota: "Te confirmamos el costo del despacho antes de cobrarte.",
      diasEstimados: null
    };
  }

  const plazo = tarifa.diasEstimados;
  const conPlazo = plazo ? ` Llega en ${plazo} día${plazo === 1 ? "" : "s"} hábil${plazo === 1 ? "" : "es"}.` : "";

  if (numeroAjuste("ENVIO_GRATIS") && (opciones.subtotal ?? 0) >= numeroAjuste("ENVIO_GRATIS")) {
    return {
      costo: 0,
      porConfirmar: false,
      nota: `Despacho sin costo por el monto de la compra.${conPlazo}`,
      diasEstimados: plazo
    };
  }
  return { costo: tarifa.precio, porConfirmar: false, nota: `Despacho a ${region}.${conPlazo}`, diasEstimados: plazo };
}
