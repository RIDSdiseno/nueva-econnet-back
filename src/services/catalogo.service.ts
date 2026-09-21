/**
 * Catálogo. La honestidad del dato vive aquí: lo que no consta se dice, y un
 * precio de marketplace nunca se presenta como el precio de la tienda.
 */
import type { Producto } from "@prisma/client";
import { buscarPorId, buscarPorSlug, listarProductos } from "../repositories/catalogo.repository.js";

export interface PrecioReferencia {
  valor: number | null;
  propio: boolean;
  canal: "falabella" | "lider" | null;
}

export function precioReferencia(producto: Producto): PrecioReferencia {
  if (producto.precioVenta) return { valor: producto.precioVenta, propio: true, canal: null };

  const marketplaces: Array<[("falabella" | "lider"), number | null]> = [
    ["falabella", producto.precioFalabella],
    ["lider", producto.precioLider]
  ];
  let mejor: number | null = null;
  let canal: "falabella" | "lider" | null = null;
  for (const [nombre, valor] of marketplaces) {
    if (valor && (mejor === null || valor < mejor)) {
      mejor = valor;
      canal = nombre;
    }
  }
  return { valor: mejor, propio: false, canal };
}

/**
 * Lo que se puede comprar en línea. Lo demás se consulta.
 *
 * Cero no es un precio: `precioReferencia` y `publicable` ya lo trataban como
 * ausente, y esto lo alineaba mal —un 0 colado por una importación dejaba el
 * botón de comprar puesto sobre un equipo de cero pesos.
 */
export const seVende = (producto: Producto): boolean =>
  producto.precioVenta !== null && producto.precioVenta > 0;

export const stockConocido = (producto: Producto): boolean =>
  producto.stockEstado === "EN_STOCK" && producto.stockUnidades !== null;

/** Qué le falta a un producto para poder anunciarse o publicarse como oferta. */
export function publicable(producto: Producto): { ok: boolean; faltas: string[] } {
  const faltas: string[] = [];
  if (!producto.precioVenta) faltas.push("sin precio propio");
  if (!producto.condicion) faltas.push("sin condición declarada");
  if (producto.stockEstado === "DESCONOCIDO") faltas.push("sin stock conocido");
  if (!producto.imagenUrl) faltas.push("sin imagen");
  if (!producto.para?.trim() || !producto.noPara?.trim()) faltas.push("sin «para quién es / para quién no»");
  if (!producto.garantia?.trim()) faltas.push("sin garantía declarada");
  return { ok: faltas.length === 0, faltas };
}

export const catalogoCompleto = listarProductos;
export const productoPorId = buscarPorId;
export const productoPorSlug = buscarPorSlug;

/** Dos alternativas: una más barata y una con más músculo. */
export async function alternativasPara(producto: Producto, cuantas = 2): Promise<Producto[]> {
  const todos = await listarProductos();
  const referencia = precioReferencia(producto).valor ?? 0;

  const hermanos = todos
    .filter((p) => p.id !== producto.id && p.usos.some((u) => producto.usos.includes(u)))
    .map((p) => ({ p, valor: precioReferencia(p).valor ?? 0 }))
    .filter((o) => o.valor > 0);

  const barata = hermanos.filter((o) => o.valor < referencia).sort((a, b) => b.valor - a.valor)[0];
  const potente = hermanos.filter((o) => o.valor > referencia).sort((a, b) => a.valor - b.valor)[0];
  return [barata, potente].filter(Boolean).slice(0, cuantas).map((o) => (o as { p: Producto }).p);
}
