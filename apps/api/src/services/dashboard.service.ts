import { prisma } from '../utils/prisma';

const JOURS_ACTIVITE_PROJET = 30;

const TACHE_STATUTS_FINALISES = ['termine', 'archive'] as const;

export class DashboardService {
  private async getAdminProjetsParStatutEtEntites() {
    const projets = await prisma.projet.findMany({
      where: { deletedAt: null },
      select: {
        id: true,
        nom: true,
        codeProjet: true,
        statut: true,
        dateFinPrevue: true,
        entites: {
          include: {
            entite: { select: { id: true, nom: true, code: true } },
          },
        },
        sponsors: { select: { userId: true } },
        chefsProjet: { select: { userId: true } },
        techLeads: { select: { userId: true } },
        equipe: { select: { userId: true } },
      },
      orderBy: [{ statut: 'asc' }, { nom: 'asc' }],
    });

    const projetIds = projets.map((p) => p.id);
    const userIdsByProjet = new Map<string, Set<string>>();
    const allUserIds = new Set<string>();

    const ensureProjetUserSet = (projetId: string) => {
      if (!userIdsByProjet.has(projetId)) userIdsByProjet.set(projetId, new Set<string>());
      return userIdsByProjet.get(projetId)!;
    };

    for (const p of projets) {
      const users = ensureProjetUserSet(p.id);
      for (const u of [...(p.sponsors || []), ...(p.chefsProjet || []), ...(p.techLeads || []), ...(p.equipe || [])]) {
        if (!u?.userId) continue;
        users.add(u.userId);
        allUserIds.add(u.userId);
      }
    }

    if (projetIds.length > 0) {
      const taches = await prisma.tache.findMany({
        where: {
          deletedAt: null,
          OR: [
            { projetId: { in: projetIds } },
            {
              userStory: {
                is: {
                  deletedAt: null,
                  epic: { is: { deletedAt: null, projetId: { in: projetIds } } },
                },
              },
            },
          ],
        },
        select: {
          projetId: true,
          userStory: { select: { epic: { select: { projetId: true } } } },
          assignesUtilisateurs: { select: { userId: true } },
        },
      });

      for (const t of taches) {
        const projetId = t.projetId ?? t.userStory?.epic?.projetId ?? null;
        if (!projetId) continue;
        const users = ensureProjetUserSet(projetId);
        for (const au of t.assignesUtilisateurs || []) {
          if (!au?.userId) continue;
          users.add(au.userId);
          allUserIds.add(au.userId);
        }
      }
    }

    const entitesByUserId = new Map<string, { id: string; nom: string; code: string | null }[]>();
    if (allUserIds.size > 0) {
      const userEntites = await prisma.userEntite.findMany({
        where: { userId: { in: [...allUserIds] }, entite: { is: { deletedAt: null } } },
        select: {
          userId: true,
          entite: { select: { id: true, nom: true, code: true } },
        },
      });
      for (const row of userEntites) {
        if (!entitesByUserId.has(row.userId)) entitesByUserId.set(row.userId, []);
        entitesByUserId.get(row.userId)!.push({
          id: row.entite.id,
          nom: row.entite.nom,
          code: row.entite.code ?? null,
        });
      }
    }

    const byStatut = new Map<
      string,
      {
        statut: string;
        count: number;
        projets: {
          id: string;
          nom: string;
          codeProjet: string;
          dateFinPrevue: string | null;
          entites: { id: string; nom: string; code: string | null }[];
        }[];
      }
    >();

    for (const p of projets) {
      const key = p.statut || 'inconnu';
      if (!byStatut.has(key)) {
        byStatut.set(key, { statut: key, count: 0, projets: [] });
      }
      const bucket = byStatut.get(key)!;
      bucket.count += 1;
      const explicitEntites = (p.entites || []).map((pe) => ({
        id: pe.entite.id,
        nom: pe.entite.nom,
        code: pe.entite.code ?? null,
      }));
      const mergedEntites = new Map<string, { id: string; nom: string; code: string | null }>(
        explicitEntites.map((e) => [e.id, e])
      );
      const linkedUsers = userIdsByProjet.get(p.id) || new Set<string>();
      for (const userId of linkedUsers) {
        for (const entite of entitesByUserId.get(userId) || []) {
          if (!mergedEntites.has(entite.id)) mergedEntites.set(entite.id, entite);
        }
      }
      bucket.projets.push({
        id: p.id,
        nom: p.nom,
        codeProjet: p.codeProjet,
        dateFinPrevue: p.dateFinPrevue ? p.dateFinPrevue.toISOString() : null,
        entites: Array.from(mergedEntites.values()),
      });
    }

    return {
      totalProjets: projets.length,
      parStatut: Array.from(byStatut.values()).sort((a, b) => b.count - a.count),
    };
  }

