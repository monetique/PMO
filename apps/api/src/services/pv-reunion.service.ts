import { prisma } from '../utils/prisma';
import { DocType, LogAction, RefType, ResourceType, Role, UserStatus } from '../generated/prisma/enums';
import { NotificationService } from './notification.service';
import * as fs from 'fs/promises';
import * as path from 'path';
import { Readable } from 'stream';
import { v4 as uuidv4 } from 'uuid';
import { generatePvPdfBuffer, type PvPdfMeta } from '../utils/pv-pdf-from-html';
import { CompanyInfoService } from './company-info.service';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

const UPLOAD_DIR = path.join(process.cwd(), 'uploads');

function multerFileLike(opts: {
  diskPath: string;
  diskFilename: string;
  originalname: string;
  mimetype: string;
  size: number;
}): Express.Multer.File {
  const empty = new Readable();
  empty.push(null);
  return {
    fieldname: 'fichier',
    originalname: opts.originalname,
    encoding: '7bit',
    mimetype: opts.mimetype,
    size: opts.size,
    destination: path.dirname(opts.diskPath),
    filename: opts.diskFilename,
    path: opts.diskPath,
    buffer: Buffer.alloc(0),
    stream: empty as any,
  } as Express.Multer.File;
}

function pvStatutLabelFr(st: string): string {
  const m: Record<string, string> = {
    brouillon: 'Brouillon',
    en_revision: 'En révision',
    valide: 'Validé',
    archive: 'Archivé',
  };
  return m[st] || st;
}

function slugifyTitre(titre: string): string {
  const s = titre
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9-_]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 60);
  return s || 'PV';
}

export function buildPvPrincipalFileBaseName(titre: string, dateReunion?: Date | null): string {
  const d =
    dateReunion && !Number.isNaN(dateReunion.getTime())
      ? dateReunion.toISOString().slice(0, 10)
      : new Date().toISOString().slice(0, 10);
  return `PV_Reunion_${d}_${slugifyTitre(titre)}`;
}

async function syncPvPrincipalDocumentLinks(documentId: string, expanded: LiensExplicites) {
  await prisma.$transaction([
    prisma.tacheDocument.deleteMany({ where: { documentId } }),
    prisma.epicDocument.deleteMany({ where: { documentId } }),
  ]);
  if (expanded.tacheIds.length) {
    await prisma.tacheDocument.createMany({
      data: expanded.tacheIds.map((tacheId) => ({ tacheId, documentId })),
      skipDuplicates: true,
    });
  }
  if (expanded.epicIds.length) {
    await prisma.epicDocument.createMany({
      data: expanded.epicIds.map((epicId) => ({ epicId, documentId })),
      skipDuplicates: true,
    });
  }
}

export const PV_REUNION_STATUTS = ['brouillon', 'en_revision', 'valide', 'archive'] as const;
export type PvReunionStatut = (typeof PV_REUNION_STATUTS)[number];

export function normalizePvStatut(input: unknown): PvReunionStatut | null {
  const s = String(input || '').trim().toLowerCase();
  if (!s) return null;
  return (PV_REUNION_STATUTS as readonly string[]).includes(s) ? (s as PvReunionStatut) : null;
}

export type LiensExplicites = {
  projetIds: string[];
  tacheIds: string[];
  userStoryIds: string[];
  epicIds: string[];
  contratIds: string[];
  processusIds: string[];
};

const emptyLiens: LiensExplicites = {
  projetIds: [],
  tacheIds: [],
  userStoryIds: [],
  epicIds: [],
  contratIds: [],
  processusIds: [],
};

function uniq(ids: string[]): string[] {
  return [...new Set(ids.filter(Boolean))];
}

function stripHtmlTags(html: string): string {
  return String(html || '')
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ');
}

function decodeHtmlEntities(raw: string): string {
  return raw
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function extractAssignedActionRowsFromHtml(
  html: string
): Array<{ targetType: 'user' | 'entite'; targetId: string; actionLabel: string }> {
  const source = String(html || '');
  if (!source.trim()) return [];
  const rows: Array<{ targetType: 'user' | 'entite'; targetId: string; actionLabel: string }> = [];
  const trRegex = /<tr\b([^>]*)>([\s\S]*?)<\/tr>/gi;
  let m: RegExpExecArray | null;
  while ((m = trRegex.exec(source)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const notifyMatch = /data-notify="([^"]*)"/i.exec(attrs);
    const isNotifyEnabled = String(notifyMatch?.[1] || '').trim() === '1';
    if (!isNotifyEnabled) continue;
    const userIdsAttr = /data-user-ids="([^"]*)"/i.exec(attrs)?.[1] || '';
    const legacyUserId = /data-user-id="([^"]*)"/i.exec(attrs)?.[1] || '';
    const entiteId = String(/data-entite-id="([^"]*)"/i.exec(attrs)?.[1] || '').trim();
    let userIds: string[] = [];
    if (userIdsAttr) {
      try {
        const parsed = JSON.parse(decodeHtmlEntities(userIdsAttr));
        if (Array.isArray(parsed)) {
          userIds = parsed.map((x) => String(x || '').trim()).filter(Boolean);
        }
      } catch {
        userIds = [];
      }
    }
    if (!userIds.length && legacyUserId) userIds = [String(legacyUserId).trim()];
    if (!userIds.length && !entiteId) continue;
    const td = /<td\b[^>]*>([\s\S]*?)<\/td>/i.exec(inner);
    const actionLabel = decodeHtmlEntities(
      String(td?.[1] || '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
    );
    if (!actionLabel || actionLabel === '—') continue;
    for (const userId of userIds) {
      rows.push({ targetType: 'user', targetId: userId, actionLabel });
    }
    if (entiteId) {
      rows.push({ targetType: 'entite', targetId: entiteId, actionLabel });
    }
  }
  return rows;
}

function parseLiensExplicites(raw: unknown): LiensExplicites {
  if (!raw || typeof raw !== 'object') return { ...emptyLiens };
  const o = raw as Record<string, unknown>;
  const arr = (v: unknown) =>
    Array.isArray(v) ? uniq(v.filter((x): x is string => typeof x === 'string')) : [];
  return {
    projetIds: arr(o.projetIds),
    tacheIds: arr(o.tacheIds),
    userStoryIds: arr(o.userStoryIds),
    epicIds: arr(o.epicIds),
    contratIds: arr(o.contratIds),
    processusIds: arr(o.processusIds),
  };
}

export function parseIdArrayFromBody(val: unknown): string[] {
  if (val == null || val === '') return [];
  if (Array.isArray(val)) return uniq(val.filter((x): x is string => typeof x === 'string'));
  if (typeof val === 'string') {
    try {
      const j = JSON.parse(val);
      return Array.isArray(j) ? uniq(j.filter((x: unknown) => typeof x === 'string')) : [];
    } catch {
      return [];
    }
  }
  return [];
}

/** Même modèle que Contrat (créateur, permissions explicites, admin implicite / adminSansAcces). */
type PvReunionAcl = {
  id: string;
  createdById: string;
  permissions: { userId: string; niveau: string }[];
  adminSansAcces?: { userId: string }[];
};

