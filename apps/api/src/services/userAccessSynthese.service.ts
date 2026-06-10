import { prisma } from '../utils/prisma';
import { PermissionResource } from '../generated/prisma/enums';
import { UiModule } from '../generated/prisma/enums';
import { defaultUiModuleLevel, getEffectiveUiModules, UI_MODULE_LABELS } from './userUiModule.service';
import { getEntiteDescendantIds, getUserDirectEntiteIds, keepMostSpecificEntiteIds } from '../utils/entiteScope';

function govRolesForProjet(
  userId: string,
  p: {
    responsableId: string | null;
    gestionnaireId: string | null;
    createdById: string | null;
    sponsors?: { userId: string }[] | null;
    chefsProjet?: { userId: string }[] | null;
    techLeads?: { userId: string }[] | null;
    equipe?: { userId: string }[] | null;
  }
): string[] {
  const r: string[] = [];
  if (p.createdById === userId) r.push('créateur');
  if (p.responsableId === userId) r.push('responsable');
  if (p.gestionnaireId === userId) r.push('gestionnaire');
  if ((p.sponsors ?? []).some((s) => s.userId === userId)) r.push('sponsor');
  if ((p.chefsProjet ?? []).some((c) => c.userId === userId)) r.push('chef de projet');
  if ((p.techLeads ?? []).some((t) => t.userId === userId)) r.push('tech lead');
  if ((p.equipe ?? []).some((e) => e.userId === userId)) r.push('équipe');
  return r;
}

export class UserAccessSyntheseService {
  private async getUserEntiteIds(userId: string): Promise<string[]> {
    const direct = await getUserDirectEntiteIds(userId);
    return keepMostSpecificEntiteIds(direct);
  }

  private async getEntiteDescendantIds(rootIds: string[]): Promise<string[]> {
    return getEntiteDescendantIds([...new Set((rootIds || []).filter(Boolean))]);
  }

