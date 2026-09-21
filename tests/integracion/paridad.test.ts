/**
 * Paridad con los marketplaces. Es un informe interno: enseña margen, así que
 * también se comprueba que no esté abierto a cualquiera.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { paridad } from "../../src/services/paridad.service.js";
import { crearProducto } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

describe("paridad de precios", () => {
  it("marca el equipo que está más caro en casa que en su propio marketplace", async () => {
    await crearProducto({
      id: "caro", slug: "caro", marca: "ASUS", nombre: "Más caro en casa",
      precioVenta: 1_200_000, precioFalabella: 1_000_000
    });

    const informe = await paridad();
    const fila = informe.filas.find((f) => f.id === "caro");

    expect(fila?.situacion).toBe("mas-caro-en-casa");
    expect(fila?.diferencia).toBe(200_000);
    expect(fila?.diferenciaPorcentaje).toBe(20);
    expect(informe.avisos.join(" ")).toMatch(/MÁS CAROS en econnet\.cl/);
  });

  it("marca el que está más barato en casa: es un argumento de venta, no un problema", async () => {
    await crearProducto({
      id: "barato", slug: "barato", marca: "ASUS", nombre: "Más barato en casa",
      precioVenta: 1_185_990, precioFalabella: 1_721_990
    });

    const fila = (await paridad()).filas.find((f) => f.id === "barato");
    expect(fila?.situacion).toBe("mas-barato-en-casa");
    expect(fila?.diferenciaPorcentaje).toBe(-31);
  });

  it("compara contra el marketplace más barato: es el que ve el cliente", async () => {
    await crearProducto({
      id: "dos", slug: "dos", marca: "ASUS", nombre: "En los dos",
      precioVenta: 900_000, precioFalabella: 1_100_000, precioLider: 800_000
    });

    const fila = (await paridad()).filas.find((f) => f.id === "dos");
    expect(fila?.canal).toBe("lider");
    expect(fila?.precioCanal).toBe(800_000);
    expect(fila?.situacion).toBe("mas-caro-en-casa");
  });

  it("señala los que se venden fuera pero no tienen precio propio: ahí se cae la venta", async () => {
    await crearProducto({
      id: "solofuera", slug: "solofuera", marca: "Dell", nombre: "Latitude",
      precioLider: 399_990
    });

    const informe = await paridad();
    expect(informe.filas.find((f) => f.id === "solofuera")?.situacion).toBe("solo-marketplace");
    expect(informe.avisos.join(" ")).toMatch(/NO tienen precio propio/);
  });

  it("distingue «no está en marketplace» de «no tiene precio»", async () => {
    await crearProducto({ id: "propio", slug: "propio", marca: "HP", nombre: "Solo en casa", precioVenta: 500_000 });
    await crearProducto({ id: "nada", slug: "nada", marca: "HP", nombre: "Sin precio" });

    const informe = await paridad();
    expect(informe.filas.find((f) => f.id === "propio")?.situacion).toBe("solo-propio");
    expect(informe.filas.find((f) => f.id === "nada")?.situacion).toBe("sin-precio");
  });

  it("cada fila lleva su fuente y su fecha: un precio sin fecha no se compara", async () => {
    await crearProducto({
      id: "f", slug: "f", marca: "ASUS", nombre: "Con fuente",
      precioVenta: 100_000, precioFalabella: 120_000
    });

    const fila = (await paridad()).filas.find((f) => f.id === "f");
    expect(fila?.fuente).toBeTruthy();
    expect(fila?.fechaDato).toBe("18-09-2026");
  });

  it("el informe no está abierto: sin el secreto no se ve el margen", async () => {
    const sinSecreto = await request(app).get("/api/informes/paridad");
    expect(sinSecreto.status).toBe(401);

    const conSecreto = await request(app)
      .get("/api/informes/paridad")
      .set("authorization", "Bearer cron-de-pruebas");
    expect(conSecreto.status).toBe(200);
    expect(conSecreto.body.informe.total).toBeDefined();
  });
});
