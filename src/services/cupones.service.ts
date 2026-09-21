/** Cupones: comprobar, calcular y consumir. El descuento siempre en servidor. */
import type { Cupon } from "@prisma/client";
import { buscarCupon, consumirCupon, devolverCupon, yaLoUso } from "../repositories/cupones.repository.js";
import { huella } from "./firma.js";

export interface ResultadoCupon {
  ok: boolean;
  descuento: number;
  cupon: Cupon | null;
  motivo: string;
}

/** Comprueba y calcula, sin consumir. Nunca lanza: un cupón malo no tumba un checkout. */
export async function aplicarCupon(datos: { codigo?: string | null; subtotal: number; correo?: string | null }): Promise<ResultadoCupon> {
  const codigo = (datos.codigo ?? "").trim().toUpperCase();
  if (!codigo) return { ok: false, descuento: 0, cupon: null, motivo: "" };

  const cupon = await buscarCupon(codigo);
  if (!cupon) return { ok: false, descuento: 0, cupon: null, motivo: "Ese cupón no existe." };
  if (cupon.caduca && cupon.caduca < new Date()) return { ok: false, descuento: 0, cupon: null, motivo: "Ese cupón ya venció." };
  if (cupon.minimo && datos.subtotal < cupon.minimo) {
    return { ok: false, descuento: 0, cupon: null, motivo: `Este cupón aplica desde $${cupon.minimo.toLocaleString("es-CL")}.` };
  }
  if (cupon.usos !== null && cupon.usados >= cupon.usos) {
    return { ok: false, descuento: 0, cupon: null, motivo: "Ese cupón ya se agotó." };
  }
  if (cupon.unoPorCorreo && datos.correo && (await yaLoUso(cupon.codigo, huella(datos.correo)))) {
    return { ok: false, descuento: 0, cupon: null, motivo: "Ese cupón ya lo usaste." };
  }

  const descuento =
    cupon.tipo === "MONTO" ? Math.min(cupon.valor, datos.subtotal) : Math.round(datos.subtotal * (cupon.valor / 100));

  return { ok: true, descuento, cupon, motivo: "" };
}

export const consumir = (cupon: Cupon, correo: string | null): Promise<boolean> =>
  consumirCupon(cupon, correo ? huella(correo) : null);

export const devolver = (codigo: string, correo: string | null): Promise<void> =>
  devolverCupon(codigo, correo ? huella(correo) : null);
