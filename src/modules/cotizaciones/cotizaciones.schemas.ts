import { z } from "zod";
import { PERFILES_VALIDOS } from "../../services/propuestas.service.js";
import { rutValido } from "../../services/texto.js";

export const cotizarSchema = z
  .object({
    correo: z.string().email().max(254),
    nombre: z.string().max(80).optional(),
    empresa: z.string().max(120).optional(),
    rut: z.string().max(20).optional().refine((r) => !r || rutValido(r), { message: "Ese RUT no pasa la comprobación del dígito verificador." }),
    telefono: z.string().max(30).optional(),
    equipos: z.number().int().min(1).max(5000),
    perfil: z.enum(PERFILES_VALIDOS as [string, ...string[]]),
    presupuesto: z.number().int().min(0).max(20_000_000),
    accesorios: z.boolean(),
    consentimiento: z.literal(true, { errorMap: () => ({ message: "Falta aceptar que te contactemos." }) }),
    empresa_web: z.string().max(100).optional(),
    ms: z.number().optional()
  })
  .strict();

export const verCotizacionSchema = z
  .object({
    numero: z.string().min(6).max(24),
    correo: z.string().email().max(254)
  })
  .strict();

export const aceptarSchema = z.object({ t: z.string().min(10).max(1024) }).strict();

export type Cotizar = z.infer<typeof cotizarSchema>;
