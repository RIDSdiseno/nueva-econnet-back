/** Utilidades de texto y de datos chilenos. */

/* Los caracteres de control son justo lo que hay que quitar: la regla está
   desactivada a propósito, no por descuido. */
// eslint-disable-next-line no-control-regex
const CONTROL = /[\x00-\x1F\x7F]/g;

export const limpiar = (v: unknown, maximo = 200): string =>
  String(v ?? "")
    .replace(CONTROL, " ")
    .replace(/[<>]/g, "")
    .trim()
    .slice(0, maximo);

export const escapar = (v: unknown): string =>
  String(v ?? "").replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export const normalizarCorreo = (v: unknown): string => String(v ?? "").trim().toLowerCase();

/**
 * RUT chileno con dígito verificador (módulo 11). Un RUT inválido en una
 * factura es un problema con el SII, no un campo feo.
 */
export function rutValido(rut: unknown): boolean {
  const limpio = String(rut ?? "").replace(/[.\s]/g, "").toUpperCase();
  const partes = limpio.match(/^(\d{7,8})-([\dK])$/);
  if (!partes) return false;

  const cuerpo = partes[1] as string;
  const dv = partes[2] as string;
  let suma = 0;
  let factor = 2;
  for (let i = cuerpo.length - 1; i >= 0; i--) {
    suma += Number(cuerpo[i]) * factor;
    factor = factor === 7 ? 2 : factor + 1;
  }
  const resto = 11 - (suma % 11);
  const esperado = resto === 11 ? "0" : resto === 10 ? "K" : String(resto);
  return dv === esperado;
}

export const normalizarRut = (rut: unknown): string => {
  const limpio = String(rut ?? "").replace(/[.\s]/g, "").toUpperCase();
  return limpio.includes("-") ? limpio : limpio.replace(/^(\d+)([\dK])$/, "$1-$2");
};

export const telefonoValido = (v: unknown): boolean =>
  /^(56)?[2-9]\d{8}$/.test(String(v ?? "").replace(/[\s()+-]/g, ""));

/** Trampa para robots: un campo que una persona nunca rellena y un tiempo mínimo. */
export function pareceRobot(cuerpo: { empresa_web?: unknown; ms?: unknown }): string | null {
  if (limpiar(cuerpo?.empresa_web, 100)) return "campo trampa relleno";
  const ms = Number(cuerpo?.ms);
  if (Number.isFinite(ms) && ms > 0 && ms < 1200) return "formulario enviado en menos de 1,2 s";
  return null;
}

export const slugificar = (texto: string): string =>
  texto
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 70);
