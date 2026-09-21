import { describe, expect, it, vi } from "vitest";
import { desglosar, sumarLineas } from "../../src/services/dinero.js";
import { cotizarEnvio } from "../../src/services/envios.js";
import { comprobar, firmar } from "../../src/services/firma.js";
import { pareceRobot, rutValido, telefonoValido } from "../../src/services/texto.js";

describe("dinero", () => {
  it("separa el IVA como lo pide el SII", () => {
    const d = desglosar(1_190_000);
    expect(d.neto + d.iva).toBe(1_190_000);
    expect(d.neto).toBe(1_000_000);
  });

  it("suma líneas por cantidad", () => {
    expect(sumarLineas([{ precio: 1000, cantidad: 3 }, { precio: 500, cantidad: 2 }])).toBe(4000);
  });
});

describe("despacho", () => {
  it("el retiro no cuesta", () => {
    expect(cotizarEnvio({ modo: "RETIRO" }).costo).toBe(0);
  });

  it("sin tarifa cargada, el despacho queda por confirmar y no se cobra", () => {
    const cotizacion = cotizarEnvio({ modo: "DESPACHO", region: "Metropolitana de Santiago" });
    expect(cotizacion.costo).toBeNull();
    expect(cotizacion.porConfirmar).toBe(true);
  });

  it("una región inventada no pasa", () => {
    expect(cotizarEnvio({ modo: "DESPACHO", region: "Cataluña" }).porConfirmar).toBe(true);
  });
});

describe("firma de enlaces", () => {
  it("un token firmado se lee", () => {
    expect(comprobar(firmar({ a: "baja", c: "x@y.cl" }))?.c).toBe("x@y.cl");
  });

  it("un token manipulado no vale", () => {
    const token = firmar({ a: "baja", c: "x@y.cl" });
    expect(comprobar(`${token.slice(0, -2)}zz`)).toBeNull();
  });

  it("un token caducado no vale", () => {
    expect(comprobar(firmar({ a: "baja" }, -10))).toBeNull();
  });

  it("la basura no revienta", () => {
    expect(comprobar("hola")).toBeNull();
    expect(comprobar(null)).toBeNull();
  });
});

describe("datos chilenos", () => {
  it("comprueba el RUT de verdad", () => {
    expect(rutValido("76.086.428-5")).toBe(true);
    expect(rutValido("11111111-1")).toBe(true);
    expect(rutValido("11.111.111-2")).toBe(false);
    expect(rutValido("hola")).toBe(false);
  });

  it("reconoce un teléfono chileno", () => {
    expect(telefonoValido("+56 9 8765 4321")).toBe(true);
    expect(telefonoValido("123")).toBe(false);
  });

  it("caza robots por el campo trampa y por el tiempo", () => {
    expect(pareceRobot({ empresa_web: "http://spam" })).toBeTruthy();
    expect(pareceRobot({ ms: 300 })).toBeTruthy();
    expect(pareceRobot({ ms: 9000 })).toBeNull();
  });
});

describe("plazos de despacho", () => {
  it("sin plazo declarado no se promete ninguno", async () => {
    vi.stubEnv("ENVIO_TABLA", "Metropolitana de Santiago:6990");
    vi.resetModules();
    const { cotizarEnvio } = await import("../../src/services/envios.js");

    const envio = cotizarEnvio({ modo: "DESPACHO", region: "Metropolitana de Santiago" });
    expect(envio.costo).toBe(6990);
    expect(envio.diasEstimados).toBeNull();
    expect(envio.nota).not.toMatch(/día/i);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("con plazo declarado, se dice", async () => {
    vi.stubEnv("ENVIO_TABLA", "Metropolitana de Santiago:6990:2");
    vi.resetModules();
    const { cotizarEnvio } = await import("../../src/services/envios.js");

    const envio = cotizarEnvio({ modo: "DESPACHO", region: "Metropolitana de Santiago" });
    expect(envio.diasEstimados).toBe(2);
    expect(envio.nota).toMatch(/2 días hábiles/);

    vi.unstubAllEnvs();
    vi.resetModules();
  });

  it("sin tabla cargada no se cobra ni se promete nada", async () => {
    vi.stubEnv("ENVIO_TABLA", "");
    vi.resetModules();
    const { cotizarEnvio } = await import("../../src/services/envios.js");

    const envio = cotizarEnvio({ modo: "DESPACHO", region: "Maule" });
    expect(envio.costo).toBeNull();
    expect(envio.porConfirmar).toBe(true);
    expect(envio.diasEstimados).toBeNull();

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
