/**
 * La propuesta de empresa: de cuatro respuestas a una cotización con modelos,
 * precios y un número.
 *
 * Por qué existe: hasta hoy el cotizador guardaba la consulta y avisaba a
 * ventas. La empresa no recibía nada. Una propuesta que tarda dos días en
 * llegar compite con otra que llegó en dos minutos, y pierde.
 *
 * Lo que este fichero **no** hace, a propósito:
 *  · No inventa precios de accesorios: si no hay accesorio en el catálogo, la
 *    línea no existe y la propuesta lo dice.
 *  · No inventa descuento por volumen: sale de `DESCUENTO_VOLUMEN`, y si está
 *    vacío la propuesta dice que el descuento lo confirma ventas.
 *  · No promete plazos de entrega con el stock desconocido.
 */
import { desglosar } from "./dinero.js";
import { catalogoCompleto, precioReferencia, stockConocido } from "./catalogo.service.js";
import type { Producto } from "@prisma/client";
import { ajuste, numeroAjuste, trozosDeTabla } from "./ajustes.js";

/** Qué busca cada perfil. Es el criterio de Econnet, no una tabla de marketing. */
const PERFILES: Record<string, { usos: string[]; exigeWindows: boolean; etiqueta: string }> = {
  administrativo: { usos: ["empresa", "trabajar"], exigeWindows: true, etiqueta: "Administración" },
  comercial: { usos: ["trabajar", "empresa"], exigeWindows: true, etiqueta: "Comercial y terreno" },
  diseno: { usos: ["crear"], exigeWindows: false, etiqueta: "Diseño" },
  ingenieria: { usos: ["crear", "jugar"], exigeWindows: false, etiqueta: "Ingeniería" },
  direccion: { usos: ["trabajar", "empresa"], exigeWindows: true, etiqueta: "Dirección" }
};

export const PERFILES_VALIDOS = Object.keys(PERFILES);

export interface LineaPropuesta {
  productoId: string;
  slug: string;
  nombre: string;
  condicion: string | null;
  precioUnitario: number;
  cantidad: number;
  importe: number;
  stockConocido: boolean;
  concepto: "equipo" | "accesorio";
  /** Por qué este equipo. NULL = el catálogo todavía no lo dice. */
  porQue: string | null;
}

export interface Propuesta {
  perfil: string;
  etiquetaPerfil: string;
  lineas: LineaPropuesta[];
  alternativas: Array<{ slug: string; nombre: string; precioUnitario: number; condicion: string | null }>;
  subtotal: number;
  descuento: number;
  descuentoPorcentaje: number;
  neto: number;
  iva: number;
  total: number;
  huecos: string[];
  validaHasta: Date;
}

/** Tramos de descuento por volumen. Vacío = no hay política, y se dice. */
export function tramosDeVolumen(): Array<{ desde: number; porcentaje: number }> {
  return trozosDeTabla(ajuste("DESCUENTO_VOLUMEN"))
    .map((trozo) => trozo.split(":"))
    .map(([unidades, porcentaje]) => ({ desde: Number(unidades), porcentaje: Number(porcentaje) }))
    .filter((t) => Number.isFinite(t.desde) && Number.isFinite(t.porcentaje) && t.desde > 0 && t.porcentaje > 0)
    .sort((a, b) => a.desde - b.desde);
}

export function descuentoPara(equipos: number): number {
  let porcentaje = 0;
  for (const tramo of tramosDeVolumen()) if (equipos >= tramo.desde) porcentaje = tramo.porcentaje;
  return porcentaje;
}

const esWindows = (producto: Producto): boolean =>
  String((producto.specs as Record<string, string | null> | null)?.so ?? "").includes("Windows");

const esAccesorio = (producto: Producto): boolean =>
  ["monitor", "monitores", "accesorio", "accesorios"].includes(producto.categoria.toLowerCase());

/**
 * Elige el equipo. El criterio es el mismo de siempre: que sirva para ese
 * perfil, que entre en el presupuesto (con un 10% de margen, porque un
 * presupuesto es una intención, no un techo) y, dentro de eso, el mejor.
 */
