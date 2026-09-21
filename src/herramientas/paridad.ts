/**
 * `npm run paridad` — la comparación de precios contra los marketplaces, por
 * terminal. Es una herramienta interna: enseña margen, así que no vive en una
 * URL pública.
 */
import { paridad, comoTexto } from "../services/paridad.service.js";
import { prisma } from "../repositories/prisma.js";

const informe = await paridad();
console.log(comoTexto(informe));
await prisma.$disconnect();
