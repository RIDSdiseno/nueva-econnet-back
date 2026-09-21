import type { Request, Response } from "express";
import { enviar } from "../../services/correo.js";
import { comprobar } from "../../services/firma.js";
import { darDeBaja, enlacesDe, registrarLead } from "../../services/leads.service.js";
import { bienvenida, guia, resultadoTest } from "../../services/plantillas.js";
import { productoPorId, precioReferencia } from "../../services/catalogo.service.js";
import { cambiarEstadoCarrito } from "../../repositories/carritos.repository.js";
import { normalizarCorreo, pareceRobot, escapar } from "../../services/texto.js";
import type { Producto } from "@prisma/client";

const aProductoCorreo = (p: Producto) => {
  const specs = (p.specs ?? {}) as Record<string, string | null>;
  return {
    marca: p.marca,
    nombre: p.nombre,
    condicion: p.condicion,
    precioVenta: precioReferencia(p).propio ? p.precioVenta : null,
    ram: specs.ram ?? null,
    almacenamiento: specs.almacenamiento ?? null,
    gpu: specs.gpu ?? null,
    so: specs.so ?? null,
    para: p.para,
    noPara: p.noPara
  };
};

export async function suscribir(req: Request, res: Response): Promise<void> {
  const cuerpo = req.body as {
    correo: string; nombre?: string; origen: string; recomendados?: string[]; empresa_web?: string; ms?: number;
  };

  if (pareceRobot(cuerpo)) {
    res.json({ ok: true, mensaje: "Listo." });
    return;
  }

  const correo = normalizarCorreo(cuerpo.correo);
  await registrarLead({ correo, nombre: cuerpo.nombre ?? null, origen: cuerpo.origen, etiquetas: [cuerpo.origen] });
  const enlaces = enlacesDe(correo);

  let pieza = bienvenida(enlaces);
  if (cuerpo.origen === "guia") pieza = guia(enlaces);
  else if (cuerpo.origen === "test" && cuerpo.recomendados?.length) {
    const productos = (await Promise.all(cuerpo.recomendados.map((id) => productoPorId(id)))).filter(Boolean) as Producto[];
    if (productos.length) pieza = resultadoTest(enlaces, productos.map(aProductoCorreo));
  }

  const resultado = await enviar({ ...pieza, para: correo, bajaUrl: enlaces.baja });
  res.json({
    ok: true,
    mensaje: resultado.enviado ? "Te llegó un correo." : "Anotado. El correo sale en cuanto podamos.",
    origen: cuerpo.origen
  });
}

const pagina = (titulo: string, cuerpo: string): string => `<!doctype html><html lang="es-CL"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapar(titulo)} · Econnet</title></head>
<body style="margin:0;background:#07090F;color:#E9EEFB;font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif">
<div style="max-width:520px;margin:0 auto;padding:18vh 24px">
<div style="font-size:20px;font-weight:600;letter-spacing:-.04em;margin-bottom:26px">econnet</div>
<h1 style="font-size:28px;line-height:1.2;letter-spacing:-.03em;margin:0 0 12px">${escapar(titulo)}</h1>
<p style="font-size:16px;line-height:1.6;color:#B9C3DC;margin:0">${escapar(cuerpo)}</p>
</div></body></html>`;

export async function baja(req: Request, res: Response): Promise<void> {
  const datos = comprobar((req.consultaValidada as { t: string }).t);
  res.type("html");

  if (!datos) {
    res.status(400).send(pagina("Ese enlace ya no vale", "Puede haber caducado. Si quieres dejar de recibir correos, respóndenos a cualquiera de ellos y lo hacemos a mano."));
    return;
  }

  if (datos.a === "parar" && datos.k) {
    await cambiarEstadoCarrito(datos.k, "PARADO").catch(() => null);
    res.send(pagina("Listo, no te escribimos más por ese carrito", "El carrito queda guardado por si lo retomas. Los demás correos de Econnet siguen igual."));
    return;
  }

  if (datos.a === "baja" && datos.c) {
    await darDeBaja(datos.c, "enlace");
    res.send(pagina("Te diste de baja", "No vas a recibir más correos de Econnet. Si fue sin querer, escríbenos y te volvemos a poner."));
    return;
  }

  res.status(400).send(pagina("No entendimos la petición", "Escríbenos y lo resolvemos a mano."));
}
