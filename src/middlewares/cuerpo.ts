/**
 * Un cuerpo grande, y **solo** donde hace falta.
 *
 * La API entera acepta 32 KB: un pedido no ocupa más, y un tope bajo es la
 * defensa más barata que hay contra que alguien llene la memoria del proceso
 * mandando megas. Pero una fotografía en base64 son megas de verdad, y un CSV
 * con el catálogo entero también.
 *
 * Así que el tope se sube en esas dos rutas, que además están detrás de la
 * clave del panel: para llegar aquí hay que haber entrado.
 */
import express, { type RequestHandler } from "express";

/** 8 MB: una foto de 4 MB en base64 ocupa un tercio más, y sobra sitio. */
export const cuerpoGrande: RequestHandler = express.json({ limit: "8mb" });
