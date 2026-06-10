import { prisma } from './prisma';

function uniqueIds(ids: string[] = []): string[] {
  return [...new Set((ids || []).filter(Boolean))];
}

export async function getUserDirectEntiteIds(userId: string): Promise<string[]> {
  const rows = await prisma.userEntite.findMany({
    where: { userId },
    select: { entiteId: true },
  });
  return uniqueIds(rows.map((r) => r.entiteId));
}

async function buildParentChainMap(seedIds: string[]): Promise<Map<string, string | null>> {
  const parentById = new Map<string, string | null>();
  let frontier = uniqueIds(seedIds);
  while (frontier.length > 0) {
    const rows = await prisma.entite.findMany({
      where: { id: { in: frontier } },
      select: { id: true, parentId: true },
    });
    const nextParents: string[] = [];
    for (const row of rows) {
      parentById.set(row.id, row.parentId ?? null);
      if (row.parentId && !parentById.has(row.parentId)) {
        nextParents.push(row.parentId);
      }
    }
    frontier = uniqueIds(nextParents);
  }
  return parentById;
}

export async function keepMostSpecificEntiteIds(entiteIds: string[]): Promise<string[]> {
  const directIds = uniqueIds(entiteIds);
  if (directIds.length <= 1) return directIds;
  const directSet = new Set(directIds);
  const parentById = await buildParentChainMap(directIds);
  const ancestorsToDrop = new Set<string>();

  for (const childId of directIds) {
    let parentId = parentById.get(childId) ?? null;
    while (parentId) {
      if (directSet.has(parentId)) ancestorsToDrop.add(parentId);
      parentId = parentById.get(parentId) ?? null;
    }
  }

  return directIds.filter((id) => !ancestorsToDrop.has(id));
}

export async function getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
  const roots = uniqueIds(rootIds);
  if (roots.length === 0) return [];
  const all = new Set<string>(roots);
  let frontier = [...roots];
  while (frontier.length > 0) {
    const children = await prisma.entite.findMany({
      where: { parentId: { in: frontier }, deletedAt: null },
      select: { id: true },
    });
    const next: string[] = [];
    for (const c of children) {
      if (!all.has(c.id)) {
        all.add(c.id);
        next.push(c.id);
      }
    }
    frontier = next;
  }
  return [...all];
}

export async function getUserScopedEntiteIds(userId: string): Promise<string[]> {
  const direct = await getUserDirectEntiteIds(userId);
  const effectiveRoots = await keepMostSpecificEntiteIds(direct);
  return getEntiteDescendantIds(effectiveRoots);
}

