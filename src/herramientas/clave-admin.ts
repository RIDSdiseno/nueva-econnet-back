/**
 * Genera el valor de `ADMIN_CLAVE_HASH`.
 *
 *   npm run clave -- "la clave que quieras"
 *
 * Imprime el hash, nunca la clave, y no lo escribe en ningún fichero: copiarlo
 * a la variable de entorno es a mano a propósito. Un script que te deja la
 * clave en claro en el historial del terminal no es una comodidad.
 */
import { hashDeClave } from "../services/admin.js";

const clave = process.argv.slice(2).join(" ").trim();

if (!clave) {
  console.error('Uso: npm run clave -- "tu clave"');
  process.exit(1);
}

if (clave.length < 12) {
  console.error(`Esa clave tiene ${clave.length} caracteres. Mínimo 12: es la llave del catálogo entero.`);
  process.exit(1);
}

const hash = await hashDeClave(clave);
console.log("");
console.log("Pega esto en el .env del backend (y en las variables del hosting):");
console.log("");
console.log(`ADMIN_CLAVE_HASH="${hash}"`);
console.log("");
console.log("La clave en claro no se guarda en ningún sitio. Si se pierde, se genera otra.");