function toPvAcl(pv: {
  id: string;
  createdById: string;
  permissions?: { userId: string; niveau: string }[];
  adminSansAcces?: { userId: string }[];
}): PvReunionAcl {
  return {
    id: pv.id,
    createdById: pv.createdById,
    permissions: (pv.permissions || []).map((p) => ({ userId: p.userId, niveau: p.niveau })),
    adminSansAcces: pv.adminSansAcces || [],
  };
}

function adminImplicitAccessRefusedPv(pv: PvReunionAcl, userId: string): boolean {
  return (pv.adminSansAcces || []).some((x) => x.userId === userId);
}

export function canViewPvReunion(pv: PvReunionAcl, userId: string, userRole: string): boolean {
  if (pv.createdById === userId) return true;
  const hasPerm = pv.permissions.some((p) => p.userId === userId);
  if (userRole === Role.admin) {
    if (adminImplicitAccessRefusedPv(pv, userId)) return hasPerm;
    return true;
  }
  return hasPerm;
}

export function capabilitiesPvReunion(pv: PvReunionAcl, userId: string, userRole: string) {
  const isAdmin = userRole === Role.admin;
  const isCreator = pv.createdById === userId;
  const perm = pv.permissions.find((p) => p.userId === userId);
  const adminRefused = isAdmin && adminImplicitAccessRefusedPv(pv, userId);

  if (isCreator) {
    return {
      canView: true,
      canModify: true,
      canDelete: true,
      canManagePermissions: true,
    };
  }

  if (perm) {
    const canView = true;
    const canModify = perm.niveau === 'modification' || perm.niveau === 'suppression';
    const canDelete = perm.niveau === 'suppression';
    return { canView, canModify, canDelete, canManagePermissions: false };
  }

  if (isAdmin && !adminRefused) {
    return {
      canView: true,
      canModify: true,
      canDelete: true,
      canManagePermissions: false,
    };
  }

  return { canView: false, canModify: false, canDelete: false, canManagePermissions: false };
}

async function maybeExcludeAdminAfterPermissionRemovedPv(
  pvReunionId: string,
  pvCreatedById: string,
  targetUserId: string
) {
  if (targetUserId === pvCreatedById) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== Role.admin) return;
  await prisma.pvReunionAdminSansAcces.upsert({
    where: { pvReunionId_userId: { pvReunionId, userId: targetUserId } },
    create: { pvReunionId, userId: targetUserId },
    update: {},
  });
}

const pvIncludeDetail = {
  document: {
    select: {
      id: true,
      nom: true,
      fichierUrl: true,
      fichierNomOriginal: true,
      fichierTaille: true,
      fichierType: true,
      typeDocument: true,
    },
  },
  createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
  permissions: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
  },
  adminSansAcces: { select: { userId: true } },
  presentsUser: { include: { user: { select: { id: true, nom: true, prenom: true, email: true } } } },
  presentsClientFournisseur: {
    include: { clientFournisseur: { select: { id: true, nom: true, type: true } } },
  },
  modificationDelegues: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
  },
  projets: { include: { projet: { select: { id: true, nom: true, codeProjet: true } } } },
  taches: { include: { tache: { select: { id: true, nom: true, statut: true } } } },
  userStories: { include: { userStory: { select: { id: true, description: true } } } },
  epics: { include: { epic: { select: { id: true, nom: true } } } },
  contrats: { include: { contrat: { select: { id: true, nom: true, codeContrat: true } } } },
  processus: { include: { processus: { select: { id: true, nom: true } } } },
  commentaires: {
    orderBy: { createdAt: 'asc' as const },
    include: {
      user: { select: { id: true, nom: true, prenom: true } },
      assigneUser: { select: { id: true, nom: true, prenom: true } },
      pieceJointe: {
        select: {
          id: true,
          nom: true,
          fichierNomOriginal: true,
          fichierTaille: true,
          fichierType: true,
        },
      },
    },
  },
} as const;

/** Données enrichies pour la liste (cartes dépliables). */
const pvIncludeList = {
  document: { select: { id: true, nom: true, fichierNomOriginal: true } },
  createdBy: { select: { id: true, nom: true, prenom: true } },
  permissions: {
    include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
  },
  adminSansAcces: { select: { userId: true } },
  presentsUser: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
  presentsClientFournisseur: {
    include: { clientFournisseur: { select: { id: true, nom: true, type: true } } },
  },
  projets: { include: { projet: { select: { id: true, nom: true, codeProjet: true } } } },
  taches: { include: { tache: { select: { id: true, nom: true, statut: true } } } },
  userStories: { include: { userStory: { select: { id: true, description: true } } } },
  epics: { include: { epic: { select: { id: true, nom: true } } } },
  contrats: { include: { contrat: { select: { id: true, nom: true, codeContrat: true } } } },
  processus: { include: { processus: { select: { id: true, nom: true } } } },
} as const;

function mapPvWithCaps<T extends object>(pv: T, userId: string, role: string) {
  const acl = toPvAcl(pv as any);
  const caps = capabilitiesPvReunion(acl, userId, role);
  const adminSansAccesUserIds = ((pv as { adminSansAcces?: { userId: string }[] }).adminSansAcces || []).map(
    (x) => x.userId,
  );
  return {
    ...pv,
    liensExplicites: parseLiensExplicites((pv as { liensExplicites?: unknown }).liensExplicites),
    capabilities: caps,
    adminSansAccesUserIds,
    accesApercu: {
      delegations: (((pv as { permissions?: unknown[] }).permissions || []) as any[]).map((p: any) => ({
        id: p.id,
        user: p.user,
        niveau: p.niveau,
      })),
    },
  } as T & {
    liensExplicites: LiensExplicites;
    capabilities: ReturnType<typeof capabilitiesPvReunion>;
    adminSansAccesUserIds: string[];
    accesApercu: { delegations: Array<{ id?: string; user?: unknown; niveau: string }> };
  };
}

async function expandLiens(liens: LiensExplicites): Promise<LiensExplicites> {
  const tacheIds = new Set(liens.tacheIds);
  const userStoryIds = new Set(liens.userStoryIds);

  if (userStoryIds.size > 0) {
    const tus = await prisma.tache.findMany({
      where: { userStoryId: { in: [...userStoryIds] }, deletedAt: null },
      select: { id: true },
    });
    tus.forEach((t) => tacheIds.add(t.id));
  }

  const epicIds = new Set(liens.epicIds);
  if (epicIds.size > 0) {
    const stories = await prisma.userStory.findMany({
      where: { epicId: { in: [...epicIds] }, deletedAt: null },
      select: { id: true },
    });
    for (const s of stories) userStoryIds.add(s.id);
    if (stories.length > 0) {
      const tus2 = await prisma.tache.findMany({
        where: { userStoryId: { in: stories.map((s) => s.id) }, deletedAt: null },
        select: { id: true },
      });
      tus2.forEach((t) => tacheIds.add(t.id));
    }
  }

  return {
    projetIds: uniq(liens.projetIds),
    tacheIds: [...tacheIds],
    userStoryIds: [...userStoryIds],
    epicIds: uniq(liens.epicIds),
    contratIds: uniq(liens.contratIds),
    processusIds: uniq(liens.processusIds),
  };
}

