import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { correosEnviados } from "../../src/services/correo.js";
import { prisma } from "../../src/repositories/prisma.js";
import { compraBase, productoSinStock, productoSoloMarketplace, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

const compra = (extra: Record<string, unknown> = {}) => ({
  ...compraBase,
  items: [{ productoId: "p-vendible", cantidad: 1 }],
  idempotencia: `idem-${Math.random().toString(36).slice(2)}`,
  ...extra
});

describe("totales", () => {
  it("el precio lo pone el servidor, no el navegador", async () => {
    await productoVendible();
    const r = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p-vendible", cantidad: 1 }], despacho: { modo: "RETIRO" } });

    expect(r.status).toBe(200);
    expect(r.body.totales.subtotal).toBe(1_185_990);
    expect(r.body.sePuedeCobrar).toBe(true);
  });

  it("lo que no tiene precio propio no se puede comprar", async () => {
    await productoSoloMarketplace();
    const r = await request(app)
      .post("/api/totales")
      .send({ items: [{ productoId: "p-marketplace", cantidad: 1 }], despacho: { modo: "RETIRO" } });

    expect(r.body.lineas).toHaveLength(0);
    expect(r.body.rechazadas[0].motivo).toMatch(/sin precio propio/);
  });
});

describe("pedidos", () => {
  it("un pedido normal queda pendiente de pago y reserva stock", async () => {
    await productoVendible();
    const r = await request(app).post("/api/pedido").send(compra());

    expect(r.status).toBe(201);
    expect(r.body.estado).toBe("PENDIENTE_PAGO");
    expect(r.body.numero).toMatch(/^ECN-\d{4}-\d{5}$/);

    const producto = await prisma.producto.findUnique({ where: { id: "p-vendible" } });
    expect(producto?.reservadas).toBe(1);
  });

  it("dos clics en pagar no son dos pedidos", async () => {
    await productoVendible();
    const cuerpo = compra({ idempotencia: "clic-doble-1234" });
    const uno = await request(app).post("/api/pedido").send(cuerpo);
    const dos = await request(app).post("/api/pedido").send(cuerpo);

    expect(dos.body.numero).toBe(uno.body.numero);
    expect(dos.body.repetido).toBe(true);
    expect(await prisma.pedido.count()).toBe(1);
  });

  it("si el stock no consta, el pedido no se cobra", async () => {
    await productoSinStock();
    const r = await request(app).post("/api/pedido").send(compra({ items: [{ productoId: "p-sinstock", cantidad: 1 }] }));

    expect(r.body.estado).toBe("POR_CONFIRMAR");
    expect(r.body.porConfirmar.stock).toBe(true);
    expect(r.body.pago).toBeNull();
  });

  it("si no hay tarifa para la región, tampoco se cobra", async () => {
    await productoVendible();
    const r = await request(app).post("/api/pedido").send(
      compra({
        despacho: { modo: "DESPACHO", region: "Magallanes y de la Antártica Chilena", comuna: "Punta Arenas", direccion: "Calle 123, casa 4" }
      })
    );

    expect(r.body.estado).toBe("POR_CONFIRMAR");
    expect(r.body.porConfirmar.envio).toBe(true);
  });

  it("una factura con RUT malo no pasa", async () => {
    await productoVendible();
    const r = await request(app).post("/api/pedido").send(
      compra({ documento: { tipo: "FACTURA", rut: "11.111.111-2", razonSocial: "Econnet SpA", giro: "Venta" } })
    );

    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/dígito verificador/);
  });

  it("faltan datos de despacho y no pasa", async () => {
    await productoVendible();
    const r = await request(app).post("/api/pedido").send(
      compra({ despacho: { modo: "DESPACHO", region: "Metropolitana de Santiago" } })
    );
    expect(r.status).toBe(400);
  });

  it("el seguimiento necesita número Y correo", async () => {
    await productoVendible();
    const creado = await request(app).post("/api/pedido").send(compra());

    const bien = await request(app).get("/api/seguimiento").query({ numero: creado.body.numero, correo: compraBase.correo });
    expect(bien.status).toBe(200);

    const mal = await request(app).get("/api/seguimiento").query({ numero: creado.body.numero, correo: "otro@econnet.cl" });
    expect(mal.status).toBe(404);
  });
});

