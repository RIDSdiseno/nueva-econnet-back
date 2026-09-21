import { z } from "zod";
import { REGIONES } from "../../services/envios.js";
import { rutValido, telefonoValido } from "../../services/texto.js";

export const lineaSchema = z.object({ productoId: z.string().min(1).max(80), cantidad: z.number().int().min(1).max(20) }).strict();

export const despachoSchema = z
  .object({
    modo: z.enum(["DESPACHO", "RETIRO"]),
    region: z.enum(REGIONES).optional(),
    comuna: z.string().max(60).optional(),
    direccion: z.string().max(160).optional(),
    notas: z.string().max(200).optional()
  })
  .strict()
  .refine((d) => d.modo === "RETIRO" || (!!d.region && !!d.comuna && (d.direccion ?? "").length >= 5), {
    message: "Para despacho hacen falta región, comuna y dirección."
  });

export const documentoSchema = z
  .object({
    tipo: z.enum(["BOLETA", "FACTURA"]),
    rut: z.string().max(20).optional(),
    razonSocial: z.string().max(120).optional(),
    giro: z.string().max(120).optional(),
    direccion: z.string().max(160).optional()
  })
  .strict()
  .refine((d) => d.tipo === "BOLETA" || (!!d.razonSocial && !!d.giro), {
    message: "Para factura hacen falta razón social y giro."
  })
  .refine((d) => d.tipo === "BOLETA" || rutValido(d.rut), {
    message: "Ese RUT no pasa la comprobación del dígito verificador."
  });

export const totalesSchema = z
  .object({
    items: z.array(lineaSchema).max(30).default([]),
    despacho: z
      .object({ modo: z.enum(["DESPACHO", "RETIRO"]).default("DESPACHO"), region: z.enum(REGIONES).optional() })
      .strict()
      .default({ modo: "DESPACHO" }),
    cupon: z.string().max(40).optional(),
    correo: z.string().email().max(254).optional()
  })
  .strict();

export const crearPedidoSchema = z
  .object({
    items: z.array(lineaSchema).min(1).max(30),
    nombre: z.string().min(3).max(80),
    correo: z.string().email().max(254),
    telefono: z.string().max(30).optional().refine((t) => !t || telefonoValido(t), { message: "Ese teléfono no parece chileno." }),
    despacho: despachoSchema,
    documento: documentoSchema,
    cupon: z.string().max(40).optional(),
    carritoId: z.string().uuid().optional(),
    idempotencia: z.string().min(8).max(64),
    /**
     * El total que el checkout tenía en pantalla. **Lo único que se acepta del
     * navegador sobre dinero, y solo puede frenar la venta**: si el total real
     * subió respecto a este, el pedido no se crea y se vuelve a enseñar. Nunca
     * fija un precio, así que manipularlo no sirve para pagar menos.
     */
    totalEsperado: z.number().int().min(0).max(999_999_999).optional(),
    /** Obligatorio: aceptar las condiciones de compra. */
    terminos: z.literal(true, { errorMap: () => ({ message: "Hay que aceptar los términos y la política de privacidad." }) }),
    /** Opcional y distinto: recibir publicidad. */
    consentimiento: z.boolean().optional(),
    empresa_web: z.string().max(100).optional(),
    ms: z.number().optional()
  })
  .strict();

/**
 * Seguir un pedido: o con número y correo —lo que se teclea— o con el enlace
 * firmado del correo, que no hay que teclear ni se puede adivinar.
 */
export const seguimientoSchema = z.union([
  z.object({ t: z.string().min(10).max(1024) }).strict(),
  z.object({ numero: z.string().min(5).max(32), correo: z.string().email().max(254) }).strict()
]);

export type CrearPedido = z.infer<typeof crearPedidoSchema>;
export type Totales = z.infer<typeof totalesSchema>;
