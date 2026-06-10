import { randomBytes } from 'crypto';
import { prisma } from '../utils/prisma';
import { Prisma } from '../generated/prisma/client';
import { PermissionType } from '../generated/prisma/enums';
import { fetchProjetAdminExcludedByProjetIds, fetchProjetAdminExcludedForUser } from '../utils/resourceAdminSansAcces';
import { TacheService } from './tache.service';
import { NotificationService } from './notification.service';
import {
  getEntiteDescendantIds as listEntiteDescendants,
  getUserDirectEntiteIds,
  keepMostSpecificEntiteIds,
} from '../utils/entiteScope';

const TACHE_TERMINEES = ['termine', 'archive'] as const;
const SCORING_PRODUCTIVITE_WINDOW_DAYS = 30;
const SCORING_WEIGHTS = {
  delais: 0.3,
  workflow: 0.2,
  stabilite: 0.15,
  rework: 0.15,
  flux: 0.1,
} as const;
const SCORING_WEIGHT_TOTAL =
  SCORING_WEIGHTS.delais +
  SCORING_WEIGHTS.workflow +
  SCORING_WEIGHTS.stabilite +
  SCORING_WEIGHTS.rework +
  SCORING_WEIGHTS.flux;

type TaskStatusTransition = { at: Date; from: string; to: string };
type TaskScoringBreakdown = {
  delais: number;
  workflow: number;
  stabilite: number;
  rework: number;
  flux: number;
  final: number;
  transitions: number;
  reouvertures: number;
  completedAt?: string | null;
};

/** Champs scalaires autorisés pour `projet.update` (ignore tout le reste du body client). */
const PROJET_UPDATABLE_SCALAR_KEYS = new Set([
  'nom',
  'codeProjet',
  'description',
  'tags',
  'type',
  'nomClient',
  'statut',
  'priorite',
  'dateFinReelle',
  'budgetPrevu',
  'budgetConsomme',
  'deviseId',
  'responsableId',
  'gestionnaireId',
  'contexte',
  'mission',
  'vision',
  'scopeInclus',
  'scopeExclus',
]);

function pickProjetScalarUpdateData(raw: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of PROJET_UPDATABLE_SCALAR_KEYS) {
    if (key in raw && raw[key] !== undefined) {
      out[key] = raw[key];
    }
  }
  return out;
}

/** Montant budget : chaîne vide / invalide → null ; sinon valeur numérique pour Prisma Decimal. */
function parseBudgetDecimalInput(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim().replace(/\s/g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  if (Number.isNaN(n)) return null;
  return s;
}

async function sanitizeProjetScalarUpdateData(payload: Record<string, unknown>): Promise<Record<string, unknown>> {
  const out = { ...payload };
  if ('budgetPrevu' in out) {
    out.budgetPrevu = parseBudgetDecimalInput(out.budgetPrevu);
  }
  if ('budgetConsomme' in out) {
    out.budgetConsomme = parseBudgetDecimalInput(out.budgetConsomme);
  }
  if ('deviseId' in out) {
    const v = out.deviseId;
    if (v === null || v === '') {
      out.deviseId = null;
    } else {
      const id = String(v).trim();
      const d = await prisma.devise.findUnique({ where: { id }, select: { id: true } });
      if (!d) throw new Error('Devise introuvable');
      out.deviseId = id;
    }
  }
  return out;
}

const projetListInclude = {
  entites: {
    include: { entite: { select: { id: true, nom: true, code: true } } },
  },
  sponsors: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
  chefsProjet: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
  techLeads: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
  equipe: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
  clientsFournisseurs: { include: { clientFournisseur: { include: { typeSociete: true, representants: true } } } },
  devise: { select: { id: true, code: true, libelle: true } },
  responsable: { select: { id: true, nom: true, prenom: true } },
  gestionnaire: { select: { id: true, nom: true, prenom: true } },
  createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
} as const;

export type ProjetAuth = { userId: string; role: string };

function isAdminRole(role: string) {
  return role === 'admin';
}

async function getUserEntiteIds(userId: string): Promise<string[]> {
  const direct = await getUserDirectEntiteIds(userId);
  return keepMostSpecificEntiteIds(direct);
}

async function getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
  return listEntiteDescendants([...new Set(rootIds.filter(Boolean))]);
}

async function getContributeurProjetEntiteScope(userId: string): Promise<Set<string>> {
  const ownEntites = await getUserEntiteIds(userId);
  const scope = await getEntiteDescendantIds(ownEntites);
  return new Set(scope);
}

function projetHasScopedEntite(
  p: { entites?: Array<{ entiteId?: string; entite?: { id?: string } }> },
  scopedEntites: Set<string>
) {
  const ids = (p.entites || [])
    .map((pe: any) => pe.entiteId ?? pe.entite?.id)
    .filter(Boolean);
  return ids.some((id: string) => scopedEntites.has(id));
}

async function myPermTypesForProjet(projetId: string, userId: string): Promise<PermissionType[]> {
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'projet', ressourceId: projetId, userId },
    select: { permission: true },
  });
  return rows.map((r) => r.permission);
}

function isGovernanceMember(
  p: {
    responsableId: string | null;
    gestionnaireId: string | null;
    sponsors?: { userId: string }[] | null;
    chefsProjet?: { userId: string }[] | null;
    techLeads?: { userId: string }[] | null;
    equipe?: { userId: string }[] | null;
  },
  userId: string
) {
  if (p.responsableId === userId || p.gestionnaireId === userId) return true;
  const sponsors = p.sponsors ?? [];
  const chefsProjet = p.chefsProjet ?? [];
  const techLeads = p.techLeads ?? [];
  const equipe = p.equipe ?? [];
  return (
    sponsors.some((s) => s.userId === userId) ||
    chefsProjet.some((c) => c.userId === userId) ||
    techLeads.some((t) => t.userId === userId) ||
    equipe.some((e) => e.userId === userId)
  );
}

function canViewProjet(
  row: { id: string; createdById: string | null },
  auth: ProjetAuth,
  permTypes: PermissionType[],
  gov: boolean,
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (gov) return true;
    if (adminImplicitRefused && (permTypes ?? []).length === 0) return false;
    return true;
  }
  if (row.createdById == null) return true;
  if (row.createdById === auth.userId) return true;
  if (gov) return true;
  return (permTypes ?? []).length > 0;
}

function canModifyProjet(
  row: { createdById: string | null; responsableId: string | null; gestionnaireId: string | null },
  auth: ProjetAuth,
  permTypes: PermissionType[],
  gov: boolean,
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (row.responsableId === auth.userId || row.gestionnaireId === auth.userId) return true;
    if (gov) return true;
    if (adminImplicitRefused) {
      return (permTypes ?? []).some((t) => ['modification', 'suppression', 'gestion'].includes(t));
    }
    return true;
  }
  if (row.createdById === auth.userId) return true;
  if (row.responsableId === auth.userId || row.gestionnaireId === auth.userId) return true;
  if (gov) return true;
  const perms = permTypes ?? [];
  return perms.some((t) => ['modification', 'suppression', 'gestion'].includes(t));
}