  private async getAdminGlobalTotals() {
    const [
      processusTotal,
      projetsTotal,
      epicsTotal,
      userStoriesTotal,
      tachesTotal,
      clientsTotal,
      fournisseursTotal,
      contratsTotal,
      pvReunionsTotal,
      licencesTotal,
      certificationsTotal,
      entitesTotal,
      documentsTotal,
      utilisateursTotal,
    ] = await Promise.all([
      prisma.processus.count({ where: { deletedAt: null } }),
      prisma.projet.count({ where: { deletedAt: null } }),
      prisma.epic.count({ where: { deletedAt: null } }),
      prisma.userStory.count({ where: { deletedAt: null } }),
      prisma.tache.count({ where: { deletedAt: null } }),
      prisma.clientFournisseur.count({ where: { deletedAt: null, type: { contains: 'client', mode: 'insensitive' } } }),
      prisma.clientFournisseur.count({ where: { deletedAt: null, type: { contains: 'fournisseur', mode: 'insensitive' } } }),
      prisma.contrat.count({ where: { deletedAt: null } }),
      prisma.pvReunion.count({ where: { deletedAt: null } }),
      prisma.licence.count({ where: { deletedAt: null } }),
      prisma.licence.count({ where: { deletedAt: null, typeLicence: { contains: 'certif', mode: 'insensitive' } } }),
      prisma.entite.count({ where: { deletedAt: null } }),
      prisma.document.count({ where: { deletedAt: null } }),
      prisma.user.count(),
    ]);

    return {
      processusTotal,
      projetsTotal,
      epicUserStoryTache: {
        epics: epicsTotal,
        userStories: userStoriesTotal,
        taches: tachesTotal,
        total: epicsTotal + userStoriesTotal + tachesTotal,
      },
      clientsFournisseurs: {
        clients: clientsTotal,
        fournisseurs: fournisseursTotal,
        total: clientsTotal + fournisseursTotal,
      },
      contratsTotal,
      pvReunionsTotal,
      licencesCertifications: {
        licences: Math.max(licencesTotal - certificationsTotal, 0),
        certifications: certificationsTotal,
        total: licencesTotal,
      },
      entitesTotal,
      documentsTotal,
      utilisateursTotal,
    };
  }