async function replaceLiens(pvReunionId: string, expanded: LiensExplicites) {
  await prisma.$transaction([
    prisma.pvReunionProjet.deleteMany({ where: { pvReunionId } }),
    prisma.pvReunionTache.deleteMany({ where: { pvReunionId } }),
    prisma.pvReunionUserStory.deleteMany({ where: { pvReunionId } }),
    prisma.pvReunionEpic.deleteMany({ where: { pvReunionId } }),
    prisma.pvReunionContrat.deleteMany({ where: { pvReunionId } }),
    prisma.pvReunionProcessus.deleteMany({ where: { pvReunionId } }),
  ]);

  if (expanded.projetIds.length) {
    await prisma.pvReunionProjet.createMany({
      data: expanded.projetIds.map((projetId) => ({ pvReunionId, projetId })),
      skipDuplicates: true,
    });
  }
  if (expanded.tacheIds.length) {
    await prisma.pvReunionTache.createMany({
      data: expanded.tacheIds.map((tacheId) => ({ pvReunionId, tacheId })),
      skipDuplicates: true,
    });
  }
  if (expanded.userStoryIds.length) {
    await prisma.pvReunionUserStory.createMany({
      data: expanded.userStoryIds.map((userStoryId) => ({ pvReunionId, userStoryId })),
      skipDuplicates: true,
    });
  }
  if (expanded.epicIds.length) {
    await prisma.pvReunionEpic.createMany({
      data: expanded.epicIds.map((epicId) => ({ pvReunionId, epicId })),
      skipDuplicates: true,
    });
  }
  if (expanded.contratIds.length) {
    await prisma.pvReunionContrat.createMany({
      data: expanded.contratIds.map((contratId) => ({ pvReunionId, contratId })),
      skipDuplicates: true,
    });
  }
  if (expanded.processusIds.length) {
    await prisma.pvReunionProcessus.createMany({
      data: expanded.processusIds.map((processusId) => ({ pvReunionId, processusId })),
      skipDuplicates: true,
    });
  }
}