function canSoftDeleteProjet(
  row: { createdById: string | null },
  auth: ProjetAuth,
  permTypes: PermissionType[],
  adminImplicitRefused: boolean
) {
  if (isAdminRole(auth.role)) {
    if (row.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return (permTypes ?? []).some((t) => ['suppression', 'gestion'].includes(t));
    }
    return true;
  }
  if (row.createdById === auth.userId) return true;
  const perms = permTypes ?? [];
  return perms.some((t) => ['suppression', 'gestion'].includes(t));
}

/** Utilisateur de référence pour les droits d’accès (créateur enregistré, sinon responsable, sinon gestionnaire). */
function projetAccesOwnerUserId(row: {
  createdById: string | null;
  responsableId?: string | null;
  gestionnaireId?: string | null;
}): string | null {
  if (row.createdById) return row.createdById;
  return row.responsableId ?? row.gestionnaireId ?? null;
}

/** Propriétaire métier des accès ou délégation « gestion » (admin implicite ne gère pas les accès — aligné contrat). */
function canManageProjetPermissions(
  row: { createdById: string | null; responsableId?: string | null; gestionnaireId?: string | null },
  auth: ProjetAuth,
  permTypes: PermissionType[]
) {
  const ownerId = projetAccesOwnerUserId(row);
  if (ownerId === auth.userId) return true;
  return (permTypes ?? []).includes('gestion');
}

function capabilitiesProjet(
  row: {
    id: string;
    createdById: string | null;
    responsableId: string | null;
    gestionnaireId: string | null;
  },
  auth: ProjetAuth,
  permTypes: PermissionType[],
  gov: boolean,
  adminImplicitRefused: boolean
) {
  const view = canViewProjet(row, auth, permTypes, gov, adminImplicitRefused);
  return {
    canView: view,
    canModify: view && canModifyProjet(row, auth, permTypes, gov, adminImplicitRefused),
    canDelete: view && canSoftDeleteProjet(row, auth, permTypes, adminImplicitRefused),
    canManagePermissions: view && canManageProjetPermissions(row, auth, permTypes),
  };
}

async function maybeExcludeAdminAfterProjetPermissionRemoved(
  projetId: string,
  projetAccesOwnerId: string | null,
  targetUserId: string
) {
  if (projetAccesOwnerId && targetUserId === projetAccesOwnerId) return;
  const u = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
  if (u?.role !== 'admin') return;
  const remaining = await prisma.permission.count({
    where: { ressourceType: 'projet', ressourceId: projetId, userId: targetUserId },
  });
  if (remaining > 0) return;
  try {
    await prisma.projetAdminSansAcces.upsert({
      where: { projetId_userId: { projetId, userId: targetUserId } },
      create: { projetId, userId: targetUserId },
      update: {},
    });
  } catch {
    /* table absente */
  }
}