  async build(userId: string) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, role: true, prenom: true, nom: true, email: true },
    });
    if (!user) return null;

    const overrides = await prisma.userUiModuleAccess.findMany({
      where: { userId },
      orderBy: { module: 'asc' },
    });

    const effectiveMap = await getEffectiveUiModules(userId, user.role);
    const uiModules = (Object.values(UiModule) as UiModule[]).map((module) => ({
      module,
      label: UI_MODULE_LABELS[module],
      effectiveLevel: effectiveMap[module],
      defaultLevel: defaultUiModuleLevel(user.role, module),
      isOverride: overrides.some((o) => o.module === module),
    }));

    const [entiteIdsDirectes, entitesScope] = await (async () => {
      const directs = await this.getUserEntiteIds(userId);
      const scoped = await this.getEntiteDescendantIds(directs);
      const entites = scoped.length
        ? await prisma.entite.findMany({
            where: { id: { in: scoped }, deletedAt: null },
            select: { id: true, nom: true, code: true },
            orderBy: { nom: 'asc' },
          })
        : [];
      return [directs, entites] as const;
    })();

    const usersScopeRows =
      user.role === 'admin'
        ? []
        : entitesScope.length
          ? await prisma.user.findMany({
              where: {
                entitesMembres: { some: { entiteId: { in: entitesScope.map((e) => e.id) } } },
              },
              select: { id: true, prenom: true, nom: true, email: true },
              orderBy: [{ nom: 'asc' }, { prenom: 'asc' }],
              take: 500,
            })
          : [];

    const [
      permissionsRows,
      projetsGov,
      tacheAssigns,
      docPerms,
      userEntites,
      processusOwned,
      contratPerms,
      licencePerms,
    ] = await Promise.all([
      prisma.permission.findMany({
        where: { userId },
        include: {
          grantedBy: { select: { id: true, prenom: true, nom: true } },
        },
        orderBy: [{ ressourceType: 'asc' }, { createdAt: 'desc' }],
        take: 500,
      }),
      prisma.projet.findMany({
        where: {
          deletedAt: null,
          OR: [
            { responsableId: userId },
            { gestionnaireId: userId },
            { createdById: userId },
            { sponsors: { some: { userId } } },
            { chefsProjet: { some: { userId } } },
            { techLeads: { some: { userId } } },
            { equipe: { some: { userId } } },
          ],
        },
        select: {
          id: true,
          nom: true,
          codeProjet: true,
          responsableId: true,
          gestionnaireId: true,
          createdById: true,
          sponsors: { select: { userId: true } },
          chefsProjet: { select: { userId: true } },
          techLeads: { select: { userId: true } },
          equipe: { select: { userId: true } },
        },
        take: 300,
      }),
      prisma.tacheUser.findMany({
        where: { userId },
        include: {
          tache: {
            select: {
              id: true,
              nom: true,
              deletedAt: true,
              projetId: true,
              projet: { select: { id: true, nom: true, codeProjet: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.documentPermission.findMany({
        where: { userId },
        include: {
          document: { select: { id: true, nom: true, estConfidentiel: true } },
        },
        orderBy: { createdAt: 'desc' },
        take: 200,
      }),
      prisma.userEntite.findMany({
        where: { userId },
        include: { entite: { select: { id: true, nom: true, code: true } } },
      }),
      prisma.processus.findMany({
        where: { proprietaireId: userId, deletedAt: null },
        select: { id: true, nom: true, codeProcessus: true },
        take: 100,
      }),
      prisma.contratPermission.findMany({
        where: { userId, contrat: { deletedAt: null } },
        include: { contrat: { select: { id: true, nom: true, createdById: true } } },
        take: 100,
      }),
      prisma.licencePermission.findMany({
        where: { userId, licence: { deletedAt: null } },
        include: { licence: { select: { id: true, nom: true, reference: true } } },
        take: 100,
      }),
    ]);

    const projetIdsFromPerms = [
      ...new Set(
        permissionsRows.filter((p) => p.ressourceType === PermissionResource.projet).map((p) => p.ressourceId)
      ),
    ];
    const processusIdsFromPerms = [
      ...new Set(
        permissionsRows
          .filter((p) => p.ressourceType === PermissionResource.processus)
          .map((p) => p.ressourceId)
      ),
    ];
    const entiteIdsFromPerms = [
      ...new Set(
        permissionsRows.filter((p) => p.ressourceType === PermissionResource.entite).map((p) => p.ressourceId)
      ),
    ];
    const documentIdsFromPerms = [
      ...new Set(
        permissionsRows.filter((p) => p.ressourceType === PermissionResource.document).map((p) => p.ressourceId)
      ),
    ];
    const cfIdsFromPerms = [
      ...new Set(
        permissionsRows
          .filter((p) => p.ressourceType === PermissionResource.clientFournisseur)
          .map((p) => p.ressourceId)
      ),
    ];

    const [projetsMeta, processusMeta, entitesMeta, documentsMeta, cfMeta] = await Promise.all([
      projetIdsFromPerms.length
        ? prisma.projet.findMany({
            where: { id: { in: projetIdsFromPerms } },
            select: { id: true, nom: true, codeProjet: true },
          })
        : Promise.resolve([]),
      processusIdsFromPerms.length
        ? prisma.processus.findMany({
            where: { id: { in: processusIdsFromPerms } },
            select: { id: true, nom: true, codeProcessus: true },
          })
        : Promise.resolve([]),
      entiteIdsFromPerms.length
        ? prisma.entite.findMany({
            where: { id: { in: entiteIdsFromPerms } },
            select: { id: true, nom: true, code: true },
          })
        : Promise.resolve([]),
      documentIdsFromPerms.length
        ? prisma.document.findMany({
            where: { id: { in: documentIdsFromPerms } },
            select: { id: true, nom: true },
          })
        : Promise.resolve([]),
      cfIdsFromPerms.length
        ? prisma.clientFournisseur.findMany({
            where: { id: { in: cfIdsFromPerms } },
            select: { id: true, nom: true },
          })
        : Promise.resolve([]),
    ]);

    const pvImpliques = await prisma.pvReunion.findMany({
      where: {
        deletedAt: null,
        OR: [
          { createdById: userId },
          { modificationDelegues: { some: { userId } } },
          { presentsUser: { some: { userId } } },
        ],
      },
      select: {
        id: true,
        titre: true,
        createdAt: true,
        createdById: true,
        modificationDelegues: { where: { userId }, select: { id: true } },
      },
      orderBy: { createdAt: 'desc' },
      take: 80,
    });

    const projetMap = new Map(projetsMeta.map((p) => [p.id, p]));
    const processusMap = new Map(processusMeta.map((p) => [p.id, p]));
    const entiteMap = new Map(entitesMeta.map((e) => [e.id, e]));
    const documentMap = new Map(documentsMeta.map((d) => [d.id, d]));
    const cfMap = new Map(cfMeta.map((c) => [c.id, c]));

    const permissionsEnriched = permissionsRows.map((row) => {
      let ressourceLabel = row.ressourceId;
      if (row.ressourceType === PermissionResource.projet) {
        const x = projetMap.get(row.ressourceId);
        ressourceLabel = x ? `${x.nom} (${x.codeProjet})` : row.ressourceId;
      } else if (row.ressourceType === PermissionResource.processus) {
        const x = processusMap.get(row.ressourceId);
        ressourceLabel = x ? `${x.nom} (${x.codeProcessus})` : row.ressourceId;
      } else if (row.ressourceType === PermissionResource.entite) {
        const x = entiteMap.get(row.ressourceId);
        ressourceLabel = x ? `${x.nom} (${x.code})` : row.ressourceId;
      } else if (row.ressourceType === PermissionResource.document) {
        const x = documentMap.get(row.ressourceId);
        ressourceLabel = x ? x.nom : row.ressourceId;
      } else if (row.ressourceType === PermissionResource.clientFournisseur) {
        const x = cfMap.get(row.ressourceId);
        ressourceLabel = x ? x.nom : row.ressourceId;
      }
      return {
        id: row.id,
        ressourceType: row.ressourceType,
        ressourceId: row.ressourceId,
        ressourceLabel,
        permission: row.permission,
        grantedBy: row.grantedBy,
        createdAt: row.createdAt,
      };
    });

    const projetsGouvernance = projetsGov.map((p) => ({
      id: p.id,
      nom: p.nom,
      codeProjet: p.codeProjet,
      roles: govRolesForProjet(userId, p),
    }));

    const delegProjetIds = new Set(
      permissionsEnriched.filter((x) => x.ressourceType === PermissionResource.projet).map((x) => x.ressourceId)
    );
    const projetsGouvernanceDedup = projetsGouvernance.filter((p) => !delegProjetIds.has(p.id));

    return {
      user,
      uiModules,
      uiModuleOverrides: overrides,
      permissionsDeleguees: permissionsEnriched,
      projets: {
        gouvernance: projetsGouvernanceDedup,
        delegations: permissionsEnriched.filter((x) => x.ressourceType === PermissionResource.projet),
      },
      processus: {
        proprietaire: processusOwned,
        delegations: permissionsEnriched.filter((x) => x.ressourceType === PermissionResource.processus),
      },
      entites: {
        membres: userEntites.map((ue) => ({
          id: ue.id,
          entite: ue.entite,
        })),
        delegations: permissionsEnriched.filter((x) => x.ressourceType === PermissionResource.entite),
      },
      documents: {
        accesConfidentiel: docPerms.map((dp) => ({
          id: dp.id,
          documentId: dp.documentId,
          documentNom: dp.document?.nom ?? dp.documentId,
          confidentiel: dp.document?.estConfidentiel ?? false,
        })),
        delegations: permissionsEnriched.filter((x) => x.ressourceType === PermissionResource.document),
      },
      clientsFournisseurs: {
        delegations: permissionsEnriched.filter(
          (x) => x.ressourceType === PermissionResource.clientFournisseur
        ),
      },
      tachesAssignees: tacheAssigns
        .filter((tu) => tu.tache && !tu.tache.deletedAt)
        .map((tu) => ({
          tacheUserId: tu.id,
          tacheId: tu.tacheId,
          permission: tu.permission,
          tacheNom: tu.tache!.nom,
          projet: tu.tache!.projet,
        })),
      contrats: contratPerms.map((cp) => ({
        id: cp.id,
        contratId: cp.contratId,
        niveau: cp.niveau,
        contrat: cp.contrat,
        contratCreatedById: cp.contrat?.createdById ?? null,
      })),
      licences: licencePerms.map((lp) => ({
        id: lp.id,
        licenceId: lp.licenceId,
        niveau: lp.niveau,
        licence: lp.licence,
      })),
      pvReunions: pvImpliques.map((pv) => {
        let lien = 'présent';
        if (pv.createdById === userId) lien = 'créateur';
        else if (pv.modificationDelegues.length > 0) lien = 'délégué modification';
        return { id: pv.id, titre: pv.titre, createdAt: pv.createdAt, lien };
      }),
      pagesScopes: {
        entites: {
          directes: entiteIdsDirectes,
          scopeAvecEnfants: entitesScope,
        },
        utilisateurs:
          user.role === 'admin'
            ? {
                mode: 'global',
                description: "Administrateur : accès global aux utilisateurs (hors restrictions explicites).",
                visibleCount: null,
                preview: [],
              }
            : {
                mode: 'entite_enfants',
                description:
                  'Accès limité aux membres des entités de rattachement et de leurs entités enfants (parents exclus).',
                visibleCount: usersScopeRows.length,
                preview: usersScopeRows.slice(0, 20),
              },
      },
    };
  }
}
