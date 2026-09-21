/**
 * Lo que encontró la auditoría externa del 21-09-2026, fijado.
 *
 * Todo lo de aquí pasó de verdad: son huecos que ni el compilador ni las
 * pruebas del autor cazaron, y que encontró alguien atacando el sistema en
 * marcha. Cada `it` reproduce uno.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { compraBase, productoVendible } from "../ayudas.js";
import { prisma } from "../../src/repositories/prisma.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

describe("un cuerpo que el cliente manda mal es culpa del cliente", () => {
  it("un JSON roto da 400, no 500", async () => {
    const r = await request(app).post("/api/totales").set("Content-Type", "application/json").send('{"items":[');

    expect(r.status).toBe(400);
    expect(r.body.error.codigo).toBe("peticion_invalida");
  });

  it("un cuerpo más grande que el tope da 413, no 500", async () => {
    const enorme = JSON.stringify({ items: "A".repeat(40_000) });
    const r = await request(app).post("/api/totales").set("Content-Type", "application/json").send(enorme);

    expect(r.status).toBe(413);
    expect(r.body.error.codigo).toBe("cuerpo_demasiado_grande");
  });

  it("y ninguno de los dos filtra nada del servidor", async () => {
    const r = await request(app).post("/api/totales").set("Content-Type", "application/json").send("{roto");
    const texto = JSON.stringify(r.body);

    expect(texto).not.toMatch(/at .*\.ts:/);
    expect(texto).not.toContain("node_modules");
    expect(texto).not.toContain("SyntaxError");
  });
});

describe("nunca se cobra más de lo que la persona vio", () => {
  const compra = (extra: Record<string, unknown> = {}) => ({
    ...compraBase,
    items: [{ productoId: "p1", cantidad: 1 }],
    idempotencia: `tot-${Math.random().toString(36).slice(2)}`,
    ...extra
  });

  it("si el total real subió respecto al de la pantalla, el pedido no se crea", async () => {
    await productoVendible("p1", 5);

    /* La pantalla enseñó $1.000. El servidor calcula $1.185.990. */
    const r = await request(app).post("/api/pedido").send(compra({ totalEsperado: 1000 }));

    expect(r.status).toBe(409);
    expect(r.body.error.codigo).toBe("total_cambio");
    expect(r.body.error.detalles.ahora).toBe(1_185_990);
    expect(r.body.error.detalles.esperaba).toBe(1000);

    /* Y no queda ni pedido ni stock reservado. */
    expect(await prisma.pedido.count()).toBe(0);
    const p = await prisma.producto.findUnique({ where: { id: "p1" } });
    expect(p?.reservadas).toBe(0);
  });

  it("si coincide, la compra sigue como siempre", async () => {
    await productoVendible("p1", 5);
    const r = await request(app).post("/api/pedido").send(compra({ totalEsperado: 1_185_990 }));

    expect(r.status).toBe(201);
    expect(r.body.totales.total).toBe(1_185_990);
  });

  it("si el total real BAJÓ, se sigue: cobrar menos de lo enseñado no perjudica a nadie", async () => {
    await productoVendible("p1", 5);
    const r = await request(app).post("/api/pedido").send(compra({ totalEsperado: 9_000_000 }));

    expect(r.status).toBe(201);
    expect(r.body.totales.total).toBe(1_185_990);
  });

  it("y mandarlo manipulado no sirve para pagar menos: solo puede frenar la venta", async () => {
    await productoVendible("p1", 5);
    const r = await request(app).post("/api/pedido").send(compra({ totalEsperado: 1 }));

    expect(r.status).toBe(409);
    /* Lo que no pasa: un pedido de un peso. */
    expect(await prisma.pedido.count()).toBe(0);
  });

  it("sin mandarlo, todo funciona igual que antes", async () => {
    await productoVendible("p1", 5);
    const r = await request(app).post("/api/pedido").send(compra());
    expect(r.status).toBe(201);
  });
});

describe("el estado del pago no se contradice con el del pedido", () => {
  const compra = () => ({
    ...compraBase,
    items: [{ productoId: "p1", cantidad: 1 }],
    idempotencia: `pg-${Math.random().toString(36).slice(2)}`
  });

  it("marcar PAGADO a mano anota el pago, no lo deja en «pendiente»", async () => {
    await productoVendible("p1", 5);
    const creado = await request(app).post("/api/pedido").send(compra());

    const { cambiarEstado } = await import("../../src/services/pedidos.service.js");
    const pedido = await cambiarEstado(creado.body.numero, "PAGADO", "transferencia recibida");

    expect(pedido?.estado).toBe("PAGADO");
    expect(pedido?.pagoEstado).toBe("pagado");
    expect(pedido?.pagoFecha).toBeTruthy();
    /* Y la referencia que ya tenía de la pasarela no se toca ni se inventa otra. */
    expect(pedido?.pagoReferencia).toBe(creado.body.pago?.referencia ?? pedido?.pagoReferencia);
  });

  it("anular deja el pago en «no corresponde», no en «pendiente» para siempre", async () => {
    await productoVendible("p1", 5);
    const creado = await request(app).post("/api/pedido").send(compra());

    const { cambiarEstado } = await import("../../src/services/pedidos.service.js");
    const pedido = await cambiarEstado(creado.body.numero, "ANULADO", "se arrepintió");

    expect(pedido?.estado).toBe("ANULADO");
    expect(pedido?.pagoEstado).toBe("no-corresponde");
  });
});
