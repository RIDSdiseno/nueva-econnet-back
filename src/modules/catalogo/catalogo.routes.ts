/** Catálogo público. Es lo único cacheable de toda la API. */
import { Router } from "express";
import { catalogoCompleto, precioReferencia, productoPorSlug, publicable, seVende } from "../../services/catalogo.service.js";
import { noEncontrado } from "../../middlewares/errores.js";

export const rutasCatalogo = Router();

const aRespuesta = (producto: Awaited<ReturnType<typeof productoPorSlug>>) => {
  if (!producto) return null;
  const referencia = precioReferencia(producto);
  return {
    id: producto.id,
    slug: producto.slug,
    sku: producto.sku,
    marca: producto.marca,
    nombre: producto.nombre,
    etiqueta: producto.etiqueta,
    color: producto.color,
    categoria: producto.categoria,
    subcategoria: producto.subcategoria,
    tipoProducto: producto.tipoProducto,
    modelo: producto.modelo,
    condicion: producto.condicion,
    garantia: producto.garantia,
    precio: { lista: producto.precioLista, venta: producto.precioVenta },
    marketplaces: { falabella: producto.precioFalabella, lider: producto.precioLider },
    referencia,
    stock: { estado: producto.stockEstado, unidades: producto.stockUnidades, reservadas: producto.reservadas },
    specs: producto.specs,
    usos: producto.usos,
    valores: producto.valores,
    para: producto.para,
    noPara: producto.noPara,
    alerta: producto.alerta,
    descripcionCorta: producto.descripcionCorta,
    descripcionLarga: producto.descripcionLarga,
    /* Sin foto no se manda una de relleno: la tarjeta dibuja un equipo genérico. */
    imagenUrl: producto.imagenUrl,
    imagenAlt: producto.imagenAlt ?? (producto.imagenUrl ? `${producto.marca} ${producto.nombre}` : null),
    imagenes: producto.imagenes,
    fuente: producto.fuente,
    fechaDato: producto.fechaDato,
    confianza: producto.confianza,
    seVende: seVende(producto),
    publicable: publicable(producto)
  };
};

rutasCatalogo.get("/catalogo", async (_req, res) => {
  const productos = await catalogoCompleto();
  res.set("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=86400");
  res.json({ ok: true, productos: productos.map(aRespuesta) });
});

rutasCatalogo.get("/catalogo/:slug", async (req, res, next) => {
  const producto = await productoPorSlug(String(req.params.slug));
  if (!producto) return next(noEncontrado("No existe ese producto"));
  res.set("Cache-Control", "public, max-age=60, s-maxage=600, stale-while-revalidate=86400");
  res.json({ ok: true, producto: aRespuesta(producto) });
});
