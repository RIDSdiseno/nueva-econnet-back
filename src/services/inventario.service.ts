/**
 * El inventario visto desde dentro.
 *
 * El catálogo público responde «qué se vende»; esto responde «qué hay, qué le
 * falta a cada equipo para poder venderse, y quién tocó qué». Es la diferencia
 * entre una tienda y una hoja de cálculo: aquí un hueco se ve, no se rellena.
 */
import type { Prisma, Producto } from "@prisma/client";
import { conflicto, noEncontrado, peticionInvalida } from "../middlewares/errores.js";
import { publicable, seVende } from "./catalogo.service.js";
import { margenDe, resumirMargen, type Margen, type ResumenMargen } from "./margen.js";
import {
  ajustarUnidades,
  buscarCualquiera,
  cambiosDe,
  crear,
  existeSku,
  existeSlug,
  guardar,
  listarTodo,
  ultimosCambios,
  type Anotacion
} from "../repositories/inventario.repository.js";
import type { Alta, Edicion } from "../modules/admin/admin.schemas.js";

/** Un texto a identificador: «Lenovo ThinkPad E14» → «lenovo-thinkpad-e14». */
export function aIdentificador(texto: string): string {
  return texto
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

/** Cómo se lee un valor en el historial. NULL se dice, no se pinta vacío. */
const comoTexto = (valor: unknown): string | null => {
  if (valor === null || valor === undefined) return null;
  if (Array.isArray(valor)) return valor.join(", ");
  if (typeof valor === "object") return JSON.stringify(valor);
  return String(valor);
};

const iguales = (a: unknown, b: unknown): boolean => comoTexto(a) === comoTexto(b);

export interface FilaInventario {
  id: string;
  slug: string;
  sku: string | null;
  marca: string;
  nombre: string;
  etiqueta: string;
  color: string;
  categoria: string;
  subcategoria: string | null;
  tipoProducto: string | null;
  modelo: string | null;
  condicion: Producto["condicion"];
  garantia: string | null;
  precioLista: number | null;
  precioVenta: number | null;
  precioFalabella: number | null;
  precioLider: number | null;
  costoNeto: number | null;
  margen: Margen;
  stockEstado: Producto["stockEstado"];
  stockUnidades: number | null;
  reservadas: number;
  /** Lo que de verdad se puede vender ahora mismo: unidades menos reservas. */
  disponibles: number | null;
  specs: Record<string, string | null>;
  usos: string[];
  valores: string[];
  para: string | null;
  noPara: string | null;
  alerta: string | null;
  descripcionCorta: string | null;
  descripcionLarga: string | null;
  imagenUrl: string | null;
  imagenAlt: string | null;
  imagenes: string[];
  fuente: string;
  fechaDato: string;
  confianza: Producto["confianza"];
  archivado: string | null;
  actualizado: string;
  seVende: boolean;
  publicable: { ok: boolean; faltas: string[] };
}

export function aFila(p: Producto): FilaInventario {
  return {
    id: p.id,
    slug: p.slug,
    sku: p.sku,
    marca: p.marca,
    nombre: p.nombre,
    etiqueta: p.etiqueta,
    color: p.color,
    categoria: p.categoria,
    subcategoria: p.subcategoria,
    tipoProducto: p.tipoProducto,
    modelo: p.modelo,
    condicion: p.condicion,
    garantia: p.garantia,
    precioLista: p.precioLista,
    precioVenta: p.precioVenta,
    precioFalabella: p.precioFalabella,
    precioLider: p.precioLider,
    costoNeto: p.costoNeto,
    margen: margenDe(p),
    stockEstado: p.stockEstado,
    stockUnidades: p.stockUnidades,
    reservadas: p.reservadas,
    disponibles: p.stockUnidades === null ? null : Math.max(0, p.stockUnidades - p.reservadas),
    specs: (p.specs ?? {}) as Record<string, string | null>,
    usos: p.usos,
    valores: p.valores,
    para: p.para,
    noPara: p.noPara,
    alerta: p.alerta,
    descripcionCorta: p.descripcionCorta,
    descripcionLarga: p.descripcionLarga,
    imagenUrl: p.imagenUrl,
    imagenAlt: p.imagenAlt,
    imagenes: p.imagenes,
    fuente: p.fuente,
    fechaDato: p.fechaDato,
    confianza: p.confianza,
    archivado: p.archivado ? p.archivado.toISOString() : null,
    actualizado: p.actualizado.toISOString(),
    seVende: seVende(p),
    publicable: publicable(p)
  };
}

export interface ResumenInventario {
  total: number;
  enVenta: number;
  archivados: number;
  /** Cuántos equipos tienen cada hueco. Es la lista de tareas del panel. */
  huecos: Array<{ falta: string; cuantos: number }>;
  sinStockConocido: number;
  agotados: number;
  valorInventario: number | null;
  /** Lo que cuesta ese inventario, no lo que vale. NULL si falta algún coste. */
  costeInventario: number | null;
  margen: ResumenMargen;
}

export function resumir(productos: Producto[]): ResumenInventario {
  const vivos = productos.filter((p) => !p.archivado);
  const cuenta = new Map<string, number>();
  for (const p of vivos) {
    for (const falta of publicable(p).faltas) cuenta.set(falta, (cuenta.get(falta) ?? 0) + 1);
  }

  /* El valor solo suma lo que tiene precio Y unidades. Estimar el resto daría
     una cifra redonda y falsa; se prefiere una parcial y cierta. */
  const conAmbos = vivos.filter((p) => p.precioVenta !== null && p.stockUnidades !== null);
  const conCoste = vivos.filter((p) => p.costoNeto !== null && p.stockUnidades !== null);

  return {
    total: productos.length,
    enVenta: vivos.filter((p) => seVende(p)).length,
    archivados: productos.length - vivos.length,
    huecos: [...cuenta.entries()]
      .map(([falta, cuantos]) => ({ falta, cuantos }))
      .sort((a, b) => b.cuantos - a.cuantos),
    sinStockConocido: vivos.filter((p) => p.stockUnidades === null).length,
    agotados: vivos.filter((p) => p.stockUnidades !== null && p.stockUnidades - p.reservadas <= 0).length,
    valorInventario: conAmbos.length
      ? conAmbos.reduce((suma, p) => suma + (p.precioVenta ?? 0) * (p.stockUnidades ?? 0), 0)
      : null,
    costeInventario: conCoste.length
      ? conCoste.reduce((suma, p) => suma + (p.costoNeto ?? 0) * (p.stockUnidades ?? 0), 0)
      : null,
    margen: resumirMargen(productos)
  };
}

export async function inventario() {
  const productos = await listarTodo();
  return { productos: productos.map(aFila), resumen: resumir(productos) };
}

export async function historial(cuantos = 30) {
  const cambios = await ultimosCambios(cuantos);
  return cambios.map((c) => ({ ...c, fecha: c.fecha.toISOString() }));
}

export async function historialDe(id: string) {
  const cambios = await cambiosDe(id);
  return cambios.map((c) => ({ ...c, fecha: c.fecha.toISOString() }));
}

/** Las specs se guardan limpias: una clave con valor nulo o vacío desaparece. */
function limpiarSpecs(entrantes: Record<string, string | null>): Record<string, string> {
  const salida: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(entrantes)) {
    const texto = typeof valor === "string" ? valor.trim() : "";
    if (texto) salida[clave] = texto;
  }
  return salida;
}

