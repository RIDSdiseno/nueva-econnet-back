/**
 * Los motores de tráfico. Lo que se comprueba es lo que cuesta dinero: que al
 * feed de anuncios no entre nada incompleto —eso suspende la cuenta— y que el
 * informe diga qué falta, con nombre y apellido.
 */
import request from "supertest";
import { beforeAll, describe, expect, it } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { crearProducto, productoVendible } from "../ayudas.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

/** El único caso completo: precio propio, condición, stock e imagen. */
const productoAnunciable = () =>
  crearProducto({
    id: "completo",
    slug: "completo",
    marca: "ASUS",
    nombre: "ExpertBook completo",
    sku: "NT104ASU15",
    condicion: "NUEVO",
    precioVenta: 1_185_990,
    stockEstado: "EN_STOCK",
    stockUnidades: 10,
    imagenUrl: "https://econnet.cl/img/completo.jpg"
  });

describe("feed de anuncios", () => {
  it("un producto sin imagen no entra, aunque tenga precio y stock", async () => {
    await productoVendible("p1", 10);

    const r = await request(app).get("/api/feed/google.xml");
    expect(r.status).toBe(200);
    expect(r.text).not.toContain("p1");
    expect(r.text).toContain("<rss");
  });

  it("un producto completo sí entra, con su condición traducida", async () => {
    await productoAnunciable();

    const r = await request(app).get("/api/feed/google.xml");
    expect(r.text).toContain("<g:id>completo</g:id>");
    expect(r.text).toContain("<g:condition>new</g:condition>");
    expect(r.text).toContain("<g:availability>in_stock</g:availability>");
    expect(r.text).toContain("<g:price>1185990 CLP</g:price>");
  });

  it("un reacondicionado va como refurbished, no como nuevo", async () => {
    await crearProducto({
      id: "refu", slug: "refu", marca: "HP", nombre: "EliteBook",
      condicion: "REACONDICIONADO", precioVenta: 499_990,
      stockEstado: "EN_STOCK", stockUnidades: 3, imagenUrl: "https://econnet.cl/img/refu.jpg"
    });

    const r = await request(app).get("/api/feed/google.xml");
    expect(r.text).toContain("<g:condition>refurbished</g:condition>");
  });

  it("el CSV de Meta lleva cabecera y una fila por producto publicable", async () => {
    await productoAnunciable();
    await productoVendible("incompleto", 5);

    const r = await request(app).get("/api/feed/meta.csv");
    const filas = r.text.trim().split("\n");
    expect(filas[0]).toContain('"id","title"');
    expect(filas).toHaveLength(2);
    expect(filas[1]).toContain("completo");
  });

  it("el informe dice cuántos faltan y por qué, producto a producto", async () => {
    await productoVendible("p1", 10);
    await crearProducto({
      id: "p2", slug: "p2", marca: "Dell", nombre: "Latitude",
      precioLider: 399_990, stockEstado: "DESCONOCIDO"
    });

    const r = await request(app).get("/api/feed/informe");
    const { informe } = r.body;

    expect(informe.total).toBe(2);
    expect(informe.publicables).toBe(0);
    expect(informe.sePuedeAnunciar).toBe(false);
    expect(informe.resumen).toMatch(/Ninguno de los 2 productos/);

    const latitude = informe.fuera.find((f: { nombre: string }) => f.nombre.includes("Latitude"));
    expect(latitude.faltas).toEqual(
      expect.arrayContaining(["sin precio propio", "sin condición declarada", "sin stock conocido", "sin imagen"])
    );

    const imagen = informe.faltas.find((f: { falta: string }) => f.falta === "sin imagen");
    expect(imagen.productos).toBe(2);
  });

  it("con catálogo completo, el informe deja anunciar", async () => {
    await productoAnunciable();

    const r = await request(app).get("/api/feed/informe");
    expect(r.body.informe.sePuedeAnunciar).toBe(true);
    expect(r.body.informe.resumen).toMatch(/1 de 1 productos/);
  });

  it("los feeds se sirven con su tipo y con caché: Google los pide cada día", async () => {
    await productoAnunciable();

    const xml = await request(app).get("/api/feed/google.xml");
    expect(xml.headers["content-type"]).toMatch(/xml/);
    expect(xml.headers["cache-control"]).toMatch(/max-age/);

    const csv = await request(app).get("/api/feed/meta.csv");
    expect(csv.headers["content-type"]).toMatch(/csv/);
  });
});
