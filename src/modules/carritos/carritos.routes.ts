import { Router } from "express";
import { limitePorIp } from "../../middlewares/limites.js";
import { validarCuerpo } from "../../middlewares/validar.js";
import { guardarCarritoSchema } from "./carritos.schemas.js";
import { guardarCarritoControlador, verCarrito } from "./carritos.controller.js";

export const rutasCarritos = Router();

rutasCarritos.get("/carrito/:id", verCarrito);
rutasCarritos.post("/carrito", limitePorIp(60), validarCuerpo(guardarCarritoSchema), guardarCarritoControlador);