export async function altaDeProducto(datos: Alta, autor = "panel"): Promise<FilaInventario> {
  const slug = datos.slug ?? aIdentificador(`${datos.marca} ${datos.nombre}`);
  const id = datos.id ?? slug;
  if (!slug || !id) throw peticionInvalida("De la marca y el nombre no sale un identificador válido: escríbelo a mano.");

  if (await existeSlug(slug)) throw conflicto(`Ya hay un equipo con la dirección «${slug}». Cámbiala.`);
  if (await buscarCualquiera(id)) throw conflicto(`Ya hay un equipo con el identificador «${id}».`);
  if (datos.sku && (await existeSku(datos.sku))) throw conflicto(`El SKU «${datos.sku}» ya está en otro equipo.`);

  const unidades = datos.stockUnidades ?? null;
  const creado = await crear(
    {
      id,
      slug,
      sku: datos.sku ?? null,
      marca: datos.marca,
      nombre: datos.nombre,
      /* Presentación, no dato del equipo: la etiqueta cae en la categoría y el
         color en un neutro. Ninguno afirma nada sobre el producto. */
      etiqueta: datos.etiqueta ?? datos.categoria,
      color: datos.color ?? "#8FA3BF",
      categoria: datos.categoria,
      subcategoria: datos.subcategoria ?? null,
      tipoProducto: datos.tipoProducto ?? null,
      modelo: datos.modelo ?? null,
      condicion: datos.condicion ?? null,
      garantia: datos.garantia ?? null,
      precioLista: datos.precioLista ?? null,
      precioVenta: datos.precioVenta ?? null,
      precioFalabella: datos.precioFalabella ?? null,
      precioLider: datos.precioLider ?? null,
      costoNeto: datos.costoNeto ?? null,
      stockEstado: datos.stockEstado ?? (unidades === null ? "DESCONOCIDO" : unidades === 0 ? "SIN_EXISTENCIAS" : unidades <= 3 ? "LIMITADO" : "EN_STOCK"),
      stockUnidades: unidades,
      specs: limpiarSpecs(datos.specs ?? {}),
      usos: datos.usos ?? [],
      valores: datos.valores ?? [],
      para: datos.para ?? null,
      noPara: datos.noPara ?? null,
      alerta: datos.alerta ?? null,
      descripcionCorta: datos.descripcionCorta ?? null,
      descripcionLarga: datos.descripcionLarga ?? null,
      imagenUrl: datos.imagenUrl ?? null,
      imagenAlt: datos.imagenAlt ?? null,
      imagenes: datos.imagenes ?? [],
      fuente: datos.fuente,
      /* Sin fecha declarada, la de hoy: es cuándo se metió el dato, y eso sí
         consta. Lo que no se inventa es de cuándo es el dato de origen. */
      fechaDato: datos.fechaDato ?? new Date().toISOString().slice(0, 10),
      confianza: datos.confianza ?? "MEDIA"
    },
    autor
  );

  return aFila(creado);
}

