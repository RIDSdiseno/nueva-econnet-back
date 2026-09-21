/**
 * Paridad de precios con los marketplaces donde Econnet ya vende.
 *
 * Por qué importa para vender: si el mismo equipo está más barato en el
 * listado de Falabella que en econnet.cl, la venta se va igual — pero pagando
 * comisión. Y si un equipo solo tiene precio de marketplace, la tienda propia
 * no lo puede vender: manda a consultar y ahí se pierde la mitad.
 *
 * Esto **no decide** nada: compara lo que consta, con su fuente y su fecha, y
 * deja la decisión escrita para quien la tenga que tomar.
 */
import { catalogoCompleto } from "./catalogo.service.js";
import type { Producto } from "@prisma/client";

export type Situacion =
  | "mas-caro-en-casa"
  | "mas-barato-en-casa"
  | "igual"
  | "solo-marketplace"
  | "solo-propio"
  | "sin-precio";

export interface FilaParidad {
  id: string;
  nombre: string;
  situacion: Situacion;
  precioPropio: number | null;
  canal: string | null;
  precioCanal: number | null;
  diferencia: number | null;
  /** Porcentaje del precio propio sobre el del canal. Positivo = más caro en casa. */
  diferenciaPorcentaje: number | null;
  fuente: string;
  fechaDato: string;
}

export interface InformeParidad {
  total: number;
  filas: FilaParidad[];
  recuento: Record<Situacion, number>;
  avisos: string[];
}

const canales = (producto: Producto): Array<[string, number]> =>
  (
    [
      ["falabella", producto.precioFalabella],
      ["lider", producto.precioLider]
    ] as Array<[string, number | null]>
  ).filter((par): par is [string, number] => par[1] !== null && par[1] > 0);

function filaDe(producto: Producto): FilaParidad {
  const base = {
    id: producto.id,
    nombre: `${producto.marca} ${producto.nombre}`,
    precioPropio: producto.precioVenta,
    fuente: producto.fuente,
    fechaDato: producto.fechaDato
  };

  const lista = canales(producto);

  /* Se compara contra el marketplace más barato: es el que ve el cliente. */
  const mejor = lista.sort((a, b) => a[1] - b[1])[0];

  if (!mejor) {
    return {
      ...base,
      situacion: producto.precioVenta ? "solo-propio" : "sin-precio",
      canal: null,
      precioCanal: null,
      diferencia: null,
      diferenciaPorcentaje: null
    };
  }

  const [canal, precioCanal] = mejor;

  if (producto.precioVenta === null) {
    return { ...base, situacion: "solo-marketplace", canal, precioCanal, diferencia: null, diferenciaPorcentaje: null };
  }

  const diferencia = producto.precioVenta - precioCanal;
  const situacion: Situacion = diferencia > 0 ? "mas-caro-en-casa" : diferencia < 0 ? "mas-barato-en-casa" : "igual";

  return {
    ...base,
    situacion,
    canal,
    precioCanal,
    diferencia,
    diferenciaPorcentaje: Math.round((producto.precioVenta / precioCanal - 1) * 100)
  };
}

export async function paridad(): Promise<InformeParidad> {
  const productos = await catalogoCompleto();
  const filas = productos.map(filaDe);

  const recuento = filas.reduce<Record<string, number>>((cuenta, fila) => {
    cuenta[fila.situacion] = (cuenta[fila.situacion] ?? 0) + 1;
    return cuenta;
  }, {}) as Record<Situacion, number>;

  const avisos: string[] = [];

  const caros = filas.filter((f) => f.situacion === "mas-caro-en-casa");
  if (caros.length) {
    avisos.push(
      `${caros.length} equipo(s) están MÁS CAROS en econnet.cl que en su propio listado de marketplace: la venta se va igual, pero pagando comisión.`
    );
  }

  const soloMarketplace = filas.filter((f) => f.situacion === "solo-marketplace");
  if (soloMarketplace.length) {
    avisos.push(
      `${soloMarketplace.length} equipo(s) se venden en marketplace pero NO tienen precio propio: en la tienda mandan a consultar, y ahí se cae la venta.`
    );
  }

  const sinDatos = filas.filter((f) => f.situacion === "solo-propio").length;
  if (sinDatos) {
    avisos.push(
      `${sinDatos} equipo(s) no tienen precio de marketplace en el catálogo: no se sabe si están publicados fuera o no.`
    );
  }

  return { total: filas.length, filas, recuento, avisos };
}

/** El informe en texto, para leerlo por terminal. */
export function comoTexto(informe: InformeParidad): string {
  const clp = (n: number | null) => (n === null ? "—" : `$${n.toLocaleString("es-CL")}`);
  const ETIQUETA: Record<Situacion, string> = {
    "mas-caro-en-casa": "MÁS CARO EN CASA",
    "mas-barato-en-casa": "más barato en casa",
    igual: "igual",
    "solo-marketplace": "SIN PRECIO PROPIO",
    "solo-propio": "sin dato de marketplace",
    "sin-precio": "sin precio de ninguno"
  };

  const lineas = [
    "Paridad de precios · econnet.cl contra sus propios listados de marketplace",
    "",
    ...informe.filas
      .filter((f) => f.situacion !== "solo-propio")
      .map(
        (f) =>
          `${ETIQUETA[f.situacion].padEnd(24)} ${f.nombre.slice(0, 38).padEnd(38)} ` +
          `propio ${clp(f.precioPropio).padEnd(12)} ${(f.canal ?? "").padEnd(10)} ${clp(f.precioCanal).padEnd(12)} ` +
          (f.diferenciaPorcentaje === null ? "" : `${f.diferenciaPorcentaje > 0 ? "+" : ""}${f.diferenciaPorcentaje}%`)
      ),
    "",
    ...informe.avisos.map((a) => `· ${a}`),
    "",
    `Total: ${informe.total} productos.`
  ];

  return lineas.join("\n");
}
