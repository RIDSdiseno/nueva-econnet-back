/**
 * Cotizaciones de empresa. La diferencia con antes: la empresa se va de la
 * página **con la propuesta en la mano**, no con un «te contactamos pronto».
 */
import type { Request, Response } from "express";
import { env } from "../../config/env.js";
import { noEncontrado } from "../../middlewares/errores.js";
import { comprobar } from "../../services/firma.js";
import { registrarLead } from "../../services/leads.service.js";
import { normalizarCorreo, pareceRobot } from "../../services/texto.js";
import { buscarCotizacion } from "../../repositories/cotizaciones.repository.js";
import { aceptar, cotizar as cotizarServicio, marcarVista, propuestaDe } from "../../services/cotizaciones.service.js";
import type { Cotizar } from "./cotizaciones.schemas.js";

export async function crearCotizacionControlador(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as Cotizar;

  if (pareceRobot(cuerpo)) {
    res.json({ ok: true, mensaje: "Listo." });
    return;
  }

  const correo = normalizarCorreo(cuerpo.correo);
  const { cotizacion, propuesta } = await cotizarServicio({
    correo,
    nombre: cuerpo.nombre ?? null,
    empresa: cuerpo.empresa ?? null,
    rut: cuerpo.rut ?? null,
    telefono: cuerpo.telefono ?? null,
    equipos: cuerpo.equipos,
    perfil: cuerpo.perfil,
    presupuesto: cuerpo.presupuesto,
    accesorios: cuerpo.accesorios
  });

  await registrarLead({ correo, nombre: cuerpo.nombre ?? null, origen: "cotizador", etiquetas: ["empresa"] });

  res.status(201).json({
    ok: true,
    numero: cotizacion.numero,
    validaHasta: cotizacion.validaHasta.toISOString(),
    propuesta: {
      etiquetaPerfil: propuesta.etiquetaPerfil,
      lineas: propuesta.lineas,
      alternativas: propuesta.alternativas,
      subtotal: propuesta.subtotal,
      descuento: propuesta.descuento,
      descuentoPorcentaje: propuesta.descuentoPorcentaje,
      neto: propuesta.neto,
      iva: propuesta.iva,
      total: propuesta.total,
      huecos: propuesta.huecos
    }
  });
}

/** Ver la cotización: número + correo, igual que el seguimiento de un pedido. */
export async function verCotizacion(req: Request, res: Response): Promise<void> {
  const { numero, correo } = req.consultaValidada as { numero: string; correo: string };

  const cotizacion = await buscarCotizacion(numero.trim().toUpperCase());
  if (!cotizacion || cotizacion.correo !== normalizarCorreo(correo)) {
    throw noEncontrado("No encontramos esa cotización con ese correo");
  }

  await marcarVista(cotizacion.numero);
  const propuesta = propuestaDe(cotizacion);

  res.json({
    ok: true,
    cotizacion: {
      numero: cotizacion.numero,
      estado: cotizacion.estado === "ENVIADA" ? "VISTA" : cotizacion.estado,
      empresa: cotizacion.empresa,
      equipos: cotizacion.equipos,
      creada: cotizacion.creado.toISOString(),
      validaHasta: cotizacion.validaHasta.toISOString(),
      caducada: cotizacion.validaHasta < new Date(),
      propuesta: {
        etiquetaPerfil: propuesta.etiquetaPerfil,
        lineas: propuesta.lineas,
        alternativas: propuesta.alternativas,
        subtotal: propuesta.subtotal,
        descuento: propuesta.descuento,
        descuentoPorcentaje: propuesta.descuentoPorcentaje,
        neto: propuesta.neto,
        iva: propuesta.iva,
        total: propuesta.total,
        huecos: propuesta.huecos
      }
    }
  });
}

/**
 * Aceptar desde el correo. El enlace va firmado: sin la firma no se puede
 * aceptar la cotización de otro escribiendo un número a mano.
 */
export async function aceptarCotizacion(req: Request, res: Response): Promise<void> {
  const { t } = req.consultaValidada as { t: string };
  const datos = comprobar(t);
  const base = env.SITIO_PUBLICO.replace(/\/$/, "");

  if (!datos || datos.a !== "cotizacion" || !datos.c || !datos.k) {
    res.redirect(303, `${base}/cotizacion?estado=enlace-caducado`);
    return;
  }

  const resultado = await aceptar(datos.k, normalizarCorreo(datos.c));
  const estado = resultado.ok ? "aceptada" : (resultado.motivo ?? "error");
  res.redirect(303, `${base}/cotizacion?n=${encodeURIComponent(datos.k)}&estado=${encodeURIComponent(estado)}`);
}
