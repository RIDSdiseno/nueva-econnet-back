/**
 * La importación del catálogo. Un CSV de proveedor viene sucio: comas dentro
 * de comillas, precios con puntos de miles, columnas que no están y celdas
 * vacías que significan «no sé», no «cero».
 */
import { describe, expect, it } from "vitest";
import { aPesos, partirCsv } from "../../src/services/importacion.service.js";

describe("leer un CSV de verdad", () => {
  it("una coma dentro de comillas no parte la celda", () => {
    const filas = partirCsv('nombre,precio\n"ThinkPad E14, 16 GB",899990');
    expect(filas[1]).toEqual(["ThinkPad E14, 16 GB", "899990"]);
  });

  it("las comillas escapadas se leen como una comilla", () => {
    const filas = partirCsv('nombre\n"Pantalla de 14"" FHD"');
    expect(filas[1]?.[0]).toBe('Pantalla de 14" FHD');
  });

  it("un salto de línea dentro de una celda no crea una fila", () => {
    const filas = partirCsv('nombre,desc\nThinkPad,"Primera línea\nSegunda línea"');
    expect(filas).toHaveLength(2);
    expect(filas[1]?.[1]).toContain("\n");
  });

  it("acepta punto y coma, que es lo que exporta Excel en español", () => {
    expect(partirCsv("nombre;precio\nThinkPad;899990")[1]).toEqual(["ThinkPad", "899990"]);
  });

  it("se come el BOM que mete Excel al principio", () => {
    expect(partirCsv("﻿nombre,precio\nX,1")[0]?.[0]).toBe("nombre");
  });

  it("las filas en blanco se descartan", () => {
    expect(partirCsv("a,b\n1,2\n\n\n3,4")).toHaveLength(3);
  });
});

describe("leer un precio chileno", () => {
  it("con separador de miles y símbolo", () => {
    expect(aPesos("$1.185.990")).toBe(1_185_990);
    expect(aPesos("1.185.990")).toBe(1_185_990);
  });

  it("con coma decimal, como lo exporta un ERP", () => {
    expect(aPesos("899990,00")).toBe(899_990);
    expect(aPesos("1.185.990,00")).toBe(1_185_990);
  });

  it("en formato inglés", () => {
    expect(aPesos("1,185,990.00")).toBe(1_185_990);
  });

  it("una celda vacía es «no consta», no cero", () => {
    expect(aPesos("")).toBeNull();
    expect(aPesos("   ")).toBeNull();
    expect(aPesos("n/d")).toBeNull();
  });

  it("un precio negativo no se acepta", () => {
    expect(aPesos("-5000")).toBeNull();
  });

  it("el cero sí es un cero, y se distingue del vacío", () => {
    expect(aPesos("0")).toBe(0);
  });
});
