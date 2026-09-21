/**
 * Siembra: el catálogo del 18-09-2026 y el cupón de bienvenida.
 *
 * El fichero de datos vive dentro de este repositorio a propósito: la regla de
 * la guía es que ningún proyecto importe ficheros del otro. Cuando exista la
 * exportación real de WooCommerce, se reemplaza `prisma/datos/catalogo.json`
 * y se vuelve a sembrar.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Condicion, type Confianza, type EstadoStock } from "@prisma/client";

const aqui = dirname(fileURLToPath(import.meta.url));
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL ?? "" }) });

interface ProductoFuente {
  id: string;
  sku?: string | null;
  url?: string | null;
  marca: string;
  nombre: string;
  etiqueta: string;
  color: string;
  categoria: string;
  condicion: string | null;
  garantia: string | null;
  precio: { lista: number | null; venta: number | null };
  marketplaces: { falabella?: number; lider?: number };
  stock: { estado: string; unidades: number | null };
  specs: Record<string, string | null>;
  usos: string[];
  valores: string[];
  para: string;
  noPara: string;
  alerta: string | null;
  fuente: string;
  fecha: string;
  confianza: string;
}

const CONDICION: Record<string, Condicion> = {
  Nuevo: "NUEVO",
  Openbox: "OPENBOX",
  Reacondicionado: "REACONDICIONADO",
  Seminuevo: "SEMINUEVO",
  Usado: "USADO"
};

const STOCK: Record<string, EstadoStock> = {
  "En stock": "EN_STOCK",
  "Stock limitado": "LIMITADO",
  "Sin existencias": "SIN_EXISTENCIAS",
  "Stock desconocido": "DESCONOCIDO"
};

const CONFIANZA: Record<string, Confianza> = { alta: "ALTA", media: "MEDIA", baja: "BAJA" };

const slugificar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);

async function sembrar(): Promise<void> {
  const bruto = JSON.parse(readFileSync(join(aqui, "datos", "catalogo.json"), "utf8")) as {
    extraccion: string;
    productos: ProductoFuente[];
  };

  for (const p of bruto.productos) {
    const datos = {
      slug: slugificar(`${p.marca}-${p.nombre}`),
      sku: p.sku ?? null,
      marca: p.marca,
      nombre: p.nombre,
      etiqueta: p.etiqueta,
      color: p.color,
      categoria: p.categoria,
      condicion: p.condicion ? (CONDICION[p.condicion] ?? null) : null,
      garantia: p.garantia ?? null,
      precioLista: p.precio.lista ?? null,
      precioVenta: p.precio.venta ?? null,
      precioFalabella: p.marketplaces?.falabella ?? null,
      precioLider: p.marketplaces?.lider ?? null,
      stockEstado: STOCK[p.stock.estado] ?? "DESCONOCIDO",
      stockUnidades: p.stock.unidades ?? null,
      specs: p.specs,
      usos: p.usos,
      valores: p.valores,
      para: p.para,
      noPara: p.noPara,
      alerta: p.alerta ?? null,
      imagenUrl: null,
      fuente: p.fuente,
      fechaDato: p.fecha,
      confianza: CONFIANZA[p.confianza] ?? "BAJA"
    };

    /**
     * `reservadas: 0` a propósito: sembrar es volver a un estado conocido. Sin
     * esto, las reservas de pedidos de prueba se quedan pegadas y el catálogo
     * dice «sin stock» con las unidades en la bodega.
     */
    await prisma.producto.upsert({
      where: { id: p.id },
      create: { id: p.id, ...datos, reservadas: 0 },
      update: { ...datos, reservadas: 0 }
    });
  }

  await prisma.cupon.upsert({
    where: { codigo: process.env.CUPON_BIENVENIDA ?? "BIENVENIDA10" },
    create: { codigo: process.env.CUPON_BIENVENIDA ?? "BIENVENIDA10", tipo: "PORCENTAJE", valor: 10, unoPorCorreo: true },
    update: {}
  });

  const cuenta = await prisma.producto.count();
  const sinCondicion = await prisma.producto.count({ where: { condicion: null } });
  const sinPrecio = await prisma.producto.count({ where: { precioVenta: null } });
  const sinStock = await prisma.producto.count({ where: { stockEstado: "DESCONOCIDO" } });

  console.log(`Catálogo del ${bruto.extraccion}: ${cuenta} productos sembrados.`);
  console.log(`  · sin condición declarada: ${sinCondicion}`);
  console.log(`  · sin precio propio: ${sinPrecio}`);
  console.log(`  · sin stock conocido: ${sinStock}`);
  console.log(`  · sin imagen: ${cuenta} — no hay ni una foto de producto todavía.`);
}

sembrar()
  .then(() => prisma.$disconnect())
  .catch(async (error: unknown) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
