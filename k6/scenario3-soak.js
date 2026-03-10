import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';
import { loginAdmin, createTestCategory, BASE_URL } from './helpers/auth.js';

const soakDuration = new Trend('soak_req_duration', true);
const errorRate = new Rate('soak_error_rate');

export const options = {
  scenarios: {
    soak: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 200 },
        { duration: '5m', target: 200 },
        { duration: '15s', target: 0 },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<500'],
    http_req_failed: ['rate<0.01'],
    soak_error_rate: ['rate<0.01'],
    soak_req_duration: ['p(95)<500'],
  },
};

export function setup() {
  const adminToken = loginAdmin();
  const { eventId, categoryId } = createTestCategory(adminToken, 100);
  return { eventId, categoryId };
}

export default function ({ eventId }) {
  // Flujo mixto realista: listar eventos y ver detalle
  const listRes = http.get(`${BASE_URL}/events?page=1&limit=10`);

  const listOk = check(listRes, {
    'GET /events 200': (r) => r.status === 200,
    'has data': (r) => {
      try {
        return Array.isArray(r.json('data'));
      } catch {
        return false;
      }
    },
    'list < 500ms': (r) => r.timings.duration < 500,
  });

  soakDuration.add(listRes.timings.duration);
  errorRate.add(!listOk);

  sleep(0.5);

  // Ver detalle del evento creado en setup
  const detailRes = http.get(`${BASE_URL}/events/${eventId}`);

  const detailOk = check(detailRes, {
    'GET /events/:id 200': (r) => r.status === 200,
    'detail < 500ms': (r) => r.timings.duration < 500,
  });

  soakDuration.add(detailRes.timings.duration);
  errorRate.add(!detailOk);

  sleep(1);
}

export function handleSummary(data) {
  const p95 = data.metrics.http_req_duration?.values?.['p(95)'] ?? 'N/A';
  const p50 = data.metrics.http_req_duration?.values?.['p(50)'] ?? 'N/A';
  const p99 = data.metrics.http_req_duration?.values?.['p(99)'] ?? 'N/A';
  const reqRate = data.metrics.http_reqs?.values?.rate ?? 'N/A';
  const errRate = (data.metrics.http_req_failed?.values?.rate ?? 0) * 100;
  const totalReqs = data.metrics.http_reqs?.values?.count ?? 'N/A';

  console.log('\n========== SCENARIO 3: SOAK RESULTS ==========');
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
  console.log(`total reqs: ${totalReqs}`);
  console.log(
    `error rate: ${typeof errRate === 'number' ? errRate.toFixed(2) : errRate}%`,
  );
  console.log('===============================================\n');

  return {
    'k6/results/scenario3-soak.json': JSON.stringify(data, null, 2),
  };
}
