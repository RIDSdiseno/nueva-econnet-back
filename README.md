# Econnet · backend-api

API de Econnet: catálogo, carritos, pedidos, pagos, cotizaciones de empresa,
captación y motores de tráfico.
**Express 5 + TypeScript strict + PostgreSQL + Prisma**, según
[`GUIA-TECNICA.md`](../../../GUIA-TECNICA.md) del ecosistema.

Repositorio independiente del frontend. No comparte código con él: la frontera
es HTTP.

---

## Levantarlo desde cero

```bash
cp .env.example .env          # ver la tabla de variables más abajo
npm ci
docker compose up -d db       # o tu propio PostgreSQL 16
npx prisma migrate deploy     # crea el esquema
npm run seed                  # catálogo del 18-09-2026 + cupón de bienvenida
npm run dev                   # http://localhost:3000
```

Comprobar que está sano:

```bash
curl localhost:3000/api/salud   # ¿está vivo?
curl localhost:3000/api/listo   # ¿puede atender? (mira la base)
```

## Comandos

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor con recarga |
| `npm run build` | Compila a `dist/` |
| `npm start` | Arranca lo compilado |
| `npm run typecheck` | TypeScript en modo estricto |
| `npm run lint` | ESLint, cero avisos permitidos |
| `npm test` | Vitest contra un PostgreSQL de verdad |
| `npm run verify` | Los cuatro anteriores, en orden |
| `npm run seed` | Siembra el catálogo y deja `reservadas` en cero |
| `npm run paridad` | Informe de precios contra Falabella y Lider |
| `npm run clave -- "tu clave"` | Genera el `ADMIN_CLAVE_HASH` del panel de inventario |

Las pruebas necesitan `DATABASE_URL_TEST` apuntando a **otra** base: se trunca
entera entre pruebas.

## Variables de entorno

| Variable | Obligatoria | Qué pasa si falta |
|---|---|---|
| `DATABASE_URL` | **sí** | No arranca |
| `APP_SECRET` (32+) | **sí, también fuera de producción** | No arranca (salvo en `test`). Firma las sesiones del panel y los enlaces de baja, aceptación y seguimiento. Antes tenía un valor de relleno escrito en el repositorio: un `staging` sin secreto era falsificable |
| `CRON_SECRET` | **sí en producción** | No arranca. Sin él, los trabajos quedan abiertos |
| `PASARELA` | **sí en producción** | `simulado` **no arranca en producción**: no cobra nada |
| `WEBPAY_CODIGO_COMERCIO`, `WEBPAY_API_KEY` | si `PASARELA=webpay` | No arranca |
| `MP_ACCESS_TOKEN`, `MP_WEBHOOK_SECRET` | si `PASARELA=mercadopago` | No arranca. Sin el secreto no se comprueba la firma del webhook |
| `SITIO_PUBLICO` | recomendada | Los enlaces de los correos apuntan a localhost |
| `CORS_ORIGINS` | recomendada | El navegador no puede llamar a la API |
| `ENVIO_TABLA` | no | **Sin ella no se cobra despacho**: se confirma después. Formato `Región:precio` o `Región:precio:díasHábiles`, separados por `\|` |
| `DESCUENTO_VOLUMEN` | no | Las cotizaciones salen sin descuento y lo dicen. Formato `10:3\|25:5` |
| `CORREO_DRIVER` | no | `consola` en desarrollo; `resend` necesita `RESEND_API_KEY` |
| `LIMITE_PETICIONES` | no | 30 por IP y ventana. Ojo con CGNAT (ver `SEGURIDAD.md`) |
| `ADMIN_CLAVE_HASH` | no | **Sin ella no hay panel**: `/api/panel/*` responde 503. Se genera con `npm run clave`, nunca se escribe la clave en claro |
| `ADMIN_SESION_HORAS` | no | 8 horas de sesión en el panel |
| `RAZON_SOCIAL`, `RUT_EMPRESA`, `DIRECCION`… | no | **Se ponen en el panel, no aquí.** La página legal enseña el hueco en ámbar hasta que estén |
| `LIMITE_ENTRADAS` | no | 10 intentos de clave por IP y ventana |

## Estructura

```
src/
├─ config/         env validado con Zod, logger y rutas de la tienda
├─ middlewares/    requestId, seguridad, CORS, límites, validación, errores, cron
├─ modules/        un dominio por carpeta: routes + controller + schemas
│  ├─ salud/ catalogo/ carritos/ pedidos/ pagos/ cotizaciones/ captacion/ trafico/ trabajos/ admin/
├─ services/       la lógica: precios, stock, estados, correo, pasarelas, propuestas
├─ repositories/   el único sitio que habla con la base
└─ herramientas/   guiones de terminal (paridad de precios, clave del panel)
prisma/
├─ schema.prisma   el modelo
├─ migrations/     el historial, en orden
└─ seed.ts         catálogo de partida
```

## Migraciones

