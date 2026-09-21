/**
 * Lo que el panel puede mandar.
 *
 * La regla que manda aquí: **`undefined` es «no lo toques», `null` es «bórralo»**.
 * Sin esa distinción no hay forma de vaciar un campo, y la alternativa —mandar
 * "" y guardarlo— convierte «no consta» en «consta que está vacío», que es
 * justo el dato inventado que este catálogo no admite.
 */
import { z } from "zod";

const CONDICIONES = ["NUEVO", "OPENBOX", "REACONDICIONADO", "SEMINUEVO", "USADO"] as const;
const ESTADOS = ["EN_STOCK", "LIMITADO", "SIN_EXISTENCIAS", "DESCONOCIDO"] as const;
const CONFIANZAS = ["ALTA", "MEDIA", "BAJA"] as const;

/** Texto que puede faltar: se recorta, y en blanco significa NULL. */
const textoOpcional = (max = 400) =>
  z
    .union([z.string().max(max), z.null()])
    .transform((v) => (v === null ? null : v.trim() === "" ? null : v.trim()));

const textoObligatorio = (max = 200) => z.string().trim().min(1).max(max);

/**
 * Un entero que puede no constar: un precio, un coste, unas unidades.
 *
 * **No usa `z.coerce.number()`, y eso no es estilo: es el fallo.**
 * `Number("")`, `Number(" ")`, `Number([])` y `Number(false)` valen todos
 * **cero**. Con la coerción por delante, cualquiera de esos cuatro entraba
 * como un cero de verdad — y un coste de cero pesos da un margen del 100%,
 * que es exactamente el número con el que se decide cuánto se puede pagar por
 * traer un cliente.
 *
 * El intento anterior fue poner `z.null()` primero en el union. Eso solo
 * atrapa el `null` literal de JSON: `""` seguía cayendo en la rama que
 * convierte. Lo encontró una auditoría externa, no el tipo ni las pruebas.
 *
 * Aquí se decide **antes** de convertir nada:
 *
 * - `null` y una cadena vacía o en blanco son «no consta» → `null`.
 * - Un número entero no negativo, o una cadena que de verdad es uno, se acepta.
 * - Un array, un booleano o un objeto se **rechazan**, no se convierten en 0.
 */
const enteroONulo = (max: number, cosa: string) =>
  z
    /* El union corta primero por tipo: `false` y `[]` ni llegan a la
       transformación, que es donde antes se volvían cero. */
    .union([z.null(), z.number(), z.string()], {
      errorMap: () => ({ message: `${cosa} es un número entero, o nada` })
    })
    .transform((valor, ctx): number | null => {
      if (valor === null) return null;

      let numero: number;
      if (typeof valor === "string") {
        const limpio = valor.trim();
        /* Vacío es «no consta», no cero. Es la regla de toda la casa. */
        if (limpio === "") return null;
        if (!/^\d+$/.test(limpio)) {
          ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${cosa} es un número entero, o nada` });
          return z.NEVER;
        }
        numero = Number(limpio);
      } else {
        numero = valor;
      }

      if (!Number.isInteger(numero) || numero < 0 || numero > max) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${cosa} va entre 0 y ${max.toLocaleString("es-CL")}` });
        return z.NEVER;
      }
      return numero;
    });

/** Pesos chilenos. Enteros y no negativos: no existe el precio de −$1. */
const pesos = enteroONulo(99_999_999, "un importe");

/** Unidades. Nunca negativas: «stock = −1» no es un dato, es un error. */
export const unidades = enteroONulo(100_000, "las unidades");

const identificador = z
  .string()
  .trim()
  .min(2)
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "solo minúsculas, números y guiones");

/** Las specs son pares texto→texto. Una spec en blanco se borra, no se guarda. */
const specs = z.record(z.string().trim().min(1).max(60), z.union([z.string().max(300), z.null()]));

const listaDeTextos = z.array(z.string().trim().min(1).max(60)).max(20);

