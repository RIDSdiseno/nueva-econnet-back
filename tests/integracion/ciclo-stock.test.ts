/**
 * El ciclo de vida del stock y la máquina de estados.
 *
 * Es lo que más dinero cuesta si está mal: vender dos veces la misma unidad, o
 * que el inventario no baje nunca y la tienda diga «sin stock» con la bodega
 * llena.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { prisma } from "../../src/repositories/prisma.js";
import { cambiarEstado, marcarPagado } from "../../src/services/pedidos.service.js";
import { puedePasar, TRANSICIONES } from "../../src/services/estados-pedido.js";
import { compraBase, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

const stockDe = async (id = "p1") => {
  const p = await prisma.producto.findUnique({ where: { id } });
  return { unidades: p?.stockUnidades ?? null, reservadas: p?.reservadas ?? 0, estado: p?.stockEstado };
};

async function unPedido(cantidad = 1, clave = "ciclo-0001") {
  const r = await request(app)
    .post("/api/pedido")
    .send({ ...compraBase, items: [{ productoId: "p1", cantidad }], idempotencia: clave });
  return r.body.numero as string;
}

describe("reserva → pago → stock", () => {
  it("crear el pedido reserva, pero no descuenta todavía", async () => {
    await productoVendible("p1", 5);
    await unPedido(2);

    expect(await stockDe()).toMatchObject({ unidades: 5, reservadas: 2 });
  });

  it("pagar descuenta el stock físico y suelta la reserva", async () => {
    await productoVendible("p1", 5);
    const numero = await unPedido(2);

    await marcarPagado(numero, { metodo: "simulado", monto: (await prisma.pedido.findUnique({ where: { numero } }))!.total });

    expect(await stockDe()).toMatchObject({ unidades: 3, reservadas: 0 });
  });

  it("pagar dos veces no descuenta dos veces", async () => {
    await productoVendible("p1", 5);
    const numero = await unPedido(2);
    const total = (await prisma.pedido.findUnique({ where: { numero } }))!.total;

    await marcarPagado(numero, { metodo: "simulado", monto: total });
    await marcarPagado(numero, { metodo: "simulado", monto: total });
    await marcarPagado(numero, { metodo: "simulado", monto: total });

    expect(await stockDe()).toMatchObject({ unidades: 3, reservadas: 0 });
    expect(await prisma.pedido.count()).toBe(1);
  });

  it("la última unidad pagada deja el producto sin existencias", async () => {
    await productoVendible("p1", 1);
    const numero = await unPedido(1);
    await marcarPagado(numero, { metodo: "simulado", monto: (await prisma.pedido.findUnique({ where: { numero } }))!.total });

    expect(await stockDe()).toMatchObject({ unidades: 0, reservadas: 0, estado: "SIN_EXISTENCIAS" });
  });

  it("anular libera la reserva y no toca el stock físico", async () => {
    await productoVendible("p1", 5);
    const numero = await unPedido(2);

    await cambiarEstado(numero, "ANULADO", "prueba");

    expect(await stockDe()).toMatchObject({ unidades: 5, reservadas: 0 });
  });

  it("anular dos veces NO libera dos veces: eso robaba reservas de otros pedidos", async () => {
    await productoVendible("p1", 5);
    const deA = await unPedido(2, "ciclo-anula-a");
    await unPedido(2, "ciclo-anula-b");
    expect((await stockDe()).reservadas).toBe(4);

    await cambiarEstado(deA, "ANULADO", "una");
    await cambiarEstado(deA, "ANULADO", "otra vez");
    await cambiarEstado(deA, "ANULADO", "y otra");

    /* Solo se sueltan las 2 del pedido A: las 2 de B siguen apartadas. */
    expect((await stockDe()).reservadas).toBe(2);
  });

  it("un pedido pagado y luego anulado no devuelve stock que ya salió", async () => {
    await productoVendible("p1", 5);
    const numero = await unPedido(2);
    await marcarPagado(numero, { metodo: "simulado", monto: (await prisma.pedido.findUnique({ where: { numero } }))!.total });

    await cambiarEstado(numero, "REVISAR", "revisión").catch(() => null);
    await cambiarEstado(numero, "ANULADO", "anulado tras pagar");

    /* Se consumió al pagar: anular después no puede devolver una reserva que ya no existe. */
    expect(await stockDe()).toMatchObject({ unidades: 3, reservadas: 0 });
  });

  it("el stock nunca queda negativo, pase lo que pase", async () => {
    await productoVendible("p1", 1);
    const numero = await unPedido(1);
    await marcarPagado(numero, { metodo: "simulado", monto: (await prisma.pedido.findUnique({ where: { numero } }))!.total });

    const { unidades, reservadas } = await stockDe();
    expect(unidades).toBeGreaterThanOrEqual(0);
    expect(reservadas).toBeGreaterThanOrEqual(0);
  });
});

