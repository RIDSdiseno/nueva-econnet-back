/**
 * Dinero. Pesos chilenos, sin decimales, y el IVA como lo pide el SII: el
 * precio mostrado ya lo lleva dentro y la factura lo separa.
 */
export const IVA = 0.19;

export const clp = (n: number): string => "$" + Math.round(n || 0).toLocaleString("es-CL");

export interface Desglose {
  neto: number;
  iva: number;
  total: number;
}

export function desglosar(conIva: number): Desglose {
  const total = Math.round(conIva || 0);
  const neto = Math.round(total / (1 + IVA));
  return { neto, iva: total - neto, total };
}

export const sumarLineas = (lineas: Array<{ precio: number; cantidad: number }>): number =>
  lineas.reduce((t, l) => t + l.precio * l.cantidad, 0);