```bash
npx prisma migrate deploy        # producción: aplica lo pendiente
npx prisma migrate diff \
  --from-migrations prisma/migrations \
  --to-schema prisma/schema.prisma --script > nueva.sql   # escribir una nueva
```

Para escribir migraciones hace falta `DATABASE_URL_SHADOW` (una base vacía que
Prisma usa para calcular el diff). En producción **no se usa**.

## Pagos

Tres pasarelas detrás de una sola interfaz (`services/pagos.ts`):

| `PASARELA` | Qué hace |
|---|---|
| `simulado` | No cobra. Solo desarrollo y pruebas. **Bloqueado en producción** |
| `webpay` | Transbank Webpay Plus REST |
| `mercadopago` | Checkout Pro |

Reglas que no cambian con la pasarela:

- **El monto lo pone el servidor.** El navegador no puede proponerlo: los
  esquemas son `.strict()` y un `precio` o `total` en el cuerpo es un 400.
- **Confirmar es preguntarle a la pasarela**, nunca creerse la vuelta del
  navegador ni el cuerpo de un webhook.
- Si el monto no cuadra, el pedido va a `REVISAR`, nunca a `PAGADO`.
- El pago se aplica **una sola vez**: la transición la gana un `UPDATE`
  condicional. Tres webhooks iguales dejan un pedido pagado y un solo evento.

### Webhooks

```
POST /api/pago-aviso      Mercado Pago. Firma HMAC en x-signature
GET|POST /api/pago-retorno  Vuelta del navegador. No se cree nada: se confirma
```

Para probar en local con la pasarela simulada:

```bash
curl -X POST localhost:3000/api/pedido -H 'Content-Type: application/json' -d '{...}'
curl -i "localhost:3000/api/pago-retorno?metodo=simulado&numero=ECN-2026-00001"
```

## Ciclo de vida de un pedido

```
POR_CONFIRMAR ─┐
PENDIENTE_PAGO ─┴→ PAGADO → PREPARANDO → DESPACHADO → ENTREGADO
      │                │          │            │           │
      └→ ANULADO       └────────── DEVUELTO ───┴───────────┘
      └→ REVISAR → PAGADO | ANULADO | PREPARANDO
```

Y el stock, atado a eso:

| Momento | Efecto |
|---|---|
| Pedido creado | `reservadas + n` (atómico; si no cabe, no hay pedido) |
| Pago confirmado | `stockUnidades − n` y `reservadas − n` |
| Anulado o caducado | `reservadas − n` |
| Repetir cualquiera | **no hace nada**: lo impide `Pedido.stockEstado` |

## El panel de inventario

`/api/panel/*`, y la pantalla en `/panel` del frontend.

```bash
npm run clave -- "una clave larga de verdad"   # imprime el ADMIN_CLAVE_HASH
```

Sin `ADMIN_CLAVE_HASH` el panel **no existe**: todas sus rutas responden 503.
Abierto por defecto sería un agujero, no una comodidad.

| Ruta | Qué hace |
|---|---|
| `POST /api/panel/entrar` | Clave → cookie `HttpOnly`, `SameSite=Strict`, con caducidad dentro |
| `POST /api/panel/salir` | Borra la cookie |
| `GET /api/panel/sesion` | Si hay panel configurado y si hay sesión. Es lo único abierto |
| `GET /api/panel/inventario` | Todos los equipos (archivados incluidos), el resumen de huecos y los últimos cambios |
| `POST /api/panel/productos` | Alta. Solo exige marca, nombre, categoría y fuente |
| `PATCH /api/panel/productos/:id` | Edición parcial. `null` vacía un campo; ausente no lo toca |
| `POST /api/panel/productos/:id/stock` | Fija unidades. `null` = sin contar |
| `POST /api/panel/productos/:id/archivo` | Retira de la tienda o devuelve a la venta |
| `GET /api/panel/productos/:id/cambios` | El historial del equipo |
| `GET /api/panel/pedidos[/:numero]` | Los pedidos, con cliente, totales, pago e historial |
| `POST /api/panel/pedidos/:numero/estado` | Mueve el pedido **por la máquina de estados**: una transición imposible da 409 |
| `GET /api/panel/cotizaciones[/:numero]` | Las cotizaciones de empresa, con lo que se propuso y sus huecos |
| `POST /api/panel/cotizaciones/:numero/estado` | Ganada, perdida o caducada. Al cerrarla se para el seguimiento |
| `GET`/`POST /api/panel/ajustes` | Los ajustes del negocio (ver abajo) |
| `GET`/`POST /api/panel/medios` | Las fotografías. Se suben en base64 dentro del JSON |
| `POST /api/panel/importar` | Importa un CSV. **Por defecto ensaya**: `aplicar: true` para escribir |

Tres cosas que no son negociables:

1. **La clave nunca se guarda.** `ADMIN_CLAVE_HASH` es un scrypt con sal. Quien
   lea las variables de entorno no tiene la clave.
