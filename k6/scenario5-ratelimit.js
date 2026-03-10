import http from 'k6/http';
import { check, sleep } from 'k6';
import { Counter, Rate } from 'k6/metrics';
import { BASE_URL } from './helpers/auth.js';

const rateLimitHits = new Counter('rate_limit_429_count');
const unexpectedErrors = new Counter('rate_limit_unexpected_errors');
const errorRate = new Rate('rate_limit_error_rate');

const RATE_LIMIT = 5;
const REQUESTS_TO_SEND = 7;

export const options = {
  scenarios: {
    rate_limit_test: {
      executor: 'shared-iterations',
      vus: 1,
      iterations: 1,
      maxDuration: '30s',
    },
  },
  thresholds: {
    // Deben detectarse al menos 2 respuestas 429 (el throttle puede estar "caliente" de una run anterior)
    rate_limit_429_count: [`count>=${REQUESTS_TO_SEND - RATE_LIMIT}`],
  },
};

export default function () {
  const results = [];

  for (let i = 1; i <= REQUESTS_TO_SEND; i++) {
    const res = http.post(
      `${BASE_URL}/auth/login`,
      // Credenciales incorrectas a propósito — nos importa el status code del throttler
      // Si el throttler actúa antes de validar credenciales → 429
      // Si valida primero → 401. Ambos son < 500 y confirman que el endpoint responde
      JSON.stringify({ email: 'ratelimit@test.com', password: 'wrongpass' }),
      { headers: { 'Content-Type': 'application/json' } },
    );

    results.push({ req: i, status: res.status });

    if (i < RATE_LIMIT) {
      // Dentro del límite (req 1-4): no debe ser 429
      const withinLimit = check(res, {
        [`req ${i}: dentro del límite (no 429)`]: (r) => r.status !== 429,
      });
      errorRate.add(!withinLimit);
    } else if (i === RATE_LIMIT) {
      // Req 5: límite exacto — puede ser 401 (última permitida) o 429 (primera bloqueada)
      errorRate.add(0);
      if (res.status === 429) rateLimitHits.add(1);
    } else {
      // Req 6-7: superando el límite — DEBE ser 429
      if (res.status === 429) {
        rateLimitHits.add(1);
        errorRate.add(0);
      } else {
        unexpectedErrors.add(1);
        errorRate.add(1);
      }
    }

    // Sin sleep entre requests para saturar el throttler rápidamente
    sleep(0.1);
  }

  // Log de resultados por request
  console.log('\n--- Rate limit request log ---');
  results.forEach(({ req, status }) => {
    const label =
      status === 429
        ? '🚫 429 BLOCKED'
        : status === 401
          ? '🔑 401 bad creds'
          : `✅ ${status}`;
    console.log(`  Request ${req}: ${label}`);
  });
}

export function handleSummary(data) {
  const hits = data.metrics.rate_limit_429_count?.values?.count ?? 0;
  const unexpected =
    data.metrics.rate_limit_unexpected_errors?.values?.count ?? 0;
  const expected429s = REQUESTS_TO_SEND - RATE_LIMIT;

  const result =
    hits >= expected429s
      ? '✅ RATE LIMITING FUNCIONA'
      : '❌ RATE LIMITING NO DETECTADO';

  console.log('\n========== SCENARIO 5: RATE LIMITING RESULTS ==========');
  console.log(`Requests enviadas:        ${REQUESTS_TO_SEND}`);
  console.log(`Límite configurado:       ${RATE_LIMIT} req/min`);
  console.log(`429s esperados:           ${expected429s}`);
  console.log(`429s recibidos:           ${hits}`);
  console.log(`Errores inesperados:      ${unexpected}`);
  console.log(`Resultado:                ${result}`);
  console.log('========================================================\n');

  return {
    'k6/results/scenario5-ratelimit.json': JSON.stringify(data, null, 2),
  };
}
