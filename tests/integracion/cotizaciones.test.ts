/**
 * La venta a empresas. Lo que se comprueba no es que se guarde el formulario:
 * es que la empresa se va con una propuesta con número, precios de hoy y
 * fecha de caducidad — y que lo que no se sabe sale escrito en vez de
 * inventado.
 */
import request from "supertest";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { Express } from "express";
import { crearApp } from "../../src/app.js";
import { prisma } from "../../src/repositories/prisma.js";
import { correosEnviados, limpiarCorreosEnviados } from "../../src/services/correo.js";
import { crearProducto, productoVendible } from "../ayudas.js";
import { seguirCotizaciones } from "../../src/services/trabajos.service.js";
import { drenarCola } from "../../src/services/cola-correo.js";

let app: Express;
beforeAll(() => {
  app = crearApp();
});

const cotizacionBase = {
  correo: "compras@empresa.cl",
  nombre: "Ana Pérez",
  empresa: "Constructora Ejemplo SpA",
  telefono: "+56912345678",
  equipos: 20,
  perfil: "administrativo",
  presupuesto: 1_200_000,
  accesorios: false,
  consentimiento: true as const,
  ms: 5000
};

describe("cotización de empresa", () => {
  it("devuelve una propuesta con número, líneas y desglose de IVA", async () => {
    await productoVendible("p1", 10);

    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    expect(r.status).toBe(201);
    expect(r.body.numero).toMatch(/^COT-\d{4}-\d{5}$/);

    const { propuesta } = r.body;
    expect(propuesta.lineas).toHaveLength(1);
    expect(propuesta.lineas[0]).toMatchObject({ cantidad: 20, precioUnitario: 1_185_990 });
    expect(propuesta.subtotal).toBe(1_185_990 * 20);
    expect(propuesta.neto + propuesta.iva).toBe(propuesta.total);
  });

  it("el precio unitario es el de la tienda: no se inventa un precio de empresa", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    const producto = await prisma.producto.findUnique({ where: { id: "p1" } });
    expect(r.body.propuesta.lineas[0].precioUnitario).toBe(producto?.precioVenta);
  });

  it("sin política de descuento cargada, no descuenta nada y lo dice", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);

    expect(r.body.propuesta.descuento).toBe(0);
    expect(r.body.propuesta.descuentoPorcentaje).toBe(0);
    expect(r.body.propuesta.huecos.join(" ")).toMatch(/descuento por volumen no está cargado/i);
  });

  it("con política cargada, aplica el tramo que toca", async () => {
    vi.stubEnv("DESCUENTO_VOLUMEN", "10:3|25:5");
    vi.resetModules();
    const { armarPropuesta } = await import("../../src/services/propuestas.service.js");
    await productoVendible("p1", 10);

    const veinte = await armarPropuesta({ equipos: 20, perfil: "administrativo", presupuesto: 1_200_000, accesorios: false });
    expect(veinte.descuentoPorcentaje).toBe(3);
    expect(veinte.descuento).toBe(Math.round(veinte.subtotal * 0.03));

    const treinta = await armarPropuesta({ equipos: 30, perfil: "administrativo", presupuesto: 1_200_000, accesorios: false });
    expect(treinta.descuentoPorcentaje).toBe(5);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("no promete plazo cuando el stock no se conoce", async () => {
    await crearProducto({
      id: "p-sin", slug: "p-sin", marca: "ASUS", nombre: "Sin stock",
      condicion: "NUEVO", precioVenta: 900_000, stockEstado: "DESCONOCIDO"
    });

    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, presupuesto: 950_000 });
    expect(r.body.propuesta.lineas[0].stockConocido).toBe(false);
    expect(r.body.propuesta.huecos.join(" ")).toMatch(/stock .* por confirmar/i);
  });

  it("un equipo sin condición declarada se cotiza, pero se avisa antes de facturar", async () => {
    await crearProducto({
      id: "p-sc", slug: "p-sc", marca: "HP", nombre: "Sin condición",
      precioVenta: 800_000, stockEstado: "EN_STOCK", stockUnidades: 40
    });

    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, presupuesto: 850_000 });
    expect(r.body.propuesta.lineas[0].condicion).toBeNull();
    expect(r.body.propuesta.huecos.join(" ")).toMatch(/condición .* no está declarada/i);
  });

  it("pidiendo puesto completo sin accesorios en catálogo, lo dice en vez de inventar un precio", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, accesorios: true });

    expect(r.body.propuesta.lineas.filter((l: { concepto: string }) => l.concepto === "accesorio")).toHaveLength(0);
    expect(r.body.propuesta.huecos.join(" ")).toMatch(/no hay monitor ni accesorios/i);
  });

  it("con accesorio en catálogo, lo cotiza con su precio real", async () => {
    await productoVendible("p1", 10);
    await crearProducto({
      id: "mon", slug: "mon", marca: "Xiaomi", nombre: "Monitor A24i", categoria: "Monitor",
      condicion: "NUEVO", precioVenta: 95_200, stockEstado: "EN_STOCK", stockUnidades: 50
    });

    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, accesorios: true });
    const accesorio = r.body.propuesta.lineas.find((l: { concepto: string }) => l.concepto === "accesorio");
    expect(accesorio).toMatchObject({ precioUnitario: 95_200, cantidad: 20 });
  });

  it("si nada del catálogo entra en el presupuesto, no recomienda nada y lo dice", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, presupuesto: 200_000 });

    expect(r.body.propuesta.lineas).toHaveLength(0);
    expect(r.body.propuesta.total).toBe(0);
    expect(r.body.propuesta.huecos.join(" ")).toMatch(/no hay nada en el catálogo/i);
  });

  it("manda la propuesta al cliente y el aviso a ventas", async () => {
    await productoVendible("p1", 10);
    limpiarCorreosEnviados();
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);

    const correos = correosEnviados();
    const alCliente = correos.find((c) => c.para === "compras@empresa.cl");
    expect(alCliente?.asunto).toContain(r.body.numero);
    expect(alCliente?.texto).toMatch(/Aceptar:/);
    expect(correos.some((c) => c.asunto.includes("Cotización nueva"))).toBe(true);
  });

  it("guarda la propuesta tal como se envió: el catálogo cambia, la cotización no", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);

    await prisma.producto.update({ where: { id: "p1" }, data: { precioVenta: 2_000_000 } });

    const guardada = await prisma.cotizacion.findUnique({ where: { numero: r.body.numero } });
    const propuesta = guardada?.propuesta as { lineas: Array<{ precioUnitario: number }> };
    expect(propuesta.lineas[0]?.precioUnitario).toBe(1_185_990);
  });

  it("caduca: lleva fecha de validez y se guarda", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    const guardada = await prisma.cotizacion.findUnique({ where: { numero: r.body.numero } });
    expect(guardada?.validaHasta.getTime()).toBeGreaterThan(Date.now());
  });

  it("rechaza un perfil que no existe", async () => {
    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, perfil: "lo-que-sea" });
    expect(r.status).toBe(400);
  });

  it("sin consentimiento no se cotiza", async () => {
    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, consentimiento: false });
    expect(r.status).toBe(400);
    expect(await prisma.cotizacion.count()).toBe(0);
  });

  it("un formulario de robot no crea cotización", async () => {
    const r = await request(app).post("/api/cotizar").send({ ...cotizacionBase, ms: 200 });
    expect(r.status).toBe(200);
    expect(await prisma.cotizacion.count()).toBe(0);
  });
});

