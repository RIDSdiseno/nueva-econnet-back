/**
 * Importar el catálogo desde un CSV (el que exporta WooCommerce, o uno hecho
 * a mano).
 *
 * Dos decisiones que la hacen usable y no peligrosa:
 *
 * 1. **Siempre se puede ensayar.** `ensayo: true` dice qué pasaría —cuántas
 *    altas, cuántos cambios, campo por campo— sin tocar nada. Importar a
 *    ciegas sobre un catálogo vivo es cómo se pierden los precios buenos.
 * 2. **Una columna ausente no borra nada.** Si el CSV no trae `costo`, el
 *    coste que ya estaba se queda. Solo se vacía un campo cuando la columna
 *    viene y viene vacía a propósito, y eso se ve en el ensayo.
 *
 * Y la de siempre: una celda vacía es `null`, no cero. Un CSV de proveedor
 * viene lleno de huecos, y son huecos.
 */
import type { Producto } from "@prisma/client";
import { listarTodo } from "../repositories/inventario.repository.js";
import { altaDeProducto, editarProducto, aIdentificador } from "./inventario.service.js";
import type { Alta, Edicion } from "../modules/admin/admin.schemas.js";

/** Nombres de columna que se aceptan para cada campo, en minúsculas. */
const COLUMNAS: Record<string, string[]> = {
  sku: ["sku", "id", "referencia"],
  marca: ["marca", "brand", "fabricante"],
  nombre: ["nombre", "name", "titulo", "título", "producto"],
  categoria: ["categoria", "categoría", "category", "categorias", "categorías"],
  subcategoria: ["subcategoria", "subcategoría"],
  modelo: ["modelo", "model"],
  condicion: ["condicion", "condición", "estado", "condition"],
  garantia: ["garantia", "garantía", "warranty"],
  precioVenta: ["precio", "precio venta", "preciodeventa", "precio_venta", "regular price", "sale price", "precio normal"],
  precioLista: ["precio lista", "precio_lista", "precio antes", "regular_price", "precio anterior"],
  costoNeto: ["costo", "coste", "costo neto", "costoneto", "cost", "cogs", "precio compra", "costo de compra"],
  stockUnidades: ["stock", "existencias", "unidades", "inventario", "cantidad"],
  imagenUrl: ["imagen", "imagenes", "imágenes", "image", "images", "foto"],
  descripcionCorta: ["descripcion corta", "descripción corta", "short description", "resumen"],
  descripcionLarga: ["descripcion", "descripción", "description", "descripcion larga"],
  para: ["para", "para quien", "para quién"],
  noPara: ["nopara", "no para", "no es para"]
};

const CONDICIONES: Record<string, string> = {
  nuevo: "NUEVO",
  new: "NUEVO",
  openbox: "OPENBOX",
  "open box": "OPENBOX",
  reacondicionado: "REACONDICIONADO",
  refurbished: "REACONDICIONADO",
  seminuevo: "SEMINUEVO",
  usado: "USADO",
  used: "USADO"
};

/**
 * Un CSV de verdad: comillas dobles, comas dentro de comillas, comillas
 * escapadas como `""` y saltos de línea dentro de una celda. Partir por comas
 * funciona hasta el primer producto que lleve una coma en la descripción, que
 * es siempre.
 */
export function partirCsv(texto: string): string[][] {
  const filas: string[][] = [];
  let fila: string[] = [];
  let celda = "";
  let entreComillas = false;

  const limpio = texto.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  for (let i = 0; i < limpio.length; i++) {
    const c = limpio[i];
    if (entreComillas) {
      if (c === '"') {
        if (limpio[i + 1] === '"') {
          celda += '"';
          i++;
        } else entreComillas = false;
      } else celda += c;
      continue;
    }
    if (c === '"') entreComillas = true;
    else if (c === "," || c === ";") {
      fila.push(celda);
      celda = "";
    } else if (c === "\n") {
      fila.push(celda);
      filas.push(fila);
      fila = [];
      celda = "";
    } else celda += c;
  }
  if (celda !== "" || fila.length) {
    fila.push(celda);
    filas.push(fila);
  }
  return filas.filter((f) => f.some((c) => c.trim() !== ""));
}

