/**
 * Las fotografías que se suben desde el panel.
 *
 * **El tipo se detecta de los primeros bytes, no de lo que diga el navegador.**
 * Un fichero que se llama `foto.jpg`, se declara `image/jpeg` y por dentro es
 * HTML con un `<script>` se serviría como HTML si nos fiáramos del nombre.
 * Aquí se miran las firmas, y lo que no es JPEG, PNG o WebP no entra.
 *
 * **SVG queda fuera a propósito**, aunque sea una imagen: puede llevar
 * JavaScript dentro y se ejecuta al abrirlo directamente.
 */
import { guardarMedio, borrarMedio, leerMedio, listarMedios } from "../repositories/medios.repository.js";
import { peticionInvalida } from "../middlewares/errores.js";

/** 4 MB. Una foto de producto bien exportada no llega ni de lejos. */
export const TOPE_BYTES = 4 * 1024 * 1024;

const FIRMAS: Array<{ tipo: string; extension: string; test: (b: Buffer) => boolean }> = [
  { tipo: "image/jpeg", extension: "jpg", test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  {
    tipo: "image/png",
    extension: "png",
    test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  },
  {
    tipo: "image/webp",
    extension: "webp",
    test: (b) => b.subarray(0, 4).toString("ascii") === "RIFF" && b.subarray(8, 12).toString("ascii") === "WEBP"
  }
];

export function tipoReal(datos: Buffer): { tipo: string; extension: string } | null {
  if (datos.length < 12) return null;
  return FIRMAS.find((f) => f.test(datos)) ?? null;
}

export interface MedioGuardado {
  id: string;
  url: string;
  tipo: string;
  bytes: number;
  nombre: string;
}

/** La dirección pública de una foto. Relativa: la sirve la propia API. */
export const urlDe = (id: string): string => `/api/medios/${id}`;

export async function subir(base64: string, nombre: string): Promise<MedioGuardado> {
  /* El navegador manda «data:image/jpeg;base64,…»: se quita la cabecera, que
     además es justo la parte en la que no hay que creer. */
  const limpio = base64.includes(",") ? base64.slice(base64.indexOf(",") + 1) : base64;
  let datos: Buffer;
  try {
    datos = Buffer.from(limpio, "base64");
  } catch {
    throw peticionInvalida("Eso no es una imagen que se pueda leer.");
  }

  if (!datos.length) throw peticionInvalida("El fichero llegó vacío.");
  if (datos.length > TOPE_BYTES) {
    throw peticionInvalida(`La imagen pesa ${Math.round(datos.length / 1024)} KB y el tope son 4 MB.`);
  }

  const real = tipoReal(datos);
  if (!real) throw peticionInvalida("Solo entran JPEG, PNG y WebP. Lo que subiste no es ninguno de los tres.");

  const guardado = await guardarMedio({
    nombre: nombre.trim().slice(0, 120) || `foto.${real.extension}`,
    tipo: real.tipo,
    bytes: datos.length,
    /* Prisma guarda `Bytes` como Uint8Array respaldado por un ArrayBuffer
       propio; un Buffer de Node puede venir sobre un SharedArrayBuffer y no
       encaja en su tipo. Copiarlo es explícito y cuesta nada a este tamaño. */
    datos: new Uint8Array(datos)
  });

  return { id: guardado.id, url: urlDe(guardado.id), tipo: guardado.tipo, bytes: guardado.bytes, nombre: guardado.nombre };
}

export const verMedio = leerMedio;
export const quitarMedio = borrarMedio;

export const catalogoDeMedios = async (): Promise<MedioGuardado[]> =>
  (await listarMedios()).map((m) => ({ id: m.id, url: urlDe(m.id), tipo: m.tipo, bytes: m.bytes, nombre: m.nombre }));
