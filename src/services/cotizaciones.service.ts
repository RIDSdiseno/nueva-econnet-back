/**
 * El ciclo de una cotización de empresa: se arma, se manda, se persigue tres
 * veces y se cierra. Con número, con fecha de caducidad y con un enlace para
 * aceptarla sin tener que llamar a nadie.
 *
 * Aceptar por enlace firmado —no por un id en la URL— es lo que hace que no se
 * pueda aceptar la cotización de otro escribiendo un número a mano.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { siguiente } from "../repositories/contador.repository.js";
import {
  buscarCotizacion,
  cambiarEstadoCotizacion,
  crearCotizacion,
  programarSeguimiento
} from "../repositories/cotizaciones.repository.js";
import { encolar } from "./cola-correo.js";
import { enviar } from "./correo.js";
import { firmar } from "./firma.js";
import { RUTAS_TIENDA } from "../config/rutas.js";
import { armarPropuesta, type Propuesta } from "./propuestas.service.js";
import { avisoVentas, propuestaEnviada, type EnlacesCotizacion } from "./plantillas-cotizacion.js";
import type { Cotizacion } from "@prisma/client";
import { ajuste, numeroAjuste } from "./ajustes.js";

/** Cuándo toca cada recordatorio, contando desde que se mandó. */
const DIAS_RECORDATORIO = [2, 5, 10];

export const diasHasta = (paso: number): number => DIAS_RECORDATORIO[paso - 1] ?? 0;

export function cuandoTocaRecordatorio(creado: Date, paso: number): Date | null {
  const dias = diasHasta(paso);
  if (!dias || paso > numeroAjuste("COTIZACION_SEGUIMIENTOS", 3)) return null;
  const cuando = new Date(creado);
  cuando.setDate(cuando.getDate() + dias);
  return cuando;
}

export function enlacesDeCotizacion(numero: string, correo: string): EnlacesCotizacion {
  const base = env.SITIO_PUBLICO.replace(/\/$/, "");
  return {
    ver: `${base}${RUTAS_TIENDA.cotizacion}?n=${encodeURIComponent(numero)}`,
    aceptar: `${base}/api/cotizacion/aceptar?t=${firmar({ a: "cotizacion", c: correo, k: numero }, 60 * 60 * 24 * 45)}`,
    baja: `${base}/api/baja?t=${firmar({ a: "baja", c: correo })}`,
    whatsapp: ajuste("WHATSAPP") ? `https://wa.me/${ajuste("WHATSAPP")}` : ""
  };
}

/** El número de cotización, con la misma forma que el de un pedido. */
async function numeroNuevo(): Promise<string> {
  const anio = new Date().getFullYear();
  const n = await siguiente(`cotizacion:${anio}`);
  return `COT-${anio}-${String(n).padStart(5, "0")}`;
}

export interface DatosCotizacion {
  correo: string;
  nombre?: string | null;
  empresa?: string | null;
  rut?: string | null;
  telefono?: string | null;
  equipos: number;
  perfil: string;
  presupuesto: number;
  accesorios: boolean;
}

export interface ResultadoCotizacion {
  cotizacion: Cotizacion;
  propuesta: Propuesta;
  enlaces: EnlacesCotizacion;
}