/** Un precio chileno como viene: «$1.185.990», «1185990,00», «1,185,990». */
export function aPesos(texto: string): number | null {
  const limpio = texto.replace(/[^0-9.,-]/g, "").trim();
  if (!limpio) return null;
  /* Si hay coma y punto, el último separador que aparece es el decimal. */
  const ultimaComa = limpio.lastIndexOf(",");
  const ultimoPunto = limpio.lastIndexOf(".");
  let normal = limpio;
  if (ultimaComa > -1 && ultimoPunto > -1) {
    const decimal = ultimaComa > ultimoPunto ? "," : ".";
    const miles = decimal === "," ? "." : ",";
    normal = limpio.split(miles).join("").replace(decimal, ".");
  } else if (ultimaComa > -1) {
    /* Solo comas: decimal si deja dos cifras detrás, si no separador de miles. */
    normal = limpio.length - ultimaComa === 3 ? limpio.replace(",", ".") : limpio.split(",").join("");
  } else if (ultimoPunto > -1) {
    normal = limpio.length - ultimoPunto === 3 ? limpio.replace(".", ".") : limpio.split(".").join("");
    if (limpio.split(".").length > 2) normal = limpio.split(".").join("");
  }
  const valor = Number(normal);
  if (!Number.isFinite(valor) || valor < 0) return null;
  return Math.round(valor);
}

export interface Diferencia {
  campo: string;
  antes: string | null;
  despues: string | null;
}

export interface FilaImportada {
  linea: number;
  id: string;
  nombre: string;
  accion: "alta" | "cambio" | "igual" | "error";
  diferencias: Diferencia[];
  motivo?: string;
}

export interface Informe {
  ensayo: boolean;
  columnasReconocidas: string[];
  columnasIgnoradas: string[];
  altas: number;
  cambios: number;
  iguales: number;
  errores: number;
  filas: FilaImportada[];
}

const comoTexto = (v: unknown): string | null =>
  v === null || v === undefined || v === "" ? null : String(v);

/** Traduce una fila del CSV a los campos que entiende el inventario. */
function leerFila(cabecera: string[], celdas: string[]): Record<string, unknown> {
  const salida: Record<string, unknown> = {};

  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    const indice = cabecera.findIndex((c) => alias.includes(c));
    if (indice === -1) continue;
    const bruto = (celdas[indice] ?? "").trim();

    if (campo === "precioVenta" || campo === "precioLista" || campo === "costoNeto") {
      salida[campo] = bruto === "" ? null : aPesos(bruto);
    } else if (campo === "stockUnidades") {
      if (bruto === "") salida[campo] = null;
      else {
        const n = aPesos(bruto);
        salida[campo] = n === null ? null : Math.max(0, n);
      }
    } else if (campo === "condicion") {
      salida[campo] = bruto === "" ? null : (CONDICIONES[bruto.toLowerCase()] ?? null);
    } else if (campo === "imagenUrl") {
      /* WooCommerce exporta la galería separada por comas: la primera manda. */
      salida[campo] = bruto === "" ? null : (bruto.split(",")[0] ?? "").trim() || null;
    } else {
      salida[campo] = bruto === "" ? null : bruto;
    }
  }
  return salida;
}

