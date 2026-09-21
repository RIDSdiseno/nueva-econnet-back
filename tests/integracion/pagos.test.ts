import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { prisma } from "../../src/repositories/prisma.js";
import { correosEnviados } from "../../src/services/correo.js";
import { marcarPagado } from "../../src/services/pedidos.service.js";
import { compraBase, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

const crearPedido = async (extra: Record<string, unknown> = {}) => {
  await productoVendible();
  const r = await request(app)
    .post("/api/pedido")
    .send({
      ...compraBase,
      items: [{ productoId: "p-vendible", cantidad: 1 }],
      idempotencia: `pago-${Math.random().toString(36).slice(2)}`,
      ...extra
    });
  return r.body as { numero: string; totales: { total: number } };
};

describe("pagos", () => {
  it("la vuelta del pago marca pagado, avisa y manda a gracias", async () => {
    const pedido = await crearPedido();

    const vuelta = await request(app).get("/api/pago-retorno").query({ metodo: "simulado", numero: pedido.numero });
    expect(vuelta.status).toBe(303);
    expect(vuelta.headers.location).toContain("e=pagado");

    const guardado = await prisma.pedido.findUnique({ where: { numero: pedido.numero } });
    expect(guardado?.estado).toBe("PAGADO");
    expect(correosEnviados().some((c) => /Pago recibido/.test(c.asunto))).toBe(true);
  });

  it("el mismo pago avisado dos veces se aplica una vez", async () => {
    const pedido = await crearPedido();

    const uno = await marcarPagado(pedido.numero, { metodo: "simulado", monto: pedido.totales.total, referencia: "a" });
    const dos = await marcarPagado(pedido.numero, { metodo: "simulado", monto: pedido.totales.total, referencia: "b" });

    expect(uno.ok).toBe(true);
    expect(dos.repetido).toBe(true);

    const guardado = await prisma.pedido.findUnique({ where: { numero: pedido.numero } });
    expect(guardado?.pagoReferencia).toBe("a");
  });

  it("dos confirmaciones a la vez no pagan dos veces", async () => {
    const pedido = await crearPedido();
    const resultados = await Promise.all([
      marcarPagado(pedido.numero, { metodo: "simulado", monto: pedido.totales.total, referencia: "x" }),
      marcarPagado(pedido.numero, { metodo: "simulado", monto: pedido.totales.total, referencia: "y" })
    ]);
    expect(resultados.filter((r) => r.repetido).length).toBe(1);
  });

  it("si el monto no cuadra, el pedido queda para revisar y NO pagado", async () => {
    const pedido = await crearPedido();
    const resultado = await marcarPagado(pedido.numero, { metodo: "webpay", monto: 9999, referencia: "z" });

    expect(resultado.ok).toBe(false);
    const guardado = await prisma.pedido.findUnique({ where: { numero: pedido.numero } });
    expect(guardado?.estado).toBe("REVISAR");
  });

  it("anular en la pasarela deja el pedido anulado y devuelve el stock", async () => {
    const pedido = await crearPedido();

    const vuelta = await request(app).get("/api/pago-retorno").query({ TBK_TOKEN: "abc", TBK_ID_SESION: pedido.numero });
    expect(vuelta.status).toBe(303);
    expect(vuelta.headers.location).toContain("e=anulado");

    const producto = await prisma.producto.findUnique({ where: { id: "p-vendible" } });
    expect(producto?.reservadas).toBe(0);
  });

  it("un aviso que no es de pago se ignora sin romper nada", async () => {
    const r = await request(app).post("/api/pago-aviso").send({ type: "otra_cosa" });
    expect(r.status).toBe(200);
    expect(r.body.ignorado).toBeTruthy();
  });
});

describe("firma del webhook", () => {
  it("sin MP_WEBHOOK_SECRET configurado, producción NO acepta el aviso", async () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PASARELA", "mercadopago");
    vi.stubEnv("MP_WEBHOOK_SECRET", "");
    vi.resetModules();

    const { crearApp: crearAppProd } = await import("../../src/app.js");
    const r = await request(crearAppProd())
      .post("/api/pago-aviso?data.id=123&type=payment")
      .send({ type: "payment", data: { id: "123" } });

    expect(r.body.ignorado).toBe("sin secreto de webhook");

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("con secreto configurado, una firma que no cuadra se descarta", async () => {
    vi.stubEnv("PASARELA", "mercadopago");
    vi.stubEnv("MP_WEBHOOK_SECRET", "secreto-de-pruebas");
    vi.resetModules();

    const { crearApp: crearAppMp } = await import("../../src/app.js");
    const r = await request(crearAppMp())
      .post("/api/pago-aviso?data.id=123&type=payment")
      .set("x-signature", "ts=1,v1=firmafalsa")
      .send({ type: "payment", data: { id: "123" } });

    expect(r.body.ignorado).toBe("firma");

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
