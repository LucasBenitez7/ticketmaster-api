import http from 'k6/http';
import { check } from 'k6';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';

/**
 * Login and return accessToken. Fails the check if login fails.
 */
export function loginAdmin() {
  const res = http.post(
    `${BASE_URL}/auth/login`,
    JSON.stringify({ email: 'admin@ticketmaster.com', password: 'Admin1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'admin login 201': (r) => r.status === 201 });
  return res.json('accessToken');
}

export function registerAndLoginCustomer(index = 0) {
  const email = `k6customer${index}_${Date.now()}@test.com`;
  const res = http.post(
    `${BASE_URL}/auth/register`,
    JSON.stringify({ name: `K6 User ${index}`, email, password: 'Test1234!' }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'customer register 201': (r) => r.status === 201 });
  return res.json('accessToken');
}

/**
 * Full setup: admin login → create event → publish → create category → return categoryId
 */
export function createTestCategory(adminToken, stockOverride = 100) {
  // Create event
  const formData = {
    title: `K6 Load Test Event ${Date.now()}`,
    description: 'Created by k6',
    date: '2027-12-01T20:00:00.000Z',
    location: 'Buenos Aires, Argentina',
  };

  const eventRes = http.post(`${BASE_URL}/events`, formData, {
    headers: { Authorization: `Bearer ${adminToken}` },
  });
  check(eventRes, { 'event created 201': (r) => r.status === 201 });
  const eventId = eventRes.json('id');

  // Publish event
  const publishRes = http.patch(
    `${BASE_URL}/events/${eventId}/status`,
    JSON.stringify({ status: 'PUBLISHED' }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    },
  );
  check(publishRes, { 'event published 200': (r) => r.status === 200 });

  // Create category
  const catRes = http.post(
    `${BASE_URL}/events/${eventId}/categories`,
    JSON.stringify({
      name: 'VIP',
      description: 'K6 test category',
      price: 150.0,
      totalStock: stockOverride,
      maxTicketsPerUser: 4,
      refundPolicy: 'PARTIAL',
      refundPercentage: 80,
      refundDeadlineHours: 48,
    }),
    {
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${adminToken}`,
      },
    },
  );
  check(catRes, { 'category created 201': (r) => r.status === 201 });

  return { eventId, categoryId: catRes.json('id') };
}

export { BASE_URL };
