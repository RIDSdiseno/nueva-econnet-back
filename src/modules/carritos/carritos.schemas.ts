import { z } from "zod";

export const lineaSchema = z
  .object({
    productoId: z.string().min(1).max(80),
    cantidad: z.number().int().min(1).max(20)
  })
  .strict();

export const guardarCarritoSchema = z
  .object({
    id: z.string().uuid().optional(),
    items: z.array(lineaSchema).max(30).default([]),
    correo: z.string().email().max(254).optional(),
    consentimiento: z.boolean().optional(),
    estado: z.enum(["comprado", "parado"]).optional(),
    /* Trampa para robots y tiempo de formulario: se aceptan y se ignoran. */
    empresa_web: z.string().max(100).optional(),
    ms: z.number().optional()
  })
  .strict();

export type GuardarCarrito = z.infer<typeof guardarCarritoSchema>;
