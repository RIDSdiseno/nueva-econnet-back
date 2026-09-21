/**
 * Contadores atómicos. La numeración de pedidos sale de aquí: con mil pedidos
 * a la vez no puede haber dos con el mismo número.
 */
import { prisma } from "./prisma.js";

export async function siguiente(clave: string): Promise<number> {
  const fila = await prisma.contador.upsert({
    where: { clave },
    create: { clave, valor: 1 },
    update: { valor: { increment: 1 } }
  });
  return fila.valor;
}
