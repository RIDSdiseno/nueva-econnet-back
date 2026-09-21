/**
 * Acceso al catálogo. El único sitio que habla con la tabla Producto.
 */
import type { Producto } from "@prisma/client";
import { prisma } from "./prisma.js";

/* Archivado = fuera del catálogo público. Sigue en la base, y sigue en los
   pedidos que ya lo llevan: aquí no se borra nada, se retira. */
export const listarProductos = (): Promise<Producto[]> =>
  prisma.producto.findMany({ where: { archivado: null }, orderBy: [{ precioVenta: "asc" }, { marca: "asc" }] });

export const buscarPorId = (id: string): Promise<Producto | null> =>
  prisma.producto.findUnique({ where: { id } });

export const buscarPorSlug = (slug: string): Promise<Producto | null> =>
  prisma.producto.findFirst({ where: { slug, archivado: null } });

export const buscarVarios = (ids: string[]): Promise<Producto[]> =>
  prisma.producto.findMany({ where: { id: { in: ids } } });
