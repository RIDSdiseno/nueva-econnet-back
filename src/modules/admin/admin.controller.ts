/** El panel. El controlador no toca la base: llama al servicio y responde. */
import type { Request, Response } from "express";
import { z } from "zod";
import { abrirSesion, claveCorrecta, panelConfigurado } from "../../services/admin.js";
import { cookieDe, COOKIE, galletaBorrada, galletaDeSesion } from "../../middlewares/admin.js";
import { sesionValida } from "../../services/admin.js";
import { logger } from "../../config/logger.js";
import { noAutorizado, noEncontrado, peticionInvalida } from "../../middlewares/errores.js";
import {
  altaDeProducto,
  archivarProducto,
  editarProducto,
  fijarUnidades,
  historial,
  historialDe,
  inventario
} from "../../services/inventario.service.js";
import { buscarPedido, buscarPedidos, contarPorEstado, eventosDe } from "../../repositories/pedidos.repository.js";
import { cambiarEstado } from "../../services/pedidos.service.js";
import { TRANSICIONES } from "../../services/estados-pedido.js";
import {
  buscarCotizacion,
  buscarCotizaciones,
  cambiarEstadoCotizacion,
  contarCotizacionesPorEstado
} from "../../repositories/cotizaciones.repository.js";
import { ajuste, CATALOGO_AJUSTES, esAjusteConocido, guardarAjustes, origenDe } from "../../services/ajustes.js";
import { catalogoDeMedios, quitarMedio, subir } from "../../services/medios.js";
import { importar } from "../../services/importacion.service.js";
import { aCotizacionPanel, aPedidoPanel } from "./admin.vistas.js";
import { unidades, type Alta, type Edicion } from "./admin.schemas.js";

export async function entrar(req: Request, res: Response): Promise<void> {
  const { clave } = req.body as { clave: string };
  if (!(await claveCorrecta(clave))) {
    /* Sin decir si la clave existe o no: es una sola clave, y el detalle solo
       serviría a quien la está probando. Queda en el registro con la IP. */
    logger.warn({ ip: req.ip }, "intento fallido de entrar al panel");
    throw noAutorizado("Clave incorrecta");
  }
  res.setHeader("Set-Cookie", galletaDeSesion(abrirSesion()));
  res.json({ ok: true, entrado: true });
}

export function salir(_req: Request, res: Response): void {
  res.setHeader("Set-Cookie", galletaBorrada());
  res.json({ ok: true, entrado: false });
}

/** Para que el panel sepa si pintar la pantalla o el formulario de entrada. */
export function sesion(req: Request, res: Response): void {
  res.json({
    ok: true,
    configurado: panelConfigurado(),
    entrado: panelConfigurado() && sesionValida(cookieDe(req, COOKIE))
  });
}

export async function verInventario(_req: Request, res: Response): Promise<void> {
  const { productos, resumen } = await inventario();
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, productos, resumen, cambios: await historial(20) });
}

export async function verHistorial(req: Request, res: Response): Promise<void> {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, cambios: await historialDe(String(req.params.id)) });
}

export async function alta(req: Request, res: Response): Promise<void> {
  const producto = await altaDeProducto(req.body as Alta);
  logger.info({ id: producto.id }, "alta de producto desde el panel");
  res.status(201).json({ ok: true, producto });
}

export async function editar(req: Request, res: Response): Promise<void> {
  const producto = await editarProducto(String(req.params.id), req.body as Edicion);
  res.json({ ok: true, producto });
}

export async function archivar(req: Request, res: Response): Promise<void> {
  const { archivar: quitar, motivo } = req.body as { archivar: boolean; motivo?: string };
  const producto = await archivarProducto(String(req.params.id), quitar, motivo);
  res.json({ ok: true, producto });
}

/* Las mismas unidades que el resto del panel: una sola definición, para que
   no vuelva a haber dos reglas distintas para el mismo número. */
const stockSchema = z.object({ unidades, motivo: z.string().trim().max(200).optional() }).strict();

export async function ponerStock(req: Request, res: Response): Promise<void> {
  const leido = stockSchema.safeParse(req.body);
  if (!leido.success) throw peticionInvalida("Las unidades son un entero de 0 en adelante, o null si no consta.");
  const producto = await fijarUnidades(String(req.params.id), leido.data.unidades, leido.data.motivo);
  res.json({ ok: true, producto });
}

/* ── Pedidos ──────────────────────────────────────────────────────────────
   El panel de pedidos no inventa transiciones: llama a la misma
   `cambiarEstado` que usa el resto del sistema, con su máquina de estados y
   su efecto sobre el stock. Una pantalla que pudiera saltarse esa máquina
   sería una forma cara de descuadrar el inventario. */

export async function verPedidos(req: Request, res: Response): Promise<void> {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const texto = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const [pedidos, cuentas] = await Promise.all([
    buscarPedidos({ estado: estado as never, texto: texto || undefined }),
    contarPorEstado()
  ]);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, pedidos: pedidos.map(aPedidoPanel), cuentas, transiciones: TRANSICIONES });
}

export async function verPedido(req: Request, res: Response): Promise<void> {
  const pedido = await buscarPedido(String(req.params.numero));
  if (!pedido) throw noEncontrado("Ese pedido no existe");
  const eventos = await eventosDe(pedido.id);
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    pedido: aPedidoPanel(pedido),
    eventos: eventos.map((e) => ({ estado: e.estado, nota: e.nota, fecha: e.fecha.toISOString() })),
    siguientes: TRANSICIONES[pedido.estado] ?? []
  });
}

