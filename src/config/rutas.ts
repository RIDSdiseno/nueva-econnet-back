/**
 * Las rutas de la tienda a las que apuntan los correos.
 *
 * Están aquí, juntas y una sola vez, porque ya pasó lo que tenía que pasar:
 * la migración cambió las URLs y los correos siguieron apuntando a las
 * viejas. `/tienda/carrito` caía en la ficha de un producto que no existe —y
 * era el enlace del correo de carrito abandonado, el que trae la venta de
 * vuelta—, y `/tienda/seguimiento` no llevaba a ninguna parte.
 *
 * Si cambia una ruta de la tienda, se cambia aquí. La prueba de extremo a
 * extremo comprueba que todas estas resuelven de verdad.
 */
export const RUTAS_TIENDA = {
  inicio: "/",
  tienda: "/tienda",
  producto: (slug: string) => `/tienda/${slug}`,
  carrito: "/carrito",
  seguimiento: "/seguimiento",
  cotizacion: "/cotizacion",
  guia: "/guia-de-compra",
  empresas: "/empresas"
} as const;

/** Todas las rutas fijas, para poder comprobarlas de una pasada. */
export const RUTAS_ENLAZADAS: string[] = [
  RUTAS_TIENDA.inicio,
  RUTAS_TIENDA.tienda,
  RUTAS_TIENDA.carrito,
  RUTAS_TIENDA.seguimiento,
  RUTAS_TIENDA.cotizacion,
  RUTAS_TIENDA.guia,
  RUTAS_TIENDA.empresas
];
