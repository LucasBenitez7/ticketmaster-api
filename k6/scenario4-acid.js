import http from 'k6/http';
import { check } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { loginAdmin, createTestCategory, BASE_URL } from './helpers/auth.js';

const successfulCheckouts = new Counter('acid_successful_checkouts');
const stockErrors = new Counter('acid_stock_errors');
const unexpectedErrors = new Counter('acid_unexpected_errors');
const errorRate = new Rate('acid_error_rate');

const CONCURRENT_USERS = 50; 

export const options = {
  scenarios: {
    acid_test: {
      executor: 'shared-iterations',
      vus: CONCURRENT_USERS,
      iterations: CONCURRENT_USERS, 
      maxDuration: '30s',
    },
  },
  thresholds: {
    // CRÍTICO: exactamente 1 checkout exitoso
    acid_successful_checkouts: ['count==1'],
    // El resto deben ser 400 por stock, no errores del sistema
    acid_error_rate: ['rate<0.01'],
  },
};

// Tokens pre-generados en setup para que todos los VUs estén listos
// y hagan el checkout lo más simultáneamente posible
export function setup() {
  const adminToken = loginAdmin();

  // Stock = 1 → solo 1 usuario puede ganar
  const { categoryId } = createTestCategory(adminToken, 1);

  // Pre-registrar todos los usuarios concurrentes
  const tokens = [];
  for (let i = 0; i < CONCURRENT_USERS; i++) {
    const email = `k6acid_${i}_${Date.now()}@test.com`;
    const res = http.post(
      `${BASE_URL}/auth/register`,
      JSON.stringify({ name: `ACID User ${i}`, email, password: 'Test1234!' }),
      { headers: { 'Content-Type': 'application/json' } },
    );
    if (res.status === 201) {
      tokens.push(res.json('accessToken'));
    }
  }

  console.log(
    `Setup completo: ${tokens.length} usuarios listos, stock = 1, categoryId = ${categoryId}`,
  );
  return { categoryId, tokens };
}

export default function ({ categoryId, tokens }) {
  // Cada VU usa su token pre-generado
  const token = tokens[__VU - 1];
  if (!token) {
    unexpectedErrors.add(1);
    errorRate.add(1);
    return;
  }

  const res = http.post(
    `${BASE_URL}/orders/checkout`,
    JSON.stringify({ categoryId, quantity: 1 }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
    },
  );

  if (res.status === 201) {
    successfulCheckouts.add(1);
    errorRate.add(0);
    check(res, {
      '[ACID] único checkout exitoso tiene orderId': (r) => !!r.json('orderId'),
      '[ACID] status es PENDING': (r) => r.json('status') === 'PENDING',
    });
  } else if (res.status === 400) {
    // Stock agotado — comportamiento correcto
    stockErrors.add(1);
    errorRate.add(0);
    check(res, {
      '[ACID] rechazo correcto por stock insuficiente': (r) => r.status === 400,
    });
  } else if (res.status === 429) {
    // Rate limit — no cuenta como error del sistema
    errorRate.add(0);
  } else {
    unexpectedErrors.add(1);
    errorRate.add(1);
  }
}

export function handleSummary(data) {
  const successful = data.metrics.acid_successful_checkouts?.values?.count ?? 0;
  const stockErr = data.metrics.acid_stock_errors?.values?.count ?? 0;
  const unexpected = data.metrics.acid_unexpected_errors?.values?.count ?? 0;
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A';

  const acidResult =
    successful === 1 ? '✅ ACID CORRECTO' : '❌ SOBREVENTA DETECTADA';

  console.log('\n========== SCENARIO 4: ACID CONCURRENT RESULTS ==========');
  console.log(`Usuarios concurrentes:    ${CONCURRENT_USERS}`);
  console.log(`Stock inicial:            1`);
  console.log(`Checkouts exitosos:       ${successful} (esperado: 1)`);
  console.log(
    `Rechazos por stock:       ${stockErr} (esperado: ${CONCURRENT_USERS - 1})`,
  );
  console.log(`Errores inesperados:      ${unexpected}`);
  console.log(
    `p95 checkout:             ${typeof p95 === 'number' ? p95.toFixed(2) : p95}ms`,
  );
  console.log(`Resultado ACID:           ${acidResult}`);
  console.log('==========================================================\n');

  return {
    'k6/results/scenario4-acid.json': JSON.stringify(data, null, 2),
  };
}