export async function moverPedido(req: Request, res: Response): Promise<void> {
  const { estado, nota } = req.body as { estado: string; nota?: string };
  const pedido = await cambiarEstado(String(req.params.numero), estado as never, nota ?? "cambiado desde el panel");
  if (!pedido) throw noEncontrado("Ese pedido no existe");
  logger.info({ numero: pedido.numero, estado }, "estado de pedido cambiado desde el panel");
  res.json({ ok: true, pedido: aPedidoPanel(pedido) });
}

/* ── Cotizaciones ─────────────────────────────────────────────────────── */

export async function verCotizaciones(req: Request, res: Response): Promise<void> {
  const estado = typeof req.query.estado === "string" ? req.query.estado : undefined;
  const texto = typeof req.query.q === "string" ? req.query.q.trim() : undefined;
  const [cotizaciones, cuentas] = await Promise.all([
    buscarCotizaciones({ estado: estado as never, texto: texto || undefined }),
    contarCotizacionesPorEstado()
  ]);
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, cotizaciones: cotizaciones.map(aCotizacionPanel), cuentas });
}

export async function verCotizacionPanel(req: Request, res: Response): Promise<void> {
  const cotizacion = await buscarCotizacion(String(req.params.numero));
  if (!cotizacion) throw noEncontrado("Esa cotización no existe");
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, cotizacion: { ...aCotizacionPanel(cotizacion), propuesta: cotizacion.propuesta, huecos: cotizacion.huecos } });
}

export async function moverCotizacion(req: Request, res: Response): Promise<void> {
  const { estado } = req.body as { estado: string };
  const actual = await buscarCotizacion(String(req.params.numero));
  if (!actual) throw noEncontrado("Esa cotización no existe");
  /* Al cerrarla, se para el seguimiento: perseguir una cotización ya ganada o
     ya perdida es la forma más rápida de perder al cliente. */
  const cerrada = estado === "ACEPTADA" || estado === "PERDIDA" || estado === "CADUCADA";
  const cotizacion = await cambiarEstadoCotizacion(actual.numero, estado as never, cerrada ? { proximoCorreo: null } : {});
  res.json({ ok: true, cotizacion: aCotizacionPanel(cotizacion) });
}

/* ── Ajustes del negocio ──────────────────────────────────────────────── */

export function verAjustes(_req: Request, res: Response): void {
  res.set("Cache-Control", "no-store");
  res.json({
    ok: true,
    ajustes: CATALOGO_AJUSTES.map((d) => ({
      clave: d.clave,
      grupo: d.grupo,
      etiqueta: d.etiqueta,
      ayuda: d.ayuda,
      tipo: d.tipo,
      ejemplo: d.ejemplo ?? null,
      siFalta: d.siFalta,
      valor: ajuste(d.clave),
      origen: origenDe(d.clave)
    }))
  });
}

export async function ponerAjustes(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as Record<string, unknown>;
  const pares: Record<string, string> = {};
  for (const [clave, valor] of Object.entries(cuerpo)) {
    if (!esAjusteConocido(clave)) throw peticionInvalida(`«${clave}» no es un ajuste del negocio.`);
    if (typeof valor !== "string") throw peticionInvalida(`«${clave}» tiene que venir como texto.`);
    if (valor.length > 4000) throw peticionInvalida(`«${clave}» es demasiado largo.`);
    pares[clave] = valor;
  }
  const cambiados = await guardarAjustes(pares);
  logger.info({ cambiados }, "ajustes del negocio cambiados desde el panel");
  verAjustes(req, res);
}

/* ── Fotografías ──────────────────────────────────────────────────────── */

export async function subirFoto(req: Request, res: Response): Promise<void> {
  const { datos, nombre } = req.body as { datos?: string; nombre?: string };
  if (typeof datos !== "string" || !datos) throw peticionInvalida("No llegó ninguna imagen.");
  const medio = await subir(datos, typeof nombre === "string" ? nombre : "");
  logger.info({ id: medio.id, bytes: medio.bytes, tipo: medio.tipo }, "foto subida desde el panel");
  res.status(201).json({ ok: true, medio });
}

export async function verFotos(_req: Request, res: Response): Promise<void> {
  res.set("Cache-Control", "no-store");
  res.json({ ok: true, medios: await catalogoDeMedios() });
}

export async function quitarFoto(req: Request, res: Response): Promise<void> {
  await quitarMedio(String(req.params.id));
  res.json({ ok: true });
}

/* ── Importación ──────────────────────────────────────────────────────── */

export async function importarCatalogo(req: Request, res: Response): Promise<void> {
  const { csv, aplicar } = req.body as { csv?: string; aplicar?: boolean };
  if (typeof csv !== "string" || !csv.trim()) throw peticionInvalida("No llegó ningún CSV.");
  if (csv.length > 4_000_000) throw peticionInvalida("El CSV pasa de 4 MB. Pártelo en dos.");

  const informe = await importar(csv, aplicar !== true);
  if (aplicar === true) {
    logger.info({ altas: informe.altas, cambios: informe.cambios }, "catálogo importado desde el panel");
  }
  res.json({ ok: true, informe });
}