async function loadPermissionsForProjets(projetIds: string[]) {
  if (projetIds.length === 0) return new Map<string, any[]>();
  const rows = await prisma.permission.findMany({
    where: { ressourceType: 'projet', ressourceId: { in: projetIds } },
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

async function enrichTachesEtDocuments(projetIds: string[]) {
  const empty = {
    tacheStats: new Map<string, Record<string, number>>(),
    tachesEnRetard: new Map<string, number>(),
    documentsByProjet: new Map<string, { id: string; nom: string }[]>(),
  };
  if (projetIds.length === 0) return empty;

  const [groupStatut, overdueGroups, docsNested] = await Promise.all([
    prisma.tache.groupBy({
      by: ['projetId', 'statut'],
      where: { projetId: { in: projetIds }, deletedAt: null },
      _count: { _all: true },
    }),
    prisma.tache.groupBy({
      by: ['projetId'],
      where: {
        projetId: { in: projetIds },
        deletedAt: null,
        dateFinApprox: { lt: new Date() },
        statut: { notIn: [...TACHE_TERMINEES] },
      },
      _count: { _all: true },
    }),
    Promise.all(
      projetIds.map((pid) =>
        prisma.document.findMany({
          where: { referenceType: 'projet', referenceId: pid, deletedAt: null },
          select: { id: true, nom: true },
          orderBy: { updatedAt: 'desc' },
          take: 8,
        })
      )
    ),
  ]);

  const tacheStats = new Map<string, Record<string, number>>();
  for (const row of groupStatut) {
    if (!row.projetId) continue;
    const cur = tacheStats.get(row.projetId) ?? {};
    cur[row.statut] = row._count._all;
    tacheStats.set(row.projetId, cur);
  }

  const tachesEnRetard = new Map<string, number>();
  for (const row of overdueGroups) {
    if (row.projetId) tachesEnRetard.set(row.projetId, row._count._all);
  }

  const documentsByProjet = new Map<string, { id: string; nom: string }[]>();
  projetIds.forEach((pid, i) => {
    documentsByProjet.set(pid, docsNested[i].map((d) => ({ id: d.id, nom: d.nom })));
  });

  return { tacheStats, tachesEnRetard, documentsByProjet };
}

function buildAlertesProjet(p: {
  statut: string;
  dateFinPrevue: Date | null;
  tachesEnRetard: number;
}): string[] {
  const alertes: string[] = [];
  const now = Date.now();
  if (p.dateFinPrevue && p.statut !== 'termine') {
    const fin = new Date(p.dateFinPrevue).getTime();
    if (fin < now) {
      alertes.push('Échéance du projet dépassée');
    } else {
      const j = Math.ceil((fin - now) / 86400000);
      if (j <= 14 && j >= 0) {
        alertes.push(`Fin prévue dans ${j} jour${j > 1 ? 's' : ''}`);
      }
    }
  }
  if (p.tachesEnRetard > 0) {
    alertes.push(`${p.tachesEnRetard} tâche${p.tachesEnRetard > 1 ? 's' : ''} en retard`);
  }
  return alertes;
}

function mapProjetListItem(
  p: any,
  auth: ProjetAuth,
  permTypes: PermissionType[],
  perms: any[],
  adminImplicitRefused: boolean,
  adminSansAccesUserIds: string[],
  enrich: {
    tacheStats: Map<string, Record<string, number>>;
    tachesEnRetard: Map<string, number>;
    documentsByProjet: Map<string, { id: string; nom: string }[]>;
  }
) {
  const gov = isGovernanceMember(p, auth.userId);
  const caps = capabilitiesProjet(
    {
      id: p.id,
      createdById: p.createdById,
      responsableId: p.responsableId,
      gestionnaireId: p.gestionnaireId,
    },
    auth,
    permTypes,
    gov,
    adminImplicitRefused
  );

  const stats = enrich.tacheStats.get(p.id) ?? {};
  const totalTaches = Object.values(stats).reduce((a, b) => a + b, 0);
  const terminees = (stats.termine ?? 0) + (stats.archive ?? 0);
  const enRetard = enrich.tachesEnRetard.get(p.id) ?? 0;
  const pctAvancement = totalTaches > 0 ? Math.round((terminees / totalTaches) * 100) : null;

  const alertes = buildAlertesProjet({
    statut: p.statut,
    dateFinPrevue: p.dateFinPrevue,
    tachesEnRetard: enRetard,
  });

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
  const accesDelegations = Array.from(delegMap.values());

  return {
    ...p,
    adminSansAccesUserIds,
    partiesPrenantes: p.partiesPrenantes ? JSON.parse(p.partiesPrenantes) : [],
    kpis: p.kpis ? JSON.parse(p.kpis) : [],
    objectifsStrategiques: p.objectifsStrategiques ? JSON.parse(p.objectifsStrategiques) : [],
    objectifsOperationnels: p.objectifsOperationnels ? JSON.parse(p.objectifsOperationnels) : [],
    sponsorsData: (p.sponsors ?? []).map((s: any) => s.user),
    chefsProjetData: (p.chefsProjet ?? []).map((c: any) => c.user),
    techLeadsData: (p.techLeads ?? []).map((t: any) => t.user),
    equipeData: (p.equipe ?? []).map((e: any) => e.user),
    permissions: perms,
    capabilities: caps,
    accesApercu: { delegations: accesDelegations },
    tachesResume: {
      total: totalTaches,
      parStatut: stats,
      terminees,
      enRetard,
      avancementPct: pctAvancement,
    },
    documentsListe: enrich.documentsByProjet.get(p.id) ?? [],
    alertesProjet: alertes,
  };
}

function clampScore(v: number): number {
  if (!Number.isFinite(v)) return 1;
  if (v < 1) return 1;
  if (v > 5) return 5;
  return Number(v.toFixed(2));
}

function scoreDelais(task: any, completedAt: Date | null): number {
  if (!task?.dateFinApprox) return 3;
  const due = new Date(task.dateFinApprox);
  const ref = completedAt || new Date();
  const deltaDays = Math.floor((ref.getTime() - due.getTime()) / (1000 * 3600 * 24));
  if (deltaDays <= 0) return 5;
  if (deltaDays <= 2) return 4;
  if (deltaDays <= 7) return 3;
  if (deltaDays <= 14) return 2;
  return 1;
}

function scoreWorkflow(task: any, transitions: TaskStatusTransition[], now: Date): number {
  const startedAt = task?.dateDebut ? new Date(task.dateDebut) : new Date(task?.createdAt || now);
  let total = Math.max(1, now.getTime() - startedAt.getTime());
  let blockedOrWaiting = 0;
  let currentStatus = task?.statut || 'cree';
  let cursor = startedAt;

  for (const tr of transitions) {
    if (tr.at < cursor) continue;
    const dt = tr.at.getTime() - cursor.getTime();
    if (currentStatus === 'bloque' || currentStatus === 'en_attente') blockedOrWaiting += Math.max(0, dt);
    total += Math.max(0, dt);
    currentStatus = tr.to;
    cursor = tr.at;
  }
  const tail = Math.max(0, now.getTime() - cursor.getTime());
  if (currentStatus === 'bloque' || currentStatus === 'en_attente') blockedOrWaiting += tail;
  total += tail;

  const ratio = blockedOrWaiting / Math.max(1, total);
  if (ratio <= 0.05) return 5;
  if (ratio <= 0.15) return 4;
  if (ratio <= 0.3) return 3;
  if (ratio <= 0.5) return 2;
  return 1;
}

function scoreStabilite(transitionsCount: number): number {
  if (transitionsCount <= 1) return 5;
  if (transitionsCount === 2) return 4;
  if (transitionsCount <= 4) return 3;
  if (transitionsCount <= 6) return 2;
  return 1;
}

function scoreRework(reopenCount: number): number {
  if (reopenCount === 0) return 5;
  if (reopenCount === 1) return 3;
  if (reopenCount === 2) return 2;
  return 1;
}

const ALLOWED_FLOW: Record<string, Set<string>> = {
  cree: new Set(['a_faire', 'en_cours', 'en_attente', 'bloque', 'archive']),
  a_faire: new Set(['en_cours', 'en_attente', 'bloque', 'termine', 'archive']),
  en_cours: new Set(['en_attente', 'bloque', 'termine', 'archive']),
  en_attente: new Set(['en_cours', 'bloque', 'archive']),
  bloque: new Set(['en_cours', 'en_attente', 'archive']),
  termine: new Set(['archive', 'en_cours']),
  archive: new Set([]),
};

function scoreFlux(transitions: TaskStatusTransition[]): number {
  if (transitions.length === 0) return 4;
  let invalid = 0;
  for (const tr of transitions) {
    const allowed = ALLOWED_FLOW[tr.from] || new Set<string>();
    if (!allowed.has(tr.to)) invalid++;
  }
  const ratio = invalid / transitions.length;
  if (ratio === 0) return 5;
  if (ratio <= 0.15) return 4;
  if (ratio <= 0.3) return 3;
  if (ratio <= 0.5) return 2;
  return 1;
}

function extractStatusTransitions(historyRows: any[]): TaskStatusTransition[] {
  const out: TaskStatusTransition[] = [];
  for (const row of historyRows) {
    const details = (row?.details || {}) as any;
    const ts = row?.timestamp ? new Date(row.timestamp) : null;
    if (!ts) continue;

    const directFrom = typeof details?.ancienStatut === 'string' ? details.ancienStatut : null;
    const directTo = typeof details?.nouveauStatut === 'string' ? details.nouveauStatut : null;
    if (directFrom && directTo) {
      out.push({ at: ts, from: directFrom, to: directTo });
      continue;
    }

    const mods = Array.isArray(details?.modifications) ? details.modifications : [];
    for (const m of mods) {
      if (m?.champ !== 'statut') continue;
      if (typeof m?.avant !== 'string' || typeof m?.apres !== 'string') continue;
      out.push({ at: ts, from: m.avant, to: m.apres });
    }
  }
  out.sort((a, b) => a.at.getTime() - b.at.getTime());
  return out;
}

export class ProjetService {
  private notificationService = new NotificationService();

  private buildProjetAssignmentMap(data: {
    responsableId?: string | null;
    gestionnaireId?: string | null;
    sponsorIds?: string[];
    chefProjetIds?: string[];
    techLeadIds?: string[];
    equipeIds?: string[];
  }): Map<string, Set<string>> {
    const map = new Map<string, Set<string>>();
    const add = (userId: string | null | undefined, roleLabel: string) => {
      if (!userId) return;
      const cur = map.get(userId) || new Set<string>();
      cur.add(roleLabel);
      map.set(userId, cur);
    };
    add(data.responsableId, 'Responsable');
    add(data.gestionnaireId, 'Gestionnaire');
    for (const id of data.sponsorIds || []) add(id, 'Sponsor');
    for (const id of data.chefProjetIds || []) add(id, 'Chef de projet');
    for (const id of data.techLeadIds || []) add(id, 'Tech lead');
    for (const id of data.equipeIds || []) add(id, 'Équipe projet');
    return map;
  }

  private async notifyProjetAssignmentsDelta(params: {
    projetId: string;
    projetNom: string;
    actorId: string;
    prevMap: Map<string, Set<string>>;
    nextMap: Map<string, Set<string>>;
  }) {
    const appUrl = process.env.FRONTEND_URL || 'http://localhost:5173';
    const actor = await prisma.user.findUnique({
      where: { id: params.actorId },
      select: { nom: true, prenom: true },
    });
    const auteurNom = actor ? `${actor.prenom} ${actor.nom}` : 'Un utilisateur';

    const targets: Array<{ userId: string; roles: string[] }> = [];
    for (const [userId, nextRoles] of params.nextMap.entries()) {
      if (userId === params.actorId) continue;
      const prevRoles = params.prevMap.get(userId) || new Set<string>();
      const addedRoles = [...nextRoles].filter((r) => !prevRoles.has(r));
      if (addedRoles.length > 0) targets.push({ userId, roles: addedRoles });
    }
    if (targets.length === 0) return;

    const users = await prisma.user.findMany({
      where: { id: { in: targets.map((t) => t.userId) } },
      select: { id: true, email: true, nom: true, prenom: true },
    });
    const userMap = new Map(users.map((u) => [u.id, u]));

    await Promise.all(
      targets.map(async (t) => {
        const u = userMap.get(t.userId);
        if (!u) return;
        await this.notificationService.notifierAssignationProjet({
          projetId: params.projetId,
          projetNom: params.projetNom,
          assigneUserId: u.id,
          assigneEmail: u.email,
          assigneNom: `${u.prenom} ${u.nom}`,
          auteurNom,
          appUrl,
          roles: t.roles,
        });
      })
    );
  }

  private async collectDerivedProjetIntervenantUserIds(
    tx: Prisma.TransactionClient,
    projetId: string
  ): Promise<string[]> {
    const rows = await tx.tache.findMany({
      where: {
        deletedAt: null,
        OR: [
          { projetId },
          { userStory: { is: { epic: { is: { projetId, deletedAt: null } }, deletedAt: null } } },
        ],
      },
      select: {
        assignesUtilisateurs: { select: { userId: true } },
      },
    });
    const ids = new Set<string>();
    for (const t of rows) {
      for (const au of t.assignesUtilisateurs || []) {
        if (au.userId) ids.add(au.userId);
      }
    }
    return [...ids];
  }

  private async syncDerivedGovernanceAndEntites(tx: Prisma.TransactionClient, projetId: string): Promise<void> {
    const projet = await tx.projet.findUnique({
      where: { id: projetId },
      select: {
        id: true,
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
    });
    if (!projet) return;

    // 1) Intervenants auto depuis les tâches du projet (directes ou via userStory->epic)
    const derivedTaskUsers = await this.collectDerivedProjetIntervenantUserIds(tx, projetId);
    if (derivedTaskUsers.length > 0) {
      const existingEquipe = new Set((projet.equipe || []).map((e) => e.userId));
      const toAddEquipe = derivedTaskUsers.filter((uid) => !existingEquipe.has(uid));
      if (toAddEquipe.length > 0) {
        await tx.projetEquipe.createMany({
          data: toAddEquipe.map((userId) => ({ projetId, userId })),
          skipDuplicates: true,
        });
      }
    }

    // 2) Déduire les entités depuis tous les utilisateurs de gouvernance/intervenants
    const allGovUserIds = new Set<string>([
      ...(projet.sponsors || []).map((x) => x.userId),
      ...(projet.chefsProjet || []).map((x) => x.userId),
      ...(projet.techLeads || []).map((x) => x.userId),
      ...(projet.equipe || []).map((x) => x.userId),
      ...derivedTaskUsers,
    ]);
    const govIds = [...allGovUserIds];
    if (govIds.length === 0) return;

    const userEntites = await tx.userEntite.findMany({
      where: { userId: { in: govIds } },
      select: { entiteId: true },
    });
    const entiteIds = [...new Set(userEntites.map((x) => x.entiteId).filter(Boolean))];
    if (entiteIds.length === 0) return;

    await tx.projetEntite.createMany({
      data: entiteIds.map((entiteId) => ({ projetId, entiteId })),
      skipDuplicates: true,
    });
  }

  private async ensureCodeProjet(userCode: string | undefined): Promise<string> {
    const trimmed = typeof userCode === 'string' ? userCode.trim() : '';
    if (trimmed) return trimmed;
    for (let i = 0; i < 12; i++) {
      const code = `PRJ-${Date.now()}-${randomBytes(2).toString('hex')}`.toUpperCase();
      const exists = await prisma.projet.findFirst({
        where: { codeProjet: code },
        select: { id: true },
      });
      if (!exists) return code;
    }
    return `PRJ-${randomBytes(6).toString('hex')}`.toUpperCase();
  }

  async findAll(
    filters: {
      statut?: string;
      entiteId?: string;
      search?: string;
      sortBy?: string;
      sortOrder?: 'asc' | 'desc';
      priorite?: string;
      type?: string;
      /** ISO date (yyyy-mm-dd) : début de la période filtre (chevauchement avec la fenêtre projet dateDebut–dateFinPrevue). */
      periodeDebut?: string;
      /** ISO date (yyyy-mm-dd) : fin de la période filtre. */
      periodeFin?: string;
    },
    auth: ProjetAuth
  ) {
    const isContributeur = auth.role === 'contributeur';
    const contributeurEntiteScope = isContributeur
      ? await getContributeurProjetEntiteScope(auth.userId)
      : new Set<string>();
    const where: any = { deletedAt: null };
    if (filters?.statut) where.statut = filters.statut;
    if (filters?.priorite) where.priorite = filters.priorite;
    if (filters?.type) where.type = filters.type;
    if (filters?.entiteId) {
      where.entites = { some: { entiteId: filters.entiteId } };
    }
    if (filters?.search) {
      where.OR = [
        { nom: { contains: filters.search, mode: 'insensitive' } },
        { codeProjet: { contains: filters.search, mode: 'insensitive' } },
        { description: { contains: filters.search, mode: 'insensitive' } },
      ];
    }

    const periodeDebut = filters?.periodeDebut?.trim();
    const periodeFin = filters?.periodeFin?.trim();
    const dateClauses: object[] = [];
    if (periodeDebut) {
      const start = new Date(`${periodeDebut}T00:00:00.000Z`);
      if (!Number.isNaN(start.getTime())) {
        dateClauses.push({
          OR: [{ dateFinPrevue: { gte: start } }, { dateFinPrevue: null }],
        });
      }
    }
    if (periodeFin) {
      const end = new Date(`${periodeFin}T23:59:59.999Z`);
      if (!Number.isNaN(end.getTime())) {
        dateClauses.push({
          OR: [{ dateDebut: { lte: end } }, { dateDebut: null }],
        });
      }
    }
    if (dateClauses.length) {
      where.AND = [...(where.AND ?? []), ...dateClauses];
    }

    let orderBy: any = { updatedAt: 'desc' };
    if (filters?.sortBy) {
      const sortOrder = filters.sortOrder || 'asc';
      const sortableFields = ['codeProjet', 'nom', 'statut', 'priorite', 'createdAt', 'updatedAt'];
      if (sortableFields.includes(filters.sortBy)) {
        orderBy = { [filters.sortBy]: sortOrder };
      }
    }

    const projetList = await prisma.projet.findMany({
      where,
      include: projetListInclude,
      orderBy,
    });

    const permMap = await loadPermissionsForProjets(projetList.map((p) => p.id));
    const adminExcludedForViewer = await fetchProjetAdminExcludedForUser(
      auth.userId,
      projetList.map((p) => p.id)
    );
    const visible = projetList.filter((p) => {
      const perms = permMap.get(p.id) ?? [];
      const permTypes = perms.map((x: any) => x.permission as PermissionType);
      const gov = isGovernanceMember(p, auth.userId);
      if (isContributeur) {
        return gov || permTypes.length > 0 || projetHasScopedEntite(p as any, contributeurEntiteScope);
      }
      return canViewProjet(
        { id: p.id, createdById: p.createdById },
        auth,
        permTypes,
        gov,
        adminExcludedForViewer.has(p.id)
      );
    });

    const enrich = await enrichTachesEtDocuments(visible.map((p) => p.id));
    const adminExclAll = await fetchProjetAdminExcludedByProjetIds(visible.map((p) => p.id));

    return visible.map((p) => {
      const perms = permMap.get(p.id) ?? [];
      const permTypes = perms.map((x: any) => x.permission as PermissionType);
      return mapProjetListItem(
        p,
        auth,
        permTypes,
        perms,
        adminExcludedForViewer.has(p.id),
        adminExclAll.get(p.id) ?? [],
        enrich
      );
    });
  }

  async getConsultationCount(id: string): Promise<number> {
    return prisma.journalAcces.count({
      where: { ressourceType: 'projet', ressourceId: id, action: 'lecture' },
    });
  }

  /** Même logique que la visibilité du détail projet (liste / findOne). */
  async canAccess(
    projetId: string,
    userId: string,
    userRole: string
  ): Promise<{ canAccess: boolean; reason?: string }> {
    const projet = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        entites: { select: { entiteId: true } },
        responsableId: true,
        gestionnaireId: true,
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
    });
    if (!projet) {
      return { canAccess: false, reason: 'Projet non trouvé' };
    }
    const permTypes = await myPermTypesForProjet(projetId, userId);
    const gov = isGovernanceMember(projet as any, userId);
    if (userRole === 'contributeur') {
      const scope = await getContributeurProjetEntiteScope(userId);
      const entityScoped = projetHasScopedEntite(projet as any, scope);
      if (!gov && permTypes.length === 0 && !entityScoped) {
        return { canAccess: false, reason: 'Accès refusé à ce projet' };
      }
    }
    const adminExcl = await fetchProjetAdminExcludedForUser(userId, [projet.id]);
    const ok = canViewProjet(
      { id: projet.id, createdById: projet.createdById },
      { userId, role: userRole },
      permTypes,
      gov,
      adminExcl.has(projet.id)
    );
    if (!ok) {
      return { canAccess: false, reason: 'Accès refusé à ce projet' };
    }
    return { canAccess: true };
  }

  async findOne(id: string, auth: ProjetAuth) {
    const projet = await prisma.projet.findFirst({
      where: { id, deletedAt: null },
      include: projetListInclude,
    });

    if (!projet) return null;

    const perms = (await loadPermissionsForProjets([id])).get(id) ?? [];
    const permTypes = perms.map((x: any) => x.permission as PermissionType);
    const gov = isGovernanceMember(projet, auth.userId);
    if (auth.role === 'contributeur') {
      const scope = await getContributeurProjetEntiteScope(auth.userId);
      const entityScoped = projetHasScopedEntite(projet as any, scope);
      if (!gov && permTypes.length === 0 && !entityScoped) return null;
    }
    const adminExclViewer = await fetchProjetAdminExcludedForUser(auth.userId, [id]);
    const adminImplicitRefused = adminExclViewer.has(id);
    if (!canViewProjet({ id: projet.id, createdById: projet.createdById }, auth, permTypes, gov, adminImplicitRefused)) {
      return null;
    }

    const enrich = await enrichTachesEtDocuments([id]);
    const adminExclAll = await fetchProjetAdminExcludedByProjetIds([id]);
    return mapProjetListItem(
      projet,
      auth,
      permTypes,
      perms,
      adminImplicitRefused,
      adminExclAll.get(id) ?? [],
      enrich
    );
  }

  async getProjetScoring(id: string, auth: ProjetAuth) {
    const access = await this.canAccess(id, auth.userId, auth.role);
    if (!access.canAccess) throw new Error(access.reason === 'Projet non trouvé' ? 'NOT_FOUND' : 'FORBIDDEN');

    const tacheService = new TacheService();
    const tasks = await tacheService.findAll({ projetId: id, requesterId: auth.userId, requesterRole: auth.role as any });
    const taskIds = tasks.map((t: any) => t.id).filter(Boolean);
    const historyRows = taskIds.length
      ? await prisma.journalAcces.findMany({
          where: {
            ressourceType: 'tache',
            ressourceId: { in: taskIds },
          },
          select: { ressourceId: true, timestamp: true, details: true, action: true },
          orderBy: { timestamp: 'asc' },
        })
      : [];
    const historyByTask = new Map<string, any[]>();
    for (const h of historyRows) {
      const k = h.ressourceId || '';
      if (!k) continue;
      if (!historyByTask.has(k)) historyByTask.set(k, []);
      historyByTask.get(k)!.push(h);
    }

    const now = new Date();
    const taskScores: Array<{
      id: string;
      nom: string;
      statut: string;
      assignes: Array<{ id: string; nom: string; prenom: string }>;
      entites: Array<{ id: string; nom: string; code?: string | null }>;
      scoring: TaskScoringBreakdown;
    }> = [];

    const userAgg = new Map<string, {
      user: { id: string; nom: string; prenom: string };
      scores: number[];
      completedInWindow: number;
      assignedCount: number;
    }>();

    for (const task of tasks as any[]) {
      const transitions = extractStatusTransitions(historyByTask.get(task.id) || []);
      const completedTransition = transitions.find((tr) => tr.to === 'termine');
      const completedAt = completedTransition?.at || (task.statut === 'termine' || task.statut === 'archive' ? new Date(task.updatedAt || task.createdAt || now) : null);
      const reouvertures = transitions.filter((tr) => tr.from === 'termine' && tr.to !== 'termine' && tr.to !== 'archive').length;
      const sDelais = scoreDelais(task, completedAt);
      const sWorkflow = scoreWorkflow(task, transitions, now);
      const sStabilite = scoreStabilite(transitions.length);
      const sRework = scoreRework(reouvertures);
      const sFlux = scoreFlux(transitions);
      const finalScore = clampScore(
        (sDelais * SCORING_WEIGHTS.delais +
          sWorkflow * SCORING_WEIGHTS.workflow +
          sStabilite * SCORING_WEIGHTS.stabilite +
          sRework * SCORING_WEIGHTS.rework +
          sFlux * SCORING_WEIGHTS.flux) / SCORING_WEIGHT_TOTAL
      );

      const scoring: TaskScoringBreakdown = {
        delais: sDelais,
        workflow: sWorkflow,
        stabilite: sStabilite,
        rework: sRework,
        flux: sFlux,
        final: finalScore,
        transitions: transitions.length,
        reouvertures,
        completedAt: completedAt ? completedAt.toISOString() : null,
      };
      const assignes = (task.assignesUtilisateurs || []).map((u: any) => ({ id: u.id, nom: u.nom, prenom: u.prenom }));
      const entites = (task.assignesEntites || []).map((e: any) => ({ id: e.id, nom: e.nom, code: e.code ?? null }));
      taskScores.push({
        id: task.id,
        nom: task.nom,
        statut: task.statut,
        assignes,
        entites,
        scoring,
      });

      for (const u of assignes) {
        if (!userAgg.has(u.id)) {
          userAgg.set(u.id, { user: u, scores: [], completedInWindow: 0, assignedCount: 0 });
        }
        const row = userAgg.get(u.id)!;
        row.scores.push(finalScore);
        row.assignedCount += 1;
        if (completedAt) {
          const ageDays = Math.floor((now.getTime() - completedAt.getTime()) / (1000 * 3600 * 24));
          if (ageDays <= SCORING_PRODUCTIVITE_WINDOW_DAYS) row.completedInWindow += 1;
        }
      }
    }

    const userScores = Array.from(userAgg.values()).map((entry) => {
      const avgTasks = entry.scores.length > 0
        ? entry.scores.reduce((a, b) => a + b, 0) / entry.scores.length
        : 1;
      const completed = entry.completedInWindow;
      const productivityScore =
        completed >= 10 ? 5 : completed >= 6 ? 4 : completed >= 3 ? 3 : completed >= 1 ? 2 : 1;
      const final = clampScore(avgTasks * 0.9 + productivityScore * 0.1);
      return {
        user: entry.user,
        scores: {
          moyenneTaches: clampScore(avgTasks),
          productivite: productivityScore,
          final,
        },
        metrics: {
          tachesAssignees: entry.assignedCount,
          tachesTermineesPeriode: completed,
          periodeJours: SCORING_PRODUCTIVITE_WINDOW_DAYS,
        },
      };
    });

    const entityAgg = new Map<string, { entite: { id: string; nom: string; code?: string | null }; userScores: number[] }>();
    for (const task of taskScores) {
      for (const ent of task.entites) {
        if (!entityAgg.has(ent.id)) entityAgg.set(ent.id, { entite: ent, userScores: [] });
      }
      for (const asg of task.assignes) {
        const us = userScores.find((u) => u.user.id === asg.id);
        if (!us) continue;
        for (const ent of task.entites) {
          entityAgg.get(ent.id)?.userScores.push(us.scores.final);
        }
      }
    }
    const entityScores = Array.from(entityAgg.values()).map((e) => ({
      entite: e.entite,
      scores: {
        final: clampScore(
          e.userScores.length > 0 ? e.userScores.reduce((a, b) => a + b, 0) / e.userScores.length : 1
        ),
      },
      metrics: { utilisateursPrisEnCompte: e.userScores.length },
    }));

    return {
      meta: {
        projetId: id,
        generatedAt: now.toISOString(),
        totalTaches: taskScores.length,
        totalUtilisateurs: userScores.length,
        totalEntites: entityScores.length,
      },
      settings: {
        weights: SCORING_WEIGHTS,
        productivityWindowDays: SCORING_PRODUCTIVITE_WINDOW_DAYS,
      },
      taskScores: taskScores.sort((a, b) => b.scoring.final - a.scoring.final),
      userScores: userScores.sort((a, b) => b.scores.final - a.scores.final),
      entityScores: entityScores.sort((a, b) => b.scores.final - a.scores.final),
    };
  }

  async getAccesDetail(projetId: string, auth: ProjetAuth) {
    const p = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: {
        id: true,
        nom: true,
        createdById: true,
        responsableId: true,
        gestionnaireId: true,
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
    });
    if (!p) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProjet(projetId, auth.userId);
    const gov = isGovernanceMember(p as any, auth.userId);
    const adminExclViewer = await fetchProjetAdminExcludedForUser(auth.userId, [projetId]);
    if (!canViewProjet({ id: p.id, createdById: p.createdById }, auth, permTypes, gov, adminExclViewer.has(projetId))) {
      throw new Error('FORBIDDEN');
    }

    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true, role: true },
      orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
    });
    const ownerId = projetAccesOwnerUserId(p);
    const creator = ownerId
      ? await prisma.user.findUnique({
          where: { id: ownerId },
          select: { id: true, nom: true, prenom: true, email: true, role: true },
        })
      : null;

    const raw = await prisma.permission.findMany({
      where: { ressourceType: 'projet', ressourceId: projetId },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true, role: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { createdAt: 'asc' },
    });

    let adminSansAccesUserIds: string[] = [];
    try {
      adminSansAccesUserIds = (
        await prisma.projetAdminSansAcces.findMany({
          where: { projetId },
          select: { userId: true },
        })
      ).map((x) => x.userId);
    } catch {
      /* table absente */
    }

    return {
      ficheNom: p.nom,
      admins,
      creator,
      delegations: raw.map((r) => ({
        id: r.id,
        permission: r.permission,
        user: r.user,
        grantedBy: r.grantedBy,
        createdAt: r.createdAt,
      })),
      canManagePermissions: canManageProjetPermissions(
        { createdById: p.createdById, responsableId: p.responsableId, gestionnaireId: p.gestionnaireId },
        auth,
        permTypes
      ),
      adminSansAccesUserIds,
    };
  }

  async addPermission(projetId: string, targetUserId: string, permission: PermissionType, auth: ProjetAuth) {
    const p = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: { createdById: true, responsableId: true, gestionnaireId: true },
    });
    if (!p) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProjet(projetId, auth.userId);
    if (!canManageProjetPermissions(p, auth, permTypes)) throw new Error('FORBIDDEN');

    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { id: true, role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    const ownerId = projetAccesOwnerUserId(p);
    if (ownerId === targetUserId) throw new Error('Le créateur du projet a déjà tous les droits');

    try {
      await prisma.projetAdminSansAcces.deleteMany({ where: { projetId, userId: targetUserId } });
    } catch {
      /* table absente */
    }

    return prisma.permission.create({
      data: {
        userId: targetUserId,
        ressourceType: 'projet',
        ressourceId: projetId,
        permission,
        grantedById: auth.userId,
      },
      include: {
        user: { select: { id: true, nom: true, prenom: true, email: true } },
        grantedBy: { select: { id: true, nom: true, prenom: true } },
      },
    });
  }

  async removePermission(projetId: string, permissionId: string, auth: ProjetAuth) {
    const p = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: { createdById: true, responsableId: true, gestionnaireId: true },
    });
    if (!p) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProjet(projetId, auth.userId);
    if (!canManageProjetPermissions(p, auth, permTypes)) throw new Error('FORBIDDEN');

    const perm = await prisma.permission.findFirst({
      where: { id: permissionId, ressourceType: 'projet', ressourceId: projetId },
    });
    if (!perm) throw new Error('NOT_FOUND');
    const targetUserId = perm.userId;
    await prisma.permission.delete({ where: { id: permissionId } });
    await maybeExcludeAdminAfterProjetPermissionRemoved(projetId, projetAccesOwnerUserId(p), targetUserId);
  }

  async blockAdminImplicitAccess(projetId: string, targetUserId: string, auth: ProjetAuth) {
    const p = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: { createdById: true, responsableId: true, gestionnaireId: true },
    });
    if (!p) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProjet(projetId, auth.userId);
    if (!canManageProjetPermissions(p, auth, permTypes)) throw new Error('FORBIDDEN');
    const ownerId = projetAccesOwnerUserId(p);
    if (ownerId === targetUserId) throw new Error('Le créateur du projet ne peut pas être exclu');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { role: true, nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    if (target.role !== 'admin') {
      throw new Error("Seuls les comptes administrateur peuvent être privés de l'accès implicite au projet");
    }
    await prisma.permission.deleteMany({
      where: { ressourceType: 'projet', ressourceId: projetId, userId: targetUserId },
    });
    try {
      await prisma.projetAdminSansAcces.upsert({
        where: { projetId_userId: { projetId, userId: targetUserId } },
        create: { projetId, userId: targetUserId },
        update: {},
      });
    } catch {
      throw new Error(
        "Impossible d'enregistrer l'exclusion admin : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async restoreAdminImplicitAccess(projetId: string, targetUserId: string, auth: ProjetAuth) {
    const p = await prisma.projet.findFirst({
      where: { id: projetId, deletedAt: null },
      select: { createdById: true, responsableId: true, gestionnaireId: true },
    });
    if (!p) throw new Error('NOT_FOUND');
    const permTypes = await myPermTypesForProjet(projetId, auth.userId);
    if (!canManageProjetPermissions(p, auth, permTypes)) throw new Error('FORBIDDEN');
    const target = await prisma.user.findUnique({
      where: { id: targetUserId },
      select: { nom: true, prenom: true },
    });
    if (!target) throw new Error('Utilisateur introuvable');
    try {
      await prisma.projetAdminSansAcces.deleteMany({ where: { projetId, userId: targetUserId } });
    } catch {
      throw new Error(
        "Impossible de restaurer l'accès : table absente. Exécutez « prisma migrate deploy » sur l'API."
      );
    }
  }

  async softDelete(id: string, auth: ProjetAuth) {
    const existing = await prisma.projet.findFirst({ where: { id, deletedAt: null } });
    if (!existing) throw new Error('Projet non trouvé');
    const permTypes = await myPermTypesForProjet(id, auth.userId);
    const adminExcl = await fetchProjetAdminExcludedForUser(auth.userId, [id]);
    if (!canSoftDeleteProjet({ createdById: existing.createdById }, auth, permTypes, adminExcl.has(id))) {
      throw new Error('Accès refusé');
    }
    await prisma.projet.update({ where: { id }, data: { deletedAt: new Date() } });
  }

  async restoreFromCorbeille(id: string) {
    const row = await prisma.projet.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new Error('Élément introuvable ou non en corbeille');
    return prisma.projet.update({
      where: { id },
      data: { deletedAt: null },
      include: projetListInclude,
    });
  }

  async deletePermanent(id: string) {
    const row = await prisma.projet.findFirst({ where: { id, deletedAt: { not: null } } });
    if (!row) throw new Error('Élément introuvable ou non en corbeille');
    await prisma.permission.deleteMany({ where: { ressourceType: 'projet', ressourceId: id } });
    try {
      await prisma.projetAdminSansAcces.deleteMany({ where: { projetId: id } });
    } catch {
      /* table absente */
    }
    return prisma.projet.delete({ where: { id } });
  }

  async listDeletedForCorbeille() {
    return prisma.projet.findMany({
      where: { deletedAt: { not: null } },
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        responsable: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  /** Corbeille projets : tout pour l’admin, sinon uniquement les projets créés par l’utilisateur (aligné licences). */
  async listDeletedForCorbeilleScoped(auth: ProjetAuth) {
    const where: any = { deletedAt: { not: null } };
    if (!isAdminRole(auth.role)) {
      where.createdById = auth.userId;
    }
    return prisma.projet.findMany({
      where,
      include: {
        createdBy: { select: { id: true, nom: true, prenom: true, email: true } },
        responsable: { select: { id: true, nom: true, prenom: true } },
      },
      orderBy: { deletedAt: 'desc' },
    });
  }

  async create(
    data: {
      nom: string;
      codeProjet?: string;
      description?: string;
      tags?: string[];
      entiteIds?: string[];
      type?: string;
      nomClient?: string;
      statut?: string;
      priorite?: string;
      responsableId?: string;
      gestionnaireId?: string;
      dateDebut?: string;
      dateFinPrevue?: string;
      budgetPrevu?: string | number | null;
      budgetConsomme?: string | number | null;
      deviseId?: string | null;
      contexte?: string;
      mission?: string;
      vision?: string;
      scopeInclus?: string;
      scopeExclus?: string;
      sponsorIds?: string[];
      chefProjetIds?: string[];
      techLeadIds?: string[];
      equipeIds?: string[];
      partiesPrenantes?: any[];
      kpis?: string[];
      objectifsStrategiques?: string[];
      objectifsOperationnels?: string[];
      clientFournisseurId?: string;
    },
    auth: ProjetAuth
  ) {
    const {
      entiteIds,
      sponsorIds,
      chefProjetIds,
      techLeadIds,
      equipeIds,
      partiesPrenantes,
      kpis,
      objectifsStrategiques,
      objectifsOperationnels,
      dateDebut,
      dateFinPrevue,
      codeProjet: rawCodeProjet,
      clientFournisseurId,
      budgetPrevu,
      budgetConsomme,
      deviseId,
      ...projetData
    } = data;

    const codeProjet = await this.ensureCodeProjet(rawCodeProjet);

    let resolvedDeviseId: string | null | undefined;
    if (deviseId === undefined) {
      resolvedDeviseId = undefined;
    } else if (deviseId === null || deviseId === '') {
      resolvedDeviseId = null;
    } else {
      const id = String(deviseId).trim();
      const d = await prisma.devise.findUnique({ where: { id }, select: { id: true } });
      if (!d) throw new Error('Devise introuvable');
      resolvedDeviseId = id;
    }

    const budgetPrevuVal =
      budgetPrevu === undefined ? undefined : parseBudgetDecimalInput(budgetPrevu);
    const budgetConsommeVal =
      budgetConsomme === undefined ? undefined : parseBudgetDecimalInput(budgetConsomme);

    let nomClient = projetData.nomClient;
    if (clientFournisseurId) {
      const cf = await prisma.clientFournisseur.findUnique({
        where: { id: clientFournisseurId },
        select: { nom: true },
      });
      if (!cf) {
        throw new Error('Fiche client / fournisseur introuvable.');
      }
      if (!nomClient || !String(nomClient).trim()) {
        nomClient = cf.nom;
      }
    }

    const created = await prisma.$transaction(async (tx) => {
      const projet = await tx.projet.create({
        data: {
          ...projetData,
          nomClient: nomClient ?? undefined,
          codeProjet,
          statut: projetData.statut || 'en_preparation',
          type: projetData.type || 'interne',
          priorite: projetData.priorite || 'moyenne',
          dateDebut: dateDebut ? new Date(dateDebut) : undefined,
          dateFinPrevue: dateFinPrevue ? new Date(dateFinPrevue) : undefined,
          ...(budgetPrevuVal !== undefined ? { budgetPrevu: budgetPrevuVal } : {}),
          ...(budgetConsommeVal !== undefined ? { budgetConsomme: budgetConsommeVal } : {}),
          ...(resolvedDeviseId !== undefined ? { deviseId: resolvedDeviseId } : {}),
          partiesPrenantes: partiesPrenantes ? JSON.stringify(partiesPrenantes) : undefined,
          kpis: kpis ? JSON.stringify(kpis) : undefined,
          objectifsStrategiques: objectifsStrategiques ? JSON.stringify(objectifsStrategiques) : undefined,
          objectifsOperationnels: objectifsOperationnels ? JSON.stringify(objectifsOperationnels) : undefined,
          createdById: auth.userId,
          entites: entiteIds?.length
            ? {
                create: entiteIds.map((entiteId) => ({ entiteId })),
              }
            : undefined,
          sponsors: sponsorIds?.length
            ? {
                create: sponsorIds.map((userId) => ({ userId })),
              }
            : undefined,
          chefsProjet: chefProjetIds?.length
            ? {
                create: chefProjetIds.map((userId) => ({ userId })),
              }
            : undefined,
          techLeads: techLeadIds?.length
            ? {
                create: techLeadIds.map((userId) => ({ userId })),
              }
            : undefined,
          equipe: equipeIds?.length
            ? {
                create: equipeIds.map((userId) => ({ userId })),
              }
            : undefined,
        },
        include: projetListInclude,
      });

      if (clientFournisseurId) {
        await tx.clientFournisseurProjet.create({
          data: { clientFournisseurId, projetId: projet.id },
        });
      }

      await this.syncDerivedGovernanceAndEntites(tx, projet.id);

      return tx.projet.findUniqueOrThrow({
        where: { id: projet.id },
        include: projetListInclude,
      });
    });

    const nextMap = this.buildProjetAssignmentMap({
      responsableId: created.responsableId,
      gestionnaireId: created.gestionnaireId,
      sponsorIds: (created.sponsors || []).map((x: any) => x.userId),
      chefProjetIds: (created.chefsProjet || []).map((x: any) => x.userId),
      techLeadIds: (created.techLeads || []).map((x: any) => x.userId),
      equipeIds: (created.equipe || []).map((x: any) => x.userId),
    });
    await this.notifyProjetAssignmentsDelta({
      projetId: created.id,
      projetNom: created.nom,
      actorId: auth.userId,
      prevMap: new Map<string, Set<string>>(),
      nextMap,
    });

    return created;
  }

  async update(
    id: string,
    data: {
      nom?: string;
      codeProjet?: string;
      description?: string;
      tags?: string[];
      entiteIds?: string[];
      type?: string;
      nomClient?: string;
      statut?: string;
      priorite?: string;
      responsableId?: string;
      gestionnaireId?: string;
      dateDebut?: string;
      dateFinPrevue?: string;
      budgetPrevu?: string | number | null;
      budgetConsomme?: string | number | null;
      deviseId?: string | null;
      contexte?: string;
      mission?: string;
      vision?: string;
      scopeInclus?: string;
      scopeExclus?: string;
      sponsorIds?: string[];
      chefProjetIds?: string[];
      techLeadIds?: string[];
      equipeIds?: string[];
      partiesPrenantes?: any[];
      kpis?: string[];
      objectifsStrategiques?: string[];
      objectifsOperationnels?: string[];
    },
    auth: ProjetAuth
  ) {
    const existing = await prisma.projet.findFirst({
      where: { id, deletedAt: null },
      select: {
        id: true,
        createdById: true,
        responsableId: true,
        gestionnaireId: true,
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
    });
    if (!existing) throw new Error('Projet non trouvé');
    const permTypes = await myPermTypesForProjet(id, auth.userId);
    const gov = isGovernanceMember(existing as any, auth.userId);
    const adminExcl = await fetchProjetAdminExcludedForUser(auth.userId, [id]);
    if (!canModifyProjet(existing as any, auth, permTypes, gov, adminExcl.has(id))) {
      throw new Error('Accès refusé');
    }

    const {
      entiteIds,
      sponsorIds,
      chefProjetIds,
      techLeadIds,
      equipeIds,
      partiesPrenantes,
      kpis,
      objectifsStrategiques,
      objectifsOperationnels,
      dateDebut,
      dateFinPrevue,
      ...updateData
    } = data;

    if (entiteIds !== undefined) {
      await prisma.projetEntite.deleteMany({ where: { projetId: id } });
      if (entiteIds.length > 0) {
        await prisma.projetEntite.createMany({
          data: entiteIds.map((entiteId) => ({ projetId: id, entiteId })),
        });
      }
    }

    if (sponsorIds !== undefined) {
      await prisma.projetSponsor.deleteMany({ where: { projetId: id } });
      if (sponsorIds.length > 0) {
        await prisma.projetSponsor.createMany({
          data: sponsorIds.map((userId) => ({ projetId: id, userId })),
        });
      }
    }
    if (chefProjetIds !== undefined) {
      await prisma.projetChefProjet.deleteMany({ where: { projetId: id } });
      if (chefProjetIds.length > 0) {
        await prisma.projetChefProjet.createMany({
          data: chefProjetIds.map((userId) => ({ projetId: id, userId })),
        });
      }
    }
    if (techLeadIds !== undefined) {
      await prisma.projetTechLead.deleteMany({ where: { projetId: id } });
      if (techLeadIds.length > 0) {
        await prisma.projetTechLead.createMany({
          data: techLeadIds.map((userId) => ({ projetId: id, userId })),
        });
      }
    }
    if (equipeIds !== undefined) {
      await prisma.projetEquipe.deleteMany({ where: { projetId: id } });
      if (equipeIds.length > 0) {
        await prisma.projetEquipe.createMany({
          data: equipeIds.map((userId) => ({ projetId: id, userId })),
        });
      }
    }

    const scalarPayload = await sanitizeProjetScalarUpdateData(
      pickProjetScalarUpdateData(updateData as Record<string, unknown>)
    );

    const updated = await prisma.$transaction(async (tx) => {
      const updated = await tx.projet.update({
        where: { id },
        data: {
          ...scalarPayload,
          dateDebut: dateDebut ? new Date(dateDebut) : undefined,
          dateFinPrevue: dateFinPrevue ? new Date(dateFinPrevue) : undefined,
          partiesPrenantes: partiesPrenantes !== undefined ? JSON.stringify(partiesPrenantes) : undefined,
          kpis: kpis !== undefined ? JSON.stringify(kpis) : undefined,
          objectifsStrategiques: objectifsStrategiques !== undefined ? JSON.stringify(objectifsStrategiques) : undefined,
          objectifsOperationnels: objectifsOperationnels !== undefined ? JSON.stringify(objectifsOperationnels) : undefined,
        },
      });
      await this.syncDerivedGovernanceAndEntites(tx, id);
      return tx.projet.findUniqueOrThrow({ where: { id: updated.id }, include: projetListInclude });
    });

    const prevMap = this.buildProjetAssignmentMap({
      responsableId: existing.responsableId,
      gestionnaireId: existing.gestionnaireId,
      sponsorIds: existing.sponsors.map((x) => x.userId),
      chefProjetIds: existing.chefsProjet.map((x) => x.userId),
      techLeadIds: existing.techLeads.map((x) => x.userId),
      equipeIds: existing.equipe.map((x) => x.userId),
    });
    const nextMap = this.buildProjetAssignmentMap({
      responsableId: updated.responsableId,
      gestionnaireId: updated.gestionnaireId,
      sponsorIds: (updated.sponsors || []).map((x: any) => x.userId),
      chefProjetIds: (updated.chefsProjet || []).map((x: any) => x.userId),
      techLeadIds: (updated.techLeads || []).map((x: any) => x.userId),
      equipeIds: (updated.equipe || []).map((x: any) => x.userId),
    });
    await this.notifyProjetAssignmentsDelta({
      projetId: updated.id,
      projetNom: updated.nom,
      actorId: auth.userId,
      prevMap,
      nextMap,
    });

    return updated;
  }

  /** @deprecated Utiliser softDelete — conservé pour compat éventuelle */
  async delete(id: string) {
    return prisma.projet.delete({ where: { id } });
  }
}
