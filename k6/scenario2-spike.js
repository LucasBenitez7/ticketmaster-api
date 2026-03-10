import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate, Counter } from 'k6/metrics';
import { loginAdmin, createTestCategory, BASE_URL } from './helpers/auth.js';

const checkoutDuration = new Trend('spike_checkout_duration', true);
const errorRate = new Rate('spike_error_rate');
const successfulCheckouts = new Counter('spike_successful_checkouts');
const stockErrors = new Counter('spike_stock_errors');

export const options = {
  scenarios: {
    spike: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '5s', target: 1000 },
        { duration: '30s', target: 1000 },
        { duration: '10s', target: 0 },
      ],
    },
  },
  thresholds: {
    // Spike con 1000 VUs: latencia alta esperada; prioridad = sin sobreventa
    http_req_duration: ['p(95)<30000'],
    spike_error_rate: ['rate<0.85'],
    spike_checkout_duration: ['p(95)<30000'],
    spike_successful_checkouts: ['count<=100'],
  },
};

export function setup() {
  const adminToken = loginAdmin();
  // Stock = 100 para que el spike tenga competencia real
  const { categoryId } = createTestCategory(adminToken, 100);
  return { categoryId };
}

export default function ({ categoryId }) {
  // Cada VU registra su propio usuario para tener token único
  const vuId = __VU;
  const iterationId = __ITER;
  const email = `k6spike_${vuId}_${iterationId}@test.com`;

  const registerRes = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({
      name: `Spike User ${vuId}`,
      email,
      password: 'Test1234!',
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  if (registerRes.status !== 201) {
    errorRate.add(1);
    return;
  }

  const token = registerRes.json('accessToken');

  // Intentar checkout — puede fallar por stock agotado (esperado y válido)
  const checkoutRes = http.post(
    `${BASE_URL}/orders/checkout`,
    JSON.stringify({ categoryId, quantity: 1 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  checkoutDuration.add(checkoutRes.timings.duration);

  if (checkoutRes.status === 201) {
    successfulCheckouts.add(1);
    check(checkoutRes, {
      'checkout has orderId': (r) => !!r.json('orderId'),
      'checkout status PENDING': (r) => r.json('status') === 'PENDING',
    });
    errorRate.add(0);
  } else if (checkoutRes.status === 400) {
    // Stock agotado o límite por usuario — comportamiento ACID correcto
    stockErrors.add(1);
    errorRate.add(0); // no es un error del sistema
  } else if (checkoutRes.status === 429) {
    // Rate limit del checkout (10/min) — esperado en spike
    errorRate.add(0);
  } else {
    errorRate.add(1);
  }

  sleep(0.5);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A';
  const p50 = data.metrics.http_req_duration?.values?.['p(50)'] ?? 'N/A';
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A';
  const reqRate = data.metrics.http_reqs?.values?.rate ?? 'N/A';
  const errRate = (data.metrics.spike_error_rate?.values?.rate ?? 0) * 100;
  const successful =
    data.metrics.spike_successful_checkouts?.values?.count ?? 0;
  const stockErr = data.metrics.spike_stock_errors?.values?.count ?? 0;

  console.log('\n========== SCENARIO 2: SPIKE RESULTS ==========');
  console.log(
    `p50:                    ${typeof p50 === 'number' ? p50.toFixed(2) : p50}ms`,
  );
  console.log(
    `p95:                    ${typeof p95 === 'number' ? p95.toFixed(2) : p95}ms`,
  );
  console.log(
    `p99:                    ${typeof p99 === 'number' ? p99.toFixed(2) : p99}ms`,
  );
  console.log(
    `req/s:                  ${typeof reqRate === 'number' ? reqRate.toFixed(2) : reqRate}`,
  );
  console.log(
    `error rate:             ${typeof errRate === 'number' ? errRate.toFixed(2) : errRate}%`,
  );
  console.log(`checkouts exitosos:     ${successful} (máx esperado: 100)`);
  console.log(
    `rechazos por stock:     ${stockErr} (ACID correcto si successful <= 100)`,
  );
  console.log('================================================\n');

  return {
    'k6/results/scenario2-spike.json': JSON.stringify(data, null, 2),
  };
}
