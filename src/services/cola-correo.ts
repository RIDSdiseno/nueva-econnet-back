/**
 * La cola de correo, en PostgreSQL.
 *
 * Encolar es una escritura barata; enviar es una llamada de red de cientos de
 * milisegundos. Con cien mil correos, mezclarlos es lo que hace que un cron se
 * muera a la mitad sin que nadie sepa por dónde iba.
 *
 * El drenado usa `FOR UPDATE SKIP LOCKED`: dos trabajadores a la vez no se
 * pisan ni mandan el mismo correo dos veces.
 */
import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { logger } from "../config/logger.js";
import { prisma } from "../repositories/prisma.js";
import { enviar, type Mensaje } from "./correo.js";

const MAX_INTENTOS = 3;

export interface ResultadoEncolar {
  encolado: boolean;
  motivo?: string;
}

export async function encolar(mensaje: Mensaje, opciones: { clave?: string; programadoPara?: Date } = {}): Promise<ResultadoEncolar> {
  try {
    await prisma.correoEncolado.create({
      data: {
        para: mensaje.para,
        asunto: mensaje.asunto,
        html: mensaje.html,
        texto: mensaje.texto,
        bajaUrl: mensaje.bajaUrl ?? null,
        transaccional: mensaje.transaccional ?? false,
        clave: opciones.clave ?? null,
        programadoPara: opciones.programadoPara ?? new Date()
      }
    });
    return { encolado: true };
  } catch (error) {
    /* Clave repetida = ya estaba encolado. Es el caso bueno, no un fallo. */
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return { encolado: false, motivo: "ya estaba encolado" };
    }
    throw error;
  }
}

export const pendientes = (): Promise<number> =>
  prisma.correoEncolado.count({ where: { estado: "PENDIENTE" } });

interface FilaCola {
  id: string;
  para: string;
  asunto: string;
  html: string;
  texto: string;
  bajaUrl: string | null;
  transaccional: boolean;
  intentos: number;
}

export interface InformeCola {
  enviados: number;
  fallados: number;
  devueltos: number;
  pendientes: number;
}

export async function drenarCola(opciones: { presupuestoMs?: number; lote?: number } = {}): Promise<InformeCola> {
  const presupuestoMs = opciones.presupuestoMs ?? env.TRABAJO_PRESUPUESTO_MS;
  const lote = opciones.lote ?? 20;
  const arranque = Date.now();
  const informe: InformeCola = { enviados: 0, fallados: 0, devueltos: 0, pendientes: 0 };

  for (;;) {
    if (Date.now() - arranque > presupuestoMs) break;

    /* Toma un lote y lo marca como propio en la misma sentencia. */
    const tomados = await prisma.$queryRaw<FilaCola[]>`
      UPDATE "CorreoEncolado" SET estado = 'ENVIANDO', "actualizado" = now()
      WHERE id IN (
        SELECT id FROM "CorreoEncolado"
        WHERE estado = 'PENDIENTE' AND "programadoPara" <= now()
        ORDER BY "programadoPara"
        LIMIT ${lote}
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, para, asunto, html, texto, "bajaUrl", transaccional, intentos`;

    if (!tomados.length) break;

    for (const fila of tomados) {
      const mensaje: Mensaje = {
        para: fila.para,
        asunto: fila.asunto,
        html: fila.html,
        texto: fila.texto,
        bajaUrl: fila.bajaUrl,
        transaccional: fila.transaccional
      };

      let bien = false;
      let error = "";
      try {
        const resultado = await enviar(mensaje, { saltarTope: true });
        bien = resultado.enviado;
        error = resultado.motivo ?? "";
      } catch (e) {
        error = (e as Error).message;
      }

      if (bien) {
        await prisma.correoEncolado.update({ where: { id: fila.id }, data: { estado: "ENVIADO", error: null } });
        informe.enviados++;
        continue;
      }

      const intentos = fila.intentos + 1;
      if (intentos >= MAX_INTENTOS) {
        await prisma.correoEncolado.update({ where: { id: fila.id }, data: { estado: "FALLADO", intentos, error } });
        informe.fallados++;
        logger.error({ asunto: fila.asunto }, "correo descartado tras 3 intentos");
      } else {
        await prisma.correoEncolado.update({
          where: { id: fila.id },
          data: { estado: "PENDIENTE", intentos, error, programadoPara: new Date(Date.now() + 5 * 60 * 1000) }
        });
        informe.devueltos++;
      }
    }
  }

  informe.pendientes = await pendientes();
  logger.info(informe, "cola de correo");
  return informe;
}
