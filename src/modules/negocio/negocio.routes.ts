/**
 * Lo público que sale de los ajustes: los datos del negocio y las fotos.
 *
 * Esto existe para que cambiar el RUT o subir una foto **no sea un
 * despliegue**. Antes la razón social venía de una variable `VITE_*`, que se
 * hornea en el paquete del navegador: corregir una letra obligaba a
 * reconstruir y volver a publicar la web entera.
 */
import { Router } from "express";
import { ajuste } from "../../services/ajustes.js";
import { verMedio } from "../../services/medios.js";
import { noEncontrado } from "../../middlewares/errores.js";

export const rutasNegocio = Router();

/**
 * Los datos que la tienda enseña. Lo que no está puesto sale `null`, y la web
 * pinta el hueco en ámbar: nunca una razón social plausible.
 */
rutasNegocio.get("/negocio", (_req, res) => {
  const oNulo = (clave: string): string | null => ajuste(clave) || null;
  res.set("Cache-Control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  res.json({
    ok: true,
    negocio: {
      razonSocial: oNulo("RAZON_SOCIAL"),
      rut: oNulo("RUT_EMPRESA"),
      direccion: oNulo("DIRECCION"),
      telefono: oNulo("TELEFONO"),
      horario: oNulo("HORARIO"),
      correo: oNulo("CORREO_RESPONDER_A"),
      whatsapp: oNulo("WHATSAPP")
    }
  });
});

/**
 * Una foto. Se sirve con el tipo **detectado al subirla**, no con el que dijo
 * el navegador, `nosniff` para que el cliente tampoco adivine, y `inline` con
 * un nombre que es su propio identificador. El id es un UUID y el contenido no
 * cambia nunca, así que se puede cachear para siempre.
 */
rutasNegocio.get("/medios/:id", async (req, res, next) => {
  const medio = await verMedio(String(req.params.id));
  if (!medio) return next(noEncontrado("No existe esa imagen"));

  const etiqueta = `"${medio.id}"`;
  if (req.headers["if-none-match"] === etiqueta) {
    res.status(304).end();
    return;
  }

  res.set({
    "Content-Type": medio.tipo,
    "Content-Length": String(medio.bytes),
    "Cache-Control": "public, max-age=31536000, immutable",
    ETag: etiqueta,
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": `inline; filename="${medio.id}"`,
    /* La API tiene `default-src 'none'`, que basta; esto es el cinturón por si
       algún día alguien abre la imagen directamente en una pestaña. */
    "Content-Security-Policy": "default-src 'none'; sandbox"
  });
  res.end(Buffer.from(medio.datos));
});
