import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { prisma } from "../../src/repositories/prisma.js";
import { correosEnviados } from "../../src/services/correo.js";
import { drenarCola, encolar, pendientes } from "../../src/services/cola-correo.js";
import { caducarPedidos, procesarCarritos } from "../../src/services/trabajos.service.js";
import { compraBase, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

const CRON = "Bearer cron-de-pruebas";

const carritoSeguido = async (correo = "carrito@econnet.cl") => {
  await productoVendible();
  await request(app).post("/api/suscribir").send({ correo, consentimiento: true, ms: 5000 });
  const r = await request(app)
    .post("/api/carrito")
    .send({ items: [{ productoId: "p-vendible", cantidad: 1 }], correo, consentimiento: true, ms: 5000 });
  return r.body.carrito.id as string;
};

describe("trabajos", () => {
  it("sin CRON_SECRET no se entra", async () => {
    const r = await request(app).post("/api/trabajos/carritos");
    expect(r.status).toBe(401);
  });

  it("con el secreto correcto, entra", async () => {
    const r = await request(app).post("/api/trabajos/carritos").set("Authorization", CRON);
    expect(r.status).toBe(200);
    expect(r.body.informe).toBeTruthy();
  });
});

describe("secuencia de carrito abandonado", () => {
  it("el carrito con correo y consentimiento queda agendado", async () => {
    const id = await carritoSeguido();
    const carrito = await prisma.carrito.findUnique({ where: { id } });
    expect(carrito?.proximoCorreo).not.toBeNull();
  });

  it("el carrito sin consentimiento no se agenda", async () => {
    await productoVendible();
    const r = await request(app).post("/api/carrito").send({ items: [{ productoId: "p-vendible", cantidad: 1 }], ms: 5000 });
    const carrito = await prisma.carrito.findUnique({ where: { id: r.body.carrito.id } });
    expect(carrito?.proximoCorreo).toBeNull();
  });

  it("encola el día 1 cuando toca, y no repite en la misma pasada", async () => {
    const id = await carritoSeguido();
    await prisma.carrito.update({ where: { id }, data: { proximoCorreo: new Date(Date.now() - 1000) } });

    const uno = await procesarCarritos();
    expect(uno.encolados).toBe(1);

    const dos = await procesarCarritos();
    expect(dos.encolados).toBe(0);
  });

  it("la cola manda el correo al drenarla, y queda vacía", async () => {
    const id = await carritoSeguido();
    await prisma.carrito.update({ where: { id }, data: { proximoCorreo: new Date(Date.now() - 1000) } });
    await procesarCarritos();

    expect(await pendientes()).toBe(1);
    const informe = await drenarCola();
    expect(informe.enviados).toBe(1);
    expect(await pendientes()).toBe(0);
    expect(correosEnviados().some((c) => /guardamos/i.test(c.asunto))).toBe(true);
  });

  it("encolar dos veces lo mismo deja un solo correo", async () => {
    const mensaje = { para: "idem@econnet.cl", asunto: "x", texto: "baja: https://econnet.cl/api/baja", html: "x" };
    expect((await encolar(mensaje, { clave: "prueba:1" })).encolado).toBe(true);
    expect((await encolar(mensaje, { clave: "prueba:1" })).encolado).toBe(false);
    expect(await pendientes()).toBe(1);
  });

  it("quien se dio de baja deja de recibir, aunque el carrito siga abierto", async () => {
    const id = await carritoSeguido("baja2@econnet.cl");
    await prisma.lead.update({ where: { correo: "baja2@econnet.cl" }, data: { consienteMarketing: false, bajaFecha: new Date() } });
    await prisma.carrito.update({ where: { id }, data: { proximoCorreo: new Date(Date.now() - 1000) } });

    const informe = await procesarCarritos();
    expect(informe.encolados).toBe(0);
    expect(informe.saltados["dado de baja"]).toBe(1);
  });

  it("un carrito comprado no recibe nada", async () => {
    const id = await carritoSeguido("compro@econnet.cl");
    await prisma.carrito.update({
      where: { id },
      data: { estado: "COMPRADO", proximoCorreo: new Date(Date.now() - 1000) }
    });

    const informe = await procesarCarritos();
    expect(informe.encolados).toBe(0);
  });

  it("al séptimo correo la secuencia se cierra sola", async () => {
    const id = await carritoSeguido("septimo@econnet.cl");
    await prisma.carrito.update({ where: { id }, data: { diaSecuencia: 6, proximoCorreo: new Date(Date.now() - 1000) } });

    await procesarCarritos();
    const carrito = await prisma.carrito.findUnique({ where: { id } });
    expect(carrito?.estado).toBe("TERMINADA");
    expect(carrito?.proximoCorreo).toBeNull();
  });
});

describe("caducidad de pedidos", () => {
  it("un pedido sin pagar caduca y devuelve el stock", async () => {
    await productoVendible();
    const creado = await request(app).post("/api/pedido").send({
      ...compraBase,
      items: [{ productoId: "p-vendible", cantidad: 2 }],
      idempotencia: "caduca-1234"
    });

    expect((await prisma.producto.findUnique({ where: { id: "p-vendible" } }))?.reservadas).toBe(2);

    await prisma.pedido.update({ where: { numero: creado.body.numero }, data: { caducaEn: new Date(Date.now() - 1000) } });
    const informe = await caducarPedidos();

    expect(informe.anulados).toBe(1);
    const pedido = await prisma.pedido.findUnique({ where: { numero: creado.body.numero } });
    expect(pedido?.estado).toBe("ANULADO");
    expect((await prisma.producto.findUnique({ where: { id: "p-vendible" } }))?.reservadas).toBe(0);
  });

  it("un pedido en plazo no se anula", async () => {
    await productoVendible();
    const creado = await request(app).post("/api/pedido").send({
      ...compraBase,
      items: [{ productoId: "p-vendible", cantidad: 1 }],
      idempotencia: "en-plazo-1234"
    });

    const informe = await caducarPedidos();
    expect(informe.anulados).toBe(0);
    const pedido = await prisma.pedido.findUnique({ where: { numero: creado.body.numero } });
    expect(pedido?.estado).toBe("PENDIENTE_PAGO");
  });
});
