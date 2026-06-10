import { test, expect } from '@playwright/test';
import { apiBaseUrl, loginAsAdmin } from './helpers';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'admin123';

let adminLoginOk = false;

test.beforeAll(async () => {
  try {
    const r = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    adminLoginOk = r.ok;
  } catch {
    adminLoginOk = false;
  }
});

const PUBLIC_PATHS = [
  { path: '/login', expectHeading: /Connexion/i },
  { path: '/forgot-password', expectHeading: /Mot de passe oublié/i },
];

/** Pages liste (évite les :id aléatoires qui peuvent afficher une erreur métier). */
const ADMIN_LIST_PATHS = [
  '/dashboard',
  '/processus',
  '/projets',
  '/taches',
  '/clients-fournisseurs',
  '/contrats',
  '/ocr',
  '/licences',
  '/entites',
  '/documents',
  '/users',
  '/journal',
  '/configuration',
  '/corbeille',
  '/profile',
];

test.describe('Pages publiques', () => {
  for (const { path, expectHeading } of PUBLIC_PATHS) {
    test(`charge ${path}`, async ({ page }) => {
      await page.goto(path);
      await expect(page.locator('body')).toBeVisible();
      await expect(page.getByRole('heading', { name: expectHeading })).toBeVisible({ timeout: 15_000 });
    });
  }

  test('reset-password affiche le formulaire', async ({ page }) => {
    await page.goto('/reset-password?token=test');
    await expect(page.getByRole('heading', { name: /Réinitialiser le mot de passe/i })).toBeVisible({
      timeout: 15_000,
    });
  });
});

test.describe('Pages authentifiées (admin)', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    if (!adminLoginOk) {
      testInfo.skip(
        true,
        `Connexion admin refusée par l’API (${apiBaseUrl}). Créez un compte (ex. npm run seed dans apps/api) ou définissez E2E_ADMIN_EMAIL / E2E_ADMIN_PASSWORD.`
      );
      return;
    }
    await loginAsAdmin(page, request);
  });

  for (const path of ADMIN_LIST_PATHS) {
    test(`charge ${path} sans renvoi vers /login`, async ({ page }) => {
      await page.goto(path);
      await expect(page).not.toHaveURL(/\/login$/);
      await expect(page.locator('body')).toBeVisible();
      // Shell app : titre PMO ou navigation
      await expect(page.getByText(/PMO|HUB|Dashboard|Configuration|Licences/i).first()).toBeVisible({
        timeout: 20_000,
      });
    });
  }

  test('Configuration : onglets principaux accessibles', async ({ page }) => {
    await page.goto('/configuration');
    await expect(page.getByRole('heading', { name: 'Configuration' })).toBeVisible();
    await page.getByRole('button', { name: 'Types de licence' }).click();
    await expect(page.getByRole('heading', { name: 'Types de licence' })).toBeVisible();
    await page.getByRole('button', { name: 'Devises' }).click();
    await expect(page.getByRole('heading', { name: 'Devises' })).toBeVisible();
  });
});
