/**
 * Los feeds de producto para Google Merchant Center y para el catálogo de Meta.
 *
 * Lo importante de este fichero no es el XML: es el **informe de exclusiones**.
 * Un feed con precios que no cuadran con la ficha, sin condición o sin imagen
 * termina en cuenta suspendida. Así que aquí solo entra lo que está completo,
 * y lo que se queda fuera sale con el motivo escrito, producto por producto.
 *
 * Hoy sale vacío, y eso **es el dato**: sin fotos ni stock no hay campaña que
 * levantar. El informe dice exactamente qué falta y cuántos productos afecta.
 */
import { env } from "../config/env.js";
import { catalogoCompleto, publicable } from "./catalogo.service.js";
import { escapar } from "./texto.js";
import type { Producto } from "@prisma/client";

const CONDICION_GOOGLE: Record<string, string> = {
  NUEVO: "new",
  OPENBOX: "refurbished",
  REACONDICIONADO: "refurbished",
  SEMINUEVO: "used",
  USADO: "used"
};

const STOCK_GOOGLE: Record<string, string> = {
  EN_STOCK: "in_stock",
  LIMITADO: "in_stock",
  SIN_EXISTENCIAS: "out_of_stock"
};

export interface Separados {
  dentro: Producto[];
  fuera: Array<{ producto: Producto; faltas: string[] }>;
}

export async function separar(): Promise<Separados> {
  const productos = await catalogoCompleto();
  const dentro: Producto[] = [];
  const fuera: Array<{ producto: Producto; faltas: string[] }> = [];

  for (const producto of productos) {
    const apto = publicable(producto);
    if (apto.ok) dentro.push(producto);
    else fuera.push({ producto, faltas: apto.faltas });
  }
  return { dentro, fuera };
}

const urlDe = (producto: Producto): string => `${env.SITIO_PUBLICO.replace(/\/$/, "")}/tienda/${producto.slug}`;

export async function merchantXml(): Promise<string> {
  const { dentro } = await separar();
  const items = dentro
    .map(
      (p) => `    <item>
      <g:id>${escapar(p.id)}</g:id>
      <g:title>${escapar(`${p.marca} ${p.nombre}`)}</g:title>
      <g:description>${escapar(p.para)}</g:description>
      <g:link>${escapar(urlDe(p))}</g:link>
      <g:image_link>${escapar(p.imagenUrl ?? "")}</g:image_link>
      <g:availability>${STOCK_GOOGLE[p.stockEstado] ?? "out_of_stock"}</g:availability>
      <g:price>${p.precioVenta} CLP</g:price>
      <g:condition>${CONDICION_GOOGLE[p.condicion ?? ""] ?? "new"}</g:condition>
      <g:brand>${escapar(p.marca)}</g:brand>
      <g:mpn>${escapar(p.sku ?? p.id)}</g:mpn>
      <g:identifier_exists>${p.sku ? "yes" : "no"}</g:identifier_exists>
      <g:product_type>${escapar(p.categoria)}</g:product_type>
    </item>`
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:g="http://base.google.com/ns/1.0">
  <channel>
    <title>Econnet</title>
    <link>${escapar(env.SITIO_PUBLICO)}</link>
    <description>Catálogo de Econnet para Google Merchant Center</description>
${items}
  </channel>
</rss>`;
}

export async function metaCsv(): Promise<string> {
  const { dentro } = await separar();
  const filas: string[][] = [
    ["id", "title", "description", "availability", "condition", "price", "link", "image_link", "brand"]
  ];

  for (const p of dentro) {
    filas.push([
      p.id,
      `${p.marca} ${p.nombre}`,
      p.descripcionCorta ?? p.para ?? "",
      STOCK_GOOGLE[p.stockEstado] ?? "out of stock",
      CONDICION_GOOGLE[p.condicion ?? ""] ?? "new",
      `${p.precioVenta} CLP`,
      urlDe(p),
      p.imagenUrl ?? "",
      p.marca
    ]);
  }

  return filas.map((f) => f.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
}

export interface Informe {
  total: number;
  publicables: number;
  faltas: Array<{ falta: string; productos: number }>;
  fuera: Array<{ nombre: string; faltas: string[] }>;
  sePuedeAnunciar: boolean;
  resumen: string;
}

export async function informe(): Promise<Informe> {
  const { dentro, fuera } = await separar();
  const cuenta = new Map<string, number>();
  for (const { faltas } of fuera) for (const f of faltas) cuenta.set(f, (cuenta.get(f) ?? 0) + 1);

  const total = dentro.length + fuera.length;
  return {
    total,
    publicables: dentro.length,
    faltas: [...cuenta.entries()].sort((a, b) => b[1] - a[1]).map(([falta, productos]) => ({ falta, productos })),
    fuera: fuera.map(({ producto, faltas }) => ({ nombre: `${producto.marca} ${producto.nombre}`, faltas })),
    sePuedeAnunciar: dentro.length > 0,
    resumen: dentro.length
      ? `${dentro.length} de ${total} productos se pueden anunciar hoy.`
      : `Ninguno de los ${total} productos se puede anunciar hoy: el feed no pasa la validación sin precio propio, condición, stock e imagen.`
  };
}
