import { z } from "zod";

export const suscribirSchema = z
  .object({
    correo: z.string().email().max(254),
    nombre: z.string().max(80).optional(),
    origen: z.enum(["boletin", "guia", "test", "aviso-precio", "carrito"]).default("boletin"),
    consentimiento: z.literal(true, { errorMap: () => ({ message: "Falta el consentimiento para recibir correos." }) }),
    recomendados: z.array(z.string().max(80)).max(3).optional(),
    empresa_web: z.string().max(100).optional(),
    ms: z.number().optional()
  })
  .strict();

/* El esquema de cotizar vive en modules/cotizaciones: es su dominio. */

export const bajaSchema = z.object({ t: z.string().min(10).max(1024) }).strict();