function elegirEquipos(productos: Producto[], perfil: string, presupuesto: number) {
  const config = PERFILES[perfil] ?? { usos: ["trabajar", "empresa"], exigeWindows: false, etiqueta: perfil };
  const techo = presupuesto > 0 ? presupuesto * 1.1 : Number.POSITIVE_INFINITY;

  const conPrecio = productos.filter((p) => !esAccesorio(p) && precioReferencia(p).propio && (p.precioVenta ?? 0) <= techo);

  const encajan = conPrecio.filter(
    (p) => p.usos.some((uso) => config.usos.includes(uso)) && (!config.exigeWindows || esWindows(p))
  );

  /* Si nada encaja con el perfil, se relaja a «sirve para trabajar», y se dice. */
  const relajado = encajan.length ? encajan : conPrecio.filter((p) => p.usos.some((u) => ["trabajar", "empresa"].includes(u)));

  return {
    elegidos: [...relajado].sort((a, b) => (b.precioVenta ?? 0) - (a.precioVenta ?? 0)),
    exacto: encajan.length > 0,
    config
  };
}

export async function armarPropuesta(datos: {
  equipos: number;
  perfil: string;
  presupuesto: number;
  accesorios: boolean;
}): Promise<Propuesta> {
  const productos = await catalogoCompleto();
  const { elegidos, exacto, config } = elegirEquipos(productos, datos.perfil, datos.presupuesto);

  const lineas: LineaPropuesta[] = [];
  const huecos: string[] = [];

  const equipo = elegidos[0];
  if (!equipo) {
    huecos.push(
      datos.presupuesto > 0
        ? `Con ${datos.presupuesto.toLocaleString("es-CL")} por equipo no hay nada en el catálogo de hoy para ese perfil: lo vemos caso a caso.`
        : "Sin presupuesto de referencia no podemos proponer un modelo concreto."
    );
  } else {
    if (!exacto) huecos.push("Ningún modelo del catálogo de hoy encaja exacto con ese perfil: proponemos el más cercano.");

    lineas.push({
      productoId: equipo.id,
      slug: equipo.slug,
      nombre: `${equipo.marca} ${equipo.nombre}`,
      condicion: equipo.condicion,
      precioUnitario: equipo.precioVenta ?? 0,
      cantidad: datos.equipos,
      importe: (equipo.precioVenta ?? 0) * datos.equipos,
      stockConocido: stockConocido(equipo),
      concepto: "equipo",
      porQue: equipo.para
    });

    if (!equipo.condicion) huecos.push(`La condición de ${equipo.marca} ${equipo.nombre} no está declarada en el catálogo: la confirmamos antes de facturar.`);
    if (!stockConocido(equipo)) huecos.push(`El stock de ${equipo.marca} ${equipo.nombre} está por confirmar: el plazo de entrega va en la respuesta de ventas, no en esta propuesta.`);
  }

  if (datos.accesorios) {
    const accesorio = productos
      .filter((p) => esAccesorio(p) && precioReferencia(p).propio)
      .sort((a, b) => (a.precioVenta ?? 0) - (b.precioVenta ?? 0))[0];

    if (accesorio) {
      lineas.push({
        productoId: accesorio.id,
        slug: accesorio.slug,
        nombre: `${accesorio.marca} ${accesorio.nombre}`,
        condicion: accesorio.condicion,
        precioUnitario: accesorio.precioVenta ?? 0,
        cantidad: datos.equipos,
        importe: (accesorio.precioVenta ?? 0) * datos.equipos,
        stockConocido: stockConocido(accesorio),
        concepto: "accesorio",
        porQue: accesorio.para
      });
    } else {
      huecos.push("Pediste puesto completo, pero hoy no hay monitor ni accesorios con precio propio en el catálogo: van cotizados aparte.");
    }
  }

  const subtotal = lineas.reduce((t, l) => t + l.importe, 0);
  const descuentoPorcentaje = descuentoPara(datos.equipos);
  const descuento = Math.round((subtotal * descuentoPorcentaje) / 100);

  if (!tramosDeVolumen().length) {
    huecos.push("El descuento por volumen no está cargado en el sistema: lo confirma ventas antes de cerrar.");
  }

  const { neto, iva, total } = desglosar(subtotal - descuento);

  const validaHasta = new Date();
  validaHasta.setDate(validaHasta.getDate() + numeroAjuste("COTIZACION_VALIDA_DIAS", 15));

  return {
    perfil: datos.perfil,
    etiquetaPerfil: config.etiqueta,
    lineas,
    alternativas: elegidos.slice(1, 3).map((p) => ({
      slug: p.slug,
      nombre: `${p.marca} ${p.nombre}`,
      precioUnitario: p.precioVenta ?? 0,
      condicion: p.condicion
    })),
    subtotal,
    descuento,
    descuentoPorcentaje,
    neto,
    iva,
    total,
    huecos,
    validaHasta
  };
}
