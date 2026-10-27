// B-21 load test: 50 concurrent users on QuoteFlow's main read paths.
// k6 script (not Node): https://grafana.com/docs/k6/. See tests/load/README.md for how to run it.
//
// Each virtual user signs in as one identity, learns its roles and permissions from GET /api/v1/me,
// then loops over the screens that identity actually opens: its landing dashboard, the quote list,
// a quote's detail, its work queue (engineering, pricing or Final Review) and the board.
// Read-only: it never creates, decides or uploads anything.
//
// Environment:
//   BASE_URL   API origin, e.g. http://localhost:3000 (default) or the test App Service URL.
//   AUTH       dev (default): x-dev-user persona headers; only works against AUTH_MODE=dev.
//              bearer: Entra access tokens from TOKENS (comma-separated; one per test user).
//   PERSONAS   dev mode: comma-separated persona keys (default: one per MVP role).
//   TOKENS     bearer mode: comma-separated access tokens for the CCQ API scope.
//   PROFILE    load (default): ramp to VUS over 1 m, hold for DURATION, ramp down 30 s.
//              smoke: 2 VUs for 30 s, to check the script and the environment.
//   VUS        peak virtual users (default 50).
//   DURATION   hold time at peak (default 10m).
//   THINK_MIN / THINK_MAX   think time between screens in seconds (default 1 / 3).

import { check, fail, group, sleep } from 'k6';
import http from 'k6/http';

const BASE_URL = (__ENV.BASE_URL || 'http://localhost:3000').replace(/\/$/, '');
const AUTH = __ENV.AUTH || 'dev';
const PROFILE = __ENV.PROFILE || 'load';
const VUS = Number(__ENV.VUS || 50);
const DURATION = __ENV.DURATION || '10m';
const THINK_MIN = Number(__ENV.THINK_MIN || 1);
const THINK_MAX = Number(__ENV.THINK_MAX || 3);

// One synthetic persona per MVP role (packages/db/seeds/synthetic/personas.ts), all-scope except
// one owner-scoped KAM so the RLS-filtered list path is exercised too.
const DEFAULT_PERSONAS = [
  'kam',
  'kam-owner',
  'sales-leader',
  'eng-lead',
  'engineer',
  'pricing',
  'pricing-lead',
  'approver',
  'leadership',
  'admin',
];

const split = (s) =>
  (s || '')
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);

const scenarios =
  PROFILE === 'smoke'
    ? { smoke: { executor: 'constant-vus', vus: 2, duration: '30s' } }
    : {
        load: {
          executor: 'ramping-vus',
          startVUs: 0,
          stages: [
            { duration: '1m', target: VUS },
            { duration: DURATION, target: VUS },
            { duration: '30s', target: 0 },
          ],
          gracefulRampDown: '30s',
        },
      };

export const options = {
  scenarios,
  // Pass/fail. Per-screen p95s are reported too, so a miss points at the screen that caused it.
  thresholds: {
    http_req_duration: ['p(95)<400'],
    http_req_failed: ['rate<0.01'],
    checks: ['rate>0.99'],
    'http_req_duration{screen:dashboard}': ['p(95)<400'],
    'http_req_duration{screen:list}': ['p(95)<400'],
    'http_req_duration{screen:detail}': ['p(95)<400'],
    'http_req_duration{screen:queue}': ['p(95)<400'],
    'http_req_duration{screen:board}': ['p(95)<400'],
  },
  summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function identities() {
  if (AUTH === 'bearer') {
    const tokens = split(__ENV.TOKENS);
    if (tokens.length === 0) fail('AUTH=bearer needs TOKENS (comma-separated Entra access tokens)');
    return tokens.map((t, i) => ({
      label: `token-${i + 1}`,
      headers: { authorization: `Bearer ${t}` },
    }));
  }
  if (AUTH !== 'dev') fail(`AUTH must be dev or bearer, not ${AUTH}`);
  const personas = split(__ENV.PERSONAS);
  return (personas.length ? personas : DEFAULT_PERSONAS).map((p) => ({
    label: p,
    headers: { 'x-dev-user': p },
  }));
}

/** The dashboard a signed-in identity lands on: the first of its roles that has one. */
const DASHBOARD_ROLES = [
  'KAM',
  'SalesLeader',
  'EngLead',
  'Engineer',
  'Pricing',
  'PricingLead',
  'Approver',
  'Leadership',
];

/** The work queue screen for an identity, by the permission that opens it. */
function queuePath(permissions) {
  if (permissions.includes('engQueue.read')) return '/api/v1/queue/engineering';
  if (permissions.includes('pricingQueue.read')) return '/api/v1/queue/pricing';
  if (permissions.includes('finalReview.read')) return '/api/v1/approvals';
  return null;
}

// Runs once: resolve each identity's screens and the quotes it may open.
export function setup() {
  const health = http.get(`${BASE_URL}/api/v1/health`);
  if (health.status !== 200) fail(`${BASE_URL}/api/v1/health returned ${health.status}`);

  return identities().map((id) => {
    const me = http.get(`${BASE_URL}/api/v1/me`, { headers: id.headers });
    if (me.status !== 200) fail(`GET /me as ${id.label} returned ${me.status}: ${me.body}`);
    const { roles, permissions } = me.json();
    const dashboardRole = DASHBOARD_ROLES.find((r) => roles.includes(r)) || null;

    const list = http.get(`${BASE_URL}/api/v1/quotes?pageSize=100`, { headers: id.headers });
    if (list.status !== 200) fail(`GET /quotes as ${id.label} returned ${list.status}`);
    const quoteNumbers = list.json('items').map((q) => q.quoteNumber);

    return {
      label: id.label,
      headers: id.headers,
      dashboardRole,
      queue: queuePath(permissions),
      quoteNumbers,
    };
  });
}

const think = () => sleep(THINK_MIN + Math.random() * (THINK_MAX - THINK_MIN));

function get(path, user, screen) {
  const res = http.get(`${BASE_URL}${path}`, {
    headers: { ...user.headers, accept: 'application/json' },
    // Group per screen, not per URL, so 500 quote numbers don't make 500 metric series.
    tags: { screen, name: screen, persona: user.label },
  });
  check(res, { [`${screen} 200`]: (r) => r.status === 200 });
  return res;
}

export default function (users) {
  const user = users[(__VU - 1) % users.length];

  group('dashboard', () => {
    if (user.dashboardRole) get(`/api/v1/dashboards/${user.dashboardRole}`, user, 'dashboard');
  });
  think();

  group('list', () => {
    get('/api/v1/quotes?pageSize=25', user, 'list');
  });
  think();

  group('detail', () => {
    if (user.quoteNumbers.length === 0) return;
    const qn = user.quoteNumbers[Math.floor(Math.random() * user.quoteNumbers.length)];
    get(`/api/v1/quotes/${qn}`, user, 'detail');
  });
  think();

  group('queue', () => {
    if (user.queue) get(user.queue, user, 'queue');
  });
  think();

  group('board', () => {
    get('/api/v1/quotes/board', user, 'board');
  });
  think();
}
