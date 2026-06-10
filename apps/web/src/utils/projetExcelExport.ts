import * as XLSX from 'xlsx';
import type { Tache } from '../pages/Taches';

const STATUT_LABELS: Record<string, string> = {
  cree: 'Créée',
  a_faire: 'À faire / Non démarré',
  en_cours: 'En cours (Active)',
  en_attente: 'En attente / Suspendu',
  bloque: 'Bloqué / En retard',
  termine: 'Terminé / Finalisé',
  archive: 'Archivée',
};

function fmtDate(iso?: string) {
  if (!iso) return '';
  try {
    return new Date(iso).toLocaleDateString('fr-FR');
  } catch {
    return iso;
  }
}

function safeFilePart(s: string) {
  return s.replace(/[/\\?%*:|"<>]/g, '-').slice(0, 80);
}

function assignesPersonnes(t: Tache) {
  return (t.assignesUtilisateurs || []).map((x) => `${x.prenom} ${x.nom}`.trim()).join('; ') || '';
}

function assignesEntites(t: Tache) {
  return (t.assignesEntites || []).map((e) => e.nom).join('; ') || '';
}

function assignesClientsFournisseurs(t: Tache) {
  return (t.assignesClientsFournisseurs || [])
    .map((c) => `${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})`)
    .join('; ') || '';
}

function liaisonsResume(t: Tache) {
  const l = t.liaisons || [];
  if (l.length === 0) return '';
  return l
    .map((x) => `${x.type === 'concatenation' ? '🔗' : '↔'} ${x.tacheLiee?.nom || x.tacheLieeId || '?'}`)
    .join(' | ');
}

export type EpicExcelRow = {
  id: string;
  nom: string;
  description?: string | null;
  projetId?: string;
};

export type UserStoryExcelRow = {
  id: string;
  description: string;
  epicId?: string | null;
  epic?: { id: string; nom: string } | null;
};

const HEADERS_TACHES = [
  'ID',
  'Nom',
  'Statut',
  'Description',
  'Scénario exécution',
  "Critère d'acceptation",
  'Date début',
  'Date fin prévue',
  'Date création',
  'Créateur',
  'Assignés (personnes)',
  'Entités assignées',
  'Clients / fournisseurs assignés',
  'ID User story',
  'User story (description)',
  'ID Epic',
  'Epic (nom)',
  'Liaisons',
  'ID Projet',
  'Projet (nom)',
] as const;

const HEADERS_US = ['ID', 'Description', 'ID Epic', 'Epic (nom)'] as const;
const HEADERS_EPICS = ['ID', 'Nom', 'Description', 'ID Projet'] as const;

function rowTache(t: Tache): (string | number)[] {
  return [
    t.id,
    t.nom,
    STATUT_LABELS[t.statut] || t.statut,
    t.description ?? '',
    t.scenarioExecution ?? '',
    t.critereAcceptation ?? '',
    fmtDate(t.dateDebut),
    fmtDate(t.dateFinApprox),
    fmtDate(t.createdAt),
    t.createur ? `${t.createur.prenom} ${t.createur.nom}`.trim() : '',
    assignesPersonnes(t),
    assignesEntites(t),
    assignesClientsFournisseurs(t),
    t.userStory?.id ?? '',
    t.userStory?.description ?? '',
    t.userStory?.epic?.id ?? '',
    t.userStory?.epic?.nom ?? '',
    liaisonsResume(t),
    t.projetId ?? '',
    t.projet?.nom ?? '',
  ];
}

/**
 * Classeur Excel sur une seule feuille : blocs Tâches, User stories, Epics (données projet).
 */
export function exportProjetTachesUsEpicsExcel(
  projetNom: string,
  taches: Tache[],
  epics: EpicExcelRow[],
  userStories: UserStoryExcelRow[],
) {
  const aoa: (string | number)[][] = [];

  aoa.push([`Projet : ${projetNom}`]);
  aoa.push([`Export — ${new Date().toLocaleString('fr-FR')}`]);
  aoa.push([]);

  aoa.push(['TÂCHES']);
  aoa.push([...HEADERS_TACHES]);
  if (taches.length === 0) {
    aoa.push(['(Aucune tâche)']);
  } else {
    for (const t of taches) {
      aoa.push(rowTache(t));
    }
  }

  aoa.push([]);
  aoa.push(['USER STORIES']);
  aoa.push([...HEADERS_US]);
  if (userStories.length === 0) {
    aoa.push(['(Aucune user story)']);
  } else {
    for (const us of userStories) {
      aoa.push([
        us.id,
        us.description,
        us.epic?.id ?? us.epicId ?? '',
        us.epic?.nom ?? '',
      ]);
    }
  }

  aoa.push([]);
  aoa.push(['EPICS']);
  aoa.push([...HEADERS_EPICS]);
  if (epics.length === 0) {
    aoa.push(['(Aucun epic)']);
  } else {
    for (const e of epics) {
      aoa.push([e.id, e.nom, e.description ?? '', e.projetId ?? '']);
    }
  }

  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = [
    { wch: 14 },
    { wch: 36 },
    { wch: 22 },
    { wch: 40 },
    { wch: 28 },
    { wch: 28 },
    { wch: 12 },
    { wch: 14 },
    { wch: 14 },
    { wch: 22 },
    { wch: 32 },
    { wch: 24 },
    { wch: 32 },
    { wch: 14 },
    { wch: 48 },
    { wch: 14 },
    { wch: 28 },
    { wch: 40 },
    { wch: 14 },
    { wch: 24 },
  ];

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Projet');

  const base = safeFilePart(projetNom || 'projet');
  XLSX.writeFile(wb, `${base}_taches_user_stories_epics.xlsx`);
}
