/**
 * El margen. Lo que se comprueba aquí es que **no se inventa**: sin coste no
 * hay porcentaje, y sin porcentaje no se decide un presupuesto de publicidad
 * con un número que nadie midió.
 */
import { describe, expect, it } from "vitest";
import { aNeto, margenDe, resumirMargen } from "../../src/services/margen.js";

const equipo = (cambios: Record<string, unknown> = {}) =>
  ({
    id: "p1",
    marca: "Lenovo",
    nombre: "ThinkPad",
    precioVenta: null,
    costoNeto: null,
    stockUnidades: null,
    archivado: null,
    ...cambios
  }) as never;

describe("el margen de un equipo", () => {
  it("sin coste no se calcula, y dice qué falta", () => {
    const m = margenDe(equipo({ precioVenta: 1_190_000 }));
    expect(m.porcentaje).toBeNull();
    expect(m.pesos).toBeNull();
    expect(m.porcentaje).not.toBe(0);
    expect(m.falta).toContain("coste de compra");
  });

  it("sin precio tampoco, aunque el coste esté", () => {
    const m = margenDe(equipo({ costoNeto: 500_000 }));
    expect(m.porcentaje).toBeNull();
    expect(m.falta).toContain("precio de venta");
  });

  it("se calcula sobre el neto: el IVA no es tuyo", () => {
    /* $1.190.000 con IVA son $1.000.000 netos. Con un coste de $800.000
       quedan $200.000, que es el 20% — no el 32,8% que saldría de comparar
       el coste contra el precio con IVA. */
    const m = margenDe(equipo({ precioVenta: 1_190_000, costoNeto: 800_000 }));
    expect(aNeto(1_190_000)).toBe(1_000_000);
    expect(m.pesos).toBe(200_000);
    expect(m.porcentaje).toBe(20);
  });

  it("un margen negativo se dice, no se esconde", () => {
    const m = margenDe(equipo({ precioVenta: 1_190_000, costoNeto: 1_100_000 }));
    expect(m.pesos).toBe(-100_000);
    expect(m.porcentaje).toBeLessThan(0);
  });
});

describe("el resumen del inventario", () => {
  it("pondera por unidades: diez cámaras con buen margen no tapan un notebook malo", () => {
    const r = resumirMargen([
      /* 10 unidades, neto 100.000, coste 50.000 → 50% */
      equipo({ id: "camara", precioVenta: 119_000, costoNeto: 50_000, stockUnidades: 10 }),
      /* 10 unidades, neto 1.000.000, coste 960.000 → 4% */
      equipo({ id: "notebook", precioVenta: 1_190_000, costoNeto: 960_000, stockUnidades: 10 })
    ]);

    /* La media simple diría 27%. Lo que de verdad deja el inventario es mucho
       menos, porque el dinero está en el notebook. */
    expect(r.porcentajeMedio).toBe(27);
    expect(r.porcentajePonderado).toBeLessThan(10);
    expect(r.gananciaPotencial).toBe(500_000 + 400_000);
  });

  it("cuenta cuántos no se pueden calcular en vez de dejarlos fuera en silencio", () => {
    const r = resumirMargen([
      equipo({ id: "a", precioVenta: 119_000, costoNeto: 50_000, stockUnidades: 1 }),
      equipo({ id: "b", precioVenta: 119_000 }),
      equipo({ id: "c" })
    ]);
    expect(r.conDato).toBe(1);
    expect(r.sinDato).toBe(2);
  });

  it("sin ningún coste, no hay porcentaje: null, no cero", () => {
    const r = resumirMargen([equipo({ id: "a", precioVenta: 119_000, stockUnidades: 5 })]);
    expect(r.porcentajePonderado).toBeNull();
    expect(r.porcentajeMedio).toBeNull();
    expect(r.gananciaPotencial).toBeNull();
  });

  it("lo archivado no cuenta: ya no se vende", () => {
    const r = resumirMargen([
      equipo({ id: "a", precioVenta: 119_000, costoNeto: 50_000, stockUnidades: 5, archivado: new Date() })
    ]);
    expect(r.conDato).toBe(0);
    expect(r.gananciaPotencial).toBeNull();
  });
});