export class PvReunionService {
  private notificationService = new NotificationService();
  private companyInfoService = new CompanyInfoService();

  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds(uniq(rootIds));
  }

  private async getContributeurEntiteScope(userId: string): Promise<Set<string>> {
    const own = await this.getUserEntiteIds(userId);
    const scoped = await this.getEntiteDescendantIds(own);
    return new Set(scoped);
  }

  private async listPvIdsLinkedToEntiteScope(scopeEntiteIds: string[]): Promise<Set<string>> {
    if (!scopeEntiteIds.length) return new Set<string>();
    const [
      fromProcessus,
      fromProjets,
      fromTaches,
      fromEpicsByEntite,
      fromEpicsByProjetEntite,
      fromUserStoriesByEpicEntite,
      fromUserStoriesByEpicProjetEntite,
      fromContratsByProjetEntite,
    ] = await Promise.all([
      prisma.pvReunionProcessus.findMany({
        where: { processus: { entites: { some: { entiteId: { in: scopeEntiteIds } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionProjet.findMany({
        where: { projet: { entites: { some: { entiteId: { in: scopeEntiteIds } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionTache.findMany({
        where: { tache: { assignesEntites: { some: { entiteId: { in: scopeEntiteIds } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionEpic.findMany({
        where: { epic: { assignesEntites: { some: { entiteId: { in: scopeEntiteIds } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionEpic.findMany({
        where: { epic: { projet: { entites: { some: { entiteId: { in: scopeEntiteIds } } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionUserStory.findMany({
        where: { userStory: { epic: { assignesEntites: { some: { entiteId: { in: scopeEntiteIds } } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionUserStory.findMany({
        where: { userStory: { epic: { projet: { entites: { some: { entiteId: { in: scopeEntiteIds } } } } } } },
        select: { pvReunionId: true },
      }),
      prisma.pvReunionContrat.findMany({
        where: { contrat: { projets: { some: { projet: { entites: { some: { entiteId: { in: scopeEntiteIds } } } } } } } },
        select: { pvReunionId: true },
      }),
    ]);
    return new Set<string>(
      [
        ...fromProcessus,
        ...fromProjets,
        ...fromTaches,
        ...fromEpicsByEntite,
        ...fromEpicsByProjetEntite,
        ...fromUserStoriesByEpicEntite,
        ...fromUserStoriesByEpicProjetEntite,
        ...fromContratsByProjetEntite,
      ].map((x) => x.pvReunionId)
    );
  }

  private async canContributeurViewPvByEntite(pvId: string, userId: string): Promise<boolean> {
    const scopeSet = await this.getContributeurEntiteScope(userId);
    const scope = [...scopeSet];
    if (!scope.length) return false;
    const ids = await this.listPvIdsLinkedToEntiteScope(scope);
    return ids.has(pvId);
  }

  private logoExtToContentType(filename: string): string {
    const ext = path.extname(filename || '').toLowerCase();
    if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
    if (ext === '.webp') return 'image/webp';
    if (ext === '.svg') return 'image/svg+xml';
    return 'image/png';
  }

  /** Aligne les lignes PvReunionPermission sur les délégués « modification » du formulaire. */
  private async syncDeleguesToPermissionRows(
    pvReunionId: string,
    delegueUserIds: string[],
    createdById: string
  ) {
    const ids = uniq(delegueUserIds).filter((x) => x !== createdById);
    for (const uid of ids) {
      await prisma.pvReunionPermission.upsert({
        where: { pvReunionId_userId: { pvReunionId, userId: uid } },
        create: { pvReunionId, userId: uid, niveau: 'modification' },
        update: {},
      });
    }
  }

  private async onDeleguesFormUpdated(
    pvReunionId: string,
    createdById: string,
    previousDelegueIds: string[],
    newDelegueIds: string[]
  ) {
    const newSet = new Set(uniq(newDelegueIds).filter((x) => x !== createdById));
    for (const old of previousDelegueIds) {
      if (!newSet.has(old)) {
        const perm = await prisma.pvReunionPermission.findUnique({
          where: { pvReunionId_userId: { pvReunionId, userId: old } },
        });
        if (perm?.niveau === 'modification') {
          await prisma.pvReunionPermission.delete({ where: { id: perm.id } });
        }
      }
    }
    for (const uid of newSet) {
      await prisma.pvReunionPermission.upsert({
        where: { pvReunionId_userId: { pvReunionId, userId: uid } },
        create: { pvReunionId, userId: uid, niveau: 'modification' },
        update: {},
      });
    }
  }

  private async notifyAssignedActionUsers(opts: {
    pvId: string;
    pvTitre: string;
    auteurId: string;
    previousHtml?: string | null;
    nextHtml?: string | null;
  }) {
    const nextRows = extractAssignedActionRowsFromHtml(opts.nextHtml || '');
    if (!nextRows.length) return;
    const previousSet = new Set(
      extractAssignedActionRowsFromHtml(opts.previousHtml || '').map(
        (r) => `${r.targetType}:${r.targetId}::${r.actionLabel}`
      )
    );
    const toNotify = nextRows.filter(
      (r) => !previousSet.has(`${r.targetType}:${r.targetId}::${r.actionLabel}`)
    );
    if (!toNotify.length) return;
    const directUserIds = uniq(
      toNotify
        .filter((r) => r.targetType === 'user')
        .map((r) => r.targetId)
        .filter((id) => id && id !== opts.auteurId)
    );
    const entiteIds = uniq(
      toNotify
        .filter((r) => r.targetType === 'entite')
        .map((r) => r.targetId)
        .filter(Boolean)
    );
    const [usersDirect, entites] = await Promise.all([
      directUserIds.length
        ? prisma.user.findMany({
            where: { id: { in: directUserIds } },
            select: { id: true, email: true, nom: true, prenom: true },
          })
        : Promise.resolve([] as Array<{ id: string; email: string; nom: string; prenom: string }>),
      entiteIds.length
        ? prisma.entite.findMany({
            where: { id: { in: entiteIds }, deletedAt: null },
            select: {
              id: true,
              responsableId: true,
              responsable: { select: { id: true, email: true, nom: true, prenom: true } },
            },
          })
        : Promise.resolve(
            [] as Array<{
              id: string;
              responsableId: string | null;
              responsable: { id: string; email: string; nom: string; prenom: string } | null;
            }>
          ),
    ]);
    const users = new Map<string, { id: string; email: string; nom: string; prenom: string }>();
    for (const u of usersDirect) users.set(u.id, u);
    for (const e of entites) {
      if (!e.responsable || !e.responsableId) continue;
      if (e.responsableId === opts.auteurId) continue;
      users.set(e.responsableId, e.responsable);
    }
    if (!users.size) return;
    const resolvedUsers = [...users.values()];
    const usersById = new Map(resolvedUsers.map((u) => [u.id, u]));
    const entiteToResponsable = new Map<string, string>();
    for (const e of entites) {
      if (e.responsableId) entiteToResponsable.set(e.id, e.responsableId);
    }
    const byUser = new Map<string, string[]>();
    for (const row of toNotify) {
      let resolvedUserId = '';
      if (row.targetType === 'user') {
        resolvedUserId = row.targetId;
      } else {
        resolvedUserId = entiteToResponsable.get(row.targetId) || '';
      }
      if (!resolvedUserId || resolvedUserId === opts.auteurId) continue;
      if (!usersById.has(resolvedUserId)) continue;
      const list = byUser.get(resolvedUserId) || [];
      if (!list.includes(row.actionLabel)) list.push(row.actionLabel);
      byUser.set(resolvedUserId, list);
    }
    if (!byUser.size) return;
    const usersForNotif = resolvedUsers.filter((u) => byUser.has(u.id));
    if (!usersForNotif.length) return;
    const auteur = await prisma.user.findUnique({
      where: { id: opts.auteurId },
      select: { id: true, email: true, nom: true, prenom: true },
    });
    const auteurNom = auteur ? `${auteur.prenom} ${auteur.nom}` : 'Un utilisateur';
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    for (const u of usersForNotif) {
      const labels = byUser.get(u.id) || [];
      if (!labels.length) continue;
      for (const actionLabel of labels) {
        this.notificationService
          .notifierAssignationActionPvReunion({
            pvId: opts.pvId,
            pvTitre: opts.pvTitre,
            actionLabel,
            destinataire: { id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` },
            auteurNom,
            appUrl,
          })
          .catch((err: unknown) => console.error('[PV] Notification action assignée:', err));
      }
    }
  }

  async findAll(userId: string, role: string) {
    const list = await prisma.pvReunion.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: {
        ...pvIncludeList,
        _count: { select: { commentaires: true } },
      },
    });
    let entityScopedPvIds = new Set<string>();
    if (role === Role.contributeur) {
      const scope = [...(await this.getContributeurEntiteScope(userId))];
      entityScopedPvIds = await this.listPvIdsLinkedToEntiteScope(scope);
    }
    const visible = list.filter((pv) => {
      const hasAcl = canViewPvReunion(toPvAcl(pv), userId, role);
      if (hasAcl) return true;
      if (role !== Role.contributeur) return false;
      return entityScopedPvIds.has(pv.id);
    });
    const ids = visible.map((p) => p.id);
    const vueRows =
      ids.length > 0
        ? await prisma.journalAcces.groupBy({
            by: ['ressourceId'],
            where: {
              ressourceType: ResourceType.pvReunion,
              action: LogAction.lecture,
              ressourceId: { in: ids },
            },
            _count: { _all: true },
          })
        : [];
    const vueMap = new Map<string, number>();
    for (const r of vueRows) {
      if (r.ressourceId) vueMap.set(r.ressourceId, r._count._all);
    }
    return visible.map((row) => {
      const { _count, ...pv } = row as typeof row & { _count: { commentaires: number } };
      return mapPvWithCaps(
        {
          ...pv,
          nombreCommentaires: _count?.commentaires ?? 0,
          nombreVues: vueMap.get(pv.id) ?? 0,
        },
        userId,
        role
      );
    });
  }

  async findOne(id: string, userId: string, role: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      include: pvIncludeDetail,
    });
    if (!pv) return null;
    const hasAcl = canViewPvReunion(toPvAcl(pv), userId, role);
    if (!hasAcl) {
      if (role !== Role.contributeur) return null;
      const hasEntityAccess = await this.canContributeurViewPvByEntite(id, userId);
      if (!hasEntityAccess) return null;
    }
    const [nombreCommentaires, nombreVues] = await Promise.all([
      prisma.pvReunionCommentaire.count({ where: { pvReunionId: id } }),
      prisma.journalAcces.count({
        where: {
          ressourceType: ResourceType.pvReunion,
          action: LogAction.lecture,
          ressourceId: id,
        },
      }),
    ]);
    return mapPvWithCaps({ ...pv, nombreCommentaires, nombreVues }, userId, role);
  }

  private async buildPdfMetaForCreate(
    data: {
      titre: string;
      statut?: string | null;
      dateReunion?: Date | null;
      presentUserIds: string[];
      presentClientFournisseurIds: string[];
    },
    expanded: LiensExplicites,
    bodyHtml: string
  ): Promise<PvPdfMeta> {
    const st = normalizePvStatut(data.statut) ?? 'brouillon';
    const users = data.presentUserIds.length
      ? await prisma.user.findMany({
          where: { id: { in: uniq(data.presentUserIds) } },
          select: { prenom: true, nom: true },
        })
      : [];
    const cfs = data.presentClientFournisseurIds.length
      ? await prisma.clientFournisseur.findMany({
          where: { id: { in: uniq(data.presentClientFournisseurIds) } },
          select: { nom: true, type: true },
        })
      : [];
    const projets = expanded.projetIds.length
      ? await prisma.projet.findMany({
          where: { id: { in: expanded.projetIds }, deletedAt: null },
          select: { nom: true, codeProjet: true },
        })
      : [];
    const taches = expanded.tacheIds.length
      ? await prisma.tache.findMany({
          where: { id: { in: expanded.tacheIds }, deletedAt: null },
          select: { nom: true },
        })
      : [];
    const uss = expanded.userStoryIds.length
      ? await prisma.userStory.findMany({
          where: { id: { in: expanded.userStoryIds }, deletedAt: null },
          select: { description: true },
        })
      : [];
    const eps = expanded.epicIds.length
      ? await prisma.epic.findMany({
          where: { id: { in: expanded.epicIds }, deletedAt: null },
          select: { nom: true },
        })
      : [];

    const liensProjets = projets.length
      ? projets.map((p) => `${p.nom}${p.codeProjet ? ` (${p.codeProjet})` : ''}`).join(' ; ')
      : undefined;
    const liensTaches = taches.length ? taches.map((t) => t.nom).join(' ; ') : undefined;
    const liensUserStories = uss.length
      ? uss.map((u) => (u.description || '').replace(/\s+/g, ' ').slice(0, 120)).join(' ; ')
      : undefined;
    const liensEpics = eps.length ? eps.map((e) => e.nom).join(' ; ') : undefined;
    const companyInfo = await this.companyInfoService.get();
    let companyLogoDataUrl: string | undefined;
    if (companyInfo.logoFilename) {
      try {
        const logo = await this.companyInfoService.readLogoBuffer(companyInfo.logoFilename);
        const mime = this.logoExtToContentType(companyInfo.logoFilename);
        companyLogoDataUrl = `data:${mime};base64,${logo.toString('base64')}`;
      } catch {
        companyLogoDataUrl = undefined;
      }
    }

    return {
      titre: data.titre.trim(),
      statutLabel: pvStatutLabelFr(st),
      dateReunionLabel: data.dateReunion
        ? data.dateReunion.toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
        : '—',
      ...(companyInfo.nomEntreprise ? { companyName: companyInfo.nomEntreprise } : {}),
      ...(companyInfo.adresseEntreprise ? { companyAddress: companyInfo.adresseEntreprise } : {}),
      ...(companyInfo.formatEntreprise ? { companyFormat: companyInfo.formatEntreprise } : {}),
      ...(companyInfo.tailleEntreprise ? { companySize: companyInfo.tailleEntreprise } : {}),
      ...(companyLogoDataUrl ? { companyLogoDataUrl } : {}),
      participantUserLines: users.map((u) => `${u.prenom} ${u.nom}`.trim()),
      participantClientLines: cfs.map((c) => `${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})`),
      ...(liensProjets ? { liensProjets } : {}),
      ...(liensTaches ? { liensTaches } : {}),
      ...(liensUserStories ? { liensUserStories } : {}),
      ...(liensEpics ? { liensEpics } : {}),
      bodyHtml,
      generatedAt: new Date(),
    };
  }

  /**
   * Régénère le fichier PDF principal à partir du HTML stocké (PV rédigé dans l’app).
   * Sans contenu HTML, ne fait rien (PV importé uniquement comme fichier).
   */
  private async syncPrincipalPdfFromPvState(pvId: string): Promise<void> {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvId, deletedAt: null },
      include: {
        presentsUser: { select: { userId: true } },
        presentsClientFournisseur: { select: { clientFournisseurId: true } },
      },
    });
    if (!pv?.contenuHtml?.trim()) return;

    const expanded = await expandLiens(parseLiensExplicites(pv.liensExplicites));
    const presentUserIds = pv.presentsUser.map((p) => p.userId);
    const presentClientFournisseurIds = pv.presentsClientFournisseur.map((p) => p.clientFournisseurId);

    const meta = await this.buildPdfMetaForCreate(
      {
        titre: pv.titre,
        statut: pv.statut,
        dateReunion: pv.dateReunion,
        presentUserIds,
        presentClientFournisseurIds,
      },
      expanded,
      pv.contenuHtml
    );
    const buf = await generatePvPdfBuffer(meta);
    const base = buildPvPrincipalFileBaseName(pv.titre, pv.dateReunion);
    const storedName = `${Date.now()}-${uuidv4()}.pdf`;
    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const diskPath = path.join(UPLOAD_DIR, storedName);
    await fs.writeFile(diskPath, buf);

    const doc = await prisma.document.findUnique({
      where: { id: pv.documentId },
      select: { fichierUrl: true },
    });
    const oldUrl = doc?.fichierUrl;
    await prisma.document.update({
      where: { id: pv.documentId },
      data: {
        nom: `${base}.pdf`,
        fichierNomOriginal: `${base}.pdf`,
        fichierUrl: storedName,
        fichierTaille: buf.length,
        fichierType: 'application/pdf',
      },
    });
    if (oldUrl && oldUrl !== storedName) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, oldUrl));
      } catch {
        /* fichier déjà absent ou verrouillé */
      }
    }
  }

  async create(
    userId: string,
    role: string,
    data: {
      titre: string;
      statut?: string | null;
      dateReunion?: Date | null;
      presentUserIds: string[];
      presentClientFournisseurIds: string[];
      liens: LiensExplicites;
      modificationDelegueIds: string[];
      fichier?: Express.Multer.File;
      contenuHtml?: string | null;
    }
  ) {
    const expanded = await expandLiens(data.liens);
    const liensExplicitesStored = data.liens as object;
    const htmlTrim = data.contenuHtml?.trim() || '';

    let fichier = data.fichier;
    if (!fichier) {
      if (!htmlTrim) throw new Error('Fichier du PV ou contenu HTML requis');
      const meta = await this.buildPdfMetaForCreate(data, expanded, htmlTrim);
      const buf = await generatePvPdfBuffer(meta);
      const base = buildPvPrincipalFileBaseName(data.titre, data.dateReunion ?? null);
      const storedName = `${Date.now()}-${uuidv4()}.pdf`;
      await fs.mkdir(UPLOAD_DIR, { recursive: true });
      const diskPath = path.join(UPLOAD_DIR, storedName);
      await fs.writeFile(diskPath, buf);
      fichier = multerFileLike({
        diskPath,
        diskFilename: storedName,
        originalname: `${base}.pdf`,
        mimetype: 'application/pdf',
        size: buf.length,
      });
    }

    const doc = await prisma.document.create({
      data: {
        nom: fichier!.originalname,
        typeDocument: DocType.pv_reunion,
        fichierUrl: fichier!.filename,
        fichierNomOriginal: fichier!.originalname,
        fichierTaille: fichier!.size,
        fichierType: fichier!.mimetype,
        uploadedById: userId,
        estConfidentiel: false,
      },
    });

    const st = normalizePvStatut(data.statut);
    if (data.statut != null && String(data.statut).trim() && !st) {
      throw new Error('Statut PV invalide (brouillon, en_revision, valide, archive)');
    }

    const pv = await prisma.pvReunion.create({
      data: {
        titre: data.titre.trim(),
        statut: st ?? 'brouillon',
        documentId: doc.id,
        dateReunion: data.dateReunion ?? null,
        createdById: userId,
        liensExplicites: liensExplicitesStored as any,
        contenuHtml: htmlTrim || null,
        contenuUpdatedAt: htmlTrim ? new Date() : null,
        presentsUser: {
          create: uniq(data.presentUserIds).map((uid) => ({ userId: uid })),
        },
        presentsClientFournisseur: {
          create: uniq(data.presentClientFournisseurIds).map((clientFournisseurId) => ({
            clientFournisseurId,
          })),
        },
        modificationDelegues: {
          create: uniq(data.modificationDelegueIds)
            .filter((id) => id !== userId)
            .map((uid) => ({ userId: uid })),
        },
      },
      include: { modificationDelegues: { select: { userId: true } } },
    });

    await prisma.document.update({
      where: { id: doc.id },
      data: { referenceType: RefType.pvReunion, referenceId: pv.id },
    });

    await replaceLiens(pv.id, expanded);
    await syncPvPrincipalDocumentLinks(doc.id, expanded);

    await this.syncDeleguesToPermissionRows(
      pv.id,
      uniq(data.modificationDelegueIds),
      userId
    );

    if (htmlTrim) {
      await this.notifyAssignedActionUsers({
        pvId: pv.id,
        pvTitre: pv.titre,
        auteurId: userId,
        previousHtml: '',
        nextHtml: htmlTrim,
      });
    }

    return this.findOne(pv.id, userId, role);
  }

  async update(
    id: string,
    userId: string,
    role: string,
    data: {
      titre?: string;
      statut?: string | null;
      dateReunion?: Date | null;
      presentUserIds?: string[];
      presentClientFournisseurIds?: string[];
      liens?: LiensExplicites;
      modificationDelegueIds?: string[];
      contenuHtml?: string | null;
    }
  ) {
    const existing = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        documentId: true,
        createdById: true,
        liensExplicites: true,
        contenuHtml: true,
        titre: true,
        modificationDelegues: { select: { userId: true } },
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!existing) throw new Error('NOT_FOUND');
    if (!capabilitiesPvReunion(toPvAcl(existing), userId, role).canModify) throw new Error('FORBIDDEN');

    const liensExplicites = data.liens
      ? (data.liens as object)
      : (existing.liensExplicites as object);
    const expanded = data.liens ? await expandLiens(data.liens) : null;

    let statutUpdate: string | undefined;
    if (data.statut !== undefined && data.statut !== null) {
      const st = normalizePvStatut(data.statut);
      if (!st) throw new Error('Statut PV invalide (brouillon, en_revision, valide, archive)');
      statutUpdate = st;
    }

    const previousHtml = existing.contenuHtml || '';
    await prisma.pvReunion.update({
      where: { id },
      data: {
        ...(data.titre != null ? { titre: data.titre.trim() } : {}),
        ...(statutUpdate !== undefined ? { statut: statutUpdate } : {}),
        ...(data.dateReunion !== undefined ? { dateReunion: data.dateReunion } : {}),
        ...(data.liens ? { liensExplicites: liensExplicites as any } : {}),
        ...(data.contenuHtml !== undefined
          ? {
              contenuHtml: data.contenuHtml === null || data.contenuHtml === '' ? null : String(data.contenuHtml),
              contenuUpdatedAt:
                data.contenuHtml === null || data.contenuHtml === '' ? null : new Date(),
            }
          : {}),
      },
    });

    if (data.presentUserIds) {
      await prisma.pvReunionPresentUser.deleteMany({ where: { pvReunionId: id } });
      await prisma.pvReunionPresentUser.createMany({
        data: uniq(data.presentUserIds).map((uid) => ({ pvReunionId: id, userId: uid })),
        skipDuplicates: true,
      });
    }

    if (data.presentClientFournisseurIds) {
      await prisma.pvReunionPresentClientFournisseur.deleteMany({ where: { pvReunionId: id } });
      await prisma.pvReunionPresentClientFournisseur.createMany({
        data: uniq(data.presentClientFournisseurIds).map((clientFournisseurId) => ({
          pvReunionId: id,
          clientFournisseurId,
        })),
        skipDuplicates: true,
      });
    }

    if (data.modificationDelegueIds) {
      const prevDelegueIds = existing.modificationDelegues.map((d) => d.userId);
      await prisma.pvReunionModificationDelegue.deleteMany({ where: { pvReunionId: id } });
      const nextDelegueIds = uniq(data.modificationDelegueIds).filter((uid) => uid !== existing.createdById);
      if (nextDelegueIds.length) {
        await prisma.pvReunionModificationDelegue.createMany({
          data: nextDelegueIds.map((uid) => ({ pvReunionId: id, userId: uid })),
          skipDuplicates: true,
        });
      }
      await this.onDeleguesFormUpdated(id, existing.createdById, prevDelegueIds, data.modificationDelegueIds);
    }

    if (expanded) {
      await replaceLiens(id, expanded);
      await syncPvPrincipalDocumentLinks(existing.documentId, expanded);
    }

    const pdfMetaDirty =
      data.contenuHtml !== undefined ||
      data.titre != null ||
      data.statut !== undefined ||
      data.dateReunion !== undefined ||
      !!data.presentUserIds ||
      !!data.presentClientFournisseurIds ||
      !!data.liens;

    if (pdfMetaDirty) {
      const row = await prisma.pvReunion.findUnique({
        where: { id },
        select: { contenuHtml: true },
      });
      if (row?.contenuHtml?.trim()) {
        await this.syncPrincipalPdfFromPvState(id);
      }
    }

    if (data.contenuHtml !== undefined) {
      const nextHtml =
        data.contenuHtml === null || data.contenuHtml === '' ? '' : String(data.contenuHtml);
      await this.notifyAssignedActionUsers({
        pvId: id,
        pvTitre: data.titre?.trim() || existing.titre,
        auteurId: userId,
        previousHtml,
        nextHtml,
      });
    }

    return this.findOne(id, userId, role);
  }

  async saveContenuBrouillon(id: string, userId: string, role: string, contenuHtml: string) {
    const existing = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        titre: true,
        contenuHtml: true,
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!existing) throw new Error('NOT_FOUND');
    if (!capabilitiesPvReunion(toPvAcl(existing), userId, role).canModify) throw new Error('FORBIDDEN');
    const trimmed = String(contenuHtml || '').trim();
    const previousHtml = existing.contenuHtml || '';
    if (!trimmed) throw new Error('Contenu vide');
    if (trimmed.length > 600_000) throw new Error('Contenu trop volumineux');

    await prisma.$transaction(async (tx) => {
      await tx.pvReunionContenuVersion.create({
        data: {
          id: uuidv4(),
          pvReunionId: id,
          contenuHtml: trimmed,
          createdById: userId,
        },
      });
      await tx.pvReunion.update({
        where: { id },
        data: { contenuHtml: trimmed, contenuUpdatedAt: new Date() },
      });
      const total = await tx.pvReunionContenuVersion.count({ where: { pvReunionId: id } });
      if (total > 40) {
        const oldest = await tx.pvReunionContenuVersion.findMany({
          where: { pvReunionId: id },
          orderBy: { createdAt: 'asc' },
          take: total - 40,
          select: { id: true },
        });
        if (oldest.length) {
          await tx.pvReunionContenuVersion.deleteMany({
            where: { id: { in: oldest.map((o) => o.id) } },
          });
        }
      }
    });

    await this.syncPrincipalPdfFromPvState(id);
    await this.notifyAssignedActionUsers({
      pvId: id,
      pvTitre: existing.titre,
      auteurId: userId,
      previousHtml,
      nextHtml: trimmed,
    });

    return this.findOne(id, userId, role);
  }

  async listContenuVersions(id: string, userId: string, role: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      include: {
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (!canViewPvReunion(toPvAcl(pv), userId, role)) throw new Error('NOT_FOUND');
    const rows = await prisma.pvReunionContenuVersion.findMany({
      where: { pvReunionId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
      select: {
        id: true,
        createdAt: true,
        contenuHtml: true,
        createdBy: { select: { id: true, prenom: true, nom: true } },
      },
    });
    return rows.map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      createdBy: r.createdBy,
      preview: stripHtmlTags(r.contenuHtml).replace(/\s+/g, ' ').trim().slice(0, 280),
    }));
  }

  async getContenuVersion(id: string, versionId: string, userId: string, role: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      include: {
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (!canViewPvReunion(toPvAcl(pv), userId, role)) throw new Error('NOT_FOUND');
    const v = await prisma.pvReunionContenuVersion.findFirst({
      where: { id: versionId, pvReunionId: id },
      include: { createdBy: { select: { id: true, prenom: true, nom: true } } },
    });
    if (!v) throw new Error('NOT_FOUND');
    return v;
  }

  async softDelete(id: string, userId: string, role: string) {
    const existing = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: null },
      include: {
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!existing) throw new Error('NOT_FOUND');
    if (!capabilitiesPvReunion(toPvAcl(existing), userId, role).canDelete) throw new Error('FORBIDDEN');
    await prisma.pvReunion.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  /** PV supprimés visibles par l’utilisateur (admin : tous ; sinon créateur uniquement). */
  async listDeletedForCorbeilleScoped(userId: string, role: string) {
    const where: { deletedAt: { not: null }; createdById?: string } = {
      deletedAt: { not: null },
    };
    if (role !== Role.admin) {
      where.createdById = userId;
    }
    const rows = await prisma.pvReunion.findMany({
      where,
      orderBy: { deletedAt: 'desc' },
      include: {
        document: { select: { id: true, nom: true, fichierNomOriginal: true } },
        createdBy: { select: { id: true, nom: true, prenom: true } },
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    return rows.map((pv) => ({
      ...pv,
      capabilities: capabilitiesPvReunion(toPvAcl(pv), userId, role),
    }));
  }

  async restoreFromCorbeille(id: string, userId: string, role: string) {
    const existing = await prisma.pvReunion.findFirst({
      where: { id, deletedAt: { not: null } },
      include: {
        permissions: { select: { userId: true, niveau: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!existing) throw new Error('NOT_FOUND');
    if (!capabilitiesPvReunion(toPvAcl(existing), userId, role).canDelete) throw new Error('FORBIDDEN');
    await prisma.pvReunion.update({
      where: { id },
      data: { deletedAt: null },
    });
    return this.findOne(id, userId, role);
  }

  async addCommentaire(
    pvId: string,
    auteurId: string,
    role: string,
    contenu: string,
    assigneAId: string | null,
    fichier?: Express.Multer.File
  ) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvId, deletedAt: null },
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        permissions: {
          include: { user: { select: { id: true, email: true, nom: true, prenom: true } } },
        },
        adminSansAcces: { select: { userId: true } },
        modificationDelegues: { include: { user: { select: { id: true, email: true, nom: true, prenom: true } } } },
      },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (!canViewPvReunion(toPvAcl(pv), auteurId, role)) throw new Error('FORBIDDEN');

    let documentId: string | null = null;
    if (fichier) {
      const doc = await prisma.document.create({
        data: {
          nom: fichier.originalname,
          typeDocument: DocType.autre,
          fichierUrl: fichier.filename,
          fichierNomOriginal: fichier.originalname,
          fichierTaille: fichier.size,
          fichierType: fichier.mimetype,
          uploadedById: auteurId,
          estConfidentiel: false,
        },
      });
      documentId = doc.id;
    }

    const c = await prisma.pvReunionCommentaire.create({
      data: {
        pvReunionId: pvId,
        userId: auteurId,
        contenu: contenu.trim(),
        assigneAId: assigneAId || null,
        documentId,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true } },
        assigneUser: { select: { id: true, nom: true, prenom: true } },
        pieceJointe: {
          select: {
            id: true,
            nom: true,
            fichierNomOriginal: true,
            fichierTaille: true,
            fichierType: true,
          },
        },
      },
    });

    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const auteurUser = await prisma.user.findUnique({
      where: { id: auteurId },
      select: { nom: true, prenom: true },
    });
    const auteurNom = auteurUser ? `${auteurUser.prenom} ${auteurUser.nom}` : 'Un utilisateur';

    const destinataires: { id: string; email: string; nom: string }[] = [];
    if (assigneAId) {
      const u = await prisma.user.findUnique({
        where: { id: assigneAId },
        select: { id: true, email: true, nom: true, prenom: true },
      });
      if (!u) {
        throw new Error('Utilisateur assigné introuvable');
      }
      if (u.id !== auteurId) {
        destinataires.push({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` });
      }
    } else {
      if (pv.createdById && pv.createdById !== auteurId) {
        destinataires.push({
          id: pv.createdBy.id,
          email: pv.createdBy.email,
          nom: `${pv.createdBy.prenom} ${pv.createdBy.nom}`,
        });
      }
      for (const d of pv.modificationDelegues) {
        if (d.userId === auteurId) continue;
        if (destinataires.some((x) => x.id === d.userId)) continue;
        destinataires.push({
          id: d.user.id,
          email: d.user.email,
          nom: `${d.user.prenom} ${d.user.nom}`,
        });
      }
      for (const p of pv.permissions) {
        if (p.userId === auteurId) continue;
        if (!['modification', 'suppression'].includes(p.niveau)) continue;
        if (destinataires.some((x) => x.id === p.userId)) continue;
        destinataires.push({
          id: p.user.id,
          email: p.user.email,
          nom: `${p.user.prenom} ${p.user.nom}`,
        });
      }
    }

    if (destinataires.length > 0) {
      const estAssignation = !!(assigneAId && assigneAId !== auteurId);
      this.notificationService
        .notifierCommentairePvReunion({
          pvId,
          pvTitre: pv.titre,
          commentaire: contenu,
          destinataires,
          auteurNom,
          appUrl,
          pieceJointeNom: fichier?.originalname,
          estAssignation,
        })
        .catch((err: unknown) => console.error('[PV] Notification commentaire:', err));
    } else if (assigneAId && assigneAId === auteurId) {
      console.warn('[PV] Commentaire assigné à soi-même: aucune notification envoyée.', {
        pvId,
        auteurId,
        assigneAId,
      });
    }

    // Mentions @Prénom Nom dans les commentaires de PV
    this.notificationService
      .traiterMentions({
        contenu: contenu.trim(),
        auteurId,
        auteurNom,
        appUrl,
        context: { type: 'pvReunion', id: pvId, titre: pv.titre },
      })
      .catch((err: unknown) => console.error('[PV] Mentions commentaire:', err));

    return c;
  }

  async getCommentairePieceDocument(commentaireId: string, userId: string, userRole: string) {
    const com = await prisma.pvReunionCommentaire.findUnique({
      where: { id: commentaireId },
      include: {
        pvReunion: {
          include: {
            permissions: { select: { userId: true, niveau: true } },
            adminSansAcces: { select: { userId: true } },
          },
        },
        pieceJointe: true,
      },
    });
    if (!com?.pieceJointe || com.pvReunion.deletedAt) return null;
    if (!canViewPvReunion(toPvAcl(com.pvReunion as any), userId, userRole)) return null;
    return com.pieceJointe;
  }

  private readonly pvListLinkedSelect = {
    id: true,
    titre: true,
    dateReunion: true,
    createdAt: true,
    createdById: true,
    document: {
      select: { id: true, nom: true, fichierNomOriginal: true },
    },
    createdBy: { select: { id: true, nom: true, prenom: true } },
    permissions: { select: { userId: true, niveau: true } },
    adminSansAcces: { select: { userId: true } },
  } as const;

  private mapLinkedRows(
    rows: Array<{
      id: string;
      titre: string;
      createdById: string;
      permissions: { userId: string; niveau: string }[];
      adminSansAcces: { userId: string }[];
    }>,
    userId: string,
    role: string
  ) {
    return rows
      .filter((pv) => canViewPvReunion(toPvAcl(pv), userId, role))
      .map((pv) => ({
        ...pv,
        capabilities: capabilitiesPvReunion(toPvAcl(pv), userId, role),
      }));
  }

  async listLinkedToProjet(projetId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, projets: { some: { projetId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  async listLinkedToTache(tacheId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, taches: { some: { tacheId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  async listLinkedToUserStory(userStoryId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, userStories: { some: { userStoryId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  async listLinkedToEpic(epicId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, epics: { some: { epicId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  async listLinkedToContrat(contratId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, contrats: { some: { contratId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  async listLinkedToProcessus(processusId: string, userId: string, role: string) {
    const rows = await prisma.pvReunion.findMany({
      where: { deletedAt: null, processus: { some: { processusId } } },
      select: this.pvListLinkedSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.mapLinkedRows(rows, userId, role);
  }

  /** Détail « Accès » — même structure que le contrat (delegations, adminSansAccesUserIds, etc.). */
  async getAccesDetail(pvId: string, userId: string, role: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvId, deletedAt: null },
      include: {
        permissions: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        adminSansAcces: { select: { userId: true } },
        createdBy: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
        modificationDelegues: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        presentsUser: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        presentsClientFournisseur: {
          include: { clientFournisseur: { select: { id: true, nom: true, type: true } } },
        },
        document: { select: { id: true, nom: true, fichierNomOriginal: true } },
      },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (!canViewPvReunion(toPvAcl(pv), userId, role)) throw new Error('FORBIDDEN');

    const admins = await prisma.user.findMany({
      where: { role: Role.admin, statut: UserStatus.actif },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });

    const delegations = pv.permissions.map((p) => ({
      id: p.id,
      permission: p.niveau,
      user: p.user,
      grantedBy: null as null,
      createdAt: p.createdAt,
    }));

    return {
      ficheNom: pv.titre,
      pvId: pv.id,
      admins,
      creator: pv.createdBy,
      delegations,
      canManagePermissions: pv.createdById === userId,
      adminSansAccesUserIds: pv.adminSansAcces.map((x) => x.userId),
      modificationDelegues: pv.modificationDelegues,
      presentsUser: pv.presentsUser,
      presentsClientFournisseur: pv.presentsClientFournisseur,
      document: pv.document,
      visibilityNote:
        'Mêmes règles que pour un contrat : seul le créateur du PV gère les accès partagés. Pour un administrateur, sans ligne dans « Accès partagés » et sans exclusion, l’accès est complet ; une ligne limite ses droits ; « Retirer l’accès » le prive totalement jusqu’à un nouvel accès explicite. Les « présents » restent informatifs (réunion).',
    };
  }

  async addPermission(
    pvReunionId: string,
    targetUserId: string,
    niveau: string,
    actorUserId: string,
    _actorRole: string
  ) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvReunionId, deletedAt: null },
      include: { permissions: true },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (pv.createdById !== actorUserId) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (pv.createdById === targetUserId) throw new Error('Le créateur du PV a déjà tous les droits');

    await prisma.pvReunionAdminSansAcces.deleteMany({
      where: { pvReunionId, userId: targetUserId },
    });

    const row = await prisma.pvReunionPermission.upsert({
      where: { pvReunionId_userId: { pvReunionId, userId: targetUserId } },
      create: { pvReunionId, userId: targetUserId, niveau },
      update: { niveau },
      include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
    });

    if (niveau === 'modification' || niveau === 'suppression') {
      await prisma.pvReunionModificationDelegue.upsert({
        where: { pvReunionId_userId: { pvReunionId, userId: targetUserId } },
        create: { pvReunionId, userId: targetUserId },
        update: {},
      });
    }

    return row;
  }

  async removePermission(pvReunionId: string, targetUserId: string, actorUserId: string, _actorRole: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvReunionId, deletedAt: null },
      include: { permissions: { include: { user: true } } },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (pv.createdById !== actorUserId) throw new Error('FORBIDDEN');
    const perm = pv.permissions.find((p) => p.userId === targetUserId);
    if (!perm) throw new Error('NOT_FOUND');
    await prisma.pvReunionPermission.deleteMany({ where: { pvReunionId, userId: targetUserId } });
    await prisma.pvReunionModificationDelegue.deleteMany({
      where: { pvReunionId, userId: targetUserId },
    });
    await maybeExcludeAdminAfterPermissionRemovedPv(pvReunionId, pv.createdById, targetUserId);
  }

  async removePermissionByEntryId(
    pvReunionId: string,
    permissionEntryId: string,
    actorUserId: string,
    _actorRole: string
  ) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvReunionId, deletedAt: null },
      include: { permissions: true },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (pv.createdById !== actorUserId) throw new Error('FORBIDDEN');
    const perm = await prisma.pvReunionPermission.findFirst({
      where: { id: permissionEntryId, pvReunionId },
      include: { user: { select: { nom: true, prenom: true } } },
    });
    if (!perm) throw new Error('NOT_FOUND');
    await prisma.pvReunionPermission.delete({ where: { id: permissionEntryId } });
    await prisma.pvReunionModificationDelegue.deleteMany({
      where: { pvReunionId, userId: perm.userId },
    });
    await maybeExcludeAdminAfterPermissionRemovedPv(pvReunionId, pv.createdById, perm.userId);
  }

  async blockAdminImplicitAccess(pvReunionId: string, targetUserId: string, actorUserId: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvReunionId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (pv.createdById !== actorUserId) throw new Error('FORBIDDEN');
    if (pv.createdById === targetUserId) throw new Error('Le créateur du PV ne peut pas être exclu');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== Role.admin) {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite au PV");
    }
    await prisma.pvReunionPermission.deleteMany({ where: { pvReunionId, userId: targetUserId } });
    await prisma.pvReunionModificationDelegue.deleteMany({
      where: { pvReunionId, userId: targetUserId },
    });
    await prisma.pvReunionAdminSansAcces.upsert({
      where: { pvReunionId_userId: { pvReunionId, userId: targetUserId } },
      create: { pvReunionId, userId: targetUserId },
      update: {},
    });
  }

  async restoreAdminImplicitAccess(pvReunionId: string, targetUserId: string, actorUserId: string) {
    const pv = await prisma.pvReunion.findFirst({
      where: { id: pvReunionId, deletedAt: null },
      select: { id: true, createdById: true },
    });
    if (!pv) throw new Error('NOT_FOUND');
    if (pv.createdById !== actorUserId) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    await prisma.pvReunionAdminSansAcces.deleteMany({
      where: { pvReunionId, userId: targetUserId },
    });
  }
}

export const pvReunionService = new PvReunionService();
