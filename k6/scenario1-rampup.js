/**
 * Escenario 1 — Ramp-up
 * 0 → 500 usuarios en 30s, se mantiene 1 min, baja en 15s
 *
 * Flujo: GET /events (lectura pública, sin auth)
 * Thresholds: p95 < 500ms, error rate < 1%
 */

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';
import { BASE_URL } from './helpers/auth.js';
const errorRate = new Rate('rampup_error_rate');

export const options = {
  scenarios: {
    ramp_up: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 500 },
        { duration: '1m', target: 500 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    rampup_error_rate: ['rate<0.01'],
  },
};

export default function () {
  const res = http.get(`${BASE_URL}/events?page=1&limit=10`);

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'has data': (r) => {
      try {
        return Array.isArray(r.json('data'));
      } catch {
        return false;
      }
    },
  });

  errorRate.add(!ok);

  sleep(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A';
  const p50 = data.metrics.http_req_duration?.values?.['p(50)'] ?? 'N/A';
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A';
  const reqRate = data.metrics.http_reqs?.values?.rate ?? 'N/A';
  const errRate = (data.metrics.http_req_failed?.values?.rate ?? 0) * 100;

  console.log('\n========== SCENARIO 1: RAMP-UP RESULTS ==========');
  console.log(
    `p50:        ${typeof p50 === 'number' ? p50.toFixed(2) : p50}ms`,
  );
  console.log(
    `p95:        ${typeof p95 === 'number' ? p95.toFixed(2) : p95}ms`,
  );
  console.log(
    `p99:        ${typeof p99 === 'number' ? p99.toFixed(2) : p99}ms`,
  );
  console.log(
    `req/s:      ${typeof reqRate === 'number' ? reqRate.toFixed(2) : reqRate}`,
  );
  console.log(
    `error rate: ${typeof errRate === 'number' ? errRate.toFixed(2) : errRate}%`,
  );
  console.log('=================================================\n');

  return {
    'k6/results/scenario1-rampup.json': JSON.stringify(data, null, 2),
  };
}
