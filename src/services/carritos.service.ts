/** Carritos: valor, guardado y calendario de la secuencia. */
import { env } from "../config/env.js";
import { buscarVarios } from "../repositories/catalogo.repository.js";
import {
  buscarCarrito,
  cambiarEstadoCarrito,
  guardarCarrito,
  programarCarrito,
  type CarritoConItems
} from "../repositories/carritos.repository.js";
import { precioReferencia } from "./catalogo.service.js";
import { numeroAjuste } from "./ajustes.js";

export { buscarCarrito, cambiarEstadoCarrito, programarCarrito };
export type { CarritoConItems };

export interface LineaEntrante {
  productoId: string;
  cantidad: number;
}

const MAX_LINEAS = 30;
const MAX_CANTIDAD = 20;

/** Limpia lo que llega: solo productos que existen, cantidades con tope. */
export async function normalizarLineas(entrantes: LineaEntrante[]): Promise<LineaEntrante[]> {
  const pedidas = entrantes.slice(0, MAX_LINEAS);
  const productos = await buscarVarios(pedidas.map((l) => l.productoId));
  const existentes = new Set(productos.map((p) => p.id));

  return pedidas
    .filter((l) => existentes.has(l.productoId))
    .map((l) => ({ productoId: l.productoId, cantidad: Math.min(MAX_CANTIDAD, Math.max(1, Math.trunc(l.cantidad) || 1)) }));
}

/** Solo suma lo que se puede cobrar: un precio de marketplace no es nuestro. */
export async function valorDe(lineas: LineaEntrante[]): Promise<number> {
  const productos = await buscarVarios(lineas.map((l) => l.productoId));
  const porId = new Map(productos.map((p) => [p.id, p]));

  return lineas.reduce((total, linea) => {
    const producto = porId.get(linea.productoId);
    if (!producto) return total;
    const referencia = precioReferencia(producto);
    return total + (referencia.propio ? (referencia.valor ?? 0) * linea.cantidad : 0);
  }, 0);
}

export function cuandoToca(creado: Date, dia: number): Date {
  const inicio = creado.getTime() + env.CARRITO_ESPERA_HORAS * 3600 * 1000;
  return new Date(Math.max(inicio + (dia - 1) * 24 * 3600 * 1000, Date.now()));
}

/** Por qué NO se le escribe a este carrito. Cadena vacía = sí se le escribe. */
export function motivoParaNoEscribir(carrito: CarritoConItems): string {
  if (!carrito.correo) return "sin correo";
  if (!carrito.consiente) return "sin consentimiento";
  if (carrito.estado !== "ABIERTO") return `estado ${carrito.estado.toLowerCase()}`;
  if (!carrito.items.length) return "carrito vacío";
  if (carrito.valor && carrito.valor < numeroAjuste("CARRITO_MINIMO", 150000)) return "valor bajo el mínimo";
  return "";
}

export async function guardar(datos: {
  id?: string | null;
  lineas: LineaEntrante[];
  correo?: string | null;
  consiente?: boolean;
}): Promise<CarritoConItems> {
  const lineas = await normalizarLineas(datos.lineas);
  const valor = await valorDe(lineas);

  /* Se agenda el primer correo solo si puede recibirlo y aún no está agendado. */
  const puedeSeguirse = !!datos.correo && !!datos.consiente && lineas.length > 0 && valor >= numeroAjuste("CARRITO_MINIMO", 150000);

  return guardarCarrito({
    id: datos.id ?? null,
    lineas,
    valor,
    correo: datos.correo ?? null,
    consiente: datos.consiente ?? false,
    proximoCorreo: puedeSeguirse ? cuandoToca(new Date(), 1) : null
  });
}
