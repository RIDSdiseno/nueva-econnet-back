/**
 * El límite por IP compartido.
 *
 * Lo que se prueba es lo que fallaba en memoria: que dos instancias cuenten
 * sobre el mismo contador. Aquí «dos instancias» son dos llamadas al mismo
 * almacén, que es exactamente lo que hacen dos procesos contra la misma base.
 */
import { describe, expect, it } from "vitest";
import { limpiarCaducadas, olvidarClave, restarGolpe, sumarGolpe, verGolpe } from "../../src/repositories/limites.repository.js";
import { prisma } from "../../src/repositories/prisma.js";

const VENTANA = 60_000;

describe("contador compartido", () => {
  it("dos instancias suman sobre el mismo contador", async () => {
    const primera = await sumarGolpe("ip:1.2.3.4", VENTANA);
    const segunda = await sumarGolpe("ip:1.2.3.4", VENTANA);
    const tercera = await sumarGolpe("ip:1.2.3.4", VENTANA);

    expect(primera.golpes).toBe(1);
    expect(segunda.golpes).toBe(2);
    expect(tercera.golpes).toBe(3);
  });

  it("cada IP tiene su propio contador", async () => {
    await sumarGolpe("ip:1.1.1.1", VENTANA);
    await sumarGolpe("ip:1.1.1.1", VENTANA);
    const otra = await sumarGolpe("ip:2.2.2.2", VENTANA);

    expect(otra.golpes).toBe(1);
  });

  it("la ventana se reinicia sola al caducar, sin proceso de limpieza", async () => {
    await sumarGolpe("ip:3.3.3.3", VENTANA);
    await sumarGolpe("ip:3.3.3.3", VENTANA);

    /* Se envejece la fila a mano: es lo que haría el reloj. */
    await prisma.limitePeticion.update({
      where: { clave: "ip:3.3.3.3" },
      data: { expira: new Date(Date.now() - 1000) }
    });

    const despues = await sumarGolpe("ip:3.3.3.3", VENTANA);
    expect(despues.golpes).toBe(1);
    expect(despues.expira.getTime()).toBeGreaterThan(Date.now());
  });

  it("una ventana caducada no cuenta como golpe vivo", async () => {
    await sumarGolpe("ip:4.4.4.4", VENTANA);
    await prisma.limitePeticion.update({
      where: { clave: "ip:4.4.4.4" },
      data: { expira: new Date(Date.now() - 1000) }
    });

    expect(await verGolpe("ip:4.4.4.4")).toBeUndefined();
  });

  it("restar no baja de cero", async () => {
    await sumarGolpe("ip:5.5.5.5", VENTANA);
    await restarGolpe("ip:5.5.5.5");
    await restarGolpe("ip:5.5.5.5");

    expect((await verGolpe("ip:5.5.5.5"))?.golpes).toBe(0);
  });

  it("olvidar una clave la borra entera", async () => {
    await sumarGolpe("ip:6.6.6.6", VENTANA);
    await olvidarClave("ip:6.6.6.6");

    expect(await verGolpe("ip:6.6.6.6")).toBeUndefined();
  });

  it("veinte peticiones a la vez cuentan veinte, no menos", async () => {
    /* Es la prueba que importa: sin atomicidad, dos peticiones simultáneas
       leen el mismo valor y escriben el mismo, y el contador se queda corto. */
    await Promise.all(Array.from({ length: 20 }, () => sumarGolpe("ip:7.7.7.7", VENTANA)));

    expect((await verGolpe("ip:7.7.7.7"))?.golpes).toBe(20);
  });

  it("el barrido borra solo lo caducado", async () => {
    await sumarGolpe("ip:viva", VENTANA);
    await sumarGolpe("ip:muerta", VENTANA);
    await prisma.limitePeticion.update({ where: { clave: "ip:muerta" }, data: { expira: new Date(Date.now() - 1000) } });

    expect(await limpiarCaducadas()).toBe(1);
    expect(await verGolpe("ip:viva")).toBeDefined();
  });
});
