import { test, expect } from '@playwright/test';
import { apiBaseUrl, loginAsAdmin } from './helpers';

const adminEmail = process.env.E2E_ADMIN_EMAIL || 'admin@example.com';
const adminPassword = process.env.E2E_ADMIN_PASSWORD || 'admin123';

let adminLoginOk = false;
let adminToken = '';
let processusId = '';
let entiteId = '';
let projetId = '';
let userId = '';
let projetCreatedByTest = false;

test.beforeAll(async () => {
  try {
    const loginRes = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: adminEmail, password: adminPassword }),
    });
    adminLoginOk = loginRes.ok;
    if (!loginRes.ok) return;
    const loginJson = await loginRes.json();
    adminToken = loginJson.token;
    const auth = { Authorization: `Bearer ${adminToken}` };

    const procsRes = await fetch(`${apiBaseUrl}/processus`, { headers: auth });
    if (procsRes.ok) {
      const procs = await procsRes.json();
      const list = Array.isArray(procs) ? procs : [];
      const p = list.find((x: { deletedAt?: string | null }) => !x.deletedAt) || list[0];
      if (p?.id) processusId = p.id;
    }

    const entRes = await fetch(`${apiBaseUrl}/entites`, { headers: auth });
    if (entRes.ok) {
      const entites = await entRes.json();
      const list = Array.isArray(entites) ? entites : [];
      const e = list.find((x: { code?: string }) => x.code === 'DIR-001') || list[0];
      if (e?.id) entiteId = e.id;
    }

    const projRes = await fetch(`${apiBaseUrl}/projets`, { headers: auth });
    if (projRes.ok) {
      const projets = await projRes.json();
      const list = Array.isArray(projets) ? projets : [];
      if (list[0]?.id) {
        projetId = list[0].id;
      } else if (entiteId) {
        const codeProjet = `E2E-PW-${Date.now()}`;
        const cr = await fetch(`${apiBaseUrl}/projets`, {
          method: 'POST',
          headers: { ...auth, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            nom: 'Projet E2E Playwright',
            codeProjet,
            entiteIds: [entiteId],
          }),
        });
        if (cr.ok) {
          const created = await cr.json();
          projetId = created.id;
          projetCreatedByTest = true;
        }
      }
    }

    const usersRes = await fetch(`${apiBaseUrl}/users`, { headers: auth });
    if (usersRes.ok) {
      const users = await usersRes.json();
      const list = Array.isArray(users) ? users : [];
      if (list[0]?.id) userId = list[0].id;
    }
  } catch {
    adminLoginOk = false;
  }
});

test.afterAll(async () => {
  if (!projetCreatedByTest || !adminToken || !projetId) return;
  await fetch(`${apiBaseUrl}/projets/${projetId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${adminToken}` },
  });
});

test.describe('Routes avec identifiant (admin)', () => {
  test.beforeEach(async ({ page, request }, testInfo) => {
    if (!adminLoginOk) {
      testInfo.skip(
        true,
        `API indisponible ou login refusé (${apiBaseUrl}). Lancez l’API et le seed si besoin.`
      );
      return;
    }
    await loginAsAdmin(page, request);
  });

  test('charge /processus/:id', async ({ page }) => {
    test.skip(!processusId, 'Aucun processus en base.');
    await page.goto(`/processus/${processusId}`);
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/PMO|HUB|processus|Processus/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('charge /entites/:id', async ({ page }) => {
    test.skip(!entiteId, 'Aucune entité en base.');
    await page.goto(`/entites/${entiteId}`);
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/PMO|HUB|entité|Entité/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('charge /projets/:id', async ({ page }) => {
    test.skip(!projetId, 'Aucun projet (et création API impossible sans entité).');
    await page.goto(`/projets/${projetId}`);
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/PMO|HUB|projet|Projet/i).first()).toBeVisible({ timeout: 20_000 });
  });

  test('charge /users/:id', async ({ page }) => {
    test.skip(!userId, 'Aucun utilisateur en base.');
    await page.goto(`/users/${userId}`);
    await expect(page).not.toHaveURL(/\/login$/);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByText(/PMO|HUB|utilisateur|profil|email/i).first()).toBeVisible({
      timeout: 20_000,
    });
  });
});