describe("ver y aceptar", () => {
  async function unaCotizacion() {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    return r.body.numero as string;
  }

  it("se consulta con número y correo, y queda marcada como vista", async () => {
    const numero = await unaCotizacion();

    const r = await request(app).get("/api/cotizacion").query({ numero, correo: "compras@empresa.cl" });
    expect(r.status).toBe(200);
    expect(r.body.cotizacion.numero).toBe(numero);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.estado).toBe("VISTA");
  });

  it("con otro correo no se ve la cotización de nadie", async () => {
    const numero = await unaCotizacion();
    const r = await request(app).get("/api/cotizacion").query({ numero, correo: "curioso@otro.cl" });
    expect(r.status).toBe(404);
  });

  it("se acepta desde el enlace firmado del correo", async () => {
    const numero = await unaCotizacion();
    const correo = correosEnviados().find((c) => c.para === "compras@empresa.cl");
    const enlace = /aceptar\?t=([^\s\n]+)/.exec(correo?.texto ?? "")?.[1];
    expect(enlace).toBeTruthy();

    const r = await request(app).get("/api/cotizacion/aceptar").query({ t: enlace });
    expect(r.status).toBe(303);
    expect(r.headers.location).toMatch(/estado=aceptada/);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.estado).toBe("ACEPTADA");
    expect(guardada?.proximoCorreo).toBeNull();
  });

  it("un enlace inventado no acepta nada", async () => {
    const numero = await unaCotizacion();
    const r = await request(app).get("/api/cotizacion/aceptar").query({ t: "inventado.firma" });
    expect(r.headers.location).toMatch(/enlace-caducado/);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.estado).not.toBe("ACEPTADA");
  });
});

