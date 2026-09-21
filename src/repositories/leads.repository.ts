/** Personas que dejaron su correo, con su consentimiento fechado. */
import type { Lead } from "@prisma/client";
import { prisma } from "./prisma.js";

export const buscarLead = (correo: string): Promise<Lead | null> =>
  prisma.lead.findUnique({ where: { correo } });

export async function guardarLead(datos: {
  correo: string;
  nombre?: string | null;
  origen: string;
  etiquetas?: string[];
  consiente: boolean;
  textoConsentimiento: string;
}): Promise<Lead> {
  const previo = await buscarLead(datos.correo);
  const etiquetas = [...new Set([...(previo?.etiquetas ?? []), ...(datos.etiquetas ?? [])])];
  const origenes = [...new Set([...(previo?.origenes ?? []), datos.origen])];

  return prisma.lead.upsert({
    where: { correo: datos.correo },
    create: {
      correo: datos.correo,
      nombre: datos.nombre ?? null,
      origen: datos.origen,
      origenes,
      etiquetas,
      consienteMarketing: datos.consiente,
      consentimientoTexto: datos.consiente ? datos.textoConsentimiento : null,
      consentimientoFecha: datos.consiente ? new Date() : null
    },
    update: {
      nombre: datos.nombre ?? previo?.nombre ?? null,
      origenes,
      etiquetas,
      ...(datos.consiente
        ? { consienteMarketing: true, consentimientoTexto: datos.textoConsentimiento, consentimientoFecha: new Date() }
        : {})
    }
  });
}

export async function darDeBaja(correo: string, motivo: string): Promise<Lead | null> {
  const lead = await buscarLead(correo);
  if (!lead) return null;
  return prisma.lead.update({
    where: { correo },
    data: { consienteMarketing: false, bajaFecha: new Date(), bajaMotivo: motivo }
  });
}

export async function puedeRecibir(correo: string): Promise<boolean> {
  const lead = await buscarLead(correo);
  return !!lead && lead.consienteMarketing && !lead.bajaFecha;
}
