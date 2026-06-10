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

test.describe('Parcours métier (admin)', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    if (!adminLoginOk) {
      testInfo.skip(true, 'Login admin indisponible.');
      return;
    }
    await loginAsAdmin(page, request);
  });

  test('Processus : liste affichée', async ({ page }) => {
    await page.goto('/processus');
    await expect(page.getByRole('heading', { name: 'Processus', exact: true })).toBeVisible({
      timeout: 20_000,
    });
    await expect(page.getByRole('heading', { name: /Liste des processus/i })).toBeVisible();
  });

  test('Configuration : crée puis supprime un type de licence', async ({ page }) => {
    const name = `E2E-TL-${Date.now()}`;
    await page.goto('/configuration');
    await page.getByRole('button', { name: 'Types de licence' }).click();
    await expect(page.getByRole('heading', { name: 'Types de licence' })).toBeVisible();

    await page.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByPlaceholder('Ex. Standard, SaaS, Cloud...').fill(name);
    await page.locator('div.fixed.inset-0').filter({ hasText: /type de licence/i }).getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.getByText(name, { exact: true })).toBeVisible({ timeout: 15_000 });

    page.once('dialog', (d) => d.accept());
    const row = page.locator('div.flex.items-center.justify-between').filter({ hasText: name });
    await row.getByRole('button', { name: /Supprimer/i }).click();

    await expect(page.getByText(name, { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test('Configuration : crée puis supprime une devise', async ({ page }) => {
    const code = `Z${Date.now().toString(36).toUpperCase().slice(0, 8)}`;
    await page.goto('/configuration');
    await page.getByRole('button', { name: 'Devises' }).click();
    await expect(page.getByRole('heading', { name: 'Devises' })).toBeVisible();

    await page.getByRole('button', { name: '+ Ajouter' }).click();
    await page.getByPlaceholder('TND, EUR, USD...').fill(code);
    await page.getByPlaceholder('Ex. Dinar tunisien').fill('Test E2E');

    await page.locator('div.fixed.inset-0').filter({ hasText: /devise/i }).getByRole('button', { name: 'Enregistrer' }).click();

    await expect(page.locator('span.font-mono.font-semibold').filter({ hasText: code })).toBeVisible({
      timeout: 15_000,
    });

    page.once('dialog', (d) => d.accept());
    const row = page.locator('div.flex.items-center.justify-between').filter({ hasText: code });
    await row.getByRole('button', { name: /Supprimer/i }).click();

    await expect(page.getByText(code, { exact: true })).toHaveCount(0, { timeout: 10_000 });
  });

  test('Licences : ouverture du formulaire nouvelle licence', async ({ page }) => {
    await page.goto('/licences');
    await expect(page.getByRole('heading', { name: /Licences/i })).toBeVisible({ timeout: 20_000 });
    await page.getByRole('button', { name: '+ Nouvelle Licence & Certification' }).click();
    await expect(page.getByRole('heading', { name: 'Nouvelle licence' })).toBeVisible();
    await page.getByRole('button', { name: 'Annuler' }).click();
  });
});
