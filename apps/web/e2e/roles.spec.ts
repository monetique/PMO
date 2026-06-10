import { test, expect } from '@playwright/test';
import { apiBaseUrl, loginAsContributor } from './helpers';

const contribEmail = process.env.E2E_CONTRIB_EMAIL || 'user@example.com';
const contribPassword = process.env.E2E_CONTRIB_PASSWORD || 'user123';

let contribLoginOk = false;

test.beforeAll(async () => {
  try {
    const r = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: contribEmail, password: contribPassword }),
    });
    contribLoginOk = r.ok;
  } catch {
    contribLoginOk = false;
  }
});

test.describe('Contributeur — garde front (routes admin)', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    if (!contribLoginOk) {
      testInfo.skip(true, 'Compte contributeur indisponible (ex. lancer le seed).');
      return;
    }
    await loginAsContributor(page, request);
  });

  test('redirige /users vers le dashboard', async ({ page }) => {
    await page.goto('/users');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('redirige /configuration vers le dashboard', async ({ page }) => {
    await page.goto('/configuration');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('redirige /journal vers le dashboard', async ({ page }) => {
    await page.goto('/journal');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('redirige /corbeille vers le dashboard', async ({ page }) => {
    await page.goto('/corbeille');
    await expect(page).toHaveURL(/\/dashboard/, { timeout: 15_000 });
  });

  test('accède à /processus (autorisé)', async ({ page }) => {
    await page.goto('/processus');
    await expect(page).not.toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Processus', exact: true })).toBeVisible({
      timeout: 20_000,
    });
  });

  test('accède à /projets (autorisé)', async ({ page }) => {
    await page.goto('/projets');
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Projets', exact: true })).toBeVisible({ timeout: 20_000 });
  });
});
