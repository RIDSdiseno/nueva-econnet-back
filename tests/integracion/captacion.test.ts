import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { prisma } from "../../src/repositories/prisma.js";
import { correosEnviados } from "../../src/services/correo.js";
import { firmar } from "../../src/services/firma.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

describe("captación", () => {
  it("sin consentimiento no se guarda nada", async () => {
    const r = await request(app).post("/api/suscribir").send({ correo: "no@econnet.cl", consentimiento: false, ms: 5000 });
    expect(r.status).toBe(400);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("con consentimiento se guarda fechado y sale el correo con su baja", async () => {
    const r = await request(app).post("/api/suscribir").send({ correo: "Ana@Econnet.CL", consentimiento: true, ms: 5000 });
    expect(r.status).toBe(200);

    const lead = await prisma.lead.findUnique({ where: { correo: "ana@econnet.cl" } });
    expect(lead?.consienteMarketing).toBe(true);
    expect(lead?.consentimientoTexto).toMatch(/Acepto recibir/);
    expect(correosEnviados()[0]?.texto).toMatch(/baja/);
  });

  it("el robot se va con un gracias y sin guardarse", async () => {
    const r = await request(app)
      .post("/api/suscribir")
      .send({ correo: "bot@econnet.cl", consentimiento: true, empresa_web: "spam" });
    expect(r.status).toBe(200);
    expect(await prisma.lead.count()).toBe(0);
  });

  it("el enlace de baja da de baja de verdad", async () => {
    await request(app).post("/api/suscribir").send({ correo: "baja@econnet.cl", consentimiento: true, ms: 5000 });
    const token = firmar({ a: "baja", c: "baja@econnet.cl" });

    const r = await request(app).get("/api/baja").query({ t: token });
    expect(r.status).toBe(200);
    expect(r.text).toMatch(/Te diste de baja/);

    const lead = await prisma.lead.findUnique({ where: { correo: "baja@econnet.cl" } });
    expect(lead?.consienteMarketing).toBe(false);
    expect(lead?.bajaFecha).not.toBeNull();
  });

  it("un enlace de baja manipulado no hace nada", async () => {
    const r = await request(app).get("/api/baja").query({ t: "esto-no-esta-firmado" });
    expect(r.status).toBe(400);
  });

  it("la cotización de empresa se guarda y avisa a ventas", async () => {
    const r = await request(app).post("/api/cotizar").send({
      correo: "empresa@econnet.cl",
      equipos: 18,
      perfil: "administrativo",
      presupuesto: 1_200_000,
      accesorios: true,
      consentimiento: true,
      ms: 6000
    });

    expect(r.status).toBe(201);
    expect(await prisma.cotizacion.count()).toBe(1);
    expect(correosEnviados()).toHaveLength(2);
  });
});
