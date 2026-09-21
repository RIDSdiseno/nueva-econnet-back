/**
 * Los trabajos programados.
 *
 * Cómo aguantan cien mil carritos:
 *  1. **No barren nada.** Piden a Postgres «a quién le toca hoy» con índice, y
 *     lo toman en lote con FOR UPDATE SKIP LOCKED: dos ejecuciones a la vez no
 *     se pisan.
 *  2. **No mandan correos**: los encolan. Enviar es lento y lo hace la cola.
 *  3. **Presupuesto de tiempo.** Si se acaba, dicen `pendientes: true` y se
 *     vuelve a llamar. Nunca se quedan colgados hasta que la plataforma mate
 *     el proceso.
 */
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { buscarCarrito, cerrarSecuencia, programarCarrito, tomarCarritosDelDia } from "../repositories/carritos.repository.js";
import { buscarCotizacion, caducarCotizaciones, programarSeguimiento, tomarCotizacionesDelDia } from "../repositories/cotizaciones.repository.js";
import { limpiarCaducadas } from "../repositories/limites.repository.js";
import { tomarPedidosCaducados } from "../repositories/pedidos.repository.js";
import { alternativasPara, precioReferencia, productoPorId } from "./catalogo.service.js";
import { cuandoToca, motivoParaNoEscribir } from "./carritos.service.js";
import { encolar } from "./cola-correo.js";
import { cuandoTocaRecordatorio, enlacesDeCotizacion, propuestaDe } from "./cotizaciones.service.js";
import { recordatorio } from "./plantillas-cotizacion.js";
import { enlacesDe, puedeRecibir } from "./leads.service.js";
import { cambiarEstado } from "./pedidos.service.js";
import { correoDeSecuencia, DIAS_SECUENCIA, type ProductoCorreo } from "./plantillas.js";
import type { Producto } from "@prisma/client";
import { numeroAjuste } from "./ajustes.js";

export interface InformeCarritos {
  revisados: number;
  encolados: number;
  cerrados: number;
  saltados: Record<string, number>;
  pendientes: boolean;
}

function aProductoCorreo(producto: Producto): ProductoCorreo {
  const specs = (producto.specs ?? {}) as Record<string, string | null>;
  return {
    marca: producto.marca,
    nombre: producto.nombre,
    condicion: producto.condicion,
    precioVenta: precioReferencia(producto).propio ? producto.precioVenta : null,
    ram: specs.ram ?? null,
    almacenamiento: specs.almacenamiento ?? null,
    gpu: specs.gpu ?? null,
    so: specs.so ?? null,
    para: producto.para,
    noPara: producto.noPara
  };
}

export async function procesarCarritos(opciones: { presupuestoMs?: number; lote?: number } = {}): Promise<InformeCarritos> {
  const presupuestoMs = opciones.presupuestoMs ?? env.TRABAJO_PRESUPUESTO_MS;
  const lote = opciones.lote ?? env.TRABAJO_LOTE;
  const arranque = Date.now();

  const informe: InformeCarritos = { revisados: 0, encolados: 0, cerrados: 0, saltados: {}, pendientes: false };
  const saltar = (motivo: string) => {
    informe.saltados[motivo] = (informe.saltados[motivo] ?? 0) + 1;
  };

  for (;;) {
    if (Date.now() - arranque > presupuestoMs) {
      informe.pendientes = true;
      logger.warn(informe, "motor de carritos: presupuesto agotado");
      return informe;
    }

    const ids = await tomarCarritosDelDia(lote);
    if (!ids.length) break;

    for (const id of ids) {
      informe.revisados++;
      const carrito = await buscarCarrito(id);
      if (!carrito || !carrito.correo) {
        saltar("carrito que ya no está");
        continue;
      }

      const motivo = motivoParaNoEscribir(carrito);
      if (motivo) {
        saltar(motivo);
        continue;
      }
      if (!(await puedeRecibir(carrito.correo))) {
        await cerrarSecuencia(id);
        saltar("dado de baja");
        continue;
      }

      const dia = carrito.diaSecuencia + 1;
      if (dia > DIAS_SECUENCIA || dia > env.CARRITO_DIAS) {
        await cerrarSecuencia(id);
        informe.cerrados++;
        continue;
      }

      const primero = carrito.items[0];
      const producto = primero ? await productoPorId(primero.productoId) : null;
      const alternativas = producto ? await alternativasPara(producto) : [];
      const enlaces = enlacesDe(carrito.correo, { carritoId: carrito.id });

      const pieza = correoDeSecuencia({
        dia,
        prod: producto ? aProductoCorreo(producto) : null,
        alternativas: alternativas.map(aProductoCorreo),
        enlaces
      });
      if (!pieza) {
        saltar("sin plantilla");
        continue;
      }

      await encolar(
        { ...pieza, para: carrito.correo, bajaUrl: enlaces.baja },
        { clave: `carrito:${carrito.id}:dia:${dia}` }
      );

      if (dia >= Math.min(DIAS_SECUENCIA, env.CARRITO_DIAS)) {
        await cerrarSecuencia(id);
      } else {
        await programarCarrito(id, dia, cuandoToca(carrito.creado, dia + 1));
      }
      informe.encolados++;
    }
  }

  logger.info(informe, "motor de carritos");
  return informe;
}

