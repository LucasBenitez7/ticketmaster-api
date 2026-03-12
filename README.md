# TicketMaster API

[![CI](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/ci.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/ci.yml)
[![Newman](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/newman.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/newman.yml)
[![k6 Smoke](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/k6-smoke.yml/badge.svg)](https://github.com/LucasBenitez7/ticketmaster-api/actions/workflows/k6-smoke.yml)

Production-ready REST API for high-concurrency ticket sales — built with **NestJS**, **PostgreSQL**, **Redis**, **BullMQ**, **Stripe** and **WebSockets**. Deployed on **AWS EC2**.

---

## 🚀 Live API

**📖 [ticket.lsbstack.com/api/docs](https://ticket.lsbstack.com/api/docs)** — Swagger UI (interactive, try it live)

> Payments run in **Stripe test mode** — no real charges.

### How to explore the API

**Option 1 — Regular user (CUSTOMER role)**

1. Open `POST /auth/register` → click **Try it out** → **Execute** with the preloaded example data
2. Copy the `accessToken` from the response
3. Click **Authorize** (top right) → paste the token → **Authorize**
4. All endpoints are now available

**Option 2 — Admin user (full access)**

1. Open `POST /auth/login` → click **Try it out** → use these credentials:

```json
{
  "email": "admin@ticketmaster.com",
  "password": "Admin1234!"
}
```

2. Copy the `accessToken` from the response
3. Click **Authorize** → paste the token → **Authorize**
4. Admin endpoints (create/update/delete events, manage categories, change user roles) are now unlocked

---

## 💡 What this project demonstrates

A production API solving real engineering problems — not a tutorial project.

- **Zero overselling under high concurrency** — ACID transactions with PostgreSQL ensure exactly 1 successful checkout when 50 users hit the last ticket simultaneously (verified with k6)
- **Async payment processing** — Stripe Webhooks trigger order confirmation and enqueue email jobs via BullMQ + Redis without blocking the API response
- **Real-time stock updates** — Socket.io broadcasts `ticket:stock-updated` to all connected clients after each successful purchase
- **Redis caching** — `GET /events` cached for 60s, reducing DB load on high-frequency endpoints
- **JWT with refresh token rotation** — access tokens (15min) + refresh tokens (30d) with rotation on each refresh
- **Rate limiting** — configurable throttling per endpoint (login: 5 req/min, checkout: 10 req/min, global: 100 req/min)
- **Production deployment** — AWS EC2 (eu-north-1) + AWS S3 for image storage + Cloudflare DNS + Stripe webhooks configured in production
- **Full CI pipeline** — GitHub Actions: lint → unit tests (Jest) → API integration tests (Newman) → k6 smoke test

---

## 🧱 Tech stack

| Technology         | Usage                                          |
| ------------------ | ---------------------------------------------- |
| **NestJS**         | Backend framework (modular architecture)       |
| **Prisma**         | ORM + migrations                               |
| **PostgreSQL**     | Primary database                               |
| **Redis**          | Cache (GET /events) + BullMQ queues            |
| **BullMQ**         | Async job queues: emails, order expiration     |
| **Stripe**         | Payments (PaymentIntents + Webhooks)           |
| **Resend**         | Transactional emails                           |
| **Socket.io**      | WebSockets for real-time stock updates         |
| **MinIO / AWS S3** | Image storage (MinIO local → S3 in production) |
| **k6**             | Load testing                                   |
| **Newman**         | API integration tests (CI)                     |
| **Swagger**        | API documentation (OpenAPI)                    |
| **nestjs-pino**    | Structured logging                             |

---

## 🗺️ Architecture

```mermaid
flowchart TB
    subgraph Client
        A[HTTP Client / WebSocket]
    end

    subgraph API
        B[Auth: Login/Register]
        C[Events: CRUD + Redis Cache]
        D[Categories: per event]
        E[Orders: Checkout]
        F[Webhooks: Stripe]
    end

    subgraph Services
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

### Checkout flow

```mermaid
sequenceDiagram
    participant C as Client
    participant API
    participant DB as PostgreSQL
    participant Stripe
    participant BullMQ
    participant Email

    C->>API: POST /orders/checkout
    API->>DB: $transaction (decrement stock + create order)
    alt Insufficient stock
        DB-->>API: 0 rows updated
        API-->>C: 400 Bad Request
    else OK
        DB-->>API: 1 row updated
        API->>Stripe: create PaymentIntent
        Stripe-->>API: clientSecret
        API-->>C: 201 { clientSecret, orderId }
    end

    Note over C,Stripe: Client completes payment on frontend
    Stripe->>API: Webhook payment_intent.succeeded
    API->>DB: Mark order as PAID
    API->>BullMQ: Enqueue purchase email job
    BullMQ->>Email: Send email
```

---

## ⚡ ACID transactions — zero overselling

The checkout engine uses `prisma.$transaction` to guarantee atomicity and prevent overselling.

### The problem

Without transactions, two users buying the last ticket simultaneously could both succeed:

1. User A reads `availableStock = 1`
2. User B reads `availableStock = 1`
3. User A decrements → creates order
4. User B decrements → creates order → **oversell**

### The solution

Inside the transaction:

```sql
UPDATE ticket_categories
SET "availableStock" = "availableStock" - ${quantity}
WHERE id = ${categoryId} AND "availableStock" >= ${quantity}
```

- Only updates if stock is sufficient (`availableStock >= quantity`)
- If `updated === 0` → order is not created, error is thrown
- If `updated === 1` → order and tickets are created in the same transaction

### Verified with k6

Scenario 4 (`scenario4-acid.js`) simulates 50 users buying 1 ticket in a category with `stock = 1`. The threshold verifies:

- `acid_successful_checkouts == 1` → ✅ No overselling
- `acid_successful_checkouts > 1` → ❌ Oversell detected

---

## 📊 Load test results (k6)

| Scenario       | Users        | p95     | req/s  | Error rate | Result |
| -------------- | ------------ | ------- | ------ | ---------- | ------ |
| 1 — Ramp-up    | 0→500        | 11.32ms | 390.14 | 0%         | ✅     |
| 2 — Spike      | 1000         | 14.4s   | 136.36 | 0%         | ✅     |
| 3 — Soak       | 200 / 5min   | 11.15ms | 247.11 | 0%         | ✅     |
| 4 — ACID       | 50 / stock=1 | 79.07ms | —      | 1 checkout | ✅     |
| 5 — Rate limit | 1 / 7 reqs   | —       | —      | 2× 429     | ✅     |

Full documentation in [k6/README.md](k6/README.md).

---

## 📋 Endpoints

### Auth

| Method | Route                  | Description              | Auth  |
| ------ | ---------------------- | ------------------------ | ----- |
| POST   | `/auth/register`       | Register new user        | —     |
| POST   | `/auth/login`          | Login (rate limit 5/min) | —     |
| POST   | `/auth/refresh`        | Refresh tokens           | —     |
| POST   | `/auth/logout`         | Logout                   | —     |
| PATCH  | `/auth/users/:id/role` | Change user role         | ADMIN |

### Events

| Method | Route                | Description                               | Auth  |
| ------ | -------------------- | ----------------------------------------- | ----- |
| POST   | `/events`            | Create event (multipart/form-data)        | ADMIN |
| GET    | `/events`            | List published events (paginated, cached) | —     |
| GET    | `/events/:id`        | Get event by ID                           | —     |
| PATCH  | `/events/:id`        | Update event                              | ADMIN |
| PATCH  | `/events/:id/status` | Change status (PUBLISHED, etc.)           | ADMIN |
| DELETE | `/events/:id`        | Delete event                              | ADMIN |

### Categories

| Method | Route                                     | Description           | Auth  |
| ------ | ----------------------------------------- | --------------------- | ----- |
| POST   | `/events/:eventId/categories`             | Create category       | ADMIN |
| GET    | `/events/:eventId/categories`             | List event categories | —     |
| DELETE | `/events/:eventId/categories/:categoryId` | Delete category       | ADMIN |

### Orders

| Method | Route                | Description                  | Auth |
| ------ | -------------------- | ---------------------------- | ---- |
| POST   | `/orders/checkout`   | Create order + PaymentIntent | JWT  |
| POST   | `/orders/:id/refund` | Request refund               | JWT  |
| GET    | `/orders/my-orders`  | My orders                    | JWT  |
| GET    | `/orders/:id`        | Get order by ID              | JWT  |

### Webhooks

| Method | Route              | Description               | Auth             |
| ------ | ------------------ | ------------------------- | ---------------- |
| POST   | `/webhooks/stripe` | Stripe webhook (raw body) | Stripe signature |

---

## 🚀 Getting started

### Prerequisites

- **Node.js** 22+
- **pnpm** 10+
- **Docker** and **Docker Compose**

### 1. Clone and install

```bash
git clone https://github.com/LucasBenitez7/ticketmaster-api.git
cd ticketmaster-api
pnpm install
```

### 2. Start services (PostgreSQL, Redis, MinIO)

```bash
docker-compose up -d
```

### 3. Create MinIO bucket (first time only)

1. Open **http://localhost:9001**
2. Login: `minioadmin` / `minioadmin`
3. Create a bucket named `ticketmaster`

### 4. Set up environment variables

```bash
cp .env.example .env
```

### 5. Run migrations and seed

```bash
pnpm db:deploy
pnpm db:seed
```

### 6. Start the API

```bash
pnpm start:dev
```

API available at **http://localhost:3000** — Swagger at **http://localhost:3000/api/docs**

### 7. Stripe CLI (local webhooks)

```bash
stripe listen --forward-to localhost:3000/webhooks/stripe
```

---

## ⚙️ Environment variables

| Variable                  | Description                 | Example                                            |
| ------------------------- | --------------------------- | -------------------------------------------------- |
| `PORT`                    | Server port                 | `3000`                                             |
| `DATABASE_URL`            | PostgreSQL URL              | `postgresql://admin:pass@localhost:5435/ticket_db` |
| `JWT_SECRET`              | JWT secret                  | `your-secret`                                      |
| `ACCESS_TOKEN_EXPIRES_IN` | Access token expiry         | `15m`                                              |
| `REDIS_HOST`              | Redis host                  | `localhost`                                        |
| `REDIS_PORT`              | Redis port                  | `6379`                                             |
| `S3_ENDPOINT`             | MinIO/S3 URL                | `http://localhost:9000`                            |
| `S3_REGION`               | S3 region                   | `us-east-1`                                        |
| `S3_ACCESS_KEY_ID`        | Access key                  | `minioadmin`                                       |
| `S3_SECRET_ACCESS_KEY`    | Secret key                  | `minioadmin`                                       |
| `S3_BUCKET_NAME`          | Bucket name                 | `ticketmaster`                                     |
| `STRIPE_SECRET_KEY`       | Stripe secret key           | `sk_test_...`                                      |
| `STRIPE_WEBHOOK_SECRET`   | Webhook secret              | `whsec_...`                                        |
| `RESEND_API_KEY`          | Resend API key              | `re_...`                                           |
| `RESEND_FROM`             | Sender email                | `TicketMaster <noreply@lsbstack.com>`              |
| `EMAIL_ENABLED`           | Enable email sending        | `true`                                             |
| `THROTTLE_GLOBAL_LIMIT`   | Global rate limit req/min   | `100`                                              |
| `THROTTLE_CHECKOUT_LIMIT` | Checkout rate limit req/min | `10`                                               |

---

## ☁️ Production: MinIO → AWS S3

| Variable               | Development             | Production           |
| ---------------------- | ----------------------- | -------------------- |
| `S3_ENDPOINT`          | `http://localhost:9000` | `""` (empty for AWS) |
| `S3_REGION`            | `us-east-1`             | `eu-north-1`         |
| `S3_ACCESS_KEY_ID`     | `minioadmin`            | Your AWS key         |
| `S3_SECRET_ACCESS_KEY` | `minioadmin`            | Your AWS secret      |
| `S3_BUCKET_NAME`       | `ticketmaster`          | Your bucket name     |

---

## 🧪 Tests

```bash
# Unit tests (Jest)
pnpm test

# Unit tests with coverage
pnpm test:cov

# API integration tests (Newman)
pnpm test:api

# Load tests (k6)
k6 run k6/scenario1-rampup.js
```

---

## 🤖 CI/CD

GitHub Actions runs on every push/PR to `development` and `main`:

| Workflow     | Description                                |
| ------------ | ------------------------------------------ |
| **CI**       | Lint, typecheck and unit tests (Jest)      |
| **Newman**   | API integration tests (PostgreSQL + Redis) |
| **k6 Smoke** | Smoke test with 10 VUs for 30s             |

---

## 📬 Postman collection

- **Collection**: `postman/ticketmaster.postman_collection.json`
- **Environment**: `postman/ticketmaster.postman_environment.json`

```bash
pnpm test:api  # runs Newman and generates HTML report at postman/results.html
```

---

## 📄 License

UNLICENSED
