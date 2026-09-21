/** Utilidades compartidas por las pruebas. */
import type { Prisma, Producto } from "@prisma/client";
import { prisma } from "../src/repositories/prisma.js";

export const productoBase = {
  etiqueta: "Profesional",
  color: "#5C8CFF",
  categoria: "Notebook",
  specs: { cpu: "CPU de prueba", ram: "16 GB DDR5", almacenamiento: "512 GB SSD", so: "Windows 11 Pro" },
  usos: ["trabajar"],
  valores: ["soporte"],
  para: "Para probar.",
  noPara: "Para lo que no.",
  garantia: "12 meses",
  fuente: "Prueba",
  fechaDato: "18-09-2026",
  confianza: "ALTA" as const
};

type DatosProducto = Partial<Prisma.ProductoUncheckedCreateInput> & {
  id: string;
  slug: string;
  marca: string;
  nombre: string;
};

export const crearProducto = (datos: DatosProducto): Promise<Producto> =>
  prisma.producto.create({ data: { ...productoBase, ...datos } });

/** Un producto vendible con stock conocido: el caso normal. */
export const productoVendible = (id = "p-vendible", unidades = 10) =>
  crearProducto({
    id,
    slug: id,
    marca: "ASUS",
    nombre: "ExpertBook de prueba",
    condicion: "NUEVO",
    precioLista: 1_385_339,
    precioVenta: 1_185_990,
    stockEstado: "EN_STOCK",
    stockUnidades: unidades
  });

/** Sin precio propio: se consulta, no se compra. */
export const productoSoloMarketplace = (id = "p-marketplace") =>
  crearProducto({
    id,
    slug: id,
    marca: "ASUS",
    nombre: "TUF de prueba",
    condicion: "NUEVO",
    precioLider: 999_990,
    stockEstado: "EN_STOCK",
    stockUnidades: 5
  });

/** Con stock desconocido: el pedido no se cobra hasta confirmarlo. */
export const productoSinStock = (id = "p-sinstock") =>
  crearProducto({
    id,
    slug: id,
    marca: "ASUS",
    nombre: "ExpertBook P5 de prueba",
    precioVenta: 1_854_990,
    stockEstado: "DESCONOCIDO"
  });

export const compraBase = {
  /* Los términos son obligatorios en el esquema: sin ellos, 400. */
  terminos: true as const,
  nombre: "Comprador de Prueba",
  correo: "compra@econnet.cl",
  telefono: "+56912345678",
  despacho: { modo: "RETIRO" as const },
  documento: { tipo: "BOLETA" as const },
  ms: 5000
};