describe("máquina de estados", () => {
  it("no deja volver atrás desde un estado final", () => {
    expect(puedePasar("ANULADO", "PAGADO").ok).toBe(false);
    expect(puedePasar("DEVUELTO", "PAGADO").ok).toBe(false);
    expect(puedePasar("ENTREGADO", "PENDIENTE_PAGO").ok).toBe(false);
  });

  it("repetir el mismo estado es un no-op, no un error", () => {
    expect(puedePasar("PAGADO", "PAGADO")).toEqual({ ok: true, repetida: true });
  });

  it("deja el recorrido normal de una venta", () => {
    const camino = ["PENDIENTE_PAGO", "PAGADO", "PREPARANDO", "DESPACHADO", "ENTREGADO"] as const;
    for (let i = 0; i < camino.length - 1; i++) {
      expect(puedePasar(camino[i]!, camino[i + 1]!).ok, `${camino[i]} → ${camino[i + 1]}`).toBe(true);
    }
  });

  it("todos los estados están en la tabla: ninguno se queda sin definir", () => {
    const enEsquema = ["POR_CONFIRMAR", "PENDIENTE_PAGO", "PAGADO", "PREPARANDO", "DESPACHADO", "ENTREGADO", "ANULADO", "DEVUELTO", "REVISAR"];
    expect(Object.keys(TRANSICIONES).sort()).toEqual(enEsquema.sort());
  });

  it("una transición prohibida se rechaza y no cambia nada", async () => {
    await productoVendible("p1", 5);
    const numero = await unPedido(1);
    await cambiarEstado(numero, "ANULADO", "cerrado");

    await expect(cambiarEstado(numero, "PAGADO", "colado")).rejects.toMatchObject({ codigo: "transicion_invalida" });
    expect((await prisma.pedido.findUnique({ where: { numero } }))?.estado).toBe("ANULADO");
  });
});

describe("la pasarela simulada no llega a producción", () => {
  it("comprobarConfigCritica la rechaza", async () => {
    const { vi } = await import("vitest");
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("PASARELA", "simulado");
    vi.stubEnv("APP_SECRET", "secreto-de-pruebas-larguisimo-0123456789abcdef");
    vi.stubEnv("CRON_SECRET", "cron");
    vi.resetModules();

    const { comprobarConfigCritica } = await import("../../src/config/env.js");
    expect(() => comprobarConfigCritica()).toThrow(/simulado/i);

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});

describe("concurrencia real", () => {
  it("stock = 1, dos personas comprando a la vez: una sola venta", async () => {
    await productoVendible("p1", 1);

    const [a, b] = await Promise.all([
      request(app).post("/api/pedido").send({ ...compraBase, correo: "a@econnet.cl", items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "carrera-aaa" }),
      request(app).post("/api/pedido").send({ ...compraBase, correo: "b@econnet.cl", items: [{ productoId: "p1", cantidad: 1 }], idempotencia: "carrera-bbb" })
    ]);

    const creados = [a, b].filter((r) => r.status === 201);
    const rechazados = [a, b].filter((r) => r.status === 409);

    expect(creados).toHaveLength(1);
    expect(rechazados).toHaveLength(1);
    expect(await prisma.pedido.count()).toBe(1);
    expect(await stockDe()).toMatchObject({ unidades: 1, reservadas: 1 });
  });

  it("stock = 1, treinta a la vez, y la que gana paga: queda en cero", async () => {
    await productoVendible("p1", 1);

    const respuestas = await Promise.all(
      Array.from({ length: 30 }, (_, i) =>
        request(app)
          .post("/api/pedido")
          .send({ ...compraBase, correo: `carrera${i}@econnet.cl`, items: [{ productoId: "p1", cantidad: 1 }], idempotencia: `carrera-masiva-${i}` })
      )
    );

    const creados = respuestas.filter((r) => r.status === 201);
    expect(creados).toHaveLength(1);

    const numero = creados[0]!.body.numero as string;
    await marcarPagado(numero, { metodo: "simulado", monto: (await prisma.pedido.findUnique({ where: { numero } }))!.total });

    expect(await stockDe()).toMatchObject({ unidades: 0, reservadas: 0, estado: "SIN_EXISTENCIAS" });
  });

  it("el mismo webhook tres veces deja un solo pedido pagado", async () => {
    await productoVendible("p1", 3);
    const numero = await unPedido(1, "webhook-repetido");
    const total = (await prisma.pedido.findUnique({ where: { numero } }))!.total;

    const resultados = await Promise.all([
      marcarPagado(numero, { metodo: "webpay", referencia: "ref-1", monto: total }),
      marcarPagado(numero, { metodo: "webpay", referencia: "ref-1", monto: total }),
      marcarPagado(numero, { metodo: "webpay", referencia: "ref-1", monto: total })
    ]);

    expect(resultados.filter((r) => r.ok)).toHaveLength(3); /* los tres dicen que sí */
    expect(resultados.filter((r) => r.repetido)).toHaveLength(2); /* dos eran repeticiones */
    expect(await stockDe()).toMatchObject({ unidades: 2, reservadas: 0 });

    const eventos = await prisma.pedidoEvento.count({ where: { pedido: { numero }, estado: "PAGADO" } });
    expect(eventos).toBe(1);
  });
});
