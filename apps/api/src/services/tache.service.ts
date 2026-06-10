import { PermissionType, ResourceType } from '../generated/prisma/enums';
import { NotificationService } from './notification.service';
import { prisma } from '../utils/prisma';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

const PERM_RANK: Record<PermissionType, number> = {
  [PermissionType.lecture]: 1,
  [PermissionType.modification]: 2,
  [PermissionType.suppression]: 3,
  [PermissionType.gestion]: 4,
};

export function parseTacheAssignPermission(raw: unknown): PermissionType {
  const v = typeof raw === 'string' ? raw : '';
  if (v === 'lecture' || v === 'modification' || v === 'suppression' || v === 'gestion') {
    return v as PermissionType;
  }
  return PermissionType.lecture;
}

const TACHE_INCLUDE = {
  createur: { select: { id: true, nom: true, prenom: true } },
  projet: {
    select: {
      id: true,
      nom: true,
      equipe: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
      chefsProjet: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
      sponsors: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
      techLeads: { include: { user: { select: { id: true, nom: true, prenom: true } } } },
    }
  },
  assignesUtilisateurs: {
    include: {
      user: {
        select: {
          id: true,
          nom: true,
          prenom: true,
          entitesMembres: {
            select: {
              entite: {
                select: {
                  id: true,
                  nom: true,
                  code: true,
                },
              },
            },
          },
        },
      },
    },
  },
  assignesEntites: {
    include: {
      entite: {
        select: {
          id: true,
          nom: true,
          membres: {
            include: { user: { select: { id: true, nom: true, prenom: true } } }
          }
        }
      }
    },
  },
  assignesClientsFournisseurs: {
    include: {
      clientFournisseur: {
        select: { id: true, nom: true, type: true },
      },
    },
  },
  liaisons: {
    include: {
      tacheLiee: { select: { id: true, nom: true, statut: true } },
    },
  },
  documents: {
    include: {
      document: {
        include: {
          uploadedBy: { select: { id: true, nom: true, prenom: true } },
          permissionsUtilisateurs: {
            include: { user: { select: { id: true, nom: true, prenom: true, role: true } } }
          },
          adminSansAcces: { select: { userId: true } },
        }
      }
    }
  },
  adminSansAcces: { select: { userId: true } },
  userStory: {
    include: {
      epic: {
        select: {
          id: true,
          nom: true,
          description: true,
          projetId: true,
          projet: { select: { id: true, nom: true } },
          assignesEntites: {
            orderBy: { createdAt: 'asc' as const },
            select: { entite: { select: { id: true, nom: true } } },
          },
        },
      },
    },
  },
};

function formatTache(t: any) {
  const entitesDirectes =
    t.assignesEntites?.map((te: any) => ({
      ...te.entite,
      membres: te.entite?.membres || [],
    })) || [];

  // Si aucune entité n'est explicitement assignée à la tâche,
  // on hérite des entités des utilisateurs assignés pour l'affichage.
  const entitesHeritees = (() => {
    if (entitesDirectes.length > 0) return entitesDirectes;
    const byId = new Map<string, { id: string; nom: string; code?: string | null; membres: any[] }>();
    for (const tu of t.assignesUtilisateurs || []) {
      for (const ue of tu.user?.entitesMembres || []) {
        const ent = ue.entite;
        if (!ent?.id) continue;
        if (!byId.has(ent.id)) {
          byId.set(ent.id, {
            id: ent.id,
            nom: ent.nom,
            code: ent.code ?? null,
            membres: [],
          });
        }
      }
    }
    return [...byId.values()];
  })();

  return {
    ...t,
    assignesUtilisateurs:
      t.assignesUtilisateurs?.map((tu: any) => ({
        id: tu.user.id,
        nom: tu.user.nom,
        prenom: tu.user.prenom,
        tacheUserId: tu.id,
        permission: tu.permission ?? PermissionType.lecture,
      })) || [],
    assignesEntites: entitesHeritees,
    assignesClientsFournisseurs:
      t.assignesClientsFournisseurs?.map((tc: any) => ({
        id: tc.clientFournisseur.id,
        nom: tc.clientFournisseur.nom,
        type: tc.clientFournisseur.type,
      })) || [],
    documents: t.documents?.map((td: any) => td.document) || [],
  };
}

const ACCES_PERM_LABELS: Record<PermissionType, string> = {
  [PermissionType.lecture]: 'Consultation',
  [PermissionType.modification]: 'Modification',
  [PermissionType.suppression]: 'Suppression',
  [PermissionType.gestion]: 'Gestion des accès',
};

export class TacheService {
  private notificationService = new NotificationService();

  private uniqueIds(ids: string[] = []): string[] {
    return [...new Set((ids || []).filter(Boolean))];
  }

