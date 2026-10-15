import type { RoutePermission } from '../../src/plugins/auth';

/**
 * Every /api route, with the permission it declares and a valid sample request.
 * The matrix test fails if a registered route is missing here, so add each new route as you build it.
 * `url` is the concrete URL to call (fill path params with sample ids); `route` is the Fastify pattern.
 */
export interface RegisteredRoute {
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  route: string;
  url?: string;
  permission: RoutePermission | 'public';
  sampleBody?: unknown;
}

export const ROUTE_REGISTRY: RegisteredRoute[] = [
  { method: 'GET', route: '/api/v1/health', permission: 'public' },
  { method: 'GET', route: '/api/v1/auth/config', permission: 'public' },
  { method: 'GET', route: '/api/v1/me', permission: 'authenticated' },
];