const CAMPOS_EDITABLES = [
  "slug", "sku", "marca", "nombre", "etiqueta", "color", "categoria", "subcategoria", "tipoProducto",
  "modelo", "condicion", "garantia", "precioLista", "precioVenta", "precioFalabella", "precioLider", "costoNeto",
  "stockEstado", "stockUnidades", "specs", "usos", "valores", "para", "noPara", "alerta",
  "descripcionCorta", "descripcionLarga", "imagenUrl", "imagenAlt", "imagenes", "fuente",
  "fechaDato", "confianza"
] as const;

export async function editarProducto(id: string, datos: Edicion, autor = "panel"): Promise<FilaInventario> {
  const antes = await buscarCualquiera(id);
  if (!antes) throw noEncontrado("Ese equipo no existe");

  const { motivo, ...campos } = datos;

  if (campos.slug && (await existeSlug(campos.slug, id))) {
    throw conflicto(`Ya hay otro equipo con la dirección «${campos.slug}».`);
  }
  if (campos.sku && (await existeSku(campos.sku, id))) {
    throw conflicto(`El SKU «${campos.sku}» ya está en otro equipo.`);
  }

  const cambio: Prisma.ProductoUpdateInput = {};
  const anotaciones: Anotacion[] = [];

  for (const campo of CAMPOS_EDITABLES) {
    if (!(campo in campos)) continue;
    const nuevo = campo === "specs" ? limpiarSpecs(campos.specs ?? {}) : campos[campo];
    const viejo = (antes as unknown as Record<string, unknown>)[campo];
    if (iguales(viejo, nuevo)) continue;
    (cambio as Record<string, unknown>)[campo] = nuevo;
    anotaciones.push({ campo, antes: comoTexto(viejo), despues: comoTexto(nuevo) });
  }

  /**
   * Bajar las unidades por debajo de lo ya reservado sería prometer equipos
   * que alguien tiene en un pedido a medio pagar. Se avisa en vez de aceptar.
   */
  if (typeof cambio.stockUnidades === "number" && cambio.stockUnidades < antes.reservadas) {
    throw conflicto(
      `Hay ${antes.reservadas} unidad(es) reservadas en pedidos vivos: no puedes dejar el stock en ${cambio.stockUnidades}.`
    );
  }

  /* Cambiar unidades sin decir el estado lo deja coherente solo. */
  if ("stockUnidades" in cambio && !("stockEstado" in cambio)) {
    const u = cambio.stockUnidades as number | null;
    const estado = u === null ? "DESCONOCIDO" : u === 0 ? "SIN_EXISTENCIAS" : u <= 3 ? "LIMITADO" : "EN_STOCK";
    if (estado !== antes.stockEstado) {
      cambio.stockEstado = estado;
      anotaciones.push({ campo: "stockEstado", antes: antes.stockEstado, despues: estado });
    }
  }

  if (!anotaciones.length) return aFila(antes);

  const guardado = await guardar(id, cambio, anotaciones, autor, motivo);
  return aFila(guardado);
}

export async function archivarProducto(
  id: string,
  archivar: boolean,
  motivo: string | undefined,
  autor = "panel"
): Promise<FilaInventario> {
  const antes = await buscarCualquiera(id);
  if (!antes) throw noEncontrado("Ese equipo no existe");

  const ahora = archivar ? new Date() : null;
  if (iguales(antes.archivado, ahora)) return aFila(antes);
  if (archivar && antes.reservadas > 0) {
    throw conflicto(`Hay ${antes.reservadas} unidad(es) reservadas: atiende esos pedidos antes de retirarlo.`);
  }

  const guardado = await guardar(
    id,
    { archivado: ahora },
    [{ campo: "archivado", antes: antes.archivado?.toISOString() ?? null, despues: ahora?.toISOString() ?? null }],
    autor,
    motivo
  );
  return aFila(guardado);
}

export async function fijarUnidades(id: string, unidades: number | null, motivo: string | undefined, autor = "panel") {
  const antes = await buscarCualquiera(id);
  if (!antes) throw noEncontrado("Ese equipo no existe");
  if (unidades !== null && unidades < antes.reservadas) {
    throw conflicto(`Hay ${antes.reservadas} unidad(es) reservadas: no puedes dejar el stock en ${unidades}.`);
  }
  if (antes.stockUnidades === unidades) return aFila(antes);

  const despues = await ajustarUnidades(id, unidades);
  if (!despues) throw noEncontrado("Ese equipo no existe");

  await guardar(
    id,
    {},
    [
      { campo: "stockUnidades", antes: comoTexto(antes.stockUnidades), despues: comoTexto(despues.stockUnidades) },
      { campo: "stockEstado", antes: antes.stockEstado, despues: despues.stockEstado }
    ].filter((a) => a.antes !== a.despues),
    autor,
    motivo
  );
  return aFila(despues);
}
