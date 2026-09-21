import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { productoVendible, productoSoloMarketplace, productoSinStock } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

describe("salud", () => {
  it("responde vivo sin tocar la base", async () => {
    const r = await request(app).get("/api/salud");
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ ok: true, estado: "vivo" });
  });

  it("responde listo cuando la base contesta", async () => {
    const r = await request(app).get("/api/listo");
    expect(r.status).toBe(200);
    expect(r.body.dependencias.baseDeDatos).toBe(true);
  });
});

describe("catálogo", () => {
  it("lista lo que hay, con su honestidad intacta", async () => {
    await productoVendible();
    await productoSoloMarketplace();

    const r = await request(app).get("/api/catalogo");
    expect(r.status).toBe(200);
    expect(r.body.productos).toHaveLength(2);

    const marketplace = r.body.productos.find((p: { id: string }) => p.id === "p-marketplace");
    expect(marketplace.seVende).toBe(false);
    expect(marketplace.referencia).toMatchObject({ propio: false, canal: "lider" });
  });

  it("dice qué le falta a un producto para poder anunciarse", async () => {
    await productoSinStock();
    const r = await request(app).get("/api/catalogo/p-sinstock");
    expect(r.status).toBe(200);
    expect(r.body.producto.publicable.faltas).toContain("sin imagen");
    expect(r.body.producto.publicable.faltas).toContain("sin stock conocido");
  });

  it("un producto que no existe da 404 con la forma del contrato", async () => {
    const r = await request(app).get("/api/catalogo/no-existe");
    expect(r.status).toBe(404);
    expect(r.body).toMatchObject({ ok: false, error: { codigo: "no_encontrado" } });
  });
});

describe("contrato de errores", () => {
  it("una ruta inventada da 404 con la misma forma", async () => {
    const r = await request(app).get("/api/no-existe");
    expect(r.status).toBe(404);
    expect(r.body.ok).toBe(false);
    expect(r.body.error.codigo).toBe("no_encontrado");
  });

  it("un cuerpo inválido da 400 y dice qué campo", async () => {
    const r = await request(app).post("/api/suscribir").send({ correo: "no-es-un-correo", consentimiento: true });
    expect(r.status).toBe(400);
    expect(r.body.error.detalles[0].campo).toBe("correo");
  });

  it("un campo de más se rechaza: nada entra por la puerta de atrás", async () => {
    const r = await request(app)
      .post("/api/suscribir")
      .send({ correo: "a@b.cl", consentimiento: true, esAdmin: true });
    expect(r.status).toBe(400);
  });

  it("toda respuesta lleva su identificador de petición", async () => {
    const r = await request(app).get("/api/salud");
    expect(r.headers["x-request-id"]).toMatch(/[\w-]{8,}/);
  });
});
