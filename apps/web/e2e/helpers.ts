import type { APIRequestContext, Page } from '@playwright/test';

const email = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const password = process.env.E2E_ADMIN_PASSWORD || 'admin123';

const contribEmail = process.env.E2E_CONTRIB_EMAIL || 'user@example.com';
const contribPassword = process.env.E2E_CONTRIB_PASSWORD || 'user123';

/** URL de l’API (appels Playwright côté Node, pas le navigateur). */
export const apiBaseUrl = (process.env.PLAYWRIGHT_API_URL || 'http://localhost:4000/api/v1').replace(/\/$/, '');

/**
 * Connexion admin pour les E2E : POST /auth/login puis injection localStorage
 * (token, refreshToken, user) comme le fait le store Zustand.
 */
export async function loginAsAdmin(page: Page, request: APIRequestContext) {
  const res = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { email, password },
    headers: { 'Content-Type': 'application/json' },
  });

  if (!res.ok()) {
    const body = await res.text();
    throw new Error(
      `Échec login API (${res.status()}). Créez un admin (seed) ou définissez E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.\n${body}`
    );
  }

  const { token, refreshToken, user } = await res.json();

  await page.goto('/');
  await page.evaluate(
    ([t, rt, u]) => {
      localStorage.setItem('token', t as string);
      localStorage.setItem('refreshToken', rt as string);
      localStorage.setItem('user', JSON.stringify(u));
    },
    [token, refreshToken, user] as const
  );

  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}

export async function loginAsContributor(page: Page, request: APIRequestContext) {
  const res = await request.post(`${apiBaseUrl}/auth/login`, {
    data: { email: contribEmail, password: contribPassword },
    headers: { 'Content-Type': 'application/json' },
  });
  if (!res.ok()) {
    const body = await res.text();
    throw new Error(`Échec login contributeur (${res.status()}): ${body}`);
  }
  const { token, refreshToken, user } = await res.json();
  await page.goto('/');
  await page.evaluate(
    ([t, rt, u]) => {
      localStorage.setItem('token', t as string);
      localStorage.setItem('refreshToken', rt as string);
      localStorage.setItem('user', JSON.stringify(u));
    },
    [token, refreshToken, user] as const
  );
  await page.goto('/dashboard');
  await page.waitForURL('**/dashboard', { timeout: 15_000 });
}
