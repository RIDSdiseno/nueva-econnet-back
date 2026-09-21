/**
 * Escritura del catálogo desde el panel. El único sitio que crea, cambia o
 * archiva un producto, y el que guarda el rastro de lo que cambió.
 *
 * Producto y rastro se escriben en la misma transacción: o queda el cambio con
 * su registro, o no queda ninguno de los dos. Un historial con agujeros miente
 * peor que no tener historial.
 */
import type { CambioProducto, Prisma, Producto } from "@prisma/client";
import { prisma } from "./prisma.js";

export interface Anotacion {
  campo: string;
  antes: string | null;
  despues: string | null;
}

/** Todo, archivados incluidos: el panel enseña lo que hay, no lo que se vende. */
export const listarTodo = (): Promise<Producto[]> =>
  prisma.producto.findMany({ orderBy: [{ archivado: "asc" }, { marca: "asc" }, { nombre: "asc" }] });

export const buscarCualquiera = (id: string): Promise<Producto | null> =>
  prisma.producto.findUnique({ where: { id } });

export const existeSlug = (slug: string, salvoId?: string): Promise<boolean> =>
  prisma.producto
    .findFirst({ where: { slug, ...(salvoId ? { id: { not: salvoId } } : {}) }, select: { id: true } })
    .then((p) => p !== null);

export const existeSku = (sku: string, salvoId?: string): Promise<boolean> =>
  prisma.producto
    .findFirst({ where: { sku, ...(salvoId ? { id: { not: salvoId } } : {}) }, select: { id: true } })
    .then((p) => p !== null);

export async function crear(datos: Prisma.ProductoCreateInput, autor: string): Promise<Producto> {
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.create({ data: datos });
    await tx.cambioProducto.create({
      data: { productoId: producto.id, campo: "alta", antes: null, despues: "creado en el panel", autor }
    });
    return producto;
  });
}

export async function guardar(
  id: string,
  datos: Prisma.ProductoUpdateInput,
  anotaciones: Anotacion[],
  autor: string,
  motivo?: string
): Promise<Producto> {
  return prisma.$transaction(async (tx) => {
    const producto = await tx.producto.update({ where: { id }, data: datos });
    if (anotaciones.length) {
      await tx.cambioProducto.createMany({
        data: anotaciones.map((a) => ({ productoId: id, ...a, autor, motivo: motivo ?? null }))
      });
    }
    return producto;
  });
}

export const cambiosDe = (productoId: string, cuantos = 50): Promise<CambioProducto[]> =>
  prisma.cambioProducto.findMany({ where: { productoId }, orderBy: { fecha: "desc" }, take: cuantos });

export const ultimosCambios = (cuantos = 30): Promise<CambioProducto[]> =>
  prisma.cambioProducto.findMany({ orderBy: { fecha: "desc" }, take: cuantos });

/**
 * Ajuste de existencias en el propio UPDATE, no leyendo y escribiendo después:
 * mientras el panel escribe, un pedido puede estar reservando. Nunca baja de
 * cero, y nunca por debajo de lo ya reservado —eso sería prometer lo vendido.
 */
export async function ajustarUnidades(id: string, unidades: number | null): Promise<Producto | null> {
  return prisma.$transaction(async (tx) => {
    const antes = await tx.producto.findUnique({ where: { id } });
    if (!antes) return null;
    if (unidades === null) {
      return tx.producto.update({ where: { id }, data: { stockUnidades: null, stockEstado: "DESCONOCIDO" } });
    }
    const piso = Math.max(0, Math.trunc(unidades));
    return tx.producto.update({
      where: { id },
      data: {
        stockUnidades: piso,
        stockEstado: piso === 0 ? "SIN_EXISTENCIAS" : piso <= 3 ? "LIMITADO" : "EN_STOCK"
      }
    });
  });
}