  private async getTachesAssigneesEnInstance(userId?: string, userRole?: string) {
    if (!userId) return [];
    if (userRole !== 'contributeur') return [];

    const taches = await prisma.tache.findMany({
      where: {
        deletedAt: null,
        statut: { notIn: [...TACHE_STATUTS_FINALISES] },
        assignesUtilisateurs: { some: { userId } },
      },
      orderBy: [{ updatedAt: 'desc' }],
      take: 15,
      include: {
        projet: { select: { id: true, nom: true, codeProjet: true } },
      },
    });

    return taches.map((t) => ({
      id: t.id,
      nom: t.nom,
      statut: t.statut,
      dateFinPrevue: t.dateFinApprox?.toISOString() ?? null,
      projet: t.projet
        ? { id: t.projet.id, nom: t.projet.nom, codeProjet: t.projet.codeProjet }
        : null,
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  /** Top projets : sur 30 jours, actions journal (projet) + tches mises  jour ; complt par `updatedAt` si besoin. */
  private async getProjetsPlusActifs(projetWhere: any) {
    const depuis = new Date(Date.now() - JOURS_ACTIVITE_PROJET * 24 * 60 * 60 * 1000);
    const visibles = await prisma.projet.findMany({
      where: projetWhere,
      select: { id: true },
    });
    const ids = visibles.map((p) => p.id);
    if (ids.length === 0) return [];

    const [journalParProjet, tachesParProjet] = await Promise.all([
      prisma.journalAcces.groupBy({
        by: ['ressourceId'],
        where: {
          ressourceType: 'projet',
          ressourceId: { in: ids },
          timestamp: { gte: depuis },
        },
        _count: { id: true },
      }),
      prisma.tache.groupBy({
        by: ['projetId'],
        where: {
          projetId: { in: ids },
          updatedAt: { gte: depuis },
        },
        _count: { id: true },
      }),
    ]);

    const scoreMap = new Map<string, { j: number; t: number }>();
    for (const row of journalParProjet) {
      const rid = row.ressourceId;
      if (!rid) continue;
      scoreMap.set(rid, { j: row._count.id, t: scoreMap.get(rid)?.t ?? 0 });
    }
    for (const row of tachesParProjet) {
      const pid = row.projetId;
      if (!pid) continue;
      const cur = scoreMap.get(pid) ?? { j: 0, t: 0 };
      scoreMap.set(pid, { j: cur.j, t: row._count.id });
    }

    const scored = [...scoreMap.entries()]
      .map(([id, { j, t }]) => ({ id, score: j + t }))
      .sort((a, b) => b.score - a.score);

    let topIds = scored.filter((s) => s.score > 0).slice(0, 5).map((s) => s.id);

    if (topIds.length < 5) {
      const complement = await prisma.projet.findMany({
        where: {
          ...projetWhere,
          ...(topIds.length ? { id: { notIn: topIds } } : {}),
        },
        orderBy: { updatedAt: 'desc' },
        take: 5 - topIds.length,
        select: { id: true },
      });
      topIds = [...topIds, ...complement.map((p) => p.id)];
    }

    const projets = await prisma.projet.findMany({
      where: { id: { in: topIds } },
      select: { id: true, nom: true, codeProjet: true, statut: true },
    });
    const byId = new Map(projets.map((p) => [p.id, p]));

    return topIds
      .map((id) => {
        const p = byId.get(id);
        if (!p) return null;
        const s = scoreMap.get(id) ?? { j: 0, t: 0 };
        return {
          id: p.id,
          nom: p.nom,
          codeProjet: p.codeProjet,
          statut: p.statut,
          scoreActivite: s.j + s.t,
          consultationsJournal: s.j,
          tachesMisesAJour: s.t,
        };
      })
      .filter(Boolean) as Array<{
        id: string;
        nom: string;
        codeProjet: string;
        statut: string;
        scoreActivite: number;
        consultationsJournal: number;
        tachesMisesAJour: number;
      }>;
  }

  /**
   * Tches non finalises dont la date de fin prvue est dpasse (max 10, plus anciennes en premier).
   * Align sur la visibilit liste Tches : admin voit tout ; lecteur/contributeur : crateur ou assign utilisateur.
   */
  async getTachesEnRetard(userId?: string, userRole?: string) {
    const now = new Date();

    const baseWhere: any = {
      deletedAt: null,
      statut: { notIn: [...TACHE_STATUTS_FINALISES] },
      dateFinApprox: { not: null, lt: now },
    };

    let where: any = { ...baseWhere };

    if (userRole === 'contributeur') {
      if (!userId) {
        return [];
      }
      where = {
        AND: [
          baseWhere,
          {
            assignesUtilisateurs: { some: { userId } },
          },
        ],
      };
    } else if (userRole === 'lecteur') {
      if (!userId) {
        return [];
      }
      where = {
        AND: [
          baseWhere,
          {
            OR: [{ createurId: userId }, { assignesUtilisateurs: { some: { userId } } }],
          },
        ],
      };
    }

    const taches = await prisma.tache.findMany({
      where,
      take: 10,
      orderBy: { dateFinApprox: 'asc' },
      include: {
        projet: { select: { id: true, nom: true, codeProjet: true } },
        assignesUtilisateurs: {
          include: { user: { select: { id: true, nom: true, prenom: true } } },
        },
        assignesEntites: {
          include: { entite: { select: { id: true, nom: true, code: true } } },
        },
        assignesClientsFournisseurs: {
          include: {
            clientFournisseur: { select: { id: true, nom: true, type: true } },
          },
        },
      },
    });

    return taches.map((t) => ({
      id: t.id,
      nom: t.nom,
      statut: t.statut,
      dateFinPrevue: t.dateFinApprox?.toISOString() ?? null,
      projet: t.projet
        ? { id: t.projet.id, nom: t.projet.nom, codeProjet: t.projet.codeProjet }
        : null,
      assignesUtilisateurs: t.assignesUtilisateurs.map((tu) => ({
        id: tu.user.id,
        nom: tu.user.nom,
        prenom: tu.user.prenom,
      })),
      assignesEntites: t.assignesEntites.map((te) => ({
        id: te.entite.id,
        nom: te.entite.nom,
        code: te.entite.code,
      })),
      assignesClientsFournisseurs: t.assignesClientsFournisseurs.map((tc) => ({
        id: tc.clientFournisseur.id,
        nom: tc.clientFournisseur.nom,
        type: tc.clientFournisseur.type,
      })),
    }));
  }

  async getKPIs(userId?: string, userRole?: string) {
    let whereClause: any = {};
    let entitesWhereClause: any = {};
    let projetWhereClause: any = { deletedAt: null };

    if (userRole === 'contributeur') {
      if (!userId) {
        whereClause = { id: { in: [] } };
        entitesWhereClause = { id: { in: [] } };
        projetWhereClause = { deletedAt: null, id: { in: [] } };
      } else {
        const assignedTasks = await prisma.tache.findMany({
          where: {
            deletedAt: null,
            assignesUtilisateurs: { some: { userId } },
          },
          select: { projetId: true },
        });
        const projetIds = [...new Set(assignedTasks.map((t) => t.projetId).filter(Boolean))] as string[];
        if (projetIds.length === 0) {
          whereClause = { id: { in: [] } };
          entitesWhereClause = { id: { in: [] } };
          projetWhereClause = { deletedAt: null, id: { in: [] } };
        } else {
          const entitesProjet = await prisma.projetEntite.findMany({
            where: { projetId: { in: projetIds } },
            select: { entiteId: true },
          });
          const entiteIds = [...new Set(entitesProjet.map((x) => x.entiteId))];
          whereClause =
            entiteIds.length > 0
              ? {
                  entites: {
                    some: {
                      entiteId: { in: entiteIds },
                    },
                  },
                }
              : { id: { in: [] } };
          entitesWhereClause = entiteIds.length > 0 ? { id: { in: entiteIds } } : { id: { in: [] } };
          projetWhereClause = {
            deletedAt: null,
            id: { in: projetIds },
          };
        }
      }
    } else if (userRole === 'lecteur') {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          entitesMembres: {
            select: { entiteId: true },
          },
        },
      });
      if (user?.entitesMembres && user.entitesMembres.length > 0) {
        const entiteIds = user.entitesMembres.map((ue) => ue.entiteId);
        whereClause = {
          entites: {
            some: {
              entite: {
                id: { in: entiteIds },
              },
            },
          },
        };
        entitesWhereClause = { id: { in: entiteIds } };
        projetWhereClause = {
          deletedAt: null,
          entites: { some: { entiteId: { in: entiteIds } } },
        };
      } else {
        whereClause = { id: { in: [] } };
        entitesWhereClause = { id: { in: [] } };
        projetWhereClause = { deletedAt: null, id: { in: [] } };
      }
    }

    const [
      processusTotal, 
      processusParStatut, 
      projetsActifs, 
      documentsRecents, 
      utilisateursActifs, 
      entitesTotal, 
      entitesAvecMembres, 
      documentsPlusVisualises, 
      documentsPlusTelecharges
    ] = await Promise.all([
      prisma.processus.count({ where: whereClause }),
      prisma.processus.groupBy({
        by: ['statut'],
        where: whereClause,
        _count: true,
      }),
      prisma.projet.groupBy({
        by: ['statut'],
        where: projetWhereClause,
        _count: true,
      }),
      prisma.document.findMany({
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          uploadedBy: { select: { nom: true, prenom: true } },
        },
      }),
      prisma.user.count({
        where: {
          statut: 'actif',
          derniereConnexion: {
            gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.entite.count({ where: entitesWhereClause }),
      prisma.entite.findMany({
        where: entitesWhereClause,
        select: {
          id: true,
          nom: true,
          code: true,
          _count: { select: { membres: true } },
        },
      }),
      prisma.journalAcces.groupBy({
        by: ['ressourceId'],
        where: { ressourceType: 'document', action: 'lecture' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
      prisma.journalAcces.groupBy({
        by: ['ressourceId'],
        where: { ressourceType: 'document', action: 'telechargement' },
        _count: { id: true },
        orderBy: { _count: { id: 'desc' } },
        take: 5,
      }),
    ]);

    const parStatut: Record<string, number> = {};
    processusParStatut.forEach((item) => {
      parStatut[item.statut] = item._count;
    });
    const projetsParStatutMap: Record<string, number> = {};
    projetsActifs.forEach((item: any) => {
      projetsParStatutMap[item.statut] = item._count;
    });

    const documentsVisualisesIds = documentsPlusVisualises.map((item) => item.ressourceId).filter(Boolean) as string[];
    const documentsVisualisesDetails = documentsVisualisesIds.length > 0
      ? await prisma.document.findMany({
          where: { id: { in: documentsVisualisesIds } },
          select: {
            id: true,
            nom: true,
            typeDocument: true,
            uploadedBy: { select: { nom: true, prenom: true } },
          },
        })
      : [];

    const visualisationsMap = new Map(documentsPlusVisualises.map((item) => [item.ressourceId, item._count.id]));

    const documentsTelechargesIds = documentsPlusTelecharges.map((item) => item.ressourceId).filter(Boolean) as string[];
    const documentsTelechargesDetails = documentsTelechargesIds.length > 0
      ? await prisma.document.findMany({
          where: { id: { in: documentsTelechargesIds } },
          select: {
            id: true,
            nom: true,
            typeDocument: true,
            uploadedBy: { select: { nom: true, prenom: true } },
          },
        })
      : [];

    const telechargementsMap = new Map(documentsPlusTelecharges.map((item) => [item.ressourceId, item._count.id]));

    const documentsVisualisesTries = documentsVisualisesDetails
      .map((doc) => ({
        ...doc,
        nombreVisualisations: visualisationsMap.get(doc.id) || 0,
      }))
      .sort((a, b) => b.nombreVisualisations - a.nombreVisualisations);

    const documentsTelechargesTries = documentsTelechargesDetails
      .map((doc) => ({
        ...doc,
        nombreTelechargements: telechargementsMap.get(doc.id) || 0,
      }))
      .sort((a, b) => b.nombreTelechargements - a.nombreTelechargements);

    const [projetsPlusActifs, tachesEnRetard] = await Promise.all([
      this.getProjetsPlusActifs(projetWhereClause),
      this.getTachesEnRetard(userId, userRole),
    ]);
    const adminProjetsParStatutEtEntites =
      userRole === 'admin' ? await this.getAdminProjetsParStatutEtEntites() : undefined;
    const adminGlobalTotals = userRole === 'admin' ? await this.getAdminGlobalTotals() : undefined;
    const tachesAssigneesEnInstance = await this.getTachesAssigneesEnInstance(userId, userRole);
    const projetsAssignesCount =
      userRole === 'contributeur'
        ? new Set(tachesAssigneesEnInstance.map((t) => t.projet?.id).filter(Boolean)).size
        : undefined;

    return {
      processus: { total: processusTotal, parStatut },
      projets: { actifs: Object.values(projetsParStatutMap).reduce((a, b) => a + b, 0), parStatut: projetsParStatutMap },
      projetsPlusActifs,
      tachesEnRetard,
      documentsRecents: documentsRecents.map((d) => ({
        id: d.id,
        nom: d.nom,
        typeDocument: d.typeDocument,
        uploadedBy: d.uploadedBy,
        createdAt: d.createdAt,
      })),
      utilisateursActifs,
      entitesTotal,
      entitesMembres: entitesAvecMembres,
      documentsPlusVisualises: documentsVisualisesTries,
      documentsPlusTelecharges: documentsTelechargesTries,
      tachesAssigneesEnInstance,
      projetsAssignesCount,
      adminGlobalTotals,
      adminProjetsParStatutEtEntites,
    };
  }
}