export async function cotizar(datos: DatosCotizacion): Promise<ResultadoCotizacion> {
  const propuesta = await armarPropuesta(datos);
  const numero = await numeroNuevo();

  const cotizacion = await crearCotizacion({
    numero,
    correo: datos.correo,
    nombre: datos.nombre ?? null,
    empresa: datos.empresa ?? null,
    rut: datos.rut ?? null,
    telefono: datos.telefono ?? null,
    equipos: datos.equipos,
    perfil: datos.perfil,
    presupuesto: datos.presupuesto,
    accesorios: datos.accesorios,
    propuesta: JSON.parse(JSON.stringify(propuesta)) as object,
    huecos: propuesta.huecos,
    neto: propuesta.neto,
    iva: propuesta.iva,
    descuento: propuesta.descuento,
    total: propuesta.total,
    validaHasta: propuesta.validaHasta,
    proximoCorreo: cuandoTocaRecordatorio(new Date(), 1)
  });

  const enlaces = enlacesDeCotizacion(numero, datos.correo);

  /* La propuesta sale ya: es lo que la empresa está esperando en pantalla. */
  await enviar(
    { ...propuestaEnviada(numero, propuesta, enlaces, datos.empresa), para: datos.correo, bajaUrl: enlaces.baja },
    { saltarTope: true }
  );

  if (ajuste("CORREO_RESPONDER_A")) {
    await enviar(avisoVentas(numero, propuesta, datos, ajuste("CORREO_RESPONDER_A")), { saltarTope: true });
  }

  logger.info({ numero, total: propuesta.total, equipos: datos.equipos }, "cotización enviada");
  return { cotizacion, propuesta, enlaces };
}

export const propuestaDe = (cotizacion: Cotizacion): Propuesta => {
  const guardada = cotizacion.propuesta as unknown as Propuesta;
  return { ...guardada, validaHasta: new Date(guardada.validaHasta) };
};

/** Marca vista la primera vez que alguien la abre. No reinicia el seguimiento. */
export async function marcarVista(numero: string): Promise<Cotizacion | null> {
  const cotizacion = await buscarCotizacion(numero);
  if (!cotizacion) return null;
  if (cotizacion.estado !== "ENVIADA") return cotizacion;
  return cambiarEstadoCotizacion(numero, "VISTA");
}

export interface ResultadoAceptar {
  ok: boolean;
  motivo?: string;
  cotizacion?: Cotizacion;
}

export async function aceptar(numero: string, correo: string): Promise<ResultadoAceptar> {
  const cotizacion = await buscarCotizacion(numero);
  if (!cotizacion) return { ok: false, motivo: "no existe" };
  if (cotizacion.correo !== correo) return { ok: false, motivo: "no es suya" };
  if (cotizacion.estado === "ACEPTADA") return { ok: true, cotizacion };
  if (cotizacion.estado === "PERDIDA") return { ok: false, motivo: "archivada" };

  /* Caducada se puede aceptar igual, pero ventas tiene que rehacer el precio. */
  const caducada = cotizacion.validaHasta < new Date();
  const aceptada = await cambiarEstadoCotizacion(numero, "ACEPTADA", { proximoCorreo: null });

  if (ajuste("CORREO_RESPONDER_A")) {
    const propuesta = propuestaDe(aceptada);
    const aviso = avisoVentas(numero, propuesta, aceptada, ajuste("CORREO_RESPONDER_A"), true);
    await enviar(
      caducada
        ? { ...aviso, asunto: `${aviso.asunto} · PRECIO CADUCADO, rehacer` }
        : aviso,
      { saltarTope: true }
    );
  }

  logger.info({ numero, caducada }, "cotización aceptada");
  return { ok: true, cotizacion: aceptada };
}

export async function archivar(numero: string): Promise<Cotizacion | null> {
  const cotizacion = await buscarCotizacion(numero);
  if (!cotizacion) return null;
  return cambiarEstadoCotizacion(numero, "PERDIDA", { proximoCorreo: null });
}

/** Encola el recordatorio que toca y programa el siguiente. */
export async function encolarRecordatorio(
  cotizacion: Cotizacion,
  paso: number,
  pieza: { asunto: string; html: string; texto: string; bajaUrl?: string | null }
): Promise<void> {
  await encolar(
    { ...pieza, para: cotizacion.correo, bajaUrl: pieza.bajaUrl ?? null },
    { clave: `cotizacion:${cotizacion.numero}:paso:${paso}` }
  );
  await programarSeguimiento(cotizacion.numero, paso, cuandoTocaRecordatorio(cotizacion.creado, paso + 1));
}