/** Barre las ventanas de límite ya caducadas. Sin esto la tabla solo crece. */
export async function limpiarLimites(): Promise<{ borradas: number }> {
  const borradas = await limpiarCaducadas();
  if (borradas) logger.info({ borradas }, "límites caducados barridos");
  return { borradas };
}

export interface InformeCaducidad {
  revisados: number;
  anulados: number;
}

/**
 * Pedidos que esperan pago y se pasaron de plazo. Sin esto, el stock reservado
 * por un pedido que nadie paga se queda reservado para siempre y la tienda
 * acaba diciendo «sin stock» con las unidades en la bodega.
 */
export async function caducarPedidos(opciones: { lote?: number } = {}): Promise<InformeCaducidad> {
  const numeros = await tomarPedidosCaducados(opciones.lote ?? env.TRABAJO_LOTE);
  let anulados = 0;

  for (const numero of numeros) {
    await cambiarEstado(numero, "ANULADO", `Sin pago en ${env.PAGO_CADUCA_HORAS} horas: se libera el stock`);
    anulados++;
  }

  const informe = { revisados: numeros.length, anulados };
  if (numeros.length) logger.info(informe, "caducidad de pedidos");
  return informe;
}


export interface InformeCotizaciones {
  revisados: number;
  encolados: number;
  cerrados: number;
  caducadas: number;
  saltados: Record<string, number>;
}

/**
 * El seguimiento de las cotizaciones de empresa.
 *
 * Una cotización B2B que nadie persigue se pierde sola: el contacto la
 * reenvía, se queda esperando aprobación y a las dos semanas ya compró en
 * otro sitio. Tres recordatorios, cada uno con algo dentro, y se cierra.
 *
 * Quien se dio de baja no recibe ninguno, aunque su cotización siga viva.
 */
export async function seguirCotizaciones(opciones: { lote?: number } = {}): Promise<InformeCotizaciones> {
  const lote = opciones.lote ?? env.TRABAJO_LOTE;
  const informe: InformeCotizaciones = { revisados: 0, encolados: 0, cerrados: 0, caducadas: 0, saltados: {} };
  const saltar = (motivo: string) => {
    informe.saltados[motivo] = (informe.saltados[motivo] ?? 0) + 1;
  };

  informe.caducadas = (await caducarCotizaciones(lote)).length;

  for (const numero of await tomarCotizacionesDelDia(lote)) {
    informe.revisados++;
    const cotizacion = await buscarCotizacion(numero);
    if (!cotizacion) {
      saltar("ya no está");
      continue;
    }

    if (!(await puedeRecibir(cotizacion.correo))) {
      await programarSeguimiento(numero, cotizacion.seguimiento, null);
      saltar("dado de baja");
      continue;
    }

    const paso = cotizacion.seguimiento + 1;
    if (paso > numeroAjuste("COTIZACION_SEGUIMIENTOS", 3)) {
      await programarSeguimiento(numero, cotizacion.seguimiento, null);
      informe.cerrados++;
      continue;
    }

    const enlaces = enlacesDeCotizacion(numero, cotizacion.correo);
    const pieza = recordatorio(paso, numero, propuestaDe(cotizacion), enlaces);
    if (!pieza) {
      await programarSeguimiento(numero, cotizacion.seguimiento, null);
      saltar("sin plantilla");
      continue;
    }

    await encolar(
      { ...pieza, para: cotizacion.correo, bajaUrl: enlaces.baja },
      { clave: `cotizacion:${numero}:paso:${paso}` }
    );
    await programarSeguimiento(numero, paso, cuandoTocaRecordatorio(cotizacion.creado, paso + 1));
    informe.encolados++;
  }

  if (informe.revisados || informe.caducadas) logger.info(informe, "seguimiento de cotizaciones");
  return informe;
}