describe("concurrencia", () => {
  it("veinte personas comprando diez unidades: entran diez", async () => {
    await productoVendible("p-vendible", 10);

    const intentos = Array.from({ length: 20 }, (_, i) =>
      request(app).post("/api/pedido").send(compra({ idempotencia: `carrera-${i}`, correo: `c${i}@econnet.cl` }))
    );
    const respuestas = await Promise.all(intentos);

    const creados = respuestas.filter((r) => r.status === 201);
    const rechazados = respuestas.filter((r) => r.status === 409);

    expect(creados).toHaveLength(10);
    expect(rechazados).toHaveLength(10);

    const producto = await prisma.producto.findUnique({ where: { id: "p-vendible" } });
    expect(producto?.reservadas).toBe(10);
  });

  it("los números de pedido no se repiten aunque lleguen a la vez", async () => {
    await productoVendible("p-vendible", 50);
    const respuestas = await Promise.all(
      Array.from({ length: 12 }, (_, i) => request(app).post("/api/pedido").send(compra({ idempotencia: `numero-${i}` })))
    );
    const numeros = new Set(respuestas.map((r) => r.body.numero));
    expect(numeros.size).toBe(12);
  });
});

describe("seguimiento con enlace firmado", () => {
  async function unPedido() {
    await productoVendible("p1", 5);
    const r = await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "firmado-1" });
    return r.body.numero as string;
  }

  it("el correo trae un enlace que abre el pedido sin teclear nada", async () => {
    const numero = await unPedido();
    const correo = correosEnviados().find((c) => c.para === compraBase.correo);
    const token = /seguimiento\?t=([^\s"&<]+)/.exec(correo?.html ?? "")?.[1];
    expect(token).toBeTruthy();

    const r = await request(app).get("/api/seguimiento").query({ t: token });
    expect(r.status).toBe(200);
    expect(r.body.pedido.numero).toBe(numero);
  });

  it("una firma inventada no abre ningún pedido", async () => {
    await unPedido();
    const r = await request(app).get("/api/seguimiento").query({ t: "inventado.firma" });
    expect(r.status).toBe(404);
  });

  it("el enlace de un pedido no sirve para ver otro", async () => {
    await productoVendible("p1", 5);
    const primero = await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "firmado-uno" });
    await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, correo: "otra@econnet.cl", items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "firmado-dos" });

    const correo = correosEnviados().find((c) => c.para === compraBase.correo);
    const token = /seguimiento\?t=([^\s"&<]+)/.exec(correo?.html ?? "")?.[1];

    const r = await request(app).get("/api/seguimiento").query({ t: token });
    expect(r.body.pedido.numero).toBe(primero.body.numero);
  });

  it("sigue valiendo el número y el correo tecleados a mano", async () => {
    const numero = await unPedido();
    const r = await request(app).get("/api/seguimiento").query({ numero, correo: compraBase.correo });
    expect(r.status).toBe(200);
  });

  it("no se puede mezclar: ni firma con número, ni campos de más", async () => {
    const numero = await unPedido();
    const r = await request(app).get("/api/seguimiento").query({ numero, correo: compraBase.correo, t: "algo" });
    expect(r.status).toBe(400);
  });
});

describe("consentimientos separados", () => {
  it("sin aceptar los términos no hay pedido", async () => {
    await productoVendible("p1", 5);
    const { terminos: _, ...sinTerminos } = compraBase;

    const r = await request(app)
      .post("/api/pedido")
      .send({ ...sinTerminos, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "sin-terminos-1" });

    expect(r.status).toBe(400);
    expect(JSON.stringify(r.body)).toMatch(/términos/i);
    expect(await prisma.pedido.count()).toBe(0);
  });

  it("aceptar los términos queda fechado: es la prueba si alguien reclama", async () => {
    await productoVendible("p1", 5);
    const r = await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "con-terminos-1" });

    const pedido = await prisma.pedido.findUnique({ where: { numero: r.body.numero } });
    expect(pedido?.terminosEn).toBeInstanceOf(Date);
  });

  it("aceptar los términos NO suscribe a publicidad", async () => {
    await productoVendible("p1", 5);
    await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "sin-marketing-1" });

    expect(await prisma.lead.count()).toBe(0);
  });

  it("marcar la casilla de publicidad sí registra el lead, con su texto", async () => {
    await productoVendible("p1", 5);
    await request(app)
      .post("/api/pedido")
      .send({ ...compraBase, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "con-marketing-1", consentimiento: true });

    const lead = await prisma.lead.findUnique({ where: { correo: compraBase.correo } });
    expect(lead?.consienteMarketing).toBe(true);
    expect(lead?.consentimientoTexto).toMatch(/Acepto recibir/);
  });
});