export async function importar(csv: string, ensayo = true, autor = "importación"): Promise<Informe> {
  const filas = partirCsv(csv);
  if (filas.length < 2) {
    return {
      ensayo,
      columnasReconocidas: [],
      columnasIgnoradas: [],
      altas: 0,
      cambios: 0,
      iguales: 0,
      errores: 0,
      filas: [{ linea: 1, id: "", nombre: "", accion: "error", diferencias: [], motivo: "El fichero no tiene cabecera y al menos una fila." }]
    };
  }

  const cabecera = (filas[0] ?? []).map((c) => c.trim().toLowerCase());
  const reconocidas: string[] = [];
  for (const [campo, alias] of Object.entries(COLUMNAS)) {
    if (cabecera.some((c) => alias.includes(c))) reconocidas.push(campo);
  }
  const usadas = new Set(Object.values(COLUMNAS).flat());
  const ignoradas = cabecera.filter((c) => c && !usadas.has(c));

  const existentes = new Map<string, Producto>();
  for (const p of await listarTodo()) {
    existentes.set(p.id, p);
    if (p.sku) existentes.set(`sku:${p.sku}`, p);
  }

  const informe: Informe = {
    ensayo,
    columnasReconocidas: reconocidas,
    columnasIgnoradas: ignoradas,
    altas: 0,
    cambios: 0,
    iguales: 0,
    errores: 0,
    filas: []
  };

  for (let i = 1; i < filas.length; i++) {
    const celdas = filas[i] ?? [];
    const datos = leerFila(cabecera, celdas);
    const marca = comoTexto(datos.marca);
    const nombre = comoTexto(datos.nombre);
    const sku = comoTexto(datos.sku);

    if (!marca || !nombre) {
      informe.errores++;
      informe.filas.push({
        linea: i + 1,
        id: sku ?? "",
        nombre: [marca, nombre].filter(Boolean).join(" "),
        accion: "error",
        diferencias: [],
        motivo: "Falta la marca o el nombre: sin eso no hay ficha que crear."
      });
      continue;
    }

    /* Se busca por SKU primero —es el identificador del negocio— y si no, por
       el identificador que saldría de la marca y el nombre. */
    const existente = (sku ? existentes.get(`sku:${sku}`) : undefined) ?? existentes.get(aIdentificador(`${marca} ${nombre}`));

    const campos: Record<string, unknown> = {};
    for (const campo of reconocidas) {
      if (campo === "sku" || campo === "marca" || campo === "nombre") continue;
      campos[campo] = datos[campo];
    }

    if (!existente) {
      const categoria = comoTexto(datos.categoria) ?? "Sin categoría";
      informe.altas++;
      informe.filas.push({
        linea: i + 1,
        id: aIdentificador(`${marca} ${nombre}`),
        nombre: `${marca} ${nombre}`,
        accion: "alta",
        diferencias: Object.entries(campos)
          .filter(([, v]) => v !== null && v !== undefined)
          .map(([campo, v]) => ({ campo, antes: null, despues: comoTexto(v) }))
      });
      if (!ensayo) {
        await altaDeProducto(
          {
            marca,
            nombre,
            categoria,
            fuente: "Importación CSV",
            ...(sku ? { sku } : {}),
            ...campos
          } as Alta,
          autor
        );
      }
      continue;
    }

    const diferencias: Diferencia[] = [];
    for (const [campo, valor] of Object.entries(campos)) {
      const actual = (existente as unknown as Record<string, unknown>)[campo] ?? null;
      if (comoTexto(actual) !== comoTexto(valor)) {
        diferencias.push({ campo, antes: comoTexto(actual), despues: comoTexto(valor) });
      }
    }

    if (!diferencias.length) {
      informe.iguales++;
      informe.filas.push({ linea: i + 1, id: existente.id, nombre: `${marca} ${nombre}`, accion: "igual", diferencias: [] });
      continue;
    }

    informe.cambios++;
    informe.filas.push({ linea: i + 1, id: existente.id, nombre: `${marca} ${nombre}`, accion: "cambio", diferencias });
    if (!ensayo) {
      await editarProducto(existente.id, { ...campos, motivo: "Importación CSV" } as Edicion, autor);
    }
  }

  return informe;
}
