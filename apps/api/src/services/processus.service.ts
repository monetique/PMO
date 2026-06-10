import { prisma } from '../utils/prisma';
import { ProcessusStatut } from '@prisma/client';
import { PermissionType } from '../generated/prisma/enums';
import {
  fetchProcessusAdminExcludedByProcessusIds,
  fetchProcessusAdminExcludedForUser,
} from '../utils/resourceAdminSansAcces';
import { getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

export type ProcessusAuth = { userId: string; role: string };

const processusIncludeList = {
  proprietaire: { select: { id: true, nom: true, prenom: true, email: true } },
  entites: {
    include: {
      entite: { select: { id: true, nom: true, code: true } },
    },
  },
  categories: {
    include: {
      categorie: { select: { id: true, nom: true, couleur: true } },
    },
  },
  createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
} as const;

function isAdminRole(role: string) {
  return role === 'admin';
}

async function getUserEntiteIds(userId: string): Promise<string[]> {
  const direct = await getUserDirectEntiteIds(userId);
  return keepMostSpecificEntiteIds(direct);
}

function rowHasScopedEntite(
  row: { entites?: Array<{ entiteId?: string; entite?: { id?: string } }> },
  scopedEntiteIds: Set<string>
) {
  const ids = (row.entites || [])
    .map((pe: any) => pe.entiteId ?? pe.entite?.id)
    .filter(Boolean);
  return ids.some((id: string) => scopedEntiteIds.has(id));
}

async function myPermTypesForProcessus(processusId: string, userId: string): Promise<PermissionType[]> {
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'processus', ressourceId: processusId, userId },
    select: { permission: true },
  });
  return rows.map((r) => r.permission);
}

async function loadPermissionsForProcessus(processusIds: string[]) {
  if (processusIds.length === 0) return new Map<string, any[]>();
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'processus', ressourceId: { in: processusIds } },
    include: {
      user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
      grantedBy: { select: { id: true, nom: true, prenom: true } },
    },
    orderBy: { createdAt: 'asc' },
  });
  const m = new Map<string, any[]>();
  for (const r of rows) {
    const list = m.get(r.ressourceId) ?? [];
    list.push(r);
    m.set(r.ressourceId, list);
  }
  return m;
}

function canViewProcessusRow(
  row: {
    statut: ProcessusStatut;
    createdById: string | null;
    proprietaireId: string | null;
  },
  auth: ProcessusAuth,
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  const archived = row.statut === 'archive' || row.statut === 'obsolete';

  if (isAdminRole(auth.role)) {
    if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
    if (adminImplicitRefused && permTypes.length === 0) return false;
    if (archived) return permTypes.length > 0;
    return true;
  }

  if (archived) {
    if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
    return permTypes.length > 0;
  }

  if (row.createdById == null) return true;
  if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
  return permTypes.length > 0;
}

function canModifyProcessusRow(
  row: { proprietaireId: string | null; createdById: string | null },
  auth: ProcessusAuth,
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return permTypes.some((t) => ['modification', 'suppression', 'gestion'].includes(t));
    }
    return true;
  }
  if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
  return permTypes.some((t) => ['modification', 'suppression', 'gestion'].includes(t));
}

function canSoftDeleteProcessusRow(
  row: { proprietaireId: string | null; createdById: string | null },
  auth: ProcessusAuth,
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return permTypes.some((t) => ['suppression', 'gestion'].includes(t));
    }
    return true;
  }
  if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
  return permTypes.some((t) => ['suppression', 'gestion'].includes(t));
}

/** Propriétaire, créateur ou délégation « gestion » (admin implicite ne gère plus les accès). */
function canManageProcessusPermissionsRow(
  row: { proprietaireId: string | null; createdById: string | null },
  auth: ProcessusAuth,
  permTypes: PermissionType[]
) {
  if (row.proprietaireId === auth.userId || row.createdById === auth.userId) return true;
  return permTypes.includes('gestion');
}