2. **Lo que se escribe queda registrado.** Cada cambio guarda campo, valor
   anterior, valor nuevo, motivo y fecha en `CambioProducto`, en la misma
   transacción que el producto.
3. **Nada se borra.** Retirar un equipo pone `Producto.archivado`: sale del
   catálogo público, sigue en el panel y sigue en los pedidos que ya lo llevan.
   No se puede retirar un equipo con reservas vivas, ni dejar las unidades por
   debajo de lo reservado.

### Los ajustes del negocio

Viven en la tabla `Ajuste` y se editan desde el panel, **sin desplegar**. Se
cargan enteros en memoria al arrancar, se refrescan cada 30 segundos y también
en cuanto el panel escribe, así que leerlos es un acceso a un mapa y no hubo
que volver asíncrono el camino del dinero (`envios.ts`, `carritos.service.ts`,
`propuestas.service.ts`).

Lo que se paga: con varias instancias, un cambio tarda hasta 30 segundos en
verse en todas. Para una tarifa de envío eso no es nada. **Para un secreto lo
sería, y por eso aquí no hay secretos**: `APP_SECRET`, `CRON_SECRET`,
`ADMIN_CLAVE_HASH` y las credenciales de pago siguen en el entorno.

Cada ajuste tiene escrito **qué pasa exactamente si se deja vacío**, y eso es
lo que sale en pantalla: no «se usa un valor por defecto», sino «no se cobra
despacho y el pedido queda por confirmar».

Las tablas (`ENVIO_TABLA`, `DESCUENTO_VOLUMEN`) admiten **salto de línea o
barra vertical**: el entorno las escribe en una línea con `|` y el panel usa un
cuadro de texto donde lo natural es una por línea. Solo se entendía `|`, y lo
escrito en el panel se guardaba como una región inexistente sin dar error —lo
cazó una prueba de extremo a extremo, no el compilador.

### El margen

`Producto.costoNeto` es el coste de compra **neto**, y sin él el margen sale
`null`, no cero. Se calcula sobre el neto de venta: comparar un coste sin IVA
contra un precio con IVA infla el margen diecinueve puntos, y con ese número
inflado es con el que se decide cuánto se puede pagar por traer un cliente.

El resumen pondera por unidades en stock, no por producto: diez cámaras baratas
al 40% no compensan un notebook caro al 4%, y la media simple diría que sí.

### Las fotografías

Van en la propia base (`Medio.datos`, `bytea`). A esta escala son decenas de
megas, y así no hace falta ni un bucket ni un volumen: sobreviven a un
redespliegue y entran en la copia de seguridad. Si esto pasa de unos cientos de
megas, toca almacenamiento aparte.

El tipo se detecta de los **primeros bytes**, no del nombre ni de lo que declare
el navegador, y se sirve con ese tipo más `nosniff`. SVG queda fuera a
propósito: es una imagen que puede ejecutar JavaScript.

## Trabajos programados

```bash
curl -X POST localhost:3000/api/trabajos/carritos -H "authorization: Bearer $CRON_SECRET"
```

| Ruta | Qué hace |
|---|---|
| `/api/trabajos/carritos` | Secuencia de carrito abandonado, caducidad de pedidos, seguimiento de cotizaciones, cola de correo y limpieza de límites |
| `/api/trabajos/correos` | Solo drena la cola |
| `/api/trabajos/caducar` | Solo caduca pedidos sin pagar |
| `/api/trabajos/cotizaciones` | Solo recordatorios de cotización |

## Producción

```bash
docker build -t econnet-api .
docker run --env-file .env -p 3000:3000 econnet-api
```

La imagen corre como usuario `node`, trae `HEALTHCHECK` y no incluye
dependencias de desarrollo. El arranque llama a `comprobarConfigCritica()`: si
falta algo obligatorio, **no levanta** en vez de levantar a medias.

### Despliegue y vuelta atrás

1. `npx prisma migrate deploy` (las migraciones son aditivas: no borran
   columnas, así que la versión anterior sigue funcionando con el esquema
   nuevo).
2. Desplegar la imagen.
3. Comprobar `/api/listo`.

**Vuelta atrás**: se despliega la imagen anterior. No hace falta deshacer la
migración porque ninguna es destructiva. Si alguna vez lo fuera, hay que
escribir el `down` a mano **antes** de aplicarla.

## Qué no hace, y hay que saberlo

- **No emite boleta ni factura electrónica** (SII). Guarda el tipo de documento
  y comprueba el RUT, y ahí se acaba.
- **El panel no factura.** Cubre catálogo, pedidos, cotizaciones, ajustes,
  fotos e importación, pero emitir la boleta o la factura electrónica sigue
  siendo de otro sistema.
- **La importación es de ida, no de vuelta.** Se puede traer el catálogo de
  WooCommerce por CSV; no hay sincronización continua en ninguna dirección.
- **Un pedido DEVUELTO no repone stock automáticamente**: un equipo devuelto no
  siempre vuelve a estar vendible. Queda el evento registrado y lo decide una
  persona.
