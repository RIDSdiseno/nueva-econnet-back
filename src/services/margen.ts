/**
 * El margen, que es la pregunta que decide cuánto se puede gastar en traer a
 * un cliente.
 *
 * Dos reglas, y las dos son la misma regla de siempre:
 *
 * 1. **Sin coste no hay margen.** Si `costoNeto` es NULL el margen es `null`,
 *    no cero y no una estimación. Un margen inventado se usa para decidir un
 *    presupuesto de publicidad, y ahí el error cuesta dinero de verdad.
 * 2. **Se calcula sobre el neto.** El IVA no es tuyo: entra y sale. Comparar
 *    un precio con IVA contra un coste sin IVA infla el margen 19 puntos.
 */
import type { Producto } from "@prisma/client";

export const IVA = 0.19;

/** De un precio con IVA al neto que de verdad te queda. */
export const aNeto = (conIva: number): number => Math.round(conIva / (1 + IVA));

export interface Margen {
  /** Lo que ganas por unidad, en pesos. NULL = falta el coste o el precio. */
  pesos: number | null;
  /** Sobre el neto de venta, en tanto por ciento. NULL por lo mismo. */
  porcentaje: number | null;
  /** Qué falta para poder calcularlo. Vacío si se pudo. */
  falta: string[];
}

export function margenDe(producto: Pick<Producto, "precioVenta" | "costoNeto">): Margen {
  const falta: string[] = [];
  if (!producto.precioVenta) falta.push("precio de venta");
  if (producto.costoNeto === null) falta.push("coste de compra");
  if (falta.length) return { pesos: null, porcentaje: null, falta };

  const neto = aNeto(producto.precioVenta as number);
  const pesos = neto - (producto.costoNeto as number);
  return {
    pesos,
    porcentaje: neto > 0 ? Math.round((pesos / neto) * 1000) / 10 : null,
    falta: []
  };
}

export interface ResumenMargen {
  /** Cuántos equipos permiten calcularlo, y cuántos no. */
  conDato: number;
  sinDato: number;
  /** Ponderado por unidades en stock: es el margen del inventario que tienes. */
  porcentajePonderado: number | null;
  /** Media simple entre los que tienen dato. Para comparar productos, no stock. */
  porcentajeMedio: number | null;
  /** Lo que ganarías si vendieras hoy todo el stock contado. NULL si no hay nada que sumar. */
  gananciaPotencial: number | null;
  /** Los tres que menos margen dejan. Es donde primero hay que mirar. */
  peores: Array<{ id: string; nombre: string; porcentaje: number }>;
}

export function resumirMargen(
  productos: Array<Pick<Producto, "id" | "marca" | "nombre" | "precioVenta" | "costoNeto" | "stockUnidades" | "archivado">>
): ResumenMargen {
  const vivos = productos.filter((p) => !p.archivado);
  const conMargen = vivos
    .map((p) => ({ p, m: margenDe(p) }))
    .filter((x) => x.m.porcentaje !== null);

  const conStock = conMargen.filter((x) => (x.p.stockUnidades ?? 0) > 0);
  const unidades = conStock.reduce((s, x) => s + (x.p.stockUnidades ?? 0), 0);

  return {
    conDato: conMargen.length,
    sinDato: vivos.length - conMargen.length,
    /* Ponderar por unidades y no por producto: diez cámaras baratas con 40%
       no compensan un notebook caro al 4%, y la media simple diría que sí. */
    porcentajePonderado:
      unidades > 0
        ? Math.round(
            (conStock.reduce((s, x) => s + (x.m.pesos as number) * (x.p.stockUnidades ?? 0), 0) /
              conStock.reduce((s, x) => s + aNeto(x.p.precioVenta as number) * (x.p.stockUnidades ?? 0), 0)) *
              1000
          ) / 10
        : null,
    porcentajeMedio: conMargen.length
      ? Math.round((conMargen.reduce((s, x) => s + (x.m.porcentaje as number), 0) / conMargen.length) * 10) / 10
      : null,
    gananciaPotencial: conStock.length
      ? conStock.reduce((s, x) => s + (x.m.pesos as number) * (x.p.stockUnidades ?? 0), 0)
      : null,
    peores: conMargen
      .sort((a, b) => (a.m.porcentaje as number) - (b.m.porcentaje as number))
      .slice(0, 3)
      .map((x) => ({
        id: x.p.id,
        nombre: `${x.p.marca} ${x.p.nombre}`,
        porcentaje: x.m.porcentaje as number
      }))
  };
}
