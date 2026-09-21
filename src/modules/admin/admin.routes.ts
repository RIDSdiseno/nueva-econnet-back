/**
 * Rutas del panel de inventario.
 *
 * Todo cuelga de `/api/panel`, y todo pasa por `panelDisponible` (503 si nadie
 * lo configuró) y `soloPanel` (401 sin sesión). La entrada tiene su propio
 * límite por IP, mucho más estrecho que el de la tienda: ahí lo que se frena
 * es probar claves, no comprar.
 */
import { Router } from "express";
import { panelDisponible, soloPanel } from "../../middlewares/admin.js";
import { env } from "../../config/env.js";
import { limitePorIp } from "../../middlewares/limites.js";
import { validarCuerpo } from "../../middlewares/validar.js";
import { altaSchema, archivoSchema, edicionSchema, entrarSchema } from "./admin.schemas.js";
import {
  alta,
  archivar,
  editar,
  entrar,
  importarCatalogo,
  moverCotizacion,
  moverPedido,
  ponerAjustes,
  ponerStock,
  quitarFoto,
  salir,
  sesion,
  subirFoto,
  verAjustes,
  verCotizacionPanel,
  verCotizaciones,
  verFotos,
  verHistorial,
  verInventario,
  verPedido,
  verPedidos
} from "./admin.controller.js";
import { cuerpoGrande } from "../../middlewares/cuerpo.js";
import { estadoPedidoSchema, estadoCotizacionSchema, importacionSchema } from "./admin.schemas.js";

export const rutasAdmin = Router();

/** Envuelve para que un `throw` dentro de un async llegue al manejador. */
const asincrono =
  (fn: (req: Parameters<typeof verInventario>[0], res: Parameters<typeof verInventario>[1]) => Promise<void>) =>
  (req: Parameters<typeof verInventario>[0], res: Parameters<typeof verInventario>[1], next: (e?: unknown) => void) => {
    fn(req, res).catch(next);
  };

rutasAdmin.get("/panel/sesion", sesion);

rutasAdmin.post("/panel/entrar", panelDisponible, limitePorIp(env.LIMITE_ENTRADAS), validarCuerpo(entrarSchema), asincrono(entrar));
rutasAdmin.post("/panel/salir", salir);

rutasAdmin.get("/panel/inventario", panelDisponible, soloPanel, asincrono(verInventario));
rutasAdmin.get("/panel/productos/:id/cambios", panelDisponible, soloPanel, asincrono(verHistorial));

rutasAdmin.post("/panel/productos", panelDisponible, soloPanel, validarCuerpo(altaSchema), asincrono(alta));
rutasAdmin.patch("/panel/productos/:id", panelDisponible, soloPanel, validarCuerpo(edicionSchema), asincrono(editar));
rutasAdmin.post("/panel/productos/:id/archivo", panelDisponible, soloPanel, validarCuerpo(archivoSchema), asincrono(archivar));
rutasAdmin.post("/panel/productos/:id/stock", panelDisponible, soloPanel, asincrono(ponerStock));

/* Pedidos. El cambio de estado pasa por la máquina de estados de siempre. */
rutasAdmin.get("/panel/pedidos", panelDisponible, soloPanel, asincrono(verPedidos));
rutasAdmin.get("/panel/pedidos/:numero", panelDisponible, soloPanel, asincrono(verPedido));
rutasAdmin.post("/panel/pedidos/:numero/estado", panelDisponible, soloPanel, validarCuerpo(estadoPedidoSchema), asincrono(moverPedido));

/* Cotizaciones de empresa. */
rutasAdmin.get("/panel/cotizaciones", panelDisponible, soloPanel, asincrono(verCotizaciones));
rutasAdmin.get("/panel/cotizaciones/:numero", panelDisponible, soloPanel, asincrono(verCotizacionPanel));
rutasAdmin.post("/panel/cotizaciones/:numero/estado", panelDisponible, soloPanel, validarCuerpo(estadoCotizacionSchema), asincrono(moverCotizacion));

/* Ajustes del negocio. Aquí no hay secretos: ver `services/ajustes.ts`. */
rutasAdmin.get("/panel/ajustes", panelDisponible, soloPanel, verAjustes);
rutasAdmin.post("/panel/ajustes", panelDisponible, soloPanel, asincrono(ponerAjustes));

/* Fotografías. `cuerpoGrande` solo aquí: el resto de la API sigue con 32 KB. */
rutasAdmin.get("/panel/medios", panelDisponible, soloPanel, asincrono(verFotos));
rutasAdmin.post("/panel/medios", panelDisponible, soloPanel, cuerpoGrande, asincrono(subirFoto));
rutasAdmin.post("/panel/medios/:id/borrar", panelDisponible, soloPanel, asincrono(quitarFoto));

/* Importación del catálogo. Por defecto es un ensayo: no toca nada. */
rutasAdmin.post("/panel/importar", panelDisponible, soloPanel, cuerpoGrande, validarCuerpo(importacionSchema), asincrono(importarCatalogo));