describe("seguimiento", () => {
  async function cotizacionQueToca(dias: number) {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    await prisma.cotizacion.update({
      where: { numero: r.body.numero },
      data: { proximoCorreo: new Date(Date.now() - dias * 86_400_000) }
    });
    return r.body.numero as string;
  }

  it("encola el primer recordatorio y programa el siguiente", async () => {
    const numero = await cotizacionQueToca(1);

    const informe = await seguirCotizaciones();
    expect(informe.encolados).toBe(1);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.seguimiento).toBe(1);
    expect(guardada?.proximoCorreo).not.toBeNull();
  });

  it("no manda el mismo recordatorio dos veces aunque el cron se dispare dos veces", async () => {
    await cotizacionQueToca(1);
    await seguirCotizaciones();
    await prisma.cotizacion.updateMany({ data: { proximoCorreo: new Date(Date.now() - 86_400_000), seguimiento: 0 } });
    await seguirCotizaciones();

    expect(await prisma.correoEncolado.count()).toBe(1);
  });

  it("una cotización aceptada no se persigue más", async () => {
    const numero = await cotizacionQueToca(1);
    await prisma.cotizacion.update({ where: { numero }, data: { estado: "ACEPTADA" } });

    const informe = await seguirCotizaciones();
    expect(informe.encolados).toBe(0);
  });

  it("quien se dio de baja no recibe recordatorios, aunque su cotización siga viva", async () => {
    const numero = await cotizacionQueToca(1);
    await prisma.lead.update({ where: { correo: "compras@empresa.cl" }, data: { consienteMarketing: false, bajaFecha: new Date(), bajaMotivo: "prueba" } });

    const informe = await seguirCotizaciones();
    expect(informe.encolados).toBe(0);
    expect(informe.saltados["dado de baja"]).toBe(1);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.proximoCorreo).toBeNull();
  });

  it("al tercer recordatorio se cierra sola", async () => {
    const numero = await cotizacionQueToca(1);
    await prisma.cotizacion.update({ where: { numero }, data: { seguimiento: 3 } });

    const informe = await seguirCotizaciones();
    expect(informe.cerrados).toBe(1);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero } });
    expect(guardada?.proximoCorreo).toBeNull();
  });

  it("los recordatorios llevan enlace de baja: rozan lo comercial", async () => {
    await cotizacionQueToca(1);
    await seguirCotizaciones();
    limpiarCorreosEnviados();
    await drenarCola();

    const enviado = correosEnviados()[0];
    expect(enviado?.texto).toMatch(/baja/i);
  });

  it("pasada la fecha de validez, se marca caducada y deja de perseguirse", async () => {
    await productoVendible("p1", 10);
    const r = await request(app).post("/api/cotizar").send(cotizacionBase);
    await prisma.cotizacion.update({
      where: { numero: r.body.numero },
      data: { validaHasta: new Date(Date.now() - 86_400_000) }
    });

    const informe = await seguirCotizaciones();
    expect(informe.caducadas).toBe(1);

    const guardada = await prisma.cotizacion.findUnique({ where: { numero: r.body.numero } });
    expect(guardada?.estado).toBe("CADUCADA");
    expect(guardada?.proximoCorreo).toBeNull();
  });
});
