# TicketMaster API

[![CI](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/ci.yml)
[![Newman](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/newman.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/newman.yml)
[![k6 Smoke](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/k6-smoke.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/k6-smoke.yml)

API REST para venta de entradas con alta escalabilidad, construida con **NestJS**, **PostgreSQL**, **Redis**, **BullMQ**, **Stripe** y **WebSockets**.

---

## Tabla de contenidos

- [Descripción](#descripción)
- [Stack tecnológico](#stack-tecnológico)
- [Diagrama de flujo](#diagrama-de-flujo)
- [Cómo correr el proyecto](#cómo-correr-el-proyecto)
- [Variables de entorno](#variables-de-entorno)
- [Tabla de endpoints](#tabla-de-endpoints)
- [Transacciones ACID y prevención de sobreventa](#transacciones-acid-y-prevención-de-sobreventa)
- [Swagger](#swagger)
- [Tests](#tests)
- [Resultados k6](#resultados-k6)
- [Producción: MinIO → AWS S3](#producción-minio--aws-s3)
- [Colección Postman](#colección-postman)
- [CI/CD](#cicd)

---

## Descripción

TicketMaster API es una API REST lista para producción que permite:

- **Autenticación**: registro, login, refresh tokens con rotación, logout
- **Eventos**: CRUD de eventos con póster (S3/MinIO), estados (DRAFT, PUBLISHED, SOLD_OUT, CANCELLED, COMPLETED)
- **Categorías de entradas**: VIP, General, etc., con stock, precios y políticas de reembolso
- **Checkout**: compra con Stripe PaymentIntent, expiración de órdenes en 15 min
- **Webhooks Stripe**: confirmación de pago, emails de compra vía cola BullMQ
- **WebSockets**: emisión de `ticket:stock-updated` en tiempo real
- **Cache Redis**: GET /events cacheado 60s
- **Rate limiting**: throttling configurable por entorno

---

## Stack tecnológico

| Tecnología | Uso |
|------------|-----|
| **NestJS** | Framework backend |
| **Prisma** | ORM + migraciones |
| **PostgreSQL** | Base de datos |
| **Redis** | Cache (GET /events) + colas BullMQ |
| **BullMQ** | Colas: emails, expiración de órdenes |
| **Stripe** | Pagos |
| **Resend** | Emails transaccionales |
| **Socket.io** | WebSockets |
| **MinIO / S3** | Almacenamiento de imágenes |
| **k6** | Load testing |
| **Newman** | Tests de integración API |

---

## Diagrama de flujo

```mermaid
flowchart TB
    subgraph Cliente
        A[Cliente HTTP/WebSocket]
    end

    subgraph API
        B[Auth: Login/Register]
        C[Events: CRUD + Cache Redis]
        D[Categories: por evento]
        E[Orders: Checkout]
        F[Webhooks: Stripe]
    end

    subgraph Servicios
        G[(PostgreSQL)]
        H[(Redis)]
        I[BullMQ]
        J[Stripe]
        K[Resend]
        L[MinIO/S3]
    end

    A --> B
    A --> C
    A --> D
    A --> E
    A --> F

    B --> G
    C --> H
    C --> G
    C --> L
    D --> G
    E --> G
    E --> J
    E --> I
    F --> E
    I --> K
    I --> G
```

### Flujo de checkout

```mermaid
sequenceDiagram
    participant C as Cliente
    participant API

    participant DB as PostgreSQL
    participant Stripe
    participant BullMQ
    participant Email

    C->>API: POST /orders/checkout
    API->>DB: $transaction (decrementar stock + crear orden)
    alt Stock insuficiente
        DB-->>API: 0 rows updated
        API-->>C: 400 Bad Request
    else OK
        DB-->>API: 1 row updated
        API->>Stripe: create PaymentIntent
        Stripe-->>API: clientSecret
        API-->>C: 201 { clientSecret, orderId }
    end

    Note over C,Stripe: Cliente paga en frontend
    Stripe->>API: Webhook payment_intent.succeeded
    API->>DB: Marcar orden PAID
    API->>BullMQ: Encolar email de compra
    BullMQ->>Email: Enviar email
```

---

## Cómo correr el proyecto

### 1. Requisitos

- **Node.js** 22+
- **pnpm** 10+
- **Docker** y **Docker Compose**

### 2. Clonar e instalar

```bash
git clone <repo-url>
cd ticketmaster-api
pnpm install
```

### 3. Levantar servicios (PostgreSQL, Redis, MinIO)

```bash
docker-compose up -d
```

### 4. Crear bucket en MinIO (solo la primera vez)

Docker Compose levanta MinIO pero el bucket no existe. Hay que crearlo manualmente:

1. Abrí **http://localhost:9001** en el navegador
2. Login: `minioadmin` / `minioadmin`
3. Crear bucket llamado **`ticketmaster`** (o el nombre que uses en `S3_BUCKET_NAME`)
4. Opcional: configurarlo como público si necesitás URLs directas a las imágenes

### 5. Configurar variables de entorno

Copiar `.env.example` a `.env` y rellenar los valores:

```bash
cp .env.example .env
```

### 6. Aplicar migraciones y seed

```bash
pnpm db:deploy
pnpm db:seed
```

### 7. Iniciar la API

```bash
pnpm start:dev
```

La API estará en **http://localhost:3000** y Swagger en **http://localhost:3000/api/docs**.

### 8. Stripe CLI (webhooks en desarrollo local)

Para que los webhooks de Stripe funcionen en local, necesitás el [Stripe CLI](https://stripe.com/docs/stripe-cli) en una terminal separada:

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

Stripe te dará un `whsec_...` temporal; usalo en `STRIPE_WEBHOOK_SECRET` de tu `.env`.

---

## Variables de entorno

| Variable | Descripción | Ejemplo |
|----------|-------------|---------|
| `PORT` | Puerto del servidor | `3000` |
| `DATABASE_URL` | URL de PostgreSQL | `postgresql://admin:adminpassword@localhost:5435/ticket_db` |
| `JWT_SECRET` | Secreto para JWT | `tu-secreto-seguro` |
| `ACCESS_TOKEN_EXPIRES_IN` | Expiración del access token | `15m` |
| `REDIS_HOST` | Host de Redis | `localhost` |
| `REDIS_PORT` | Puerto de Redis | `6379` |
| `REDIS_PASSWORD` | Contraseña Redis (opcional) | — |
| `S3_ENDPOINT` | URL de MinIO/S3 | `http://localhost:9000` |
| `S3_REGION` | Región S3 | `us-east-1` |
| `S3_ACCESS_KEY_ID` | Access key | `minioadmin` |
| `S3_SECRET_ACCESS_KEY` | Secret key | `minioadmin` |
| `S3_BUCKET_NAME` | Nombre del bucket | `ticketmaster` |
| `STRIPE_SECRET_KEY` | Clave secreta Stripe | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Webhook secret Stripe | `whsec_...` |
| `RESEND_API_KEY` | API key de Resend | `re_...` |
| `RESEND_FROM` | Email remitente | `TicketMaster <noreply@lsbstack.com>` |
| `EMAIL_ENABLED` | `true` para enviar emails | `true` |
| `ADMIN_NAME` | Nombre del admin (seed) | `Admin` |
| `ADMIN_EMAIL` | Email del admin (seed) | `admin@ticketmaster.com` |
| `ADMIN_PASSWORD` | Contraseña del admin (seed) | `Admin1234!` |
| `THROTTLE_GLOBAL_LIMIT` | Límite global req/min | `100` |
| `THROTTLE_CHECKOUT_LIMIT` | Límite checkout req/min | `10` |
| `WEBSOCKET_CORS_ORIGIN` | Origen CORS WebSocket | `*` |

---

## Tabla de endpoints

### Auth

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/auth/register` | Registrar usuario | — |
| POST | `/auth/login` | Login (rate limit 5/min) | — |
| POST | `/auth/refresh` | Refrescar tokens | — |
| POST | `/auth/logout` | Cerrar sesión | — |
| PATCH | `/auth/users/:id/role` | Cambiar rol (ADMIN) | ADMIN |

### Events

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/events` | Crear evento (multipart/form-data) | ADMIN |
| GET | `/events` | Listar eventos publicados (paginated, cache) | — |
| GET | `/events/:id` | Obtener evento por ID | — |
| PATCH | `/events/:id` | Actualizar evento | ADMIN |
| PATCH | `/events/:id/status` | Cambiar estado (PUBLISHED, etc.) | ADMIN |
| DELETE | `/events/:id` | Eliminar evento | ADMIN |

### Categories

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/events/:eventId/categories` | Crear categoría | ADMIN |
| GET | `/events/:eventId/categories` | Listar categorías del evento | — |
| DELETE | `/events/:eventId/categories/:categoryId` | Eliminar categoría | ADMIN |

### Orders

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/orders/checkout` | Crear orden y PaymentIntent | JWT |
| POST | `/orders/:id/refund` | Solicitar reembolso | JWT |
| GET | `/orders/my-orders` | Mis órdenes | JWT |
| GET | `/orders/:id` | Obtener orden por ID | JWT |

### Webhooks

| Método | Ruta | Descripción | Auth |
|--------|------|-------------|------|
| POST | `/webhooks/stripe` | Webhook Stripe (raw body) | Firma Stripe |

---

## Transacciones ACID y prevención de sobreventa

El checkout usa `prisma.$transaction` para garantizar **atomicidad** y evitar **sobreventa** de entradas.

### Problema

Si dos usuarios compran el último ticket al mismo tiempo, sin transacción podría ocurrir:

1. Usuario A lee `availableStock = 1`
2. Usuario B lee `availableStock = 1`
3. Usuario A decrementa y crea orden
4. Usuario B decrementa y crea orden → **sobreventa**

### Solución

Dentro de la transacción:

```sql
UPDATE ticket_categories
SET "availableStock" = "availableStock" - ${quantity}
WHERE id = ${categoryId} AND "availableStock" >= ${quantity}
```

- **Solo se actualiza si hay stock suficiente** (`availableStock >= quantity`)
- Si `updated === 0`, no se crea la orden y se lanza error
- Si `updated === 1`, se crea la orden y los tickets en la misma transacción

### Verificación con k6

El escenario 4 (`scenario4-acid.js`) simula 50 usuarios comprando 1 ticket en una categoría con stock 1. El threshold verifica:

- `acid_successful_checkouts == 1` → ✅ Sin sobreventa
- `acid_successful_checkouts > 1` → ❌ Sobreventa detectada

---

## Swagger

Swagger UI está disponible en:

**http://localhost:3000/api/docs**

Cuando la API está corriendo, puedes explorar todos los endpoints, autenticarte con Bearer token y probar las peticiones desde el navegador.

---

## Tests

```bash
# Unit tests (Jest)
pnpm test

# Unit tests con coverage
pnpm test:cov

# Tests de integración API (Newman)
pnpm test:api

# Load tests (k6)
k6 run k6/scenario1-rampup.js
```

---

## Resultados k6

| Escenario | Usuarios | p95 | req/s | Error rate | Resultado |
|-----------|----------|-----|-------|------------|-----------|
| 1 - Ramp-up | 0→500 | 11.32ms | 390.14 | 0% | ✅ |
| 2 - Spike | 1000 | 14.4s | 136.36 | 0% | ✅ |
| 3 - Soak | 200 / 5min | 11.15ms | 247.11 | 0% | ✅ |
| 4 - ACID | 50 / stock=1 | 79.07ms | — | 1 checkout | ✅ |
| 5 - Rate limit | 1 / 7 reqs | — | — | 2× 429 | ✅ |

Documentación detallada en [k6/README.md](k6/README.md).

---

## Producción: MinIO → AWS S3

En desarrollo se usa **MinIO** para almacenamiento de imágenes. En producción:

1. **Configura un bucket en AWS S3** (o compatible S3: DigitalOcean Spaces, Cloudflare R2, etc.)

2. **Variables de entorno**

   | Variable | Desarrollo | Producción |
   |----------|------------|------------|
   | `S3_ENDPOINT` | `http://localhost:9000` | `""` (vacío para AWS) |
   | `S3_REGION` | `us-east-1` | `eu-west-1` (tu región) |
   | `S3_ACCESS_KEY_ID` | `minioadmin` | Tu clave AWS |
   | `S3_SECRET_ACCESS_KEY` | `minioadmin` | Tu secreto AWS |
   | `S3_BUCKET_NAME` | `ticketmaster` | Nombre del bucket |

3. **URLs de imágenes**  
   Con `S3_ENDPOINT` vacío, el cliente S3 usa URLs públicas de AWS (o CloudFront si lo configuras).

4. **CORS**  
   Configura CORS en el bucket para permitir tu dominio frontend.

---

## Colección Postman

La colección y el entorno están en el repositorio:

- **Colección**: `postman/ticketmaster.postman_collection.json`
- **Entorno**: `postman/ticketmaster.postman_environment.json`

Para ejecutar con Newman:

```bash
pnpm test:api
```

El reporte HTML se genera en `postman/results.html`.

---

## CI/CD

GitHub Actions ejecuta en cada push/PR a `development` y `main`:

| Workflow | Descripción |
|----------|-------------|
| **CI** | Lint, typecheck y tests unitarios (Jest) |
| **Newman** | Tests de integración API (PostgreSQL + Redis) |
| **k6 Smoke** | Smoke test con 10 VUs durante 30s |

---

## Licencia

UNLICENSED
