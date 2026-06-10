import { prisma } from './prisma';

/** Tolère l’absence de table si migrate deploy n’a pas été exécuté. */

export async function fetchProjetAdminExcludedForUser(userId: string, projetIds: string[]): Promise<Set<string>> {
  if (projetIds.length === 0) return new Set();
  try {
    const rows = await prisma.projetAdminSansAcces.findMany({
      where: { userId, projetId: { in: projetIds } },
      select: { projetId: true },
    });
    return new Set(rows.map((r) => r.projetId));
  } catch {
    return new Set();
  }
}

export async function fetchProjetAdminExcludedByProjetIds(projetIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (projetIds.length === 0) return m;
  try {
    const rows = await prisma.projetAdminSansAcces.findMany({
      where: { projetId: { in: projetIds } },
      select: { projetId: true, userId: true },
    });
    for (const r of rows) {
      const arr = m.get(r.projetId) ?? [];
      arr.push(r.userId);
      m.set(r.projetId, arr);
    }
    return m;
  } catch {
    return m;
  }
}

export async function fetchProcessusAdminExcludedForUser(userId: string, processusIds: string[]): Promise<Set<string>> {
  if (processusIds.length === 0) return new Set();
  try {
    const rows = await prisma.processusAdminSansAcces.findMany({
      where: { userId, processusId: { in: processusIds } },
      select: { processusId: true },
    });
    return new Set(rows.map((r) => r.processusId));
  } catch {
    return new Set();
  }
}

export async function fetchProcessusAdminExcludedByProcessusIds(processusIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (processusIds.length === 0) return m;
  try {
    const rows = await prisma.processusAdminSansAcces.findMany({
      where: { processusId: { in: processusIds } },
      select: { processusId: true, userId: true },
    });
    for (const r of rows) {
      const arr = m.get(r.processusId) ?? [];
      arr.push(r.userId);
      m.set(r.processusId, arr);
    }
    return m;
  } catch {
    return m;
  }
}

export async function fetchCfAdminExcludedForUser(userId: string, cfIds: string[]): Promise<Set<string>> {
  if (cfIds.length === 0) return new Set();
  try {
    const rows = await prisma.clientFournisseurAdminSansAcces.findMany({
      where: { userId, clientFournisseurId: { in: cfIds } },
      select: { clientFournisseurId: true },
    });
    return new Set(rows.map((r) => r.clientFournisseurId));
  } catch {
    return new Set();
  }
}

export async function fetchCfAdminExcludedByCfIds(cfIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (cfIds.length === 0) return m;
  try {
    const rows = await prisma.clientFournisseurAdminSansAcces.findMany({
      where: { clientFournisseurId: { in: cfIds } },
      select: { clientFournisseurId: true, userId: true },
    });
    for (const r of rows) {
      const arr = m.get(r.clientFournisseurId) ?? [];
      arr.push(r.userId);
      m.set(r.clientFournisseurId, arr);
    }
    return m;
  } catch {
    return m;
  }
}

export async function fetchEntiteAdminExcludedForUser(userId: string, entiteIds: string[]): Promise<Set<string>> {
  if (entiteIds.length === 0) return new Set();
  try {
    const rows = await prisma.entiteAdminSansAcces.findMany({
      where: { userId, entiteId: { in: entiteIds } },
      select: { entiteId: true },
    });
    return new Set(rows.map((r) => r.entiteId));
  } catch {
    return new Set();
  }
}

export async function fetchEntiteAdminExcludedByEntiteIds(entiteIds: string[]): Promise<Map<string, string[]>> {
  const m = new Map<string, string[]>();
  if (entiteIds.length === 0) return m;
  try {
    const rows = await prisma.entiteAdminSansAcces.findMany({
      where: { entiteId: { in: entiteIds } },
      select: { entiteId: true, userId: true },
    });
    for (const r of rows) {
      const arr = m.get(r.entiteId) ?? [];
      arr.push(r.userId);
      m.set(r.entiteId, arr);
    }
    return m;
  } catch {
    return m;
  }
}
