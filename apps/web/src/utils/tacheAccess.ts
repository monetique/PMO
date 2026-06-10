import type { Tache } from '../pages/Taches';

/** Utilisateur présent dans la gouvernance du projet ou créateur / resp. du projet. */
export function userIsProjetGovernanceMember(userId: string, projet: any): boolean {
  if (!projet || !userId) return false;
  if (projet.createdById === userId) return true;
  if (projet.responsableId === userId) return true;
  if (projet.gestionnaireId === userId) return true;
  const lists = [projet.sponsors, projet.chefsProjet, projet.techLeads, projet.equipe];
  for (const list of lists) {
    for (const item of list || []) {
      const uid = item.user?.id ?? item.id;
      if (uid === userId) return true;
    }
  }
  return false;
}

function userEstMembreEntiteAssignee(tache: Tache, userId: string): boolean {
  for (const e of tache.assignesEntites || []) {
    const membres = (e as any).membres || [];
    for (const m of membres) {
      const u = m.user || m;
      if (u?.id === userId) return true;
    }
  }
  return false;
}

/**
 * Qui peut voir une tâche sur la fiche projet : aligné sur la page Tâches, avec extension
 * pour les membres de gouvernance du projet (toutes les tâches du projet).
 */
export function tacheVisiblePourUtilisateurSurProjetPage(
  tache: Tache,
  user: { id: string; role?: string } | null | undefined,
  projet: any,
): boolean {
  if (!user) return false;
  if (user.role === 'admin') return true;
  if (userIsProjetGovernanceMember(user.id, projet)) return true;

  const isCreator = tache.createurId === user.id;
  const isAssignee = !!(tache.assignesUtilisateurs?.some((u) => u.id === user.id));
  if (user.role === 'lecteur') {
    return isCreator || isAssignee || userEstMembreEntiteAssignee(tache, user.id);
  }
  if (user.role === 'contributeur') {
    return isCreator || isAssignee || userEstMembreEntiteAssignee(tache, user.id);
  }
  return isCreator || isAssignee;
}

/** Côté API : PUT /taches réservé aux admin et contributeurs. */
export function peutModifierTacheSelonApi(user: { role?: string } | null | undefined): boolean {
  if (!user) return false;
  return user.role === 'admin' || user.role === 'contributeur';
}