/** Campos que comparten alta y edición. */
const comunes = {
  slug: identificador.optional(),
  sku: textoOpcional(60).optional(),
  marca: textoObligatorio(80).optional(),
  nombre: textoObligatorio(140).optional(),
  etiqueta: textoObligatorio(60).optional(),
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "un color hex, como #7FD8C8").optional(),
  categoria: textoObligatorio(80).optional(),
  subcategoria: textoOpcional(80).optional(),
  tipoProducto: textoOpcional(80).optional(),
  modelo: textoOpcional(80).optional(),
  condicion: z.union([z.enum(CONDICIONES), z.null()]).optional(),
  garantia: textoOpcional(120).optional(),
  precioLista: pesos.optional(),
  precioVenta: pesos.optional(),
  /* Lo que costó comprarlo, neto. Mismo trato que un precio: en blanco es
     «no consta», y sin él el margen no se calcula en vez de salir 100%. */
  costoNeto: pesos.optional(),
  precioFalabella: pesos.optional(),
  precioLider: pesos.optional(),
  stockEstado: z.enum(ESTADOS).optional(),
  stockUnidades: unidades.optional(),
  specs: specs.optional(),
  usos: listaDeTextos.optional(),
  valores: listaDeTextos.optional(),
  para: textoOpcional(600).optional(),
  noPara: textoOpcional(600).optional(),
  alerta: textoOpcional(300).optional(),
  descripcionCorta: textoOpcional(300).optional(),
  descripcionLarga: textoOpcional(4000).optional(),
  imagenUrl: textoOpcional(500).optional(),
  imagenAlt: textoOpcional(200).optional(),
  imagenes: z.array(z.string().trim().min(1).max(500)).max(12).optional(),
  fuente: textoObligatorio(120).optional(),
  /**
   * La fecha del dato, **en los dos formatos que existen de verdad**: el
   * catálogo la guarda a la chilena (18-09-2026) y el formulario sugiere ISO.
   * Solo se aceptaba ISO, así que editar cualquier equipo de la semilla
   * fallaba entero por un campo que ni se había tocado. Se guarda tal cual se
   * escribió: va impresa en la ficha y no es nuestro sitio reformatearla.
   */
  fechaDato: z
    .string()
    .trim()
    .regex(/^(\d{4}-\d{2}-\d{2}|\d{2}-\d{2}-\d{4})$/, "una fecha AAAA-MM-DD o DD-MM-AAAA")
    .optional(),
  confianza: z.enum(CONFIANZAS).optional()
};

/**
 * El alta. Solo se exige lo que sin ello no hay producto: marca, nombre,
 * categoría y de dónde sale el dato. Precio, condición, stock y foto pueden
 * faltar — el panel los enseña como huecos y el equipo no sale a la venta
 * hasta que estén. Exigirlos en el formulario es empujar a rellenarlos a ojo.
 */
export const altaSchema = z
  .object({
    ...comunes,
    marca: textoObligatorio(80),
    nombre: textoObligatorio(140),
    categoria: textoObligatorio(80),
    fuente: textoObligatorio(120),
    id: identificador.optional()
  })
  .strict();

export const edicionSchema = z
  .object({ ...comunes, motivo: z.string().trim().max(200).optional() })
  .strict()
  .refine((v) => Object.keys(v).some((k) => k !== "motivo"), "no mandaste ningún cambio");

export const archivoSchema = z.object({ archivar: z.boolean(), motivo: z.string().trim().max(200).optional() }).strict();

export const entrarSchema = z.object({ clave: z.string().min(1).max(200) }).strict();

export type Alta = z.infer<typeof altaSchema>;
export type Edicion = z.infer<typeof edicionSchema>;

const ESTADOS_PEDIDO = [
  "POR_CONFIRMAR", "PENDIENTE_PAGO", "PAGADO", "PREPARANDO",
  "DESPACHADO", "ENTREGADO", "ANULADO", "DEVUELTO", "REVISAR"
] as const;

const ESTADOS_COTIZACION = ["ENVIADA", "VISTA", "ACEPTADA", "PERDIDA", "CADUCADA"] as const;

export const estadoPedidoSchema = z
  .object({ estado: z.enum(ESTADOS_PEDIDO), nota: z.string().trim().max(300).optional() })
  .strict();

export const estadoCotizacionSchema = z.object({ estado: z.enum(ESTADOS_COTIZACION) }).strict();

/**
 * La importación. `aplicar` es opcional y por defecto **falso**: pedir un
 * ensayo tiene que ser lo que pasa si no dices nada, no lo que hay que
 * acordarse de pedir.
 */
export const importacionSchema = z.object({ csv: z.string().min(1), aplicar: z.boolean().optional() }).strict();
