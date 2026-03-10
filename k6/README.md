# k6 Load Testing — Ticketmaster API

Documentación de los escenarios de carga y estrés para la API de venta de entradas.

---

## Requisitos

### Instalar k6

```bash
# Windows (winget)
winget install k6

# macOS
brew install k6

# Linux
sudo gpg -k
sudo gpg --no-default-keyring --keyring /usr/share/keyrings/k6-archive-keyring.gpg --keyserver hkp://keyserver.ubuntu.com:80 --recv-keys C5AD17C747E3415A3642D57D77C6C491D6AC1D69
echo "deb [signed-by=/usr/share/keyrings/k6-archive-keyring.gpg] https://dl.k6.io/deb stable main" | sudo tee /etc/apt/sources.list.d/k6.list
sudo apt-get update && sudo apt-get install k6
```

### Pre-requisitos antes de ejecutar

1. **API corriendo** en `http://localhost:3000`
2. **Docker Compose** activo (PostgreSQL + Redis + MinIO)
3. **Migraciones** aplicadas: `pnpm prisma migrate deploy`
4. **Seed** ejecutado: `pnpm prisma db seed`
5. **Credenciales admin**: El seed debe crear un admin con `ADMIN_EMAIL=admin@ticketmaster.com` y `ADMIN_PASSWORD=Admin1234!` (o ajustar `loginAdmin()` en `helpers/auth.js`)
6. **Throttle para load test**: En `.env` de desarrollo usa `THROTTLE_GLOBAL_LIMIT=50000` y `THROTTLE_CHECKOUT_LIMIT=10000`. Reinicia la API tras cambiar.

---

## Estructura

```
k6/
├── helpers/
│   └── auth.js              # Login, register, createTestCategory
├── scenario1-rampup.js       # 0→500 usuarios en 30s
├── scenario2-spike.js        # 1000 usuarios simultáneos
├── scenario3-soak.js         # 200 usuarios por 5 minutos
├── scenario4-acid.js         # 50 usuarios por 1 ticket (ACID)
├── scenario5-ratelimit.js    # Verifica 429 en /auth/login
└── results/                 # JSONs generados automáticamente
```

---

## Ejecución

```bash
# Desde la raíz del proyecto

# Escenario 1 — Ramp-up
k6 run k6/scenario1-rampup.js

# Escenario 2 — Spike
k6 run k6/scenario2-spike.js

# Escenario 3 — Soak
k6 run k6/scenario3-soak.js

# Escenario 4 — ACID
k6 run k6/scenario4-acid.js

# Escenario 5 — Rate Limiting
k6 run k6/scenario5-ratelimit.js

# Contra otro host (staging/producción)
k6 run -e BASE_URL=https://api.example.com k6/scenario1-rampup.js
```

---

## Resultados (referencia)

Los JSON con métricas completas se guardan en `k6/results/` tras cada ejecución.

| Escenario      | Usuarios     | p95      | req/s   | Error rate | Resultado |
| -------------- | ------------ | -------- | ------- | ---------- | --------- |
| 1 - Ramp-up    | 0→500        | 11.32ms  | 390.14  | 0%         | ✅        |
| 2 - Spike      | 1000         | 14.4s    | 136.36  | 0%         | ✅        |
| 3 - Soak       | 200 / 5min   | 11.15ms  | 247.11  | 0%         | ✅        |
| 4 - ACID       | 50 / stock=1 | 79.07ms  | —       | 1 checkout  | ✅        |
| 5 - Rate limit | 1 / 7 reqs   | —        | —       | 2× 429     | ✅        |

### Thresholds

| Métrica                     | Threshold | Escenarios |
| --------------------------- | --------- | ---------- |
| `http_req_duration p(95)`   | < 500ms   | 1, 3       |
| `http_req_duration p(95)`   | < 30s     | 2 (spike)  |
| `http_req_failed`           | < 1%      | 1, 3       |
| `spike_error_rate`          | < 85%     | 2 (spike)  |
| `spike_successful_checkouts`| ≤ 100     | 2 (spike)  |
| `acid_successful_checkouts` | == 1      | 4          |
| `rate_limit_429_count`      | ≥ 2       | 5          |

### Verificación ACID (Escenario 4)

- ✅ `acid_successful_checkouts == 1` → transacción ACID correcta, sin sobreventas
- ❌ `acid_successful_checkouts > 1` → sobreventa detectada
- ❌ `acid_successful_checkouts == 0` → bug, ningún usuario pudo comprar

---

## Configuración: desarrollo vs producción

### Desarrollo / load test (k6)

Para ejecutar k6 sin que el throttle corte las peticiones:

```env
THROTTLE_GLOBAL_LIMIT=50000
THROTTLE_CHECKOUT_LIMIT=10000
```

### Producción

En el entorno donde despliegues la API (Railway, Render, VPS, etc.), usa límites más restrictivos:

```env
THROTTLE_GLOBAL_LIMIT=100
THROTTLE_CHECKOUT_LIMIT=10
```

**Dónde configurarlo**

- **Railway / Render / Vercel / similares**: en el panel de la app → Variables de entorno / Environment Variables.
- **Docker / VPS**: en el `.env` del servidor o en el `docker-compose.yml` de producción.
- **No** uses el `.env` local de desarrollo para producción; cada entorno tiene su propia configuración.

**Resumen**

| Variable                  | Desarrollo (k6) | Producción |
| ------------------------ | --------------- | ---------- |
| `THROTTLE_GLOBAL_LIMIT`  | 50000           | 100        |
| `THROTTLE_CHECKOUT_LIMIT`| 10000           | 10         |

Tu `.env` local puede seguir con los valores altos para k6. En producción, configura las variables en el panel de tu proveedor de hosting.