function capabilitiesProcessus(
  row: {
    statut: ProcessusStatut;
    proprietaireId: string | null;
    createdById: string | null;
  },
  auth: ProcessusAuth,
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  const view = canViewProcessusRow(row, auth, permTypes, adminImplicitRefused);
  return {
    canView: view,
    canModify: view && canModifyProcessusRow(row, auth, permTypes, adminImplicitRefused),
    canDelete: view && canSoftDeleteProcessusRow(row, auth, permTypes, adminImplicitRefused),
    canManagePermissions: view && canManageProcessusPermissionsRow(row, auth, permTypes),
  };
}

async function maybeExcludeAdminAfterProcessusPermissionRemoved(
  processusId: string,
  createdById: string | null,
  proprietaireId: string | null,
  targetUserId: string
) {
  if (targetUserId === createdById || targetUserId === proprietaireId) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  const remaining = await prisma.permission.count({
    where: { ressourceType: 'processus', ressourceId: processusId, userId: targetUserId },
  });
  if (remaining > 0) return;
  try {
    await prisma.processusAdminSansAcces.upsert({
      where: { processusId_userId: { processusId, userId: targetUserId } },
      create: { processusId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente */
  }
}

function mapAccesDelegations(perms: any[]) {
  const delegMap = new Map<string, { user: any; permissions: PermissionType[]; permissionEntryIds: string[] }>();
  for (const r of perms) {
    const k = r.userId;
    if (!delegMap.has(k)) {
      delegMap.set(k, { user: r.user, permissions: [], permissionEntryIds: [] });
    }
    const e = delegMap.get(k)!;
    e.permissions.push(r.permission);
    e.permissionEntryIds.push(r.id);
  }
  return Array.from(delegMap.values());
}

async function enrichLiensProcessus(
  processusIds: string[],
  rows: { id: string; entites: { entiteId: string }[] }[]
) {
  const empty = {
    documentsByProc: new Map<string, { id: string; nom: string }[]>(),
    licencesByProc: new Map<string, { id: string; nom: string; reference: string }[]>(),
    projetsByProc: new Map<string, { id: string; nom: string; codeProjet: string }[]>(),
    tachesTotalByProc: new Map<string, number>(),
  };
  if (processusIds.length === 0) return empty;

  const [docsNested, licAll] = await Promise.all([
    Promise.all(
      processusIds.map((pid) =>
        prisma.document.findMany({
          where: { referenceType: 'processus', referenceId: pid, deletedAt: null },
          select: { id: true, nom: true },
          orderBy: { updatedAt: 'desc' },
          take: 6,
        })
      )
    ),
    prisma.licenceProcessus.findMany({
      where: {
        processusId: { in: processusIds },
        licence: { deletedAt: null },
      },
      include: {
        licence: { select: { id: true, nom: true, reference: true, updatedAt: true } },
      },
      orderBy: { licence: { updatedAt: 'desc' } },
      take: 400,
    }),
  ]);

  const documentsByProc = new Map<string, { id: string; nom: string }[]>();
  processusIds.forEach((pid, i) => {
    documentsByProc.set(pid, docsNested[i].map((d) => ({ id: d.id, nom: d.nom })));
  });

  const licencesByProc = new Map<string, { id: string; nom: string; reference: string }[]>();
  for (const pid of processusIds) licencesByProc.set(pid, []);
  for (const link of licAll) {
    const pid = link.processusId;
    const lic = link.licence;
    if (!lic) continue;
    const list = licencesByProc.get(pid) ?? [];
    if (list.length < 5) list.push({ id: lic.id, nom: lic.nom, reference: lic.reference });
    licencesByProc.set(pid, list);
  }

  const projetsByProc = new Map<string, { id: string; nom: string; codeProjet: string }[]>();
  const tachesTotalByProc = new Map<string, number>();

  await Promise.all(
    rows.map(async (r) => {
      const eids = r.entites.map((pe: any) => pe.entiteId ?? pe.entite?.id).filter(Boolean);
      if (eids.length === 0) {
        projetsByProc.set(r.id, []);
        tachesTotalByProc.set(r.id, 0);
        return;
      }
      const projets = await prisma.projet.findMany({
        where: { deletedAt: null, entites: { some: { entiteId: { in: eids } } } },
        select: { id: true, nom: true, codeProjet: true },
        orderBy: { updatedAt: 'desc' },
        take: 5,
      });
      projetsByProc.set(
        r.id,
        projets.map((p) => ({ id: p.id, nom: p.nom, codeProjet: p.codeProjet }))
      );
      const pids = projets.map((p) => p.id);
      const tc =
        pids.length > 0
          ? await prisma.tache.count({ where: { projetId: { in: pids }, deletedAt: null } })
          : 0;
      tachesTotalByProc.set(r.id, tc);
    })
  );

  return { documentsByProc, licencesByProc, projetsByProc, tachesTotalByProc };
}

function mapListItem(
  p: any,
  auth: ProcessusAuth,
  permTypes: PermissionType[],
  perms: any[],
  adminImplicitRefused: boolean,
  adminSansAccesUserIds: string[],
  liens: {
    documentsByProc: Map<string, { id: string; nom: string }[]>;
    licencesByProc: Map<string, { id: string; nom: string; reference: string }[]>;
    projetsByProc: Map<string, { id: string; nom: string; codeProjet: string }[]>;
    tachesTotalByProc: Map<string, number>;
  },
  nombreDocuments: number
) {
  const caps = capabilitiesProcessus(
    {
      statut: p.statut,
      proprietaireId: p.proprietaireId,
      createdById: p.createdById,
    },
    auth,
    permTypes,
    adminImplicitRefused
  );
  return {
    ...p,
    adminSansAccesUserIds,
    permissions: perms,
    capabilities: caps,
    accesApercu: { delegations: mapAccesDelegations(perms) },
    nombreDocuments,
    documentsListe: liens.documentsByProc.get(p.id) ?? [],
    licencesListe: liens.licencesByProc.get(p.id) ?? [],
    projetsListe: liens.projetsByProc.get(p.id) ?? [],
    tachesLieesTotal: liens.tachesTotalByProc.get(p.id) ?? 0,
  };
}

export class ProcessusService {
  async findAll(
    filters: {
      statut?: ProcessusStatut;
      entiteId?: string;
      categorieId?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
    },
    auth: ProcessusAuth
  ) {
    const where: any = {};
    const isContributeur = auth.role === 'contributeur';
    const userEntiteIds = !isAdminRole(auth.role) ? await getUserEntiteIds(auth.userId) : [];
    const userEntiteIdSet = new Set(userEntiteIds);
    if (filters?.statut) where.statut = filters.statut;
    if (filters?.entiteId) {
      where.entites = { some: { entiteId: filters.entiteId } };
    }
    if (filters?.categorieId) {
      where.categories = { some: { categorieId: filters.categorieId } };
    }
    if (filters?.search) {
      where.OR = [
        { nom: { contains: filters.search, mode: 'insensitive' } },
        { codeProcessus: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
        { tags: { hasSome: [filters.search] } },
      ];
    }

    let orderBy: any = { updatedAt: 'desc' };
    if (filters?.sortBy) {
      const sortOrder = filters.sortOrder || 'asc';
      switch (filters.sortBy) {
        case 'codeProcessus':
          orderBy = { codeProcessus: sortOrder };
          break;
        case 'nom':
          orderBy = { nom: sortOrder };
          break;
        case 'statut':
          orderBy = { statut: sortOrder };
          break;
        case 'createdAt':
          orderBy = { createdAt: sortOrder };
          break;
        case 'updatedAt':
          orderBy = { updatedAt: sortOrder };
          break;
        case 'proprietaire':
          orderBy = { proprietaire: { nom: sortOrder } };
          break;
        default:
          orderBy = { updatedAt: 'desc' };
      }
    }

    where.deletedAt = null;

    // Contributeur: accès strict = ACL explicite OU entité concernée.
    if (isContributeur) {
      const aclRows = await prisma.permission.findMany({
        where: { ressourceType: 'processus', userId: auth.userId },
        select: { ressourceId: true },
      });
      const aclIds = [...new Set(aclRows.map((r) => r.ressourceId).filter(Boolean))];
      if (userEntiteIds.length === 0 && aclIds.length === 0) return [];
      const scopeOr: any[] = [];
      if (userEntiteIds.length > 0) {
        scopeOr.push({ entites: { some: { entiteId: { in: userEntiteIds } } } });
      }
      if (aclIds.length > 0) {
        scopeOr.push({ id: { in: aclIds } });
      }
      where.AND = [...(Array.isArray(where.AND) ? where.AND : []), { OR: scopeOr }];
    } else if (!isAdminRole(auth.role)) {
      // Règle existante pour les autres non-admin.
      if (userEntiteIds.length === 0) return [];
      const entiteScope = { entites: { some: { entiteId: { in: userEntiteIds } } } };
      if (where.entites) {
        where.AND = [...(Array.isArray(where.AND) ? where.AND : []), entiteScope];
      } else {
        where.entites = entiteScope.entites;
      }
    }

    const processusList = await prisma.processus.findMany({
      where,
      include: processusIncludeList,
      orderBy,
    });

    let filteredList = processusList;
    if (filters?.search) {
      const searchLower = filters.search.toLowerCase();
      filteredList = processusList.filter((p) => {
        const matchesPrismaCriteria =
          (p.nom && p.nom.toLowerCase().includes(searchLower)) ||
          (p.codeProcessus && p.codeProcessus.toLowerCase().includes(searchLower)) ||
          (p.description && p.description.toLowerCase().includes(searchLower));
        let tagMatch = false;
        if (p.tags && Array.isArray(p.tags) && p.tags.length > 0) {
          tagMatch = p.tags.some((tag: string) => tag.toLowerCase().includes(searchLower));
        }
        return matchesPrismaCriteria || tagMatch;
      });
    }

    const permMap = await loadPermissionsForProcessus(filteredList.map((p) => p.id));
    const adminExcludedViewer = await fetchProcessusAdminExcludedForUser(
      auth.userId,
      filteredList.map((p) => p.id)
    );
    const visible = filteredList.filter((p) => {
      const permTypes = (permMap.get(p.id) ?? []).map((x: any) => x.permission as PermissionType);
      if (isContributeur) {
        const entityScoped = rowHasScopedEntite(p as any, userEntiteIdSet);
        return entityScoped || permTypes.length > 0;
      }
      return canViewProcessusRow(
        { statut: p.statut, createdById: p.createdById, proprietaireId: p.proprietaireId },
        auth,
        permTypes,
        adminExcludedViewer.has(p.id)
      );
    });

    const ids = visible.map((p) => p.id);
    const docGroup = await prisma.document.groupBy({
      by: ['referenceId'],
      where: {
        referenceType: 'processus',
        referenceId: { in: ids },
        deletedAt: null,
      },
      _count: { _all: true },
    });
    const docCountMap = new Map<string, number>();
    for (const g of docGroup) {
      if (g.referenceId) docCountMap.set(g.referenceId, g._count._all);
    }

    const liens = await enrichLiensProcessus(
      ids,
      visible.map((p) => ({
        id: p.id,
        entites: p.entites.map((pe: any) => ({ entiteId: pe.entiteId ?? pe.entite?.id })),
      }))
    );

    const adminExclAll = await fetchProcessusAdminExcludedByProcessusIds(ids);

    return visible.map((p) => {
      const perms = permMap.get(p.id) ?? [];
      const permTypes = perms.map((x: any) => x.permission as PermissionType);
      return mapListItem(
        p,
        auth,
        permTypes,
        perms,
        adminExcludedViewer.has(p.id),
        adminExclAll.get(p.id) ?? [],
        liens,
        docCountMap.get(p.id) ?? 0
      );
    });
  }

  async getConsultationCount(id: string): Promise<number> {
    return prisma.journalAcces.count({
      where: { ressourceType: 'processus', ressourceId: id, action: 'lecture' },
    });
  }

  async findOne(id: string, auth: ProcessusAuth) {
    if (!isAdminRole(auth.role) && auth.role !== 'contributeur') {
      const entiteIds = await getUserEntiteIds(auth.userId);
      if (entiteIds.length === 0) return null;
      const linked = await prisma.processusEntite.findFirst({
        where: { processusId: id, entiteId: { in: entiteIds } },
        select: { processusId: true },
      });
      if (!linked) return null;
    }

    const p = await prisma.processus.findFirst({
      where: { id, deletedAt: null },
      include: {
        proprietaire: true,
        entites: { include: { entite: true } },
        categories: { include: { categorie: true } },
        createdBy: true,
      },
    });
    if (!p) return null;
    const permTypes = await myPermTypesForProcessus(id, auth.userId);
    if (auth.role === 'contributeur') {
      const entiteIds = await getUserEntiteIds(auth.userId);
      const entityScoped = rowHasScopedEntite(p as any, new Set(entiteIds));
      if (!entityScoped && permTypes.length === 0) return null;
    }
    const adminExclViewer = await fetchProcessusAdminExcludedForUser(auth.userId, [id]);
    const adminImplicitRefused = adminExclViewer.has(id);
    if (
      !canViewProcessusRow(
        { statut: p.statut, createdById: p.createdById, proprietaireId: p.proprietaireId },
        auth,
        permTypes,
        adminImplicitRefused
      )
    ) {
      return null;
    }
    const perms = (await loadPermissionsForProcessus([id])).get(id) ?? [];
    const liens = await enrichLiensProcessus(
      [id],
      [{ id, entites: p.entites.map((pe: any) => ({ entiteId: pe.entiteId })) }]
    );
    const nd = await prisma.document.count({
      where: { referenceType: 'processus', referenceId: id, deletedAt: null },
    });
    const adminExclAll = await fetchProcessusAdminExcludedByProcessusIds([id]);
    return mapListItem(
      p,
      auth,
      permTypes,
      perms,
      adminImplicitRefused,
      adminExclAll.get(id) ?? [],
      liens,
      nd
    );
  }

  async getAccesDetail(processusId: string, auth: ProcessusAuth) {
    const row = await prisma.processus.findFirst({
      where: { id: processusId, deletedAt: null },
      select: {
        id: true,
        nom: true,
        createdById: true,
        proprietaireId: true,
        statut: true,
      },
    });
    if (!row) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    if (auth.role === 'contributeur') {
      const linked = await prisma.processusEntite.findFirst({
        where: { processusId, entiteId: { in: await getUserEntiteIds(auth.userId) } },
        select: { id: true },
      });
      if (!linked && permTypes.length === 0) throw new Error('FORBIDDEN');
    }
    const adminExclViewer = await fetchProcessusAdminExcludedForUser(auth.userId, [processusId]);
    if (
      !canViewProcessusRow(
        { statut: row.statut, createdById: row.createdById, proprietaireId: row.proprietaireId },
        auth,
        permTypes,
        adminExclViewer.has(processusId)
      )
    ) {
      throw new Error('FORBIDDEN');
    }

    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });

    const creator = row.createdById
      ? await prisma.user.findUnique({
          where: { id: row.createdById },
          select: { id: true, nom: true, prenom: true, email: true, role: true },
        })
      : null;

    const raw = await prisma.permission.findMany({
      where: { ressourceType: 'processus', ressourceId: processusId },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let adminSansAccesUserIds: string[] = [];
    try {
      adminSansAccesUserIds = (
        await prisma.processusAdminSansAcces.findMany({
          where: { processusId },
          select: { userId: true },
        })
      ).map((x) => x.userId);
    } catch {
      /* table absente */
    }

    return {
      ficheNom: row.nom,
      admins,
      creator,
      delegations: raw.map((r) => ({
        id: r.id,
        permission: r.permission,
        user: r.user,
        grantedBy: r.grantedBy,
        createdAt: r.createdAt,
      })),
      canManagePermissions: canManageProcessusPermissionsRow(
        { createdById: row.createdById, proprietaireId: row.proprietaireId },
        auth,
        permTypes
      ),
      adminSansAccesUserIds,
    };
  }

  async addPermission(processusId: string, targetUserId: string, permission: PermissionType, auth: ProcessusAuth) {
    const row = await prisma.processus.findFirst({ where: { id: processusId, deletedAt: null } });
    if (!row) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    if (
      !canManageProcessusPermissionsRow(
        { createdById: row.createdById, proprietaireId: row.proprietaireId },
        auth,
        permTypes
      )
    ) {
      throw new Error('FORBIDDEN');
    }
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (row.createdById === targetUserId || row.proprietaireId === targetUserId) {
      throw new Error('Le créateur ou le propriétaire a déjà tous les droits');
    }
    try {
      await prisma.processusAdminSansAcces.deleteMany({ where: { processusId, userId: targetUserId } });
    } catch {
      /* table absente */
    }
    return prisma.permission.create({
      data: {
        userId: targetUserId,
        ressourceType: 'processus',
        ressourceId: processusId,
        permission,
        grantedById: auth.userId,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });
  }

  async removePermission(processusId: string, permissionId: string, auth: ProcessusAuth) {
    const row = await prisma.processus.findFirst({ where: { id: processusId, deletedAt: null } });
    if (!row) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    if (
      !canManageProcessusPermissionsRow(
        { createdById: row.createdById, proprietaireId: row.proprietaireId },
        auth,
        permTypes
      )
    ) {
      throw new Error('FORBIDDEN');
    }
    const perm = await prisma.permission.findFirst({
      where: { id: permissionId, ressourceType: 'processus', ressourceId: processusId },
    });
    if (!perm) throw new Error('NOT_FOUND');
    const targetUserId = perm.userId;
    await prisma.permission.delete({ where: { id: permissionId } });
    await maybeExcludeAdminAfterProcessusPermissionRemoved(
      processusId,
      row.createdById,
      row.proprietaireId,
      targetUserId
    );
  }

  async blockAdminImplicitAccess(processusId: string, targetUserId: string, auth: ProcessusAuth) {
    const row = await prisma.processus.findFirst({ where: { id: processusId, deletedAt: null } });
    if (!row) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    if (!canManageProcessusPermissionsRow({ createdById: row.createdById, proprietaireId: row.proprietaireId }, auth, permTypes)) {
      throw new Error('FORBIDDEN');
    }
    if (targetUserId === row.createdById || targetUserId === row.proprietaireId) {
      throw new Error('Le créateur ou le propriétaire ne peut pas être exclu');
    }
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite au processus");
    }
    await prisma.permission.deleteMany({
      where: { ressourceType: 'processus', ressourceId: processusId, userId: targetUserId },
    });
    try {
      await prisma.processusAdminSansAcces.upsert({
        where: { processusId_userId: { processusId, userId: targetUserId } },
        create: { processusId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion admin : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async restoreAdminImplicitAccess(processusId: string, targetUserId: string, auth: ProcessusAuth) {
    const row = await prisma.processus.findFirst({ where: { id: processusId, deletedAt: null } });
    if (!row) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    if (!canManageProcessusPermissionsRow({ createdById: row.createdById, proprietaireId: row.proprietaireId }, auth, permTypes)) {
      throw new Error('FORBIDDEN');
    }
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.processusAdminSansAcces.deleteMany({ where: { processusId, userId: targetUserId } });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async canModifyForUser(processusId: string, auth: ProcessusAuth): Promise<boolean> {
    const row = await prisma.processus.findFirst({
      where: { id: processusId, deletedAt: null },
      select: { proprietaireId: true, createdById: true },
    });
    if (!row) return false;
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    const excl = await fetchProcessusAdminExcludedForUser(auth.userId, [processusId]);
    return canModifyProcessusRow(row, auth, permTypes, excl.has(processusId));
  }

  async canSoftDeleteForUser(processusId: string, auth: ProcessusAuth): Promise<boolean> {
    const row = await prisma.processus.findFirst({
      where: { id: processusId, deletedAt: null },
      select: { proprietaireId: true, createdById: true },
    });
    if (!row) return false;
    const permTypes = await myPermTypesForProcessus(processusId, auth.userId);
    const excl = await fetchProcessusAdminExcludedForUser(auth.userId, [processusId]);
    return canSoftDeleteProcessusRow(row, auth, permTypes, excl.has(processusId));
  }

  async create(
    data: {
      nom: string;
      codeProcessus: string;
      description?: string;
      categorieIds?: string[];
      entiteIds?: string[];
      proprietaireId?: string;
      createdById: string;
      initialPermissions?: { userId: string; permission: PermissionType }[];
    },
    auth: ProcessusAuth
  ) {
    const { entiteIds, categorieIds, initialPermissions, ...processusData } = data;

    const processusId = await prisma.$transaction(async (tx) => {
      const p = await tx.processus.create({
        data: {
          ...processusData,
          statut: 'brouillon',
          entites:
            entiteIds && entiteIds.length > 0
              ? { create: entiteIds.map((entiteId) => ({ entiteId })) }
              : undefined,
          categories:
            categorieIds && categorieIds.length > 0
              ? { create: categorieIds.map((categorieId) => ({ categorieId })) }
              : undefined,
        },
        select: { id: true },
      });

      const allowedPerm = new Set<PermissionType>(['lecture', 'modification', 'suppression', 'gestion']);
      for (const row of initialPermissions ?? []) {
        if (!row?.userId || !row.permission || !allowedPerm.has(row.permission)) continue;
        const target = await tx.user.findUnique({
          where: { id: row.userId },
          select: { id: true, role: true },
        });
        if (!target) continue;
        if (row.userId === data.createdById || row.userId === data.proprietaireId) continue;
        if (target.role === 'admin') {
          try {
            await tx.processusAdminSansAcces.deleteMany({
              where: { processusId: p.id, userId: row.userId },
            });
          } catch {
            /* table absente */
          }
        }
        try {
          await tx.permission.create({
            data: {
              userId: row.userId,
              ressourceType: 'processus',
              ressourceId: p.id,
              permission: row.permission,
              grantedById: data.createdById,
            },
          });
        } catch (e: any) {
          if (e?.code !== 'P2002') throw e;
        }
      }

      return p.id;
    });

    const enriched = await this.findOne(processusId, auth);
    if (!enriched) {
      return prisma.processus.findUnique({
        where: { id: processusId },
        include: processusIncludeList,
      });
    }
    return enriched;
  }

  async update(
    id: string,
    data: {
      nom?: string;
      codeProcessus?: string;
      description?: string;
      tags?: string[];
      categorieIds?: string[];
      entiteIds?: string[];
      proprietaireId?: string;
      dateProchaineRevision?: Date;
    },
    auth: ProcessusAuth
  ) {
    const can = await this.canModifyForUser(id, auth);
    if (!can) throw new Error('Accès refusé');

    const { entiteIds, categorieIds, ...updateData } = data;

    if (entiteIds !== undefined) {
      await prisma.processusEntite.deleteMany({ where: { processusId: id } });
      if (entiteIds.length > 0) {
        await prisma.processusEntite.createMany({
          data: entiteIds.map((entiteId) => ({ processusId: id, entiteId })),
        });
      }
    }

    if (categorieIds !== undefined) {
      await prisma.processusCategorie.deleteMany({ where: { processusId: id } });
      if (categorieIds.length > 0) {
        await prisma.processusCategorie.createMany({
          data: categorieIds.map((categorieId) => ({ processusId: id, categorieId })),
        });
      }
    }

    return prisma.processus.update({
      where: { id },
      data: updateData,
      include: processusIncludeList,
    });
  }

  async updateStatus(id: string, statut: ProcessusStatut, validatedBy?: string) {
    const updateData: any = { statut };
    if (statut === 'valide' || statut === 'actif') {
      updateData.dateValidation = new Date();
    }

    const processus = await prisma.processus.update({
      where: { id },
      data: updateData,
    });

    const dernierDocument = await prisma.document.findFirst({
      where: { referenceType: 'processus', referenceId: id },
      orderBy: { createdAt: 'desc' },
    });

    if (dernierDocument) {
      let documentStatut: any = dernierDocument.statut;
      if (statut === 'valide' || statut === 'actif') {
        documentStatut = 'valide';
      } else if (statut === 'en_revision') {
        documentStatut = 'en_revision';
      } else if (statut === 'archive' || statut === 'obsolete') {
        documentStatut = 'archive';
      }

      await prisma.document.update({
        where: { id: dernierDocument.id },
        data: { statut: documentStatut },
      });
    }

    return processus;
  }

  async canDelete(id: string, userId: string, userRole: string): Promise<boolean> {
    return this.canSoftDeleteForUser(id, { userId, role: userRole });
  }

  async canModifyCode(id: string, userId: string, userRole: string): Promise<boolean> {
    const processus = await prisma.processus.findUnique({
      where: { id },
      select: { proprietaireId: true, createdById: true },
    });
    if (!processus) return false;
    const permTypes = await myPermTypesForProcessus(id, userId);
    const excl = await fetchProcessusAdminExcludedForUser(userId, [id]);
    return canModifyProcessusRow(
      processus,
      { userId, role: userRole },
      permTypes,
      excl.has(id)
    );
  }

  async canAccess(id: string, userId: string, userRole: string): Promise<{ canAccess: boolean; reason?: string }> {
    const processus = await prisma.processus.findFirst({
      where: { id, deletedAt: null },
      select: { statut: true, proprietaireId: true, createdById: true },
    });
    if (!processus) {
      return { canAccess: false, reason: 'Processus non trouvé' };
    }
    const permTypes = await myPermTypesForProcessus(id, userId);
    if (userRole === 'contributeur') {
      const linked = await prisma.processusEntite.findFirst({
        where: { processusId: id, entiteId: { in: await getUserEntiteIds(userId) } },
        select: { id: true },
      });
      if (!linked && permTypes.length === 0) {
        return { canAccess: false, reason: 'Accès refusé (hors périmètre contributeur)' };
      }
    }
    const excl = await fetchProcessusAdminExcludedForUser(userId, [id]);
    const ok = canViewProcessusRow(
      {
        statut: processus.statut,
        proprietaireId: processus.proprietaireId,
        createdById: processus.createdById,
      },
      { userId, role: userRole },
      permTypes,
      excl.has(id)
    );
    if (!ok) {
      if (processus.statut === 'archive' || processus.statut === 'obsolete') {
        return {
          canAccess: false,
          reason: `Vous ne pouvez pas accéder à ce processus (${processus.statut}).`,
        };
      }
      return { canAccess: false, reason: 'Accès refusé' };
    }
    return { canAccess: true };
  }

  async delete(id: string) {
    return prisma.processus.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** Corbeille : tout pour l’admin, sinon processus dont l’utilisateur est créateur ou propriétaire. */
  async listDeletedForCorbeilleScoped(auth: ProcessusAuth) {
    const where: any = { deletedAt: { not: null } };
    if (!isAdminRole(auth.role)) {
      where.OR = [{ createdById: auth.userId }, { proprietaireId: auth.userId }];
    }
    return prisma.processus.findMany({
      where,
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        proprietaire: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }
}