  private async resolveAutoEntiteIdsFromUsers(userIds: string[]): Promise<string[]> {
    const ids = this.uniqueIds(userIds);
    if (ids.length === 0) return [];
    const rows = await prisma.userEntite.findMany({
      where: { userId: { in: ids } },
      select: { entiteId: true },
    });
    return this.uniqueIds(rows.map((r) => r.entiteId));
  }

  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds(this.uniqueIds(rootIds));
  }

  private taskHasScopedEntite(
    row: { assignesEntites?: Array<{ entiteId?: string; entite?: { id?: string } }> },
    scope: Set<string>
  ): boolean {
    const ids = (row.assignesEntites || [])
      .map((te: any) => te.entiteId ?? te.entite?.id)
      .filter(Boolean);
    return ids.some((id: string) => scope.has(id));
  }

  private permRank(p: PermissionType): number {
    return PERM_RANK[p] ?? 0;
  }

  private async getTachePermSlice(tacheId: string) {
    return prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      select: {
        id: true,
        createurId: true,
        assignesUtilisateurs: { select: { userId: true, permission: true } },
        adminSansAcces: { select: { userId: true } },
      },
    });
  }

  /** Droit effectif sur la tâche (hors liste « visible » métier). */
  private effectiveDeleguePermission(
    userId: string,
    appRole: string,
    t: {
      createurId: string | null;
      assignesUtilisateurs: { userId: string; permission: PermissionType }[];
      adminSansAcces: { userId: string }[];
    }
  ): PermissionType | null {
    if (appRole === 'admin') {
      const excluded = (t.adminSansAcces || []).some((x) => x.userId === userId);
      if (!excluded) return PermissionType.gestion;
      const row = t.assignesUtilisateurs.find((a) => a.userId === userId);
      return row?.permission ?? null;
    }
    if (t.createurId === userId) return PermissionType.gestion;
    const row = t.assignesUtilisateurs.find((a) => a.userId === userId);
    if (appRole === 'contributeur') {
      return row ? PermissionType.gestion : null;
    }
    if (appRole === 'lecteur') {
      return row?.permission ?? null;
    }
    return row ? PermissionType.gestion : null;
  }

  async canUserManageTacheAcces(tacheId: string, userId: string, appRole: string): Promise<boolean> {
    const t = await this.getTachePermSlice(tacheId);
    if (!t) return false;
    if (t.createurId !== userId) return false;
    const eff = this.effectiveDeleguePermission(userId, appRole, t);
    return eff !== null && this.permRank(eff) >= this.permRank(PermissionType.gestion);
  }

  async canUserModifyTache(tacheId: string, userId: string, appRole: string): Promise<boolean> {
    const t = await this.getTachePermSlice(tacheId);
    if (!t) return false;
    const eff = this.effectiveDeleguePermission(userId, appRole, t);
    return eff !== null && this.permRank(eff) >= this.permRank(PermissionType.modification);
  }

  async canUserDeleteTacheSoft(tacheId: string, userId: string, appRole: string): Promise<boolean> {
    const t = await this.getTachePermSlice(tacheId);
    if (!t) return false;
    const eff = this.effectiveDeleguePermission(userId, appRole, t);
    return eff !== null && this.permRank(eff) >= this.permRank(PermissionType.suppression);
  }

  private canUserViewTacheRow(
    row: { createurId: string | null; assignesUtilisateurs: { userId: string; permission: PermissionType }[]; adminSansAcces?: { userId: string }[] },
    userId: string,
    role: string
  ): boolean {
    const eff = this.effectiveDeleguePermission(userId, role, {
      createurId: row.createurId,
      assignesUtilisateurs: row.assignesUtilisateurs || [],
      adminSansAcces: row.adminSansAcces || [],
    });
    return eff !== null && this.permRank(eff) >= this.permRank(PermissionType.lecture);
  }

  async findAll(filters: { statut?: string; projetId?: string; createurId?: string; requesterId?: string; requesterRole?: string } = {}) {
    const where: any = { deletedAt: null };
    if (filters.statut) where.statut = filters.statut;
    if (filters.projetId) where.projetId = filters.projetId;
    if (filters.createurId) where.createurId = filters.createurId;

    const taches = await prisma.tache.findMany({
      where,
      include: TACHE_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
    let entiteScopeSet = new Set<string>();
    const isContributeur = filters.requesterRole === 'contributeur' && !!filters.requesterId;
    if (isContributeur) {
      const own = await this.getUserEntiteIds(filters.requesterId!);
      const scope = await this.getEntiteDescendantIds(own);
      entiteScopeSet = new Set(scope);
    }
    const visible = filters.requesterId && filters.requesterRole
      ? taches.filter((t: any) => {
          const assignedOrAcl = this.canUserViewTacheRow(t, filters.requesterId!, filters.requesterRole!);
          if (!isContributeur) return assignedOrAcl;
          const entityScoped = this.taskHasScopedEntite(t, entiteScopeSet);
          return assignedOrAcl || entityScoped;
        })
      : taches;
    return visible.map(formatTache);
  }

  async findOne(id: string) {
    const t = await prisma.tache.findFirst({
      where: { id, deletedAt: null },
      include: TACHE_INCLUDE,
    });
    if (!t) return null;
    return formatTache(t);
  }

  async listCorbeille(userId: string, role: string) {
    const where: any = { deletedAt: { not: null } };
    if (role !== 'admin') {
      where.OR = [
        { createurId: userId },
        { assignesUtilisateurs: { some: { userId } } },
      ];
    }
    const taches = await prisma.tache.findMany({
      where,
      include: TACHE_INCLUDE,
      orderBy: { deletedAt: 'desc' },
    });
    return taches.map(formatTache);
  }

  async softDelete(id: string, userId: string, role: string) {
    const existing = await prisma.tache.findUnique({
      where: { id },
      include: { assignesUtilisateurs: true },
    });
    if (!existing || existing.deletedAt) throw new Error('Tâche non trouvée');
    if (!(await this.canUserDeleteTacheSoft(id, userId, role))) {
      throw new Error('Accès refusé');
    }
    await prisma.tache.update({
      where: { id },
      data: { deletedAt: new Date() },
    });
  }

  async restore(id: string, userId: string, role: string) {
    const existing = await prisma.tache.findUnique({
      where: { id },
      include: { assignesUtilisateurs: true },
    });
    if (!existing || !existing.deletedAt) throw new Error('Tâche non trouvée dans la corbeille');
    if (!(await this.canUserDeleteTacheSoft(id, userId, role))) {
      throw new Error('Accès refusé');
    }
    await prisma.tache.update({
      where: { id },
      data: { deletedAt: null },
    });
    return this.findOne(id);
  }

  async deletePermanent(id: string) {
    const existing = await prisma.tache.findUnique({ where: { id } });
    if (!existing || !existing.deletedAt) throw new Error('Tâche introuvable ou non en corbeille');
    await prisma.tache.delete({ where: { id } });
  }

  async create(data: any, createurId: string) {
    const {
      nom, statut, dateDebut, dateFinApprox,
      priorite, complexite,
      description, scenarioExecution, critereAcceptation,
      projetId,
      userStoryId,
      assignesUtilisateurIds = [],
      assignesEntiteIds = [],
      assignesClientFournisseurIds = [],
      liaisons = [],
    } = data;
    const finalAssigneesUtilisateurIds = this.uniqueIds(assignesUtilisateurIds);
    const autoEntiteIdsFromUsers = await this.resolveAutoEntiteIdsFromUsers(finalAssigneesUtilisateurIds);
    const finalAssigneesEntiteIds = this.uniqueIds([...(assignesEntiteIds || []), ...autoEntiteIdsFromUsers]);

    const initialStatut = statut || 'cree';
    const tache = await prisma.tache.create({
      data: {
        nom,
        statut: initialStatut,
        tempsActifSecondes: 0,
        chronoActifDepuis: initialStatut === 'en_cours' ? new Date() : null,
        priorite: priorite || 'basse',
        complexite: complexite || 'basse',
        dateDebut: dateDebut ? new Date(dateDebut) : null,
        dateFinApprox: dateFinApprox ? new Date(dateFinApprox) : null,
        description: description || null,
        scenarioExecution: scenarioExecution || null,
        critereAcceptation: critereAcceptation || null,
        projetId: projetId || null,
        userStoryId: userStoryId || null,
        createurId,
        assignesUtilisateurs: {
          create: finalAssigneesUtilisateurIds.map((userId: string) => ({
            userId,
            permission: PermissionType.modification,
          })),
        },
        assignesEntites: {
          create: finalAssigneesEntiteIds.map((entiteId: string) => ({ entiteId })),
        },
        assignesClientsFournisseurs: {
          create: assignesClientFournisseurIds.map((clientFournisseurId: string) => ({
            clientFournisseurId,
          })),
        },
        liaisons: {
          create: liaisons
            .filter((l: any) => l.tacheLieeId)
            .map((l: any) => ({ tacheLieeId: l.tacheLieeId, type: l.type || 'simple' })),
        },
      },
      include: TACHE_INCLUDE,
    });
    // Notifier les utilisateurs assignés
    const tacheFormatted = formatTache(tache);
    const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';
    if (finalAssigneesUtilisateurIds?.length > 0) {
      const auteur = await prisma.user.findUnique({ where: { id: createurId }, select: { nom: true, prenom: true } });
      const auteurNom = auteur ? `${auteur.prenom} ${auteur.nom}` : 'Un utilisateur';
      const assignes = await prisma.user.findMany({ where: { id: { in: finalAssigneesUtilisateurIds } }, select: { id: true, email: true, nom: true, prenom: true } });
      for (const u of assignes) {
        this.notificationService.notifierAssignation({
          tacheId: tache.id,
          tacheNom: nom,
          assigneUserId: u.id,
          assigneEmail: u.email,
          assigneNom: `${u.prenom} ${u.nom}`,
          auteurNom,
          appUrl,
        }).catch(() => {});
      }
    }
    // Notifier membres du projet si tâche liée
    if (projetId) {
      const projet = await prisma.projet.findUnique({
        where: { id: projetId },
        select: { nom: true, equipe: { include: { user: { select: { id: true, email: true, nom: true, prenom: true } } } }, chefsProjet: { include: { user: { select: { id: true, email: true, nom: true, prenom: true } } } } },
      });
      if (projet) {
        const auteur = await prisma.user.findUnique({ where: { id: createurId }, select: { nom: true, prenom: true } });
        const auteurNom = auteur ? `${auteur.prenom} ${auteur.nom}` : 'Un utilisateur';
        const membres = [
          ...(projet.equipe || []).map((m: any) => m.user),
          ...(projet.chefsProjet || []).map((m: any) => m.user),
        ].filter((u: any) => u && u.id !== createurId);
        if (membres.length > 0) {
          this.notificationService.notifierNouvelleTacheProjet({
            tacheId: tache.id, tacheNom: nom, projetNom: projet.nom,
            membres, createurNom: auteurNom, appUrl,
          }).catch(() => {});
        }
      }
    }
    return tacheFormatted;
  }

  async update(id: string, data: any) {
    const cur = await prisma.tache.findUnique({ where: { id } });
    if (!cur || cur.deletedAt) throw new Error('Tâche non trouvée');

    const {
      nom, statut, dateDebut, dateFinApprox,
      priorite, complexite,
      description, scenarioExecution, critereAcceptation,
      projetId,
      userStoryId,
      assignesUtilisateurIds,
      assignesEntiteIds,
      assignesClientFournisseurIds,
      liaisons,
    } = data;
    const shouldSyncUsers = assignesUtilisateurIds !== undefined;
    const shouldSyncEntites = assignesEntiteIds !== undefined || shouldSyncUsers;

    let finalAssigneesUtilisateurIds: string[] = [];
    if (shouldSyncUsers) {
      finalAssigneesUtilisateurIds = this.uniqueIds(assignesUtilisateurIds || []);
    } else {
      const existingUsers = await prisma.tacheUser.findMany({
        where: { tacheId: id },
        select: { userId: true },
      });
      finalAssigneesUtilisateurIds = this.uniqueIds(existingUsers.map((r) => r.userId));
    }

    let baseAssigneesEntiteIds: string[] = [];
    if (assignesEntiteIds !== undefined) {
      baseAssigneesEntiteIds = this.uniqueIds(assignesEntiteIds || []);
    } else if (shouldSyncEntites) {
      const existingEntites = await prisma.tacheEntite.findMany({
        where: { tacheId: id },
        select: { entiteId: true },
      });
      baseAssigneesEntiteIds = this.uniqueIds(existingEntites.map((r) => r.entiteId));
    }
    const autoEntiteIdsFromUsers = shouldSyncEntites
      ? await this.resolveAutoEntiteIdsFromUsers(finalAssigneesUtilisateurIds)
      : [];
    const finalAssigneesEntiteIds = shouldSyncEntites
      ? this.uniqueIds([...baseAssigneesEntiteIds, ...autoEntiteIdsFromUsers])
      : [];

    let trackingPatch: { tempsActifSecondes?: number; chronoActifDepuis?: Date | null } = {};
    if (statut !== undefined && statut !== cur.statut) {
      const now = new Date();
      let cumul = cur.tempsActifSecondes || 0;
      let chronoActifDepuis = cur.chronoActifDepuis || null;
      if (cur.statut === 'en_cours' && chronoActifDepuis) {
        const elapsedSec = Math.max(0, Math.floor((now.getTime() - new Date(chronoActifDepuis).getTime()) / 1000));
        cumul += elapsedSec;
        chronoActifDepuis = null;
      }
      if (statut === 'en_cours') {
        chronoActifDepuis = now;
      }
      trackingPatch = {
        tempsActifSecondes: cumul,
        chronoActifDepuis,
      };
    }

    // Mise à jour du champ de base
    await prisma.tache.update({
      where: { id },
      data: {
        ...(nom !== undefined && { nom }),
        ...(statut !== undefined && { statut }),
        ...(priorite !== undefined && { priorite }),
        ...(complexite !== undefined && { complexite }),
        ...(dateDebut !== undefined && { dateDebut: dateDebut ? new Date(dateDebut) : null }),
        ...(dateFinApprox !== undefined && { dateFinApprox: dateFinApprox ? new Date(dateFinApprox) : null }),
        ...(description !== undefined && { description }),
        ...(scenarioExecution !== undefined && { scenarioExecution }),
        ...(critereAcceptation !== undefined && { critereAcceptation }),
        ...(projetId !== undefined && { projetId: projetId || null }),
        ...(userStoryId !== undefined && { userStoryId: userStoryId || null }),
        ...trackingPatch,
      },
    });

    // Sync utilisateurs assignés
    if (shouldSyncUsers) {
      await prisma.tacheUser.deleteMany({ where: { tacheId: id } });
      if (finalAssigneesUtilisateurIds.length > 0) {
        await prisma.tacheUser.createMany({
          data: finalAssigneesUtilisateurIds.map((userId: string) => ({
            tacheId: id,
            userId,
            permission: PermissionType.modification,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Sync entités assignées
    if (shouldSyncEntites) {
      await prisma.tacheEntite.deleteMany({ where: { tacheId: id } });
      if (finalAssigneesEntiteIds.length > 0) {
        await prisma.tacheEntite.createMany({
          data: finalAssigneesEntiteIds.map((entiteId: string) => ({ tacheId: id, entiteId })),
          skipDuplicates: true,
        });
      }
    }

    // Sync clients / fournisseurs assignés
    if (assignesClientFournisseurIds !== undefined) {
      await prisma.tacheClientFournisseur.deleteMany({ where: { tacheId: id } });
      if (assignesClientFournisseurIds.length > 0) {
        await prisma.tacheClientFournisseur.createMany({
          data: assignesClientFournisseurIds.map((clientFournisseurId: string) => ({
            tacheId: id,
            clientFournisseurId,
          })),
          skipDuplicates: true,
        });
      }
    }

    // Sync liaisons
    if (liaisons !== undefined) {
      await prisma.tacheLiaison.deleteMany({ where: { tacheId: id } });
      const validLiaisons = liaisons.filter((l: any) => l.tacheLieeId && l.tacheLieeId !== id);
      if (validLiaisons.length > 0) {
        await prisma.tacheLiaison.createMany({
          data: validLiaisons.map((l: any) => ({
            tacheId: id,
            tacheLieeId: l.tacheLieeId,
            type: l.type || 'simple',
          })),
          skipDuplicates: true,
        });
      }
    }

    const tacheUpdated = await this.findOne(id);
    const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';

    // Notification changement de statut
    if (data.statut && tacheUpdated) {
      const ancienneStatut = (tacheUpdated as any)._ancienStatut;
      if (ancienneStatut && ancienneStatut !== data.statut) {
        const destinataires: any[] = [];
        if (tacheUpdated.createur) {
          const u = await prisma.user.findUnique({ where: { id: tacheUpdated.createur.id }, select: { id: true, email: true, nom: true, prenom: true } });
          if (u) destinataires.push({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` });
        }
        (tacheUpdated.assignesUtilisateurs || []).forEach(async (u: any) => {
          const user = await prisma.user.findUnique({ where: { id: u.id }, select: { id: true, email: true, nom: true, prenom: true } });
          if (user) destinataires.push({ id: user.id, email: user.email, nom: `${user.prenom} ${user.nom}` });
        });
        if (destinataires.length > 0) {
          this.notificationService.notifierChangementStatut({
            tacheId: id, tacheNom: tacheUpdated.nom,
            ancienStatut: ancienneStatut, nouveauStatut: data.statut,
            destinataires, auteurNom: 'Un utilisateur', appUrl,
          }).catch(() => {});
        }
      }
    }

    // Notification nouvelles assignations
    if (assignesUtilisateurIds && tacheUpdated) {
      const ancienIds = (tacheUpdated.assignesUtilisateurs || []).map((u: any) => u.id);
      const nouveauxIds = assignesUtilisateurIds.filter((uid: string) => !ancienIds.includes(uid));
      if (nouveauxIds.length > 0) {
        const assignes = await prisma.user.findMany({ where: { id: { in: nouveauxIds } }, select: { id: true, email: true, nom: true, prenom: true } });
        for (const u of assignes) {
          this.notificationService.notifierAssignation({
            tacheId: id,
            tacheNom: tacheUpdated.nom,
            assigneUserId: u.id,
            assigneEmail: u.email,
            assigneNom: `${u.prenom} ${u.nom}`,
            auteurNom: 'Un utilisateur',
            appUrl,
          }).catch(() => {});
        }
      }
    }

    return tacheUpdated;
  }


  // ── Commentaires ──────────────────────────────────────────────────
  async getCommentaires(tacheId: string) {
    const ok = await prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      select: { id: true },
    });
    if (!ok) return [];
    return (prisma as any).tacheCommentaire.findMany({
      where: { tacheId },
      include: { user: { select: { id: true, nom: true, prenom: true } } },
      orderBy: { createdAt: 'asc' },
    }).then((list: any[]) =>
      list.map(c => ({ ...c, auteur: c.user }))
    );
  }

  async addCommentaire(tacheId: string, userId: string, contenu: string, fichier?: Express.Multer.File) {
    const tOk = await prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      select: { id: true },
    });
    if (!tOk) throw new Error('Tâche non trouvée');

    const commentaire = await (prisma as any).tacheCommentaire.create({
      data: {
        tacheId,
        userId,
        contenu,
        pieceJointeNom: fichier?.originalname || null,
        pieceJointePath: fichier?.path || null,
        pieceJointeType: fichier?.mimetype || null,
      },
      include: { user: { select: { id: true, nom: true, prenom: true } } },
    });

    // Charger la tâche pour mentions et notifications
    const tache = await prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      select: {
        nom: true, createurId: true,
        assignesUtilisateurs: { include: { user: { select: { id: true, email: true, nom: true, prenom: true } } } },
      },
    });
    const auteur = commentaire.user;
    const auteurNom = `${auteur.prenom} ${auteur.nom}`;
    const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';

    // Non-bloquant - mentions
    this.notificationService
      .traiterMentions({
        contenu,
        auteurId: userId,
        auteurNom,
        appUrl,
        context: { type: 'tache', id: tacheId, titre: tache?.nom || 'Tâche' },
      })
      .catch((err: any) => console.error('[MENTIONS] Erreur:', err));
    if (tache) {
      const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';
      const auteurUser = await prisma.user.findUnique({ where: { id: userId }, select: { nom: true, prenom: true } });
      const auteurNom = auteurUser ? `${auteurUser.prenom} ${auteurUser.nom}` : 'Un utilisateur';
      const destinataires: any[] = [];
      if (tache.createurId && tache.createurId !== userId) {
        const u = await prisma.user.findUnique({ where: { id: tache.createurId }, select: { id: true, email: true, nom: true, prenom: true } });
        if (u) destinataires.push({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` });
      }
      (tache.assignesUtilisateurs || []).forEach((tu: any) => {
        if (tu.user && tu.user.id !== userId && !destinataires.find((d: any) => d.id === tu.user.id)) {
          destinataires.push({ id: tu.user.id, email: tu.user.email, nom: `${tu.user.prenom} ${tu.user.nom}` });
        }
      });
      if (destinataires.length > 0) {
        this.notificationService.notifierCommentaire({
          tacheId, tacheNom: tache.nom, commentaire: contenu,
          destinataires, auteurNom, appUrl,
        }).catch(() => {});
      }
    }
    return { ...commentaire, auteur: commentaire.user };
  }

  async getCommentaireFichier(commentaireId: string) {
    return (prisma as any).tacheCommentaire.findUnique({
      where: { id: commentaireId },
      select: { pieceJointePath: true, pieceJointeNom: true, pieceJointeType: true },
    });
  }

  // ── Documents ─────────────────────────────────────────────────────────────

  async uploadDocument(tacheId: string, userId: string, fichier: Express.Multer.File, nom: string, description?: string) {
    const tache = await prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      select: { nom: true },
    });
    if (!tache) throw new Error('Tâche non trouvée');

    // Créer le document via le service document existant
    const document = await prisma.document.create({
      data: {
        nom: nom || fichier.originalname,
        typeDocument: 'tache' as any,
        fichierUrl: fichier.path,
        fichierNomOriginal: fichier.originalname,
        fichierTaille: fichier.size,
        fichierType: fichier.mimetype,
        description: description || null,
        statut: 'valide',
        uploadedById: userId,
        estConfidentiel: true,
      },
    });

    // Lier le document à la tâche
    await (prisma as any).tacheDocument.create({
      data: { tacheId, documentId: document.id },
    });

    // Notifier les membres
    const tacheInfo = await (prisma as any).tache.findUnique({
      where: { id: tacheId },
      select: {
        nom: true, createurId: true,
        assignesUtilisateurs: { include: { user: { select: { id: true, email: true, nom: true, prenom: true } } } },
      },
    });
    if (tacheInfo) {
      const appUrl = process.env.FRONTEND_URL || 'http://172.17.5.198:5173';
      const auteurUser = await prisma.user.findUnique({ where: { id: userId }, select: { nom: true, prenom: true } });
      const auteurNom = auteurUser ? `${auteurUser.prenom} ${auteurUser.nom}` : 'Un utilisateur';
      const destinataires: any[] = [];
      if (tacheInfo.createurId && tacheInfo.createurId !== userId) {
        const u = await prisma.user.findUnique({ where: { id: tacheInfo.createurId }, select: { id: true, email: true, nom: true, prenom: true } });
        if (u) destinataires.push({ id: u.id, email: u.email, nom: `${u.prenom} ${u.nom}` });
      }
      (tacheInfo.assignesUtilisateurs || []).forEach((tu: any) => {
        if (tu.user && tu.user.id !== userId && !destinataires.find((d: any) => d.id === tu.user.id)) {
          destinataires.push({ id: tu.user.id, email: tu.user.email, nom: `${tu.user.prenom} ${tu.user.nom}` });
        }
      });
      if (destinataires.length > 0) {
        this.notificationService.notifierDocumentUploade({
          tacheId, tacheNom: tacheInfo.nom, documentNom: nom || fichier.originalname,
          destinataires, auteurNom, appUrl,
        }).catch(() => {});
      }
    }

    return document;
  }

  async lierDocument(tacheId: string, documentId: string) {
    return (prisma as any).tacheDocument.upsert({
      where: { tacheId_documentId: { tacheId, documentId } },
      create: { tacheId, documentId },
      update: {},
    });
  }

  async delierDocument(tacheId: string, documentId: string) {
    return (prisma as any).tacheDocument.deleteMany({
      where: { tacheId, documentId },
    });
  }

  async getDocumentsLiables(search?: string) {
    return prisma.document.findMany({
      where: {
        deletedAt: null,
        typeDocument: { in: ['projet', 'processus', 'contrat'] as any },
        ...(search ? { nom: { contains: search, mode: 'insensitive' as any } } : {}),
      },
      select: {
        id: true,
        nom: true,
        typeDocument: true,
        fichierType: true,
        statut: true,
        estConfidentiel: true,
        uploadedBy: { select: { id: true, nom: true, prenom: true } },
        permissionsUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true } } }
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
  }

  async canUserViewTache(tacheId: string, userId: string, role: string): Promise<boolean> {
    const t = await this.getTachePermSlice(tacheId);
    if (!t) return false;
    const eff = this.effectiveDeleguePermission(userId, role, t);
    const assignedOrAcl = eff !== null && this.permRank(eff) >= this.permRank(PermissionType.lecture);
    if (assignedOrAcl) return true;
    if (role !== 'contributeur') return false;
    const ownEntites = await this.getUserEntiteIds(userId);
    const scope = new Set(await this.getEntiteDescendantIds(ownEntites));
    if (scope.size === 0) return false;
    const linked = await prisma.tacheEntite.findFirst({
      where: { tacheId, entiteId: { in: [...scope] } },
      select: { id: true },
    });
    return !!linked;
  }

  async getAccesDetail(tacheId: string, role: string, requesterId: string) {
    const t = await prisma.tache.findFirst({
      where: { id: tacheId, deletedAt: null },
      include: {
        createur: { select: { id: true, nom: true, prenom: true, email: true } },
        assignesUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true, email: true, role: true } } },
        },
        assignesEntites: {
          include: { entite: { select: { id: true, nom: true } } },
        },
        assignesClientsFournisseurs: {
          include: {
            clientFournisseur: { select: { id: true, nom: true, type: true } },
          },
        },
        adminSansAcces: { select: { userId: true } },
      },
    });
    if (!t) return null;
    const admins = await prisma.user.findMany({
      where: { role: 'admin', statut: 'actif' },
      select: { id: true, nom: true, prenom: true, email: true },
    });
    const canManage = await this.canUserManageTacheAcces(tacheId, requesterId, role);
    return {
      admins,
      creator: t.createur,
      delegations: t.assignesUtilisateurs.map((tu) => ({
        id: tu.id,
        user: tu.user,
        permission: tu.permission,
        permissionLabel: ACCES_PERM_LABELS[tu.permission] ?? tu.permission,
      })),
      entites: t.assignesEntites.map((te) => ({
        id: te.id,
        entite: te.entite,
      })),
      clientsFournisseurs: t.assignesClientsFournisseurs.map((tc) => ({
        id: tc.id,
        clientFournisseur: tc.clientFournisseur,
      })),
      canManagePermissions: canManage,
      adminSansAccesUserIds: (t.adminSansAcces || []).map((x: { userId: string }) => x.userId),
      noteEntites:
        'Les entités et clients / fournisseurs liés à la tâche sont modifiables depuis le formulaire « Modifier la tâche ».',
    };
  }

  async addTacheAssigne(
    tacheId: string,
    userIdToAdd: string,
    permission: PermissionType,
    actorId: string,
    actorRole: string
  ) {
    if (!(await this.canUserManageTacheAcces(tacheId, actorId, actorRole))) {
      throw new Error('Accès refusé');
    }
    const t = await prisma.tache.findFirst({ where: { id: tacheId, deletedAt: null } });
    if (!t) throw new Error('Tâche non trouvée');
    await prisma.tacheUser.upsert({
      where: { tacheId_userId: { tacheId, userId: userIdToAdd } },
      create: { tacheId, userId: userIdToAdd, permission },
      update: { permission },
    });
    await prisma.tacheAdminSansAcces.deleteMany({ where: { tacheId, userId: userIdToAdd } });
    return this.getAccesDetail(tacheId, actorRole, actorId);
  }

  async updateTacheAssignePermission(
    tacheId: string,
    tacheUserId: string,
    permission: PermissionType,
    actorId: string,
    actorRole: string
  ) {
    if (!(await this.canUserManageTacheAcces(tacheId, actorId, actorRole))) {
      throw new Error('Accès refusé');
    }
    const row = await prisma.tacheUser.findFirst({
      where: { id: tacheUserId, tacheId },
      include: { user: { select: { role: true } } },
    });
    if (!row) throw new Error('Assignation introuvable');
    await prisma.tacheUser.update({
      where: { id: tacheUserId },
      data: { permission },
    });
    return this.getAccesDetail(tacheId, actorRole, actorId);
  }

  async removeTacheAssigne(tacheId: string, tacheUserId: string, actorId: string, actorRole: string) {
    if (!(await this.canUserManageTacheAcces(tacheId, actorId, actorRole))) {
      throw new Error('Accès refusé');
    }
    const row = await prisma.tacheUser.findFirst({
      where: { id: tacheUserId, tacheId },
      include: { user: { select: { role: true } } },
    });
    if (!row) throw new Error('Assignation introuvable');
    await prisma.tacheUser.delete({ where: { id: tacheUserId } });
    if (row.user.role === 'admin') {
      await prisma.tacheAdminSansAcces.upsert({
        where: { tacheId_userId: { tacheId, userId: row.userId } },
        create: { tacheId, userId: row.userId },
        update: {},
      });
    }
    return this.getAccesDetail(tacheId, actorRole, actorId);
  }

  async blockTacheAdminImplicit(tacheId: string, targetUserId: string, actorId: string, actorRole: string) {
    if (!(await this.canUserManageTacheAcces(tacheId, actorId, actorRole))) throw new Error('Accès refusé');
    const t = await prisma.tache.findFirst({ where: { id: tacheId, deletedAt: null }, select: { createurId: true } });
    if (!t) throw new Error('Tâche non trouvée');
    if (t.createurId === targetUserId) throw new Error("Le créateur ne peut pas être exclu");
    const target = await prisma.user.findUnique({ where: { id: targetUserId }, select: { role: true } });
    if (!target || target.role !== 'admin') throw new Error("Seuls les administrateurs peuvent être exclus");
    await prisma.tacheUser.deleteMany({ where: { tacheId, userId: targetUserId } });
    await prisma.tacheAdminSansAcces.upsert({
      where: { tacheId_userId: { tacheId, userId: targetUserId } },
      create: { tacheId, userId: targetUserId },
      update: {},
    });
    return this.getAccesDetail(tacheId, actorRole, actorId);
  }

  async restoreTacheAdminImplicit(tacheId: string, targetUserId: string, actorId: string, actorRole: string) {
    if (!(await this.canUserManageTacheAcces(tacheId, actorId, actorRole))) throw new Error('Accès refusé');
    await prisma.tacheAdminSansAcces.deleteMany({ where: { tacheId, userId: targetUserId } });
    return this.getAccesDetail(tacheId, actorRole, actorId);
  }

  async getJournalHistory(tacheId: string, page: number, limit: number) {
    const skip = (page - 1) * limit;
    const where = { ressourceType: ResourceType.tache, ressourceId: tacheId };
    const [total, data] = await Promise.all([
      prisma.journalAcces.count({ where }),
      prisma.journalAcces.findMany({
        where,
        include: { user: { select: { id: true, nom: true, prenom: true, email: true } } },
        orderBy: { timestamp: 'desc' },
        skip,
        take: limit,
      }),
    ]);
    return {
      data,
      pagination: { page, limit, total, totalPages: Math.max(1, Math.ceil(total / limit)) },
    };
  }
}
