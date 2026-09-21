import type { Request, Response } from "express";
import { peticionInvalida, noEncontrado } from "../../middlewares/errores.js";
import { buscarCarrito, cambiarEstadoCarrito, guardar } from "../../services/carritos.service.js";
import { registrarLead } from "../../services/leads.service.js";
import { normalizarCorreo, pareceRobot } from "../../services/texto.js";
import type { GuardarCarrito } from "./carritos.schemas.js";

export async function verCarrito(req: Request, res: Response): Promise<void> {
  const carrito = await buscarCarrito(String(req.params.id));
  if (!carrito) throw noEncontrado("No existe ese carrito");
  res.json({
    ok: true,
    carrito: {
      id: carrito.id,
      estado: carrito.estado,
      valor: carrito.valor,
      items: carrito.items.map((i) => ({ productoId: i.productoId, cantidad: i.cantidad }))
    }
  });
}

export async function guardarCarritoControlador(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as GuardarCarrito;

  if (pareceRobot(cuerpo)) {
    res.json({ ok: true, mensaje: "Listo." });
    return;
  }

  if (cuerpo.estado && cuerpo.id) {
    const estado = cuerpo.estado === "comprado" ? "COMPRADO" : "PARADO";
    const cambiado = await cambiarEstadoCarrito(cuerpo.id, estado);
    res.json({ ok: true, carrito: { id: cambiado.id, estado: cambiado.estado } });
    return;
  }

  const correo = cuerpo.correo ? normalizarCorreo(cuerpo.correo) : null;
  if (correo && cuerpo.consentimiento !== true) {
    throw peticionInvalida("Falta el consentimiento para avisarte de este carrito.");
  }

  const carrito = await guardar({
    id: cuerpo.id ?? null,
    lineas: cuerpo.items,
    correo,
    consiente: correo ? true : false
  });

  if (correo) {
    await registrarLead({ correo, origen: "carrito", etiquetas: ["carrito"] });
  }

  res.json({
    ok: true,
    carrito: { id: carrito.id, estado: carrito.estado, valor: carrito.valor },
    avisos: Boolean(correo)
  });
}
