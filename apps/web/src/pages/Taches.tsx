import { useCallback, useEffect, useState, useRef, useMemo, type FormEvent } from 'react';
import { Link, useLocation } from 'react-router-dom';
import TachesGanttView, { type TacheGantt } from '../components/TachesGanttView';
import TachesKanbanView, { type KanbanTache } from '../components/TachesKanbanView';
import TachesEnRetardBloc, { type TacheEnRetardItem } from '../components/TachesEnRetardBloc';
import {
  clampListPage,
  ListSectionPagination,
  LIST_SECTION_PAGE_SIZE,
} from '../components/ListSectionPagination';
import {
  EpicCreateModal,
  EpicDetailModal,
  EpicEditModal,
  UserStoryDetailModal,
  UserStoryEditModal,
  type EpicRow,
  type UserStoryRow,
} from '../components/EpicUserStoryModals';
import { PvReunionsLieesBlock } from '../components/PvReunionsLieesBlock';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { DocumentAccesNatifModal } from '../components/DocumentAccesNatifModal';
import { AgileDocumentsUserStorySection } from '../components/AgileDocumentsUserStorySection';
import BulkAgileCsvImportModal from '../components/BulkAgileCsvImportModal';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { isNativeAuthorControlledUploadDoc, normalizeDocumentAclFields } from '../utils/documentNativeAcces';

const DROITS_ADMIN_DOC_PROJET_NATIF =
  'visualisation, modification statut, accès, suppression (admin non exclu de la pièce)';

export const STATUT_OPTIONS = [
  { value: 'cree', label: 'Créée', color: 'bg-gray-100 text-gray-700' },
  { value: 'a_faire', label: 'À faire / Non démarré', color: 'bg-slate-100 text-slate-700' },
  { value: 'en_cours', label: 'En cours (Active)', color: 'bg-blue-100 text-blue-700' },
  { value: 'en_attente', label: 'En attente / Suspendu', color: 'bg-yellow-100 text-yellow-700' },
  { value: 'bloque', label: 'Bloqué / En retard', color: 'bg-red-100 text-red-700' },
  { value: 'termine', label: 'Terminé / Finalisé', color: 'bg-green-100 text-green-700' },
  { value: 'archive', label: 'Archivée', color: 'bg-purple-100 text-purple-700' },
];
const PRIORITE_OPTIONS = [
  { value: 'haute', label: 'Haute' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'basse', label: 'Basse' },
] as const;
const COMPLEXITE_OPTIONS = [
  { value: 'haute', label: 'Elevée' },
  { value: 'moyenne', label: 'Moyenne' },
  { value: 'basse', label: 'Basse' },
] as const;
const PRIORITE_RANK: Record<string, number> = { haute: 0, moyenne: 1, basse: 2 };
const COMPLEXITE_RANK: Record<string, number> = { haute: 0, moyenne: 1, basse: 2 };

const LIAISON_TYPES = [
  { value: 'concatenation', label: 'Concaténation (bloquante)' },
  { value: 'simple', label: 'Liaison simple (informative)' },
];

const LABEL_LOG_ACTION: Record<string, string> = {
  connexion: 'Connexion',
  deconnexion: 'Déconnexion',
  lecture: 'Consultation',
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  telechargement: 'Téléchargement',
  export: 'Export',
};

const PERM_TACHE_OPTIONS: { value: string; label: string }[] = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
  { value: 'gestion', label: '🔐 Gestion des accès' },
];
const PERM_TACHE_LABEL: Record<string, string> = Object.fromEntries(
  PERM_TACHE_OPTIONS.map((o) => [o.value, o.label])
) as Record<string, string>;

const MSG_ACCES_ASSIGNE_TACHE =
  "Impossible : cette personne est assignée à une tâche liée. Retirez d'abord l'assignation sur la tâche.";

const STATUT_SORT_RANK: Record<string, number> = {
  cree: 1,
  a_faire: 2,
  en_cours: 3,
  en_attente: 4,
  bloque: 5,
  termine: 6,
  archive: 7,
};

const LABEL_RESSOURCE: Record<string, string> = {
  processus: 'Processus',
  document: 'Document',
  projet: 'Projet',
  entite: 'Entité',
  utilisateur: 'Utilisateur',
  licence: 'Licence',
  clientFournisseur: 'Client / fournisseur',
  contrat: 'Contrat',
  tache: 'Tâche',
  epic: 'Epic',
  userStory: 'User story',
};

const HISTORY_TECHNICAL_KEYS = new Set([
  'path',
  'method',
  'ip',
  'query',
  'params',
  'body',
  'userAgent',
  'statusCode',
]);

function statutLabelFromValue(value?: string | null) {
  if (!value) return '—';
  return STATUT_OPTIONS.find((s) => s.value === value)?.label || value;
}

function normalizeHistoryDetails(details: any): Record<string, any> | null {
  if (!details) return null;
  if (typeof details === 'string') {
    try {
      const parsed = JSON.parse(details);
      if (parsed && typeof parsed === 'object') return parsed as Record<string, any>;
      return { details };
    } catch {
      return { details };
    }
  }
  if (typeof details === 'object') return details as Record<string, any>;
  return { details };
}

function formatHistoryDetails(h: any): string[] {
  const d = normalizeHistoryDetails(h?.details);
  if (!d) return [];
  const lines: string[] = [];
  const action = String(d.action || '');

  if (action === 'consultation_tache') lines.push('Consultation de la tâche');
  if (action === 'changement_statut') {
    lines.push(`Statut: ${statutLabelFromValue(d.ancienStatut)} -> ${statutLabelFromValue(d.nouveauStatut)}`);
  }
  if (action === 'document_ajoute_tache') {
    lines.push(`Document ajouté: ${d.documentNom || d.documentId || 'document'}`);
  }
  if (action === 'document_lie_tache') {
    lines.push(`Document rattaché: ${d.documentNom || d.documentId || 'document'}`);
  }
  if (action === 'document_delie_tache') {
    lines.push(`Document retiré de la tâche: ${d.documentNom || d.documentId || 'document'}`);
  }
  if (action === 'restauration') lines.push('Tâche restaurée depuis la corbeille');
  if (action === 'corbeille_tache') lines.push('Tâche déplacée vers la corbeille');
  if (action === 'commentaire_ajoute_tache') {
    const ap = d.apercu != null ? String(d.apercu) : '';
    lines.push(ap ? `Commentaire : ${ap}` : 'Commentaire ajouté');
  }

  const mods = Array.isArray(d.modifications) ? d.modifications : [];
  const fieldLabel: Record<string, string> = {
    nom: 'Nom',
    description: 'Description',
    scenarioExecution: "Scénario d'exécution",
    critereAcceptation: "Critère d'acceptation",
    statut: 'Statut',
    dateDebut: 'Date de début',
    dateFinApprox: 'Date de fin prévisionnelle',
    projetId: 'Projet',
    userStoryId: 'User story',
    assignesUtilisateurIds: 'Assignés',
    assignesEntiteIds: 'Entités',
    assignesClientFournisseurIds: 'Clients/Fournisseurs',
    liaisons: 'Liaisons',
  };
  for (const m of mods) {
    const champ = fieldLabel[m?.champ] || m?.champ || 'champ';
    if (m?.champ === 'statut') {
      lines.push(`${champ}: ${statutLabelFromValue(m?.avant)} -> ${statutLabelFromValue(m?.apres)}`);
      continue;
    }
    const avant =
      Array.isArray(m?.avant) || typeof m?.avant === 'object' ? JSON.stringify(m?.avant) : String(m?.avant ?? '—');
    const apres =
      Array.isArray(m?.apres) || typeof m?.apres === 'object' ? JSON.stringify(m?.apres) : String(m?.apres ?? '—');
    lines.push(`${champ}: ${avant} -> ${apres}`);
  }

  if (lines.length === 0) {
    for (const [k, v] of Object.entries(d)) {
      if (HISTORY_TECHNICAL_KEYS.has(k)) continue;
      if (k === 'action' || k === 'modifications') continue;
      const val = typeof v === 'object' ? JSON.stringify(v) : String(v);
      lines.push(`${k}: ${val}`);
    }
  }
  return lines;
}

function formatTempsActifDisplay(totalSeconds: number) {
  if (totalSeconds < 24 * 3600) {
    const hours = totalSeconds / 3600;
    return `${hours.toFixed(1)} h`;
  }
  const jours = Math.floor(totalSeconds / (24 * 3600));
  const heuresRestantes = Math.round((totalSeconds - jours * 24 * 3600) / 3600);
  return `${jours} j ${heuresRestantes} h`;
}

export type Tache = {
  id: string;
  nom: string;
  statut: string;
  tempsActifSecondes?: number;
  chronoActifDepuis?: string | null;
  priorite?: 'basse' | 'moyenne' | 'haute' | string;
  complexite?: 'basse' | 'moyenne' | 'haute' | string;
  dateDebut?: string;
  dateFinApprox?: string;
  createdAt?: string;
  description?: string;
  scenarioExecution?: string;
  critereAcceptation?: string;
  projetId?: string;
  projet?: { id: string; nom: string };
  assignesUtilisateurs?: { id: string; nom: string; prenom: string; permission?: string; tacheUserId?: string }[];
  assignesEntites?: { id: string; nom: string }[];
  assignesClientsFournisseurs?: { id: string; nom: string; type: string }[];
  liaisons?: { id: string; tacheId: string; tacheLieeId: string; type: string; tacheLiee?: { id: string; nom: string; statut: string } }[];
  commentaires?: Commentaire[];
  documents?: DocTache[];
  createurId?: string;
  createur?: { id: string; nom: string; prenom: string };
  userStory?: {
    id: string;
    description: string;
    epic?: {
      id: string;
      nom: string;
      description?: string | null;
      projetId?: string;
      projet?: { id: string; nom: string };
      assignesEntites?: { entite: { id: string; nom: string } }[];
      assignesClientsFournisseurs?: { clientFournisseur: { id: string; nom: string; type: string } }[];
    } | null;
  } | null;
};

export type DocTache = {
  id: string;
  nom: string;
  typeDocument: string;
  fichierType: string;
  statut: string;
  estConfidentiel: boolean;
  referenceType?: string | null;
  referenceId?: string | null;
  uploadedById?: string;
  uploadedBy?: { id: string; nom: string; prenom: string };
  permissionsUtilisateurs?: { user: { id: string; nom: string; prenom: string } }[];
  adminSansAccesUserIds?: string[];
};

type Commentaire = {
  id: string;
  contenu: string;
  auteur?: { id: string; nom: string; prenom: string };
  createdAt: string;
  pieceJointe?: string;
  pieceJointeNom?: string;
};

export type UserOption = { id: string; nom: string; prenom: string; role?: string };
export type EntiteOption = { id: string; nom: string };
export type ClientFournisseurOption = { id: string; nom: string; type: string };
export type ProjetOption = { id: string; nom: string };

export function StatutBadge({ statut }: { statut: string }) {
  const opt = STATUT_OPTIONS.find(s => s.value === statut);
  return (
    <span className={`px-2 py-1 rounded text-xs font-medium ${opt?.color || 'bg-gray-100 text-gray-700'}`}>
      {opt?.label || statut}
    </span>
  );
}

// ─── Avancement (tâches terminées / total) ───────────────────────────────────
/** Pourcentage basé sur le statut « termine », aligné sur le KPI « Terminées » du tableau de bord. */
export function TachesAvancementBlock({ taches }: { taches: Tache[] }) {
  const total = taches.length;
  if (total === 0) return null;
  const terminees = taches.filter((t) => t.statut === 'termine').length;
  const pct = Math.round((terminees / total) * 100);
  return (
    <div
      className="mb-4 rounded-lg border border-teal-100 bg-gradient-to-r from-teal-50/90 to-emerald-50/80 p-4 shadow-sm"
      aria-label="Avancement des tâches"
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
        <span className="text-sm font-semibold text-gray-800">Avancement / réalisation</span>
        <span className="text-xl font-bold text-teal-700 tabular-nums">{pct}%</span>
      </div>
      <div className="h-3 bg-gray-200/90 rounded-full overflow-hidden">
        <div
          className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500 ease-out"
          style={{ width: `${pct}%` }}
          role="progressbar"
          aria-valuenow={pct}
          aria-valuemin={0}
          aria-valuemax={100}
        />
      </div>
      <p className="text-xs text-gray-600 mt-2">
        <span className="tabular-nums font-medium text-gray-800">{terminees}</span> tâche
        {terminees !== 1 ? 's' : ''} terminée{terminees !== 1 ? 's' : ''} sur{' '}
        <span className="tabular-nums font-medium text-gray-800">{total}</span> (statut « Terminé / Finalisé »)
      </p>
    </div>
  );
}

// ─── Dashboard Stats ──────────────────────────────────────────────────────────
type AggRow = {
  nom: string;
  total: number;
  terminees: number;
  retard: number;
  /** Somme des jours de dépassement (échéance → aujourd’hui), min 0 par tâche, pour les tâches avec date de fin. */
  joursRetardTotal: number;
  retardDetails: { nom: string; jours: number }[];
};

function accumulateTaskForAgg(
  row: AggRow,
  t: Tache,
  now: Date,
) {
  row.total++;
  if (t.statut === 'termine') row.terminees++;
  if (t.statut === 'bloque' || (t.dateFinApprox && new Date(t.dateFinApprox) < now && t.statut !== 'termine' && t.statut !== 'archive')) {
    row.retard++;
    if (t.dateFinApprox) {
      const raw = Math.floor((now.getTime() - new Date(t.dateFinApprox).getTime()) / (1000 * 3600 * 24));
      const jours = Math.max(0, raw);
      row.retardDetails.push({ nom: t.nom, jours });
      row.joursRetardTotal += jours;
    }
  }
}

/** Total de jours de retard sur l’ensemble des tâches : chaque tâche en retard ne compte qu’une fois. */
export function computeTotalJoursRetardTachesVisibles(taches: Tache[]): number {
  const now = new Date();
  let sum = 0;
  for (const t of taches) {
    const enRetard =
      t.statut === 'bloque' ||
      (t.dateFinApprox &&
        new Date(t.dateFinApprox) < now &&
        t.statut !== 'termine' &&
        t.statut !== 'archive');
    if (!enRetard || !t.dateFinApprox) continue;
    const raw = Math.floor((now.getTime() - new Date(t.dateFinApprox).getTime()) / (1000 * 3600 * 24));
    sum += Math.max(0, raw);
  }
  return sum;
}

function computeTachesAggByEntiteAndPerson(taches: Tache[]) {
  const now = new Date();
  const byEntite: Record<string, AggRow> = {};

  taches.forEach((t) => {
    const entites = t.assignesEntites || [];
    if (entites.length === 0) {
      const key = '__aucune__';
      if (!byEntite[key])
        byEntite[key] = { nom: 'Sans entité', total: 0, terminees: 0, retard: 0, joursRetardTotal: 0, retardDetails: [] };
      accumulateTaskForAgg(byEntite[key], t, now);
    } else {
      entites.forEach((e) => {
        if (!byEntite[e.id])
          byEntite[e.id] = { nom: e.nom, total: 0, terminees: 0, retard: 0, joursRetardTotal: 0, retardDetails: [] };
        accumulateTaskForAgg(byEntite[e.id], t, now);
      });
    }
  });

  const byPerson: Record<string, AggRow> = {};
  taches.forEach((t) => {
    const assignes = t.assignesUtilisateurs || [];
    if (assignes.length === 0) {
      const key = '__aucun_assigne__';
      if (!byPerson[key])
        byPerson[key] = { nom: 'Sans assigné', total: 0, terminees: 0, retard: 0, joursRetardTotal: 0, retardDetails: [] };
      accumulateTaskForAgg(byPerson[key], t, now);
    } else {
      assignes.forEach((u) => {
        if (!byPerson[u.id]) {
          byPerson[u.id] = {
            nom: `${u.prenom} ${u.nom}`.trim() || u.id,
            total: 0,
            terminees: 0,
            retard: 0,
            joursRetardTotal: 0,
            retardDetails: [],
          };
        }
        accumulateTaskForAgg(byPerson[u.id], t, now);
      });
    }
  });

  return { byEntite, byPerson };
}

function computeTachesAggByClientFournisseur(taches: Tache[]) {
  const now = new Date();
  const byCf: Record<string, AggRow> = {};
  taches.forEach((t) => {
    const cfs = t.assignesClientsFournisseurs || [];
    if (cfs.length === 0) {
      const key = '__aucun_cf__';
      if (!byCf[key])
        byCf[key] = {
          nom: 'Sans client / fournisseur',
          total: 0,
          terminees: 0,
          retard: 0,
          joursRetardTotal: 0,
          retardDetails: [],
        };
      accumulateTaskForAgg(byCf[key], t, now);
    } else {
      cfs.forEach((c) => {
        if (!byCf[c.id]) {
          byCf[c.id] = {
            nom: `${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})`,
            total: 0,
            terminees: 0,
            retard: 0,
            joursRetardTotal: 0,
            retardDetails: [],
          };
        }
        accumulateTaskForAgg(byCf[c.id], t, now);
      });
    }
  });
  return { byClientFournisseur: byCf };
}

function TachesParEntiteTableBlock({ byEntite }: { byEntite: Record<string, AggRow> }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h2 className="text-base font-semibold text-gray-700">📊 Tâches par entité</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Entité</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Terminées</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">En retard</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase" title="Somme des jours de dépassement (par tâche en retard avec échéance)">
                Σ jours retard
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Détail retard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.values(byEntite)
              .sort((a, b) => b.total - a.total)
              .map((e, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{e.nom}</td>
                  <td className="px-4 py-3 text-center">{e.total}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-green-600 font-medium">{e.terminees}</span>
                    <span className="text-gray-400 text-xs ml-1">({e.total > 0 ? Math.round((e.terminees / e.total) * 100) : 0}%)</span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {e.retard > 0 ? <span className="text-red-600 font-medium">{e.retard}</span> : <span className="text-gray-400">0</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {e.joursRetardTotal > 0 ? (
                      <span className="text-red-700 font-medium">{e.joursRetardTotal}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {e.retardDetails.length > 0
                      ? e.retardDetails.map((d, j) => (
                          <div key={j}>
                            <span className="font-medium">{d.nom}</span> — <span className="text-red-500">{d.jours}j de retard</span>
                          </div>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            {Object.keys(byEntite).length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-400">
                  Aucune donnée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TachesParPersonneTableBlock({ byPerson }: { byPerson: Record<string, AggRow> }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h2 className="text-base font-semibold text-gray-700">👤 Tâches par personne (assignés)</h2>
        <p className="text-xs text-gray-500 mt-1">
          Une même tâche avec plusieurs assignés est comptée pour chacun, comme pour les entités.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Personne</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Terminées</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">En retard</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase" title="Somme des jours de dépassement (par tâche en retard avec échéance)">
                Σ jours retard
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Détail retard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.values(byPerson)
              .sort((a, b) => b.total - a.total)
              .map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.nom}</td>
                  <td className="px-4 py-3 text-center">{row.total}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-green-600 font-medium">{row.terminees}</span>
                    <span className="text-gray-400 text-xs ml-1">
                      ({row.total > 0 ? Math.round((row.terminees / row.total) * 100) : 0}%)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.retard > 0 ? <span className="text-red-600 font-medium">{row.retard}</span> : <span className="text-gray-400">0</span>}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.joursRetardTotal > 0 ? (
                      <span className="text-red-700 font-medium">{row.joursRetardTotal}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.retardDetails.length > 0
                      ? row.retardDetails.map((d, j) => (
                          <div key={j}>
                            <span className="font-medium">{d.nom}</span> — <span className="text-red-500">{d.jours}j de retard</span>
                          </div>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            {Object.keys(byPerson).length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-400">
                  Aucune donnée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TachesParClientFournisseurTableBlock({ byClientFournisseur }: { byClientFournisseur: Record<string, AggRow> }) {
  return (
    <div className="bg-white rounded-lg shadow overflow-hidden">
      <div className="p-4 border-b bg-gray-50">
        <h2 className="text-base font-semibold text-gray-700">🤝 Tâches par client / fournisseur (assignés)</h2>
        <p className="text-xs text-gray-500 mt-1">
          Une même tâche avec plusieurs clients ou fournisseurs assignés est comptée pour chacun, comme pour les entités et
          les personnes.
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full divide-y divide-gray-200 text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Client / fournisseur</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Total</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">Terminées</th>
              <th className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase">En retard</th>
              <th
                className="px-4 py-3 text-center text-xs font-medium text-gray-500 uppercase"
                title="Somme des jours de dépassement (par tâche en retard avec échéance)"
              >
                Σ jours retard
              </th>
              <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase">Détail retard</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {Object.values(byClientFournisseur)
              .sort((a, b) => b.total - a.total)
              .map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-medium text-gray-800">{row.nom}</td>
                  <td className="px-4 py-3 text-center">{row.total}</td>
                  <td className="px-4 py-3 text-center">
                    <span className="text-green-600 font-medium">{row.terminees}</span>
                    <span className="text-gray-400 text-xs ml-1">
                      ({row.total > 0 ? Math.round((row.terminees / row.total) * 100) : 0}%)
                    </span>
                  </td>
                  <td className="px-4 py-3 text-center">
                    {row.retard > 0 ? (
                      <span className="text-red-600 font-medium">{row.retard}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center tabular-nums">
                    {row.joursRetardTotal > 0 ? (
                      <span className="text-red-700 font-medium">{row.joursRetardTotal}</span>
                    ) : (
                      <span className="text-gray-400">0</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">
                    {row.retardDetails.length > 0
                      ? row.retardDetails.map((d, j) => (
                          <div key={j}>
                            <span className="font-medium">{d.nom}</span> —{' '}
                            <span className="text-red-500">{d.jours}j de retard</span>
                          </div>
                        ))
                      : '—'}
                  </td>
                </tr>
              ))}
            {Object.keys(byClientFournisseur).length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-6 text-gray-400">
                  Aucune donnée
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** Tableau pleine largeur client/fournisseur (même détail que par entité / personne). */
export function TachesParClientFournisseurGrid({ taches, className }: { taches: Tache[]; className?: string }) {
  if (taches.length === 0) return null;
  const { byClientFournisseur } = computeTachesAggByClientFournisseur(taches);
  return (
    <div className={className}>
      <TachesParClientFournisseurTableBlock byClientFournisseur={byClientFournisseur} />
    </div>
  );
}

/** Deux tableaux côte à côte (entité | personne), ex. pilotage projet sous la charge de travail. */
export function TachesParEntitePersonneGrid({ taches, className }: { taches: Tache[]; className?: string }) {
  if (taches.length === 0) return null;
  const { byEntite, byPerson } = computeTachesAggByEntiteAndPerson(taches);
  return (
    <div className={className}>
      <div className="grid md:grid-cols-2 gap-6">
        <TachesParEntiteTableBlock byEntite={byEntite} />
        <TachesParPersonneTableBlock byPerson={byPerson} />
      </div>
    </div>
  );
}

export function TachesDashboard({
  taches,
  showStatutBreakdown,
  showParPersonne,
  hideAvancement,
  hideTables,
}: {
  taches: Tache[];
  showStatutBreakdown?: boolean;
  /** Tableau KPI « par personne assignée » (ex. fiche projet) */
  showParPersonne?: boolean;
  /** Si true, ne pas afficher la barre d’avancement (déjà affichée au-dessus, ex. fiche projet) */
  hideAvancement?: boolean;
  /** Si true, n’affiche pas les tableaux entité / personne (affichés ailleurs, ex. ligne pleine largeur pilotage) */
  hideTables?: boolean;
}) {
  const now = new Date();
  const aggregations = hideTables ? undefined : computeTachesAggByEntiteAndPerson(taches);

  const totalTaches = taches.length;
  const terminees = taches.filter(t => t.statut === 'termine').length;
  const enCours = taches.filter(t => t.statut === 'en_cours').length;
  const bloquees = taches.filter(t => t.statut === 'bloque' || (t.dateFinApprox && new Date(t.dateFinApprox) < now && t.statut !== 'termine' && t.statut !== 'archive')).length;

  return (
    <div className={hideTables ? '' : 'mb-6'}>
      {!hideAvancement && <TachesAvancementBlock taches={taches} />}
      {/* KPIs globaux */}
      <div className={`grid grid-cols-2 md:grid-cols-4 gap-4 ${hideTables ? '' : 'mb-6'}`}>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-gray-800">{totalTaches}</div>
          <div className="text-sm text-gray-500 mt-1">Total tâches</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-green-600">{terminees}</div>
          <div className="text-sm text-gray-500 mt-1">Terminées</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-blue-600">{enCours}</div>
          <div className="text-sm text-gray-500 mt-1">En cours</div>
        </div>
        <div className="bg-white rounded-lg shadow p-4 text-center">
          <div className="text-3xl font-bold text-red-600">{bloquees}</div>
          <div className="text-sm text-gray-500 mt-1">En retard / Bloquées</div>
        </div>
      </div>

      {showStatutBreakdown && (
        <div className="bg-white rounded-lg shadow p-4 mb-6">
          <h3 className="text-sm font-semibold text-gray-700 mb-3">Répartition par statut</h3>
          <div className="flex flex-wrap gap-2">
            {STATUT_OPTIONS.map((s) => {
              const n = taches.filter((t) => t.statut === s.value).length;
              return (
                <div
                  key={s.value}
                  className={`px-3 py-2 rounded-lg text-sm font-medium ${s.color} border border-gray-100`}
                >
                  {s.label}: <span className="tabular-nums">{n}</span>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {aggregations && (
        <div className={showParPersonne ? 'grid md:grid-cols-2 gap-6' : ''}>
          <TachesParEntiteTableBlock byEntite={aggregations.byEntite} />
          {showParPersonne && <TachesParPersonneTableBlock byPerson={aggregations.byPerson} />}
        </div>
      )}
    </div>
  );
}

// ─── Modal Création / Édition ─────────────────────────────────────────────────
export function TacheModal({
  onClose,
  onSave,
  projets,
  users,
  entites,
  clientsFournisseurs,
  projetClientFournisseurIds,
  taches,
  editTache,
  lockProjetId,
  lockUserStoryId,
  overlayZClass = 'z-50',
}: {
  onClose: () => void;
  onSave: () => void;
  projets: ProjetOption[];
  users: UserOption[];
  entites: EntiteOption[];
  clientsFournisseurs: ClientFournisseurOption[];
  /** Si renseigné (ex. fiche projet), la liste est filtrée sur ces fiches + sélection courante. */
  projetClientFournisseurIds?: string[];
  taches: Tache[];
  editTache?: Tache;
  /** Si défini, le projet de la tâche est fixé (ex. création depuis la fiche projet). */
  lockProjetId?: string;
  /** Si défini, la user story est fixée (ex. création depuis le flux user story). */
  lockUserStoryId?: string;
  /** Au-dessus d’un autre modal (ex. création US), utiliser z-[90] ou plus. */
  overlayZClass?: string;
}) {
  const { user: currentUser } = useAuth();
  const [form, setForm] = useState({
    nom: editTache?.nom || '',
    statut: editTache?.statut || 'cree',
    priorite: editTache?.priorite || 'basse',
    complexite: editTache?.complexite || 'basse',
    dateDebut: editTache?.dateDebut ? editTache.dateDebut.split('T')[0] : '',
    dateFinApprox: editTache?.dateFinApprox ? editTache.dateFinApprox.split('T')[0] : '',
    description: editTache?.description || '',
    scenarioExecution: editTache?.scenarioExecution || '',
    critereAcceptation: editTache?.critereAcceptation || '',
    projetId: editTache?.projetId || lockProjetId || '',
  });
  const [selectedUsers, setSelectedUsers] = useState<string[]>(
    editTache?.assignesUtilisateurs?.map(u => u.id) || []
  );
  const [selectedEntites, setSelectedEntites] = useState<string[]>(
    editTache?.assignesEntites?.map(e => e.id) || []
  );
  const [selectedClientFournisseurIds, setSelectedClientFournisseurIds] = useState<string[]>(
    editTache?.assignesClientsFournisseurs?.map((c) => c.id) || []
  );
  const [liaisons, setLiaisons] = useState<{ tacheLieeId: string; type: string }[]>(
    editTache?.liaisons?.map(l => ({ tacheLieeId: l.tacheLieeId, type: l.type })) || []
  );
  const [userStoryId, setUserStoryId] = useState(editTache?.userStory?.id || lockUserStoryId || '');
  const [userStoryOptions, setUserStoryOptions] = useState<{ id: string; description: string }[]>([]);
  const [newDocFile, setNewDocFile] = useState<File | null>(null);
  const [newDocNom, setNewDocNom] = useState('');
  const [newDocDesc, setNewDocDesc] = useState('');
  const [newCommentaire, setNewCommentaire] = useState('');
  const [newCommentFile, setNewCommentFile] = useState<File | null>(null);
  const [modalCommentaires, setModalCommentaires] = useState<Commentaire[]>([]);
  const [modalHistory, setModalHistory] = useState<any[]>([]);
  const [modalSideLoading, setModalSideLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [idCopied, setIdCopied] = useState(false);

  useEffect(() => {
    if (lockUserStoryId) setUserStoryId(lockUserStoryId);
  }, [lockUserStoryId]);

  useEffect(() => {
    setSelectedClientFournisseurIds(editTache?.assignesClientsFournisseurs?.map((c) => c.id) || []);
  }, [editTache?.id]);

  const clientsFournisseursAffiches = useMemo(() => {
    const pidSet =
      projetClientFournisseurIds && projetClientFournisseurIds.length > 0
        ? new Set(projetClientFournisseurIds)
        : null;
    if (!pidSet) return clientsFournisseurs;
    const linked = clientsFournisseurs.filter((c) => pidSet!.has(c.id));
    const sel = new Set(selectedClientFournisseurIds);
    const extra = clientsFournisseurs.filter((c) => sel.has(c.id) && !pidSet!.has(c.id));
    const seen = new Set<string>();
    const out: ClientFournisseurOption[] = [];
    for (const c of [...linked, ...extra]) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
    return out;
  }, [clientsFournisseurs, projetClientFournisseurIds, selectedClientFournisseurIds]);

  useEffect(() => {
    const pid = form.projetId || lockProjetId;
    if (!pid) {
      setUserStoryOptions([]);
      return;
    }
    let cancel = false;
    api
      .get('/user-stories', { params: { projetId: pid } })
      .then(async (r) => {
        if (cancel) return;
        let list = Array.isArray(r.data) ? r.data : [];
        if (lockUserStoryId && !list.some((us: { id: string }) => us.id === lockUserStoryId)) {
          try {
            const one = await api.get(`/user-stories/${lockUserStoryId}`);
            const row = one.data as { id?: string; description?: string } | undefined;
            if (row?.id) {
              list = [...list, { id: row.id, description: row.description || '(User Storie)' }];
            }
          } catch {
            /* ignore */
          }
        }
        if (!cancel) setUserStoryOptions(list);
      })
      .catch(() => {
        if (!cancel) setUserStoryOptions([]);
      });
    return () => {
      cancel = true;
    };
  }, [form.projetId, lockProjetId, lockUserStoryId]);

  useEffect(() => {
    const id = editTache?.id;
    if (!id) {
      setModalCommentaires([]);
      setModalHistory([]);
      setModalSideLoading(false);
      return;
    }
    let cancel = false;
    setModalSideLoading(true);
    Promise.all([
      api.get(`/taches/${id}/commentaires`),
      api.get(`/taches/${id}/history`, { params: { page: 1, limit: 80 } }),
    ])
      .then(([cRes, hRes]) => {
        if (cancel) return;
        setModalCommentaires(Array.isArray(cRes.data) ? cRes.data : []);
        setModalHistory(Array.isArray(hRes.data?.data) ? hRes.data.data : []);
      })
      .catch(() => {
        if (!cancel) {
          setModalCommentaires([]);
          setModalHistory([]);
        }
      })
      .finally(() => {
        if (!cancel) setModalSideLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [editTache?.id]);

  const tacheIdForCommentLinks = editTache?.id;
  const commentaireFichierHref = (commentaireId: string) => {
    if (!tacheIdForCommentLinks) return '#';
    const token = localStorage.getItem('token');
    const q = token ? `?token=${encodeURIComponent(token)}` : '';
    return `${API_BASE_URL}/taches/${tacheIdForCommentLinks}/commentaires/${commentaireId}/fichier${q}`;
  };

  const toggleUser = (id: string) =>
    setSelectedUsers(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleEntite = (id: string) =>
    setSelectedEntites(prev => prev.includes(id) ? prev.filter(x => x !== id) : [...prev, id]);
  const toggleClientFournisseur = (id: string) =>
    setSelectedClientFournisseurIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );

  const addLiaison = () => setLiaisons(prev => [...prev, { tacheLieeId: '', type: 'simple' }]);
  const removeLiaison = (i: number) => setLiaisons(prev => prev.filter((_, j) => j !== i));
  const updateLiaison = (i: number, field: string, value: string) =>
    setLiaisons(prev => prev.map((l, j) => j === i ? { ...l, [field]: value } : l));

  const handleSave = async () => {
    setError('');
    if (!form.nom.trim()) { setError('Le nom de la tâche est obligatoire'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        assignesUtilisateurIds: selectedUsers,
        assignesEntiteIds: selectedEntites,
        assignesClientFournisseurIds: selectedClientFournisseurIds,
        liaisons: liaisons.filter(l => l.tacheLieeId),
        userStoryId: userStoryId || null,
      };
      let tacheId = editTache?.id || '';
      if (editTache) {
        const res = await api.put(`/taches/${editTache.id}`, payload);
        tacheId = res?.data?.id || editTache.id;
      } else {
        const res = await api.post('/taches', payload);
        tacheId = res?.data?.id || '';
      }

      if (newDocFile && tacheId) {
        const fd = new FormData();
        fd.append('fichier', newDocFile);
        fd.append('nom', newDocNom.trim() || newDocFile.name);
        if (newDocDesc.trim()) fd.append('description', newDocDesc.trim());
        await api.post(`/taches/${tacheId}/documents`, fd);
      }

      if ((newCommentaire.trim() || newCommentFile) && tacheId) {
        const fd = new FormData();
        if (newCommentaire.trim()) fd.append('contenu', newCommentaire.trim());
        if (newCommentFile) fd.append('fichier', newCommentFile);
        await api.post(`/taches/${tacheId}/commentaires`, fd);
      }
      onSave();
      onClose();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const currentProjetIdForLiaison = form.projetId || lockProjetId || editTache?.projetId || '';
  const autresTaches =
    currentProjetIdForLiaison
      ? taches.filter((t) => t.id !== editTache?.id && t.projetId === currentProjetIdForLiaison)
      : [];

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-4 ${overlayZClass}`}
    >
      <div className="bg-white rounded-lg shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto relative">
        <button onClick={onClose} className="absolute top-3 right-3 text-gray-400 hover:text-gray-700 text-2xl leading-none">×</button>
        <div className="p-6">
          <h2 className="text-xl font-bold mb-5">{editTache ? 'Modifier la tâche' : 'Nouvelle tâche'}</h2>
          {editTache?.id && (
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
              <span>
                ID tâche : <span className="font-mono text-gray-700 break-all">{editTache.id}</span>
              </span>
              <button
                type="button"
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(editTache.id);
                    setIdCopied(true);
                    setTimeout(() => setIdCopied(false), 1400);
                  } catch {
                    setError("Impossible de copier l'ID automatiquement.");
                  }
                }}
                className="px-2 py-0.5 rounded border border-gray-300 text-gray-700 hover:bg-gray-50"
                title="Copier l'ID de la tâche"
              >
                {idCopied ? 'Copié' : 'Copier l’ID'}
              </button>
            </div>
          )}
          {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}

          <div className="space-y-4">
            {/* Nom */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Nom de la tâche <span className="text-red-500">*</span></label>
              <input type="text" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:ring-blue-500 focus:border-blue-500" />
            </div>

            {/* Statut */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
              <select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md">
                {STATUT_OPTIONS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Priorité</label>
                <select
                  value={form.priorite}
                  onChange={(e) => setForm({ ...form, priorite: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {PRIORITE_OPTIONS.map((p) => (
                    <option key={p.value} value={p.value}>
                      {p.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Complexité</label>
                <select
                  value={form.complexite}
                  onChange={(e) => setForm({ ...form, complexite: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md"
                >
                  {COMPLEXITE_OPTIONS.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Projet */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Projet associé</label>
              <select
                value={form.projetId}
                onChange={e => setForm({ ...form, projetId: e.target.value })}
                disabled={!!lockProjetId}
                className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100 disabled:cursor-not-allowed"
              >
                <option value="">— Aucun projet —</option>
                {projets.map(p => <option key={p.id} value={p.id}>{p.nom}</option>)}
              </select>
              {lockProjetId && (
                <p className="text-xs text-gray-500 mt-1">Projet imposé par le contexte (fiche projet).</p>
              )}
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">User Storie</label>
              <select
                value={userStoryId}
                onChange={(e) => setUserStoryId(e.target.value)}
                disabled={!!lockUserStoryId}
                className="w-full px-3 py-2 border border-gray-300 rounded-md disabled:bg-gray-100"
              >
                <option value="">— Aucune —</option>
                {userStoryOptions.map((us) => (
                  <option key={us.id} value={us.id}>
                    {(us.description || '').slice(0, 80)}
                    {(us.description || '').length > 80 ? '…' : ''}
                  </option>
                ))}
              </select>
              <p className="text-xs text-gray-500 mt-1">Liste filtrée sur le projet de la tâche.</p>
              {lockUserStoryId && (
                <p className="text-xs text-amber-700 mt-1">
                  Rattachement imposé : cette tâche est liée à la User Storie en cours de création.
                </p>
              )}
            </div>

            {/* Dates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de début</label>
                <input type="date" value={form.dateDebut} onChange={e => setForm({ ...form, dateDebut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Date de fin approximative</label>
                <input type="date" value={form.dateFinApprox} onChange={e => setForm({ ...form, dateFinApprox: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md" />
              </div>
            </div>

            {/* Utilisateurs assignés */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Utilisateurs assignés</label>
              <div className="border border-gray-300 rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
                {users.map(u => (
                  <label key={u.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                    <input type="checkbox" checked={selectedUsers.includes(u.id)} onChange={() => toggleUser(u.id)} className="rounded" />
                    <span className="text-sm">{u.prenom} {u.nom}</span>
                  </label>
                ))}
                {users.length === 0 && <p className="text-sm text-gray-400 px-2">Aucun utilisateur disponible</p>}
              </div>
            </div>

            {/* Entités assignées */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Entités assignées</label>
              <div className="border border-gray-300 rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
                {entites.map(e => (
                  <label key={e.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded">
                    <input type="checkbox" checked={selectedEntites.includes(e.id)} onChange={() => toggleEntite(e.id)} className="rounded" />
                    <span className="text-sm">{e.nom}</span>
                  </label>
                ))}
                {entites.length === 0 && <p className="text-sm text-gray-400 px-2">Aucune entité disponible</p>}
              </div>
            </div>

            {/* Clients / fournisseurs assignés */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Clients / fournisseurs assignés</label>
              {projetClientFournisseurIds && projetClientFournisseurIds.length > 0 && (
                <p className="text-xs text-gray-500 mb-1">
                  Liste priorisée sur les fiches rattachées au projet ; les fiches déjà cochées restent visibles.
                </p>
              )}
              <div className="border border-gray-300 rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
                {clientsFournisseursAffiches.map((c) => (
                  <label
                    key={c.id}
                    className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 px-2 py-1 rounded"
                  >
                    <input
                      type="checkbox"
                      checked={selectedClientFournisseurIds.includes(c.id)}
                      onChange={() => toggleClientFournisseur(c.id)}
                      className="rounded"
                    />
                    <span className="text-sm">
                      <span className="font-medium">{c.nom}</span>
                      <span className="text-gray-500 text-xs ml-1">
                        ({c.type === 'fournisseur' ? 'Fournisseur' : c.type === 'client' ? 'Client' : c.type})
                      </span>
                    </span>
                  </label>
                ))}
                {clientsFournisseursAffiches.length === 0 && (
                  <p className="text-sm text-gray-400 px-2">Aucune fiche client / fournisseur disponible</p>
                )}
              </div>
            </div>

            {/* Description */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
              <textarea rows={3} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md resize-y" placeholder="Description de la tâche..." />
            </div>

            {/* Scénario d'exécution */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Scénario d'exécution</label>
              <textarea rows={3} value={form.scenarioExecution} onChange={e => setForm({ ...form, scenarioExecution: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md resize-y" placeholder="Étapes d'exécution..." />
            </div>

            {/* Critère d'acceptation */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Critère d'acceptation</label>
              <textarea rows={3} value={form.critereAcceptation} onChange={e => setForm({ ...form, critereAcceptation: e.target.value })}
                className="w-full px-3 py-2 border border-gray-300 rounded-md resize-y" placeholder="Conditions pour considérer la tâche terminée..." />
            </div>

            {/* Liaisons avec d'autres tâches */}
            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="block text-sm font-medium text-gray-700">Liaisons avec d'autres tâches</label>
                <button type="button" onClick={addLiaison}
                  className="text-sm text-blue-600 hover:text-blue-800 font-medium">+ Ajouter</button>
              </div>
              {liaisons.map((l, i) => (
                <div key={i} className="flex gap-2 mb-2 items-center">
                  <select value={l.tacheLieeId} onChange={e => updateLiaison(i, 'tacheLieeId', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-md text-sm">
                    <option value="">— Sélectionner une tâche —</option>
                    {autresTaches.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                  </select>
                  <select value={l.type} onChange={e => updateLiaison(i, 'type', e.target.value)}
                    className="px-3 py-2 border border-gray-300 rounded-md text-sm">
                    {LIAISON_TYPES.map(lt => <option key={lt.value} value={lt.value}>{lt.label}</option>)}
                  </select>
                  <button type="button" onClick={() => removeLiaison(i)}
                    className="text-red-500 hover:text-red-700 font-bold text-lg leading-none">×</button>
                </div>
              ))}
              {liaisons.length === 0 && <p className="text-sm text-gray-400">Aucune liaison définie</p>}
            </div>

            {editTache?.id && (
              <div className="space-y-4 border-t border-gray-200 pt-4">
                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Commentaires enregistrés</h3>
                  {modalSideLoading ? (
                    <p className="text-xs text-gray-500">Chargement…</p>
                  ) : modalCommentaires.length === 0 ? (
                    <p className="text-sm text-gray-400">Aucun commentaire pour l’instant</p>
                  ) : (
                    <ul className="space-y-2 max-h-48 overflow-y-auto">
                      {modalCommentaires.map((c) => (
                        <li key={c.id} className="bg-gray-50 rounded-lg p-3 text-sm">
                          <div className="flex flex-wrap items-center gap-2 text-xs text-gray-500 mb-1">
                            <span className="font-medium text-gray-700">
                              {c.auteur?.prenom} {c.auteur?.nom}
                            </span>
                            <span>{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
                          </div>
                          {c.contenu ? (
                            <p className="text-gray-800 whitespace-pre-wrap">{c.contenu}</p>
                          ) : null}
                          {c.pieceJointeNom && (
                            <a
                              href={commentaireFichierHref(c.id)}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-blue-600 hover:underline mt-1 inline-block"
                            >
                              Pièce jointe : {c.pieceJointeNom}
                            </a>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Documents rattachés</h3>
                  {!editTache.documents?.length ? (
                    <p className="text-sm text-gray-400">Aucun document lié à cette tâche</p>
                  ) : (
                    <ul className="space-y-1 max-h-36 overflow-y-auto text-sm">
                      {(editTache.documents || []).map((doc) => {
                        const tok = localStorage.getItem('token');
                        const q = tok ? `?token=${encodeURIComponent(tok)}` : '';
                        return (
                          <li key={doc.id}>
                            <a
                              href={`${API_BASE_URL}/documents/${doc.id}/view${q}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline"
                            >
                              {doc.nom}
                            </a>
                            <span className="text-gray-400 text-xs ml-2 capitalize">{doc.typeDocument}</span>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-gray-800 mb-2">Historique des actions</h3>
                  {modalSideLoading ? (
                    <p className="text-xs text-gray-500">Chargement…</p>
                  ) : modalHistory.length === 0 ? (
                    <p className="text-sm text-gray-400">Aucun événement enregistré</p>
                  ) : (
                    <ul className="space-y-2 max-h-52 overflow-y-auto text-xs">
                      {modalHistory.map((h: any) => (
                        <li key={h.id} className="border-b border-gray-100 pb-2">
                          <div className="flex flex-wrap justify-between gap-1 text-gray-500">
                            <span>{new Date(h.timestamp).toLocaleString('fr-FR')}</span>
                            <span>
                              {h.user?.prenom} {h.user?.nom}
                            </span>
                          </div>
                          <p className="font-medium text-gray-800 mt-0.5">
                            {LABEL_LOG_ACTION[h.action] || h.action}
                          </p>
                          {formatHistoryDetails(h).length > 0 && (
                            <ul className="mt-1 space-y-0.5 text-gray-700">
                              {formatHistoryDetails(h).map((line, idx) => (
                                <li key={`${h.id}-d-${idx}`}>— {line}</li>
                              ))}
                            </ul>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </div>
            )}

            {/* Document à ajouter à l'enregistrement */}
            <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Document (optionnel)</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-2 mb-2">
                <input
                  type="text"
                  value={newDocNom}
                  onChange={(e) => setNewDocNom(e.target.value)}
                  placeholder="Nom du document"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
                <input
                  type="text"
                  value={newDocDesc}
                  onChange={(e) => setNewDocDesc(e.target.value)}
                  placeholder="Description du document"
                  className="px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <input
                type="file"
                onChange={(e) => setNewDocFile(e.target.files?.[0] || null)}
                className="text-sm"
              />
            </div>

            {/* Commentaire + pièce jointe */}
            <div className="border border-gray-200 rounded-md p-3 bg-gray-50">
              <h3 className="text-sm font-semibold text-gray-800 mb-2">Commentaire (optionnel)</h3>
              <textarea
                rows={3}
                value={newCommentaire}
                onChange={(e) => setNewCommentaire(e.target.value)}
                placeholder="Ajouter un commentaire..."
                className="w-full px-3 py-2 border border-gray-300 rounded-md resize-y text-sm mb-2"
              />
              <input
                type="file"
                onChange={(e) => setNewCommentFile(e.target.files?.[0] || null)}
                className="text-sm"
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 mt-6 pt-4 border-t">
            <button onClick={onClose} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
              Annuler
            </button>
            <button onClick={handleSave} disabled={saving}
              className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
              {saving ? 'Enregistrement...' : (editTache ? 'Mettre à jour' : 'Créer')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function UserStoryCreateModalInner({
  onClose,
  onSaved,
  projets,
  taches,
  epics,
  lockEpicId,
}: {
  onClose: () => void;
  onSaved: () => void | Promise<void>;
  projets: ProjetOption[];
  taches: Tache[];
  epics: EpicRow[];
  lockEpicId?: string;
}) {
  const [description, setDescription] = useState('');
  const [epicId, setEpicId] = useState(lockEpicId || '');
  const [projetFilter, setProjetFilter] = useState('');
  const [selectedTacheIds, setSelectedTacheIds] = useState<string[]>([]);
  const [showTacheModal, setShowTacheModal] = useState(false);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [entites, setEntites] = useState<EntiteOption[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<ClientFournisseurOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');
  const [draftUserStoryId, setDraftUserStoryId] = useState<string | null>(null);

  const epic = epics.find((e) => e.id === epicId);
  const lockProjetId = epic?.projetId || '';

  useEffect(() => {
    if (!lockEpicId) return;
    setEpicId(lockEpicId);
    const epLock = epics.find((e) => e.id === lockEpicId);
    if (epLock?.projetId) setProjetFilter(epLock.projetId);
  }, [lockEpicId, epics]);

  useEffect(() => {
    (async () => {
      try {
        const [u, e, cf] = await Promise.all([
          api.get('/users'),
          api.get('/entites'),
          api.get('/clients-fournisseurs').catch(() => ({ data: [] })),
        ]);
        setUsers(u.data || []);
        setEntites(e.data || []);
        const cfRaw = Array.isArray(cf.data) ? cf.data : [];
        setClientsFournisseurs(cfRaw.map((c: any) => ({ id: c.id, nom: c.nom, type: c.type || 'client' })));
      } catch {
        setUsers([]);
        setEntites([]);
        setClientsFournisseurs([]);
      }
    })();
  }, []);

  const filteredEpics = projetFilter ? epics.filter((e) => e.projetId === projetFilter) : epics;

  /** Même logique que « Tâches liées » à l’édition : projet de l’epic, tâches libres ou déjà liées à ce brouillon d’US. */
  const tachesPourLier = taches.filter((t) => {
    if (lockProjetId && t.projetId !== lockProjetId) return false;
    if (t.userStory?.id && t.userStory.id !== draftUserStoryId) return false;
    return true;
  });

  const toggleTache = (id: string) =>
    setSelectedTacheIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  useEffect(() => {
    if (!draftUserStoryId) return;
    const linked = taches.filter((t) => t.userStory?.id === draftUserStoryId).map((t) => t.id);
    if (linked.length === 0) return;
    setSelectedTacheIds((prev) => [...new Set([...prev, ...linked])]);
  }, [taches, draftUserStoryId]);

  const ensureDraftUserStory = async (): Promise<string | null> => {
    if (!epicId) {
      alert('Choisissez un epic.');
      return null;
    }
    if (draftUserStoryId) return draftUserStoryId;
    const desc = description.trim() || '(Brouillon — complétez la description puis enregistrez)';
    try {
      const { data } = await api.post('/user-stories', {
        description: desc,
        epicId,
        tacheIds: selectedTacheIds,
      });
      if (data?.id) {
        setDraftUserStoryId(data.id);
        return data.id as string;
      }
    } catch (ex: any) {
      alert(ex?.response?.data?.error || 'Impossible de créer la user story');
    }
    return null;
  };

  const openNewTache = async () => {
    const usId = await ensureDraftUserStory();
    if (!usId) return;
    setShowTacheModal(true);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!description.trim() || !epicId) {
      setErr('Description et epic requis.');
      return;
    }
    setSaving(true);
    try {
      if (draftUserStoryId) {
        await api.put(`/user-stories/${draftUserStoryId}`, {
          description: description.trim(),
          tacheIds: selectedTacheIds,
        });
      } else {
        await api.post('/user-stories', {
          description: description.trim(),
          epicId,
          tacheIds: selectedTacheIds,
        });
      }
      await onSaved();
      onClose();
    } catch (ex: any) {
      setErr(ex?.response?.data?.error || ex?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-4">
        <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
          <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
            <h2 className="text-lg font-semibold">Nouvelle User Storie</h2>
            <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
              ×
            </button>
          </div>
          <form onSubmit={submit} className="p-5 space-y-4">
            {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{err}</div>}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Filtrer les epics par projet</label>
              <select
                value={projetFilter}
                onChange={(e) => {
                  setProjetFilter(e.target.value);
                  setEpicId('');
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={!!lockEpicId}
              >
                <option value="">Tous les projets</option>
                {projets.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.nom}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Epic *</label>
              <select
                value={epicId}
                onChange={(e) => {
                  setEpicId(e.target.value);
                  setDraftUserStoryId(null);
                  setSelectedTacheIds([]);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                disabled={!!lockEpicId}
                required
              >
                <option value="">— Choisir un epic —</option>
                {filteredEpics.map((ep) => (
                  <option key={ep.id} value={ep.id}>
                    {ep.nom} {ep.projet?.nom ? `(${ep.projet.nom})` : ''}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Description *</label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={4}
                className="w-full px-3 py-2 border border-gray-300 rounded-md"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tâches existantes à rattacher</label>
              <p className="text-xs text-gray-500 mb-1">
                Tâches du projet sans autre User Storie, ou déjà liées à celle-ci (y compris après « Nouvelle tâche »).
              </p>
              <div className="border rounded-md max-h-44 overflow-y-auto p-2 space-y-1">
                {tachesPourLier.map((t) => (
                  <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                    <input type="checkbox" checked={selectedTacheIds.includes(t.id)} onChange={() => toggleTache(t.id)} />
                    <span>
                      {t.nom}
                      {draftUserStoryId && t.userStory?.id === draftUserStoryId && (
                        <span className="text-violet-600 font-medium"> · liée à cette Storie</span>
                      )}
                    </span>
                  </label>
                ))}
                {tachesPourLier.length === 0 && epicId && (
                  <p className="text-xs text-gray-400">Aucune tâche éligible pour ce projet — créez-en une ci-dessous.</p>
                )}
              </div>
            </div>
            <div>
              <button
                type="button"
                onClick={() => void openNewTache()}
                disabled={!epicId}
                className="text-sm px-3 py-2 border border-dashed border-blue-400 text-blue-700 rounded-md hover:bg-blue-50 disabled:opacity-50"
              >
                + Nouvelle tâche (rattachée à cette User Storie)
              </button>
              {!epicId && <p className="text-xs text-amber-700 mt-1">Sélectionnez un epic d&apos;abord.</p>}
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md text-gray-700">
                Annuler
              </button>
              <button type="submit" disabled={saving} className="px-4 py-2 bg-violet-600 text-white rounded-md disabled:opacity-50">
                {saving ? 'Création…' : 'Enregistrer la User Storie'}
              </button>
            </div>
          </form>
        </div>
      </div>
      {showTacheModal && draftUserStoryId && lockProjetId && (
        <TacheModal
          onClose={() => setShowTacheModal(false)}
          onSave={async () => {
            await onSaved();
            setShowTacheModal(false);
          }}
          projets={projets}
          users={users}
          entites={entites}
          clientsFournisseurs={clientsFournisseurs}
          taches={taches}
          lockProjetId={lockProjetId}
          lockUserStoryId={draftUserStoryId}
          overlayZClass="z-[90]"
        />
      )}
    </>
  );
}

export type CommentairesTarget = { kind: 'tache' | 'epic' | 'userStory'; id: string };

function commentairesApiPaths(target: CommentairesTarget) {
  const token = localStorage.getItem('token');
  const q = token ? `?token=${token}` : '';
  if (target.kind === 'tache') {
    return {
      list: `/taches/${target.id}/commentaires`,
      post: `/taches/${target.id}/commentaires`,
      fichierUrl: (commentaireId: string) =>
        `${API_BASE_URL}/taches/${target.id}/commentaires/${commentaireId}/fichier${q}`,
    };
  }
  if (target.kind === 'epic') {
    return {
      list: `/epics/${target.id}/commentaires`,
      post: `/epics/${target.id}/commentaires`,
      fichierUrl: (commentaireId: string) =>
        `${API_BASE_URL}/epics/${target.id}/commentaires/${commentaireId}/fichier${q}`,
    };
  }
  return {
    list: `/user-stories/${target.id}/commentaires`,
    post: `/user-stories/${target.id}/commentaires`,
    fichierUrl: (commentaireId: string) =>
      `${API_BASE_URL}/user-stories/${target.id}/commentaires/${commentaireId}/fichier${q}`,
  };
}

// ─── Zone Commentaires (tâche, epic ou user story) ───────────────────────────
function CommentairesSection({ target, users }: { target: CommentairesTarget; users: UserOption[] }) {
  const [commentaires, setCommentaires] = useState<Commentaire[]>([]);
  const [texte, setTexte] = useState('');
  const [sending, setSending] = useState(false);
  const [fichier, setFichier] = useState<File | null>(null);
  const [showMentions, setShowMentions] = useState(false);
  const [mentionSearch, setMentionSearch] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const paths = commentairesApiPaths(target);

  useEffect(() => {
    void loadCommentaires();
  }, [target.kind, target.id]);

  const loadCommentaires = async () => {
    try {
      const res = await api.get(paths.list);
      setCommentaires(res.data);
    } catch {
      // silencieux
    }
  };

  const handleTextChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    setTexte(val);
    const lastAt = val.lastIndexOf('@');
    if (lastAt !== -1 && lastAt === val.length - 1) {
      setShowMentions(true);
      setMentionSearch('');
    } else if (lastAt !== -1 && val.slice(lastAt + 1).match(/^\w*$/)) {
      setShowMentions(true);
      setMentionSearch(val.slice(lastAt + 1));
    } else {
      setShowMentions(false);
    }
  };

  const insertMention = (u: UserOption) => {
    const lastAt = texte.lastIndexOf('@');
    const newTexte = texte.slice(0, lastAt) + `@${u.prenom} ${u.nom} `;
    setTexte(newTexte);
    setShowMentions(false);
    textareaRef.current?.focus();
  };

  const filteredMentions = users.filter(u =>
    `${u.prenom} ${u.nom}`.toLowerCase().includes(mentionSearch.toLowerCase())
  );

  const handleSend = async () => {
    if (!texte.trim() && !fichier) return;
    setSending(true);
    try {
      const formData = new FormData();
      formData.append('contenu', texte.trim());
      if (fichier) formData.append('fichier', fichier);
      await api.post(paths.post, formData);
      setTexte('');
      setFichier(null);
      if (fileRef.current) fileRef.current.value = '';
      await loadCommentaires();
    } catch {
      // silencieux
    } finally {
      setSending(false);
    }
  };

  return (
    <div>
      <h3 className="text-sm font-semibold text-gray-700 mb-3">💬 Commentaires</h3>
      <div className="space-y-3 mb-4 max-h-64 overflow-y-auto">
        {commentaires.length === 0 && <p className="text-sm text-gray-400">Aucun commentaire</p>}
        {commentaires.map(c => (
          <div key={c.id} className="bg-gray-50 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <div className="w-6 h-6 rounded-full bg-blue-500 text-white flex items-center justify-center text-xs font-bold">
                {c.auteur?.prenom?.[0]}{c.auteur?.nom?.[0]}
              </div>
              <span className="text-xs font-medium text-gray-700">{c.auteur?.prenom} {c.auteur?.nom}</span>
              <span className="text-xs text-gray-400">{new Date(c.createdAt).toLocaleString('fr-FR')}</span>
            </div>
            <p className="text-sm text-gray-700 whitespace-pre-wrap">{c.contenu}</p>
            {c.pieceJointeNom && (
              <a href={paths.fichierUrl(c.id)}
                target="_blank" rel="noreferrer"
                className="text-xs text-blue-600 hover:underline mt-1 block">
                📎 {c.pieceJointeNom}
              </a>
            )}
          </div>
        ))}
      </div>
      <div className="relative">
        <textarea
          ref={textareaRef}
          value={texte}
          onChange={handleTextChange}
          rows={2}
          placeholder="Ajouter un commentaire... (utilisez @ pour mentionner)"
          className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm resize-none focus:ring-blue-500 focus:border-blue-500"
        />
        {showMentions && filteredMentions.length > 0 && (
          <div className="absolute bottom-full left-0 bg-white border border-gray-200 rounded-md shadow-lg z-10 max-h-40 overflow-y-auto w-64">
            {filteredMentions.map(u => (
              <button key={u.id} onClick={() => insertMention(u)}
                className="w-full text-left px-3 py-2 text-sm hover:bg-blue-50 hover:text-blue-700">
                {u.prenom} {u.nom}
              </button>
            ))}
          </div>
        )}
      </div>
      <div className="flex items-center justify-between mt-2">
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" className="hidden" onChange={e => setFichier(e.target.files?.[0] || null)} />
          <button onClick={() => fileRef.current?.click()}
            className="text-xs text-gray-500 hover:text-blue-600 border border-gray-300 rounded px-2 py-1">
            📎 {fichier ? fichier.name : 'Pièce jointe'}
          </button>
          {fichier && (
            <button onClick={() => { setFichier(null); if (fileRef.current) fileRef.current.value = ''; }}
              className="text-xs text-red-500 hover:text-red-700">✕</button>
          )}
        </div>
        <button onClick={handleSend} disabled={sending || (!texte.trim() && !fichier)}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-50">
          {sending ? 'Envoi...' : 'Envoyer'}
        </button>
      </div>
    </div>
  );
}


// ── Calcul des personnes ayant accès à une tâche ─────────────────────────────
function getNiveauAcces(droit: string): number {
  if (droit.includes('modification + acces') || droit.includes('modification + accès')) return 3;
  if (droit.includes('modification')) return 2;
  return 1;
}

/** Aligné sur les délégations tâche / epic / user story (PermissionType). */
function droitFromAssignPermission(perm?: string): string {
  switch (perm) {
    case 'lecture':
      return 'lecture';
    case 'modification':
      return 'modification + lecture';
    case 'suppression':
      return 'modification + suppression + lecture';
    case 'gestion':
      return 'modification + accès + lecture';
    default:
      return 'modification + lecture';
  }
}

function getAccesPersonnes(tache: Tache, allUsers: UserOption[], opts?: { skipImplicitAdmins?: boolean }) {
  const personnesMap = new Map<string, { id: string; nom: string; roles: string[]; meilleurAcces: string }>();

  const add = (id: string, nom: string, role: string, acces: string) => {
    if (personnesMap.has(id)) {
      const p = personnesMap.get(id)!;
      if (!p.roles.includes(role)) p.roles.push(role);
      if (getNiveauAcces(acces) > getNiveauAcces(p.meilleurAcces)) {
        p.meilleurAcces = acces;
      }
    } else {
      personnesMap.set(id, { id, nom, roles: [role], meilleurAcces: acces });
    }
  };

  // 1. Admins (désactivé si la synthèse API couvre déjà les droits admin / exclusions)
  if (!opts?.skipImplicitAdmins) {
    allUsers.filter((u) => (u as any).role === 'admin').forEach((u) =>
      add(u.id, `${(u as any).prenom} ${u.nom}`, 'Admin', 'modification + accès + lecture')
    );
  }

  // 2. Assignés à la tâche (niveau issu de la délégation sur la tâche)
  (tache.assignesUtilisateurs || []).forEach((u) =>
    add(u.id, `${u.prenom} ${u.nom}`, 'Assigné à la tâche', droitFromAssignPermission(u.permission))
  );

  // 3. Membres du projet
  if ((tache as any).projet) {
    const projet = (tache as any).projet;
    (projet.equipe || []).forEach((m: any) => {
      const u = m.user || m;
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Équipe projet', 'lecture');
    });
    (projet.chefsProjet || []).forEach((m: any) => {
      const u = m.user || m;
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Chef de projet / PMO', 'lecture');
    });
    (projet.sponsors || []).forEach((m: any) => {
      const u = m.user || m;
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Sponsor / Superviseur', 'lecture');
    });
    (projet.techLeads || []).forEach((m: any) => {
      const u = m.user || m;
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, 'Tech Lead', 'lecture');
    });
  }

  // 4. Membres des entités assignées
  (tache.assignesEntites || []).forEach((e: any) => {
    (e.membres || []).forEach((m: any) => {
      const u = m.user || m;
      if (u?.id) add(u.id, `${u.prenom} ${u.nom}`, `Membre de ${e.nom}`, 'lecture');
    });
  });

  return Array.from(personnesMap.values()).map(p => ({
    id: p.id,
    nom: p.nom,
    roles: p.roles,
    droit: p.meilleurAcces,
  }));
}

type PersonneAcces = { id: string; nom: string; roles: string[]; droit: string };

function aggregateAccesFromTasks(tasks: Tache[], allUsers: UserOption[], skipImplicitAdmins?: boolean): PersonneAcces[] {
  const merged = new Map<string, { id: string; nom: string; roles: string[]; meilleurAcces: string }>();
  const mergeOne = (p: PersonneAcces) => {
    if (merged.has(p.id)) {
      const ex = merged.get(p.id)!;
      for (const r of p.roles) {
        if (!ex.roles.includes(r)) ex.roles.push(r);
      }
      if (getNiveauAcces(p.droit) > getNiveauAcces(ex.meilleurAcces)) ex.meilleurAcces = p.droit;
    } else {
      merged.set(p.id, { id: p.id, nom: p.nom, roles: [...p.roles], meilleurAcces: p.droit });
    }
  };
  for (const t of tasks) {
    for (const p of getAccesPersonnes(t, allUsers, { skipImplicitAdmins: !!skipImplicitAdmins })) mergeOne(p);
  }
  return Array.from(merged.values())
    .map((p) => ({ id: p.id, nom: p.nom, roles: p.roles, droit: p.meilleurAcces }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function getTachesLieesEpic(ep: EpicRow, taches: Tache[]): Tache[] {
  const usIds = new Set((ep.userStories || []).map((u) => u.id));
  return taches.filter((t) => t.userStory?.id && usIds.has(t.userStory.id));
}

function getTachesLieesUserStory(usId: string, taches: Tache[]): Tache[] {
  return taches.filter((t) => t.userStory?.id === usId);
}

function getAccesPersonnesEpic(ep: EpicRow, taches: Tache[], allUsers: UserOption[], skipImplicitAdmins?: boolean): PersonneAcces[] {
  const tasks = getTachesLieesEpic(ep, taches);
  const base = aggregateAccesFromTasks(tasks, allUsers, skipImplicitAdmins);
  if (ep.createdBy?.id) {
    const id = ep.createdBy.id;
    const nom = `${ep.createdBy.prenom} ${ep.createdBy.nom}`;
    const idx = base.findIndex((p) => p.id === id);
    if (idx < 0) {
      base.push({ id, nom, roles: ['Créateur epic'], droit: 'modification + lecture' });
    } else {
      const p = base[idx];
      if (!p.roles.includes('Créateur epic')) {
        base[idx] = { ...p, roles: [...p.roles, 'Créateur epic'] };
      }
    }
  }
  return base.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function getAccesPersonnesUserStory(usId: string, taches: Tache[], allUsers: UserOption[], skipImplicitAdmins?: boolean): PersonneAcces[] {
  return aggregateAccesFromTasks(getTachesLieesUserStory(usId, taches), allUsers, skipImplicitAdmins);
}

function mergeDeuxListesPersonnesAcces(a: PersonneAcces[], b: PersonneAcces[]): PersonneAcces[] {
  const merged = new Map<string, { id: string; nom: string; roles: string[]; meilleurAcces: string }>();
  const mergeOne = (p: PersonneAcces) => {
    if (merged.has(p.id)) {
      const ex = merged.get(p.id)!;
      for (const r of p.roles) {
        if (!ex.roles.includes(r)) ex.roles.push(r);
      }
      if (getNiveauAcces(p.droit) > getNiveauAcces(ex.meilleurAcces)) ex.meilleurAcces = p.droit;
    } else {
      merged.set(p.id, { id: p.id, nom: p.nom, roles: [...p.roles], meilleurAcces: p.droit });
    }
  };
  for (const p of a) mergeOne(p);
  for (const p of b) mergeOne(p);
  return Array.from(merged.values())
    .map((p) => ({ id: p.id, nom: p.nom, roles: p.roles, droit: p.meilleurAcces }))
    .sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
}

/** Synthèse à partir du JSON renvoyé par GET …/acces (epic, user story ou tâche). */
function personnesFromAgileAccesApiDetail(
  detail: any | null | undefined,
  labels: { creatorRole: string; explicitRole: string; adminImplicitRole: string }
): PersonneAcces[] {
  if (!detail) return [];
  const merged = new Map<string, { id: string; nom: string; roles: string[]; meilleurAcces: string }>();
  const mergeOne = (p: PersonneAcces) => {
    if (merged.has(p.id)) {
      const ex = merged.get(p.id)!;
      for (const r of p.roles) {
        if (!ex.roles.includes(r)) ex.roles.push(r);
      }
      if (getNiveauAcces(p.droit) > getNiveauAcces(ex.meilleurAcces)) ex.meilleurAcces = p.droit;
    } else {
      merged.set(p.id, { id: p.id, nom: p.nom, roles: [...p.roles], meilleurAcces: p.droit });
    }
  };
  const deleg = (detail.delegations || []) as { user?: { id: string; nom: string; prenom: string }; permission?: string }[];
  const adminSans = new Set((detail.adminSansAccesUserIds || []) as string[]);

  if (detail.creator?.id) {
    mergeOne({
      id: detail.creator.id,
      nom: `${detail.creator.prenom} ${detail.creator.nom}`,
      roles: [labels.creatorRole],
      droit: 'modification + accès + lecture',
    });
  }
  for (const d of deleg) {
    if (!d.user?.id) continue;
    mergeOne({
      id: d.user.id,
      nom: `${d.user.prenom} ${d.user.nom}`,
      roles: [labels.explicitRole],
      droit: droitFromAssignPermission(d.permission),
    });
  }
  for (const adm of detail.admins || []) {
    if (!adm?.id) continue;
    const row = deleg.find((d: any) => d.user?.id === adm.id);
    const excluded = adminSans.has(adm.id);
    if (excluded && !row) continue;
    if (row) continue;
    mergeOne({
      id: adm.id,
      nom: `${adm.prenom} ${adm.nom}`,
      roles: [labels.adminImplicitRole],
      droit: 'modification + accès + lecture',
    });
  }
  return Array.from(merged.values())
    .map((p) => ({ id: p.id, nom: p.nom, roles: p.roles, droit: p.meilleurAcces }))
    .sort((x, y) => x.nom.localeCompare(y.nom, 'fr'));
}

/**
 * Admin exclu de la tâche (adminSansAcces) sans ligne de délégation : ne plus l’afficher dans l’aperçu
 * uniquement comme membre projet / sponsor / entité — il n’a plus de droit effectif sur la tâche.
 */
function filterInheritedPersonnesPourAccesTache(inherited: PersonneAcces[], detail: any | null | undefined): PersonneAcces[] {
  if (!detail) return inherited;
  const excluded = new Set((detail.adminSansAccesUserIds || []) as string[]);
  const avecDelegation = new Set(
    (detail.delegations || []).map((d: any) => d.user?.id).filter(Boolean) as string[]
  );
  return inherited.filter((p) => {
    if (!excluded.has(p.id)) return true;
    return avecDelegation.has(p.id);
  });
}

function getAssigneeUserIdsUnderEpic(ep: EpicRow, taches: Tache[]): Set<string> {
  const ids = new Set<string>();
  for (const t of getTachesLieesEpic(ep, taches)) {
    for (const u of t.assignesUtilisateurs || []) ids.add(u.id);
  }
  return ids;
}

function getAssigneeUserIdsUnderUserStory(usId: string, taches: Tache[]): Set<string> {
  const ids = new Set<string>();
  for (const t of getTachesLieesUserStory(usId, taches)) {
    for (const u of t.assignesUtilisateurs || []) ids.add(u.id);
  }
  return ids;
}

function getPersonnesHabiliteesEpic(ep: EpicRow, taches: Tache[], users: UserOption[], snapshot: Record<string, any>) {
  const snap = snapshot[`epic:${ep.id}`];
  const inherited = getAccesPersonnesEpic(ep, taches, users, !!snap);
  const apiOverlay = personnesFromAgileAccesApiDetail(snap ?? null, {
    creatorRole: 'Créateur epic',
    explicitRole: "Accès délégué sur l'epic",
    adminImplicitRole: 'Administrateur',
  });
  return mergeDeuxListesPersonnesAcces(inherited, apiOverlay);
}

function getPersonnesHabiliteesUserStory(usId: string, taches: Tache[], users: UserOption[], snapshot: Record<string, any>) {
  const snap = snapshot[`us:${usId}`];
  const inherited = getAccesPersonnesUserStory(usId, taches, users, !!snap);
  const apiOverlay = personnesFromAgileAccesApiDetail(snap ?? null, {
    creatorRole: 'Créateur user story',
    explicitRole: 'Accès délégué sur la user story',
    adminImplicitRole: 'Administrateur',
  });
  return mergeDeuxListesPersonnesAcces(inherited, apiOverlay);
}

function getAssignesDepuisTaches(tasks: Tache[]) {
  const m = new Map<string, string>();
  for (const t of tasks) {
    for (const u of t.assignesUtilisateurs || []) {
      m.set(u.id, `${u.prenom} ${u.nom}`);
    }
  }
  return [...m.entries()]
    .map(([id, label]) => ({ id, label }))
    .sort((a, b) => a.label.localeCompare(b.label, 'fr'));
}

function getEntitesDepuisTaches(tasks: Tache[]) {
  const m = new Map<string, string>();
  for (const t of tasks) {
    for (const e of t.assignesEntites || []) {
      m.set(e.id, e.nom);
    }
  }
  return [...m.entries()]
    .map(([id, nom]) => ({ id, nom }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

function getClientsDepuisTaches(tasks: Tache[]) {
  const m = new Map<string, { nom: string; type: string }>();
  for (const t of tasks) {
    for (const c of t.assignesClientsFournisseurs || []) {
      m.set(c.id, { nom: c.nom, type: c.type });
    }
  }
  return [...m.entries()]
    .map(([id, v]) => ({ id, nom: v.nom, type: v.type }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Fusionne plusieurs listes clients/fournisseurs (sans doublon d’id). */
function mergeClientsFournisseurRows(
  groups: { id: string; nom: string; type: string }[][],
): { id: string; nom: string; type: string }[] {
  const seen = new Set<string>();
  const out: { id: string; nom: string; type: string }[] = [];
  for (const group of groups) {
    for (const c of group) {
      if (seen.has(c.id)) continue;
      seen.add(c.id);
      out.push(c);
    }
  }
  return out.sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

/** Clients / fournisseurs visibles sur une user story : assignations sur l’US + hérités des tâches liées. */
function userStoryClientsEffectifs(us: UserStoryRow, tasksUs: Tache[]) {
  const fromTasks = getClientsDepuisTaches(tasksUs);
  const direct = (us.assignesClientsFournisseurs || []).map((row) => ({
    id: row.clientFournisseur.id,
    nom: row.clientFournisseur.nom,
    type: row.clientFournisseur.type,
  }));
  return mergeClientsFournisseurRows([direct, fromTasks]);
}

/** Clients / fournisseurs sur un epic : assignations sur l’epic + hérités des tâches (via les US). */
function epicClientsEffectifs(ep: EpicRow, tasksEp: Tache[]) {
  const fromEpic = (ep.assignesClientsFournisseurs || []).map((row) => ({
    id: row.clientFournisseur.id,
    nom: row.clientFournisseur.nom,
    type: row.clientFournisseur.type,
  }));
  const fromTasks = getClientsDepuisTaches(tasksEp);
  return mergeClientsFournisseurRows([fromEpic, fromTasks]);
}

function AccesPersonnesBlock({ personnes }: { personnes: PersonneAcces[] }) {
  if (personnes.length === 0) {
    return <p className="text-xs text-gray-400">Aucune personne (agrégation depuis les tâches liées).</p>;
  }
  return (
    <div className="flex flex-wrap gap-3">
      {personnes.map((p) => (
        <div key={p.id} className="flex items-center gap-2">
          <div
            className={`w-7 h-7 rounded-full text-white flex items-center justify-center text-xs font-bold shrink-0 ${
              p.droit.includes('modification + accès') || p.droit.includes('modification + acces')
                ? 'bg-blue-600'
                : p.droit.includes('modification')
                  ? 'bg-green-600'
                  : 'bg-gray-400'
            }`}
          >
            {p.nom
              .split(' ')
              .map((n) => n[0])
              .join('')
              .slice(0, 2)
              .toUpperCase()}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-800">{p.nom}</p>
            <p className="text-xs text-gray-400">{p.roles.join(' · ')}</p>
            <p
              className={`text-xs font-medium ${
                p.droit.includes('modification + accès') || p.droit.includes('modification + acces')
                  ? 'text-blue-600'
                  : p.droit.includes('modification')
                    ? 'text-green-600'
                    : 'text-gray-500'
              }`}
            >
              {p.droit}
            </p>
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Calcul des accès d'un document lié ───────────────────────────────────────
function getAccesDocument(doc: DocTache) {
  const personnes: { nom: string; droit: string }[] = [];
  const seen = new Set<string>();

  const add = (id: string, nom: string, droit: string) => {
    if (!seen.has(id)) { seen.add(id); personnes.push({ nom, droit }); }
  };

  if (doc.uploadedBy) {
    add(doc.uploadedBy.id, `${doc.uploadedBy.prenom} ${doc.uploadedBy.nom}`, 'Créateur : modification statut + accès + lecture');
  }

  if (doc.estConfidentiel) {
    (doc.permissionsUtilisateurs || []).forEach(p => {
      add(p.user.id, `${p.user.prenom} ${p.user.nom}`, 'Lecture : lecture');
    });
  }

  return personnes;
}

// ── Section Documents d'une Tâche ─────────────────────────────────────────────
function DocumentsTache({
  tacheId,
  documents,
  canEdit,
  users,
  onDocumentsChange,
}: {
  tacheId: string;
  documents: DocTache[];
  canEdit: boolean;
  users: UserOption[];
  onDocumentsChange?: () => void;
}) {
  const { user: currentUser } = useAuth();
  const [natifAccesDoc, setNatifAccesDoc] = useState<{ id: string; nom: string } | null>(null);
  const [convertingDocId, setConvertingDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocTache[]>(() => documents.map((d) => normalizeDocumentAclFields(d)));
  const [showUpload, setShowUpload] = useState(false);
  const [showLier, setShowLier] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNom, setUploadNom] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [searchDoc, setSearchDoc] = useState('');
  const [docsLiables, setDocsLiables] = useState<DocTache[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocs(documents.map((d) => normalizeDocumentAclFields(d)));
  }, [documents]);

  const loadDocsLiables = async () => {
    try {
      const res = await api.get(`/taches/documents-liables?search=${searchDoc}`);
      setDocsLiables(res.data);
    } catch { /* silencieux */ }
  };

  useEffect(() => { if (showLier) loadDocsLiables(); }, [showLier, searchDoc]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('fichier', uploadFile);
      formData.append('nom', uploadNom || uploadFile.name);
      formData.append('description', uploadDesc);
      const res = await api.post(`/taches/${tacheId}/documents`, formData);
      setDocs((prev) => [...prev, normalizeDocumentAclFields(res.data)]);
      setShowUpload(false); setUploadFile(null); setUploadNom(''); setUploadDesc('');
      onDocumentsChange?.();
    } catch (e: any) { alert(e.response?.data?.error || 'Erreur upload'); }
    finally { setUploading(false); }
  };

  const handleLier = async () => {
    if (!selectedDocId) return;
    try {
      await api.post(`/taches/${tacheId}/documents/lier`, { documentId: selectedDocId });
      const doc = docsLiables.find(d => d.id === selectedDocId);
      if (doc) setDocs((prev) => [...prev, normalizeDocumentAclFields(doc)]);
      setShowLier(false); setSelectedDocId('');
      onDocumentsChange?.();
    } catch (e: any) { alert(e.response?.data?.error || 'Erreur liaison'); }
  };

  const handleDelier = async (documentId: string) => {
    if (!confirm('Délier ce document ?')) return;
    try {
      await api.delete(`/taches/${tacheId}/documents/${documentId}`);
      setDocs((prev) => prev.filter((d) => d.id !== documentId));
      onDocumentsChange?.();
    } catch (e: any) { alert(e.response?.data?.error || 'Erreur'); }
  };

  const openDocAcces = async (doc: DocTache) => {
    const actorId = currentUser?.id;
    if (!actorId || doc.uploadedById !== actorId) return;
    const alreadyNative = isNativeAuthorControlledUploadDoc(doc);
    if (alreadyNative) {
      setNatifAccesDoc({ id: doc.id, nom: doc.nom });
      return;
    }
    if (
      !window.confirm(
        "Ce document n'est pas encore en mode accès natif. Le passer en confidentiel (auteur + accès explicites) et ouvrir la gestion des accès ?"
      )
    ) {
      return;
    }
    setConvertingDocId(doc.id);
    try {
      await api.put(`/documents/${doc.id}`, {
        estConfidentiel: true,
        typeDocument: 'tache',
        permissionUserIds: [actorId],
      });
      onDocumentsChange?.();
      setNatifAccesDoc({ id: doc.id, nom: doc.nom });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur lors de la conversion des accès');
    } finally {
      setConvertingDocId(null);
    }
  };

  const getFileIcon = (type: string) => {
    if (type?.includes('pdf')) return '📄';
    if (type?.includes('image')) return '🖼️';
    if (type?.includes('word') || type?.includes('doc')) return '📝';
    if (type?.includes('excel') || type?.includes('sheet')) return '📊';
    return '📎';
  };

  const getAccesDoc = (doc: DocTache) => {
    if (!doc.estConfidentiel) return null;
    const membres: string[] = [];
    if (doc.uploadedBy) membres.push(`${doc.uploadedBy.prenom} ${doc.uploadedBy.nom} (Uploadeur)`);
    (doc.permissionsUtilisateurs || []).forEach(p => membres.push(`${p.user.prenom} ${p.user.nom}`));
    return membres;
  };

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase">📎 Documents ({docs.length})</h4>
        {canEdit && (
          <div className="flex gap-2">
            <button onClick={() => { setShowUpload(!showUpload); setShowLier(false); }}
              className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200">
              ⬆ Uploader
            </button>
            <button onClick={() => { setShowLier(!showLier); setShowUpload(false); }}
              className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded hover:bg-purple-100 border border-purple-200">
              🔗 Lier
            </button>
          </div>
        )}
      </div>

      {showUpload && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
          <input type="text" value={uploadNom} onChange={e => setUploadNom(e.target.value)}
            placeholder="Nom du document" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          <input type="text" value={uploadDesc} onChange={e => setUploadDesc(e.target.value)}
            placeholder="Description (optionnel)" className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" className="hidden" onChange={e => setUploadFile(e.target.files?.[0] || null)} />
            <button onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50">
              {uploadFile ? uploadFile.name : '📎 Choisir un fichier'}
            </button>
            <button onClick={handleUpload} disabled={!uploadFile || uploading}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">
              {uploading ? 'Upload...' : 'Uploader'}
            </button>
            <button onClick={() => setShowUpload(false)} className="text-xs text-gray-500">Annuler</button>
          </div>
        </div>
      )}

      {showLier && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3 space-y-2">
          <input type="text" value={searchDoc} onChange={e => setSearchDoc(e.target.value)}
            placeholder="Rechercher (projet, processus, contrat)..."
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm" />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {docsLiables.map(d => (
              <div key={d.id} onClick={() => setSelectedDocId(d.id)}
                className={`flex items-center justify-between p-2 rounded cursor-pointer border ${selectedDocId === d.id ? 'bg-purple-100 border-purple-400' : 'bg-white border-gray-200 hover:bg-gray-50'}`}>
                <div className="flex items-center gap-2">
                  <span>{getFileIcon(d.fichierType)}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{d.nom}</p>
                    <p className="text-xs text-gray-500 capitalize">{d.typeDocument} {d.estConfidentiel && '🔒'}</p>
                  </div>
                </div>
              </div>
            ))}
            {docsLiables.length === 0 && <p className="text-sm text-gray-400 text-center py-2">Aucun document</p>}
          </div>
          {selectedDocId && (() => {
            const doc = docsLiables.find(d => d.id === selectedDocId);
            const acces = doc ? getAccesDoc(doc) : null;
            if (!acces) return null;
            return (
              <div className="bg-red-50 border border-red-200 rounded p-2">
                <p className="text-xs font-medium text-red-700 mb-1">🔒 Accès restreint :</p>
                {acces.map((m, i) => <p key={i} className="text-xs text-red-600">• {m}</p>)}
              </div>
            );
          })()}
          <div className="flex gap-2">
            <button onClick={handleLier} disabled={!selectedDocId}
              className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded disabled:opacity-50">Lier</button>
            <button onClick={() => setShowLier(false)} className="text-xs text-gray-500">Annuler</button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {docs.length === 0 && <p className="text-sm text-gray-400">Aucun document lié</p>}
        {docs.map((doc) => {
          const natif = isNativeAuthorControlledUploadDoc(doc);
          const accesPersonnes = getAccesDocument(doc);
          return (
            <div key={doc.id} className="bg-white border border-gray-200 rounded-lg p-3">
              {/* En-tête document */}
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-lg">{getFileIcon(doc.fichierType)}</span>
                  <div className="min-w-0">
                    <a href={`${API_BASE_URL}/documents/${doc.id}/view?token=${localStorage.getItem('token')}`}
                      target="_blank" rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline truncate block">{doc.nom}</a>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-500 capitalize">{doc.typeDocument}</span>
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">{doc.statut}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {doc.uploadedById === currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => void openDocAcces(doc)}
                      disabled={convertingDocId === doc.id}
                      className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                    >
                      {convertingDocId === doc.id ? 'Conversion...' : `${'\u{1F511}'} Accès`}
                    </button>
                  )}
                  {canEdit && (
                    <button onClick={() => handleDelier(doc.id)} className="text-xs text-red-500 hover:text-red-700 shrink-0">
                      Délier
                    </button>
                  )}
                </div>
              </div>

              {/* Section Accès du document */}
              <div className="border-t border-gray-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accès :</p>
                {natif ? (
                  <div className="text-xs text-gray-700 space-y-2">
                    <div className="flex flex-col items-center w-fit">
                      <div className="w-14 h-14 bg-red-100 border border-red-300 rounded-lg flex flex-col items-center justify-center">
                        <span className="text-xl">{'\u{1F512}'}</span>
                      </div>
                      <span className="text-xs text-red-600 font-medium mt-1">Accès restreint</span>
                    </div>
                    <AccessContratLikeAdminLines
                      keyPrefix={`tache-doc-${doc.id}`}
                      users={users}
                      createdById={doc.uploadedById}
                      createdBy={doc.uploadedBy}
                      adminSansAccesUserIds={doc.adminSansAccesUserIds}
                      permissions={(doc.permissionsUtilisateurs || [])
                        .filter((p: any) => p.user?.role === 'admin')
                        .map((p: any) => ({
                          userId: p.userId || p.user?.id,
                          niveau: 'lecture',
                          user: p.user,
                        }))}
                      droitsAdminCompletLabel={DROITS_ADMIN_DOC_PROJET_NATIF}
                      creatorRightsLabel="auteur — tous les droits sur ce document"
                      niveauLabel={() => 'Lecture'}
                      limitedPrefix="Admin : accès limité —"
                    />
                    {(doc.permissionsUtilisateurs || [])
                      .filter((p: any) => p.user && p.user.role !== 'admin')
                      .map((p: any) => (
                        <div key={p.id || p.user.id} className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {p.user.prenom} {p.user.nom}
                          </span>
                          <span className="text-gray-500 italic ml-1">(Accès explicite : lecture)</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-3 flex-wrap">
                    {doc.estConfidentiel ? (
                      <div className="flex flex-col items-center">
                        <div className="w-14 h-14 bg-red-100 border border-red-300 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xl">🔒</span>
                        </div>
                        <span className="text-xs text-red-600 font-medium mt-1">Accès restreint</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <div className="w-14 h-14 bg-green-100 border border-green-300 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xl">🌐</span>
                        </div>
                        <span className="text-xs text-green-600 font-medium mt-1">Accès libre</span>
                      </div>
                    )}
                    {accesPersonnes.map((p, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {p.nom
                            .split(' ')
                            .map((n: string) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-800">{p.nom}</p>
                          <p className="text-xs text-gray-500 italic">({p.droit})</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <DocumentAccesNatifModal
        open={!!natifAccesDoc}
        document={natifAccesDoc}
        users={users}
        onClose={() => setNatifAccesDoc(null)}
        onAfterMutation={() => onDocumentsChange?.()}
      />
    </div>
  );
}

// ── Section Documents d'un Epic (même logique que les tâches) ─────────────────
function DocumentsEpic({
  epicId,
  documents,
  linkedTaskDocs,
  canEdit,
  onDocumentsChange,
  users,
}: {
  epicId: string;
  documents: DocTache[];
  linkedTaskDocs?: Array<{ taskId: string; taskNom: string; doc: DocTache }>;
  canEdit: boolean;
  onDocumentsChange?: () => void;
  users: UserOption[];
}) {
  const { user: currentUser } = useAuth();
  const [natifAccesDoc, setNatifAccesDoc] = useState<{ id: string; nom: string } | null>(null);
  const [convertingDocId, setConvertingDocId] = useState<string | null>(null);
  const [docs, setDocs] = useState<DocTache[]>(() => documents.map((d) => normalizeDocumentAclFields(d)));
  const [showUpload, setShowUpload] = useState(false);
  const [showLier, setShowLier] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadNom, setUploadNom] = useState('');
  const [uploadDesc, setUploadDesc] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [searchDoc, setSearchDoc] = useState('');
  const [docsLiables, setDocsLiables] = useState<DocTache[]>([]);
  const [selectedDocId, setSelectedDocId] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDocs(documents.map((d) => normalizeDocumentAclFields(d)));
  }, [documents]);

  const loadDocsLiables = async () => {
    try {
      const res = await api.get(`/taches/documents-liables?search=${encodeURIComponent(searchDoc)}`);
      setDocsLiables(res.data);
    } catch {
      /* silencieux */
    }
  };

  useEffect(() => {
    if (showLier) void loadDocsLiables();
  }, [showLier, searchDoc]);

  const handleUpload = async () => {
    if (!uploadFile) return;
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('fichier', uploadFile);
      formData.append('nom', uploadNom || uploadFile.name);
      formData.append('description', uploadDesc);
      const res = await api.post(`/epics/${epicId}/documents`, formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setDocs((prev) => [...prev, normalizeDocumentAclFields(res.data)]);
      setShowUpload(false);
      setUploadFile(null);
      setUploadNom('');
      setUploadDesc('');
      onDocumentsChange?.();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Erreur upload');
    } finally {
      setUploading(false);
    }
  };

  const handleLier = async () => {
    if (!selectedDocId) return;
    try {
      await api.post(`/epics/${epicId}/documents/lier`, { documentId: selectedDocId });
      const doc = docsLiables.find((d) => d.id === selectedDocId);
      if (doc) setDocs((prev) => [...prev, normalizeDocumentAclFields(doc)]);
      setShowLier(false);
      setSelectedDocId('');
      onDocumentsChange?.();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Erreur liaison');
    }
  };

  const handleDelier = async (documentId: string) => {
    if (!confirm('Délier ce document ?')) return;
    try {
      await api.delete(`/epics/${epicId}/documents/${documentId}`);
      setDocs((prev) => prev.filter((d) => d.id !== documentId));
      onDocumentsChange?.();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Erreur');
    }
  };

  const openDocAcces = async (doc: DocTache) => {
    const actorId = currentUser?.id;
    if (!actorId || doc.uploadedById !== actorId) return;
    const alreadyNative = isNativeAuthorControlledUploadDoc(doc);
    if (alreadyNative) {
      setNatifAccesDoc({ id: doc.id, nom: doc.nom });
      return;
    }
    if (
      !window.confirm(
        "Ce document n'est pas encore en mode accès natif. Le passer en confidentiel (auteur + accès explicites) et ouvrir la gestion des accès ?"
      )
    ) {
      return;
    }
    setConvertingDocId(doc.id);
    try {
      await api.put(`/documents/${doc.id}`, {
        estConfidentiel: true,
        typeDocument: 'epic',
        referenceType: 'epic',
        referenceId: epicId,
        permissionUserIds: [actorId],
      });
      onDocumentsChange?.();
      setNatifAccesDoc({ id: doc.id, nom: doc.nom });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur lors de la conversion des accès');
    } finally {
      setConvertingDocId(null);
    }
  };

  const getFileIcon = (type: string) => {
    if (type?.includes('pdf')) return '📄';
    if (type?.includes('image')) return '🖼️';
    if (type?.includes('word') || type?.includes('doc')) return '📝';
    if (type?.includes('excel') || type?.includes('sheet')) return '📊';
    return '📎';
  };

  const getAccesDoc = (doc: DocTache) => {
    if (!doc.estConfidentiel) return null;
    const membres: string[] = [];
    if (doc.uploadedBy) membres.push(`${doc.uploadedBy.prenom} ${doc.uploadedBy.nom} (Uploadeur)`);
    (doc.permissionsUtilisateurs || []).forEach((p) => membres.push(`${p.user.prenom} ${p.user.nom}`));
    return membres;
  };

  const linkedTaskDocsSafe = linkedTaskDocs || [];

  return (
    <div className="border-t border-gray-100 pt-3">
      <div className="flex items-center justify-between mb-2">
        <h4 className="text-xs font-semibold text-gray-500 uppercase">📎 Documents ({docs.length})</h4>
        {canEdit && (
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                setShowUpload(!showUpload);
                setShowLier(false);
              }}
              className="text-xs px-2 py-1 bg-blue-50 text-blue-600 rounded hover:bg-blue-100 border border-blue-200"
            >
              ⬆ Uploader
            </button>
            <button
              type="button"
              onClick={() => {
                setShowLier(!showLier);
                setShowUpload(false);
              }}
              className="text-xs px-2 py-1 bg-purple-50 text-purple-600 rounded hover:bg-purple-100 border border-purple-200"
            >
              🔗 Lier
            </button>
          </div>
        )}
      </div>

      {showUpload && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-3 space-y-2">
          <input
            type="text"
            value={uploadNom}
            onChange={(e) => setUploadNom(e.target.value)}
            placeholder="Nom du document"
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
          <input
            type="text"
            value={uploadDesc}
            onChange={(e) => setUploadDesc(e.target.value)}
            placeholder="Description (optionnel)"
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
          <div className="flex items-center gap-2 flex-wrap">
            <input ref={fileRef} type="file" className="hidden" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} />
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              className="text-xs px-3 py-1.5 border border-gray-300 rounded bg-white hover:bg-gray-50"
            >
              {uploadFile ? uploadFile.name : '📎 Choisir un fichier'}
            </button>
            <button
              type="button"
              onClick={() => void handleUpload()}
              disabled={!uploadFile || uploading}
              className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
            >
              {uploading ? 'Upload...' : 'Uploader'}
            </button>
            <button type="button" onClick={() => setShowUpload(false)} className="text-xs text-gray-500">
              Annuler
            </button>
          </div>
          <p className="text-[11px] text-amber-800">
            Déposé en confidentiel : gestion des accès (administrateurs, invités) via « Accès » pour l&apos;auteur du dépôt.
          </p>
        </div>
      )}

      {showLier && (
        <div className="bg-purple-50 border border-purple-200 rounded-lg p-3 mb-3 space-y-2">
          <input
            type="text"
            value={searchDoc}
            onChange={(e) => setSearchDoc(e.target.value)}
            placeholder="Rechercher (projet, processus, contrat)..."
            className="w-full px-3 py-1.5 border border-gray-300 rounded text-sm"
          />
          <div className="max-h-40 overflow-y-auto space-y-1">
            {docsLiables.map((d) => (
              <div
                key={d.id}
                role="button"
                tabIndex={0}
                onClick={() => setSelectedDocId(d.id)}
                onKeyDown={(ev) => {
                  if (ev.key === 'Enter' || ev.key === ' ') setSelectedDocId(d.id);
                }}
                className={`flex items-center justify-between p-2 rounded cursor-pointer border ${
                  selectedDocId === d.id ? 'bg-purple-100 border-purple-400' : 'bg-white border-gray-200 hover:bg-gray-50'
                }`}
              >
                <div className="flex items-center gap-2">
                  <span>{getFileIcon(d.fichierType)}</span>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{d.nom}</p>
                    <p className="text-xs text-gray-500 capitalize">
                      {d.typeDocument} {d.estConfidentiel && '🔒'}
                    </p>
                  </div>
                </div>
              </div>
            ))}
            {docsLiables.length === 0 && <p className="text-sm text-gray-400 text-center py-2">Aucun document</p>}
          </div>
          {selectedDocId &&
            (() => {
              const doc = docsLiables.find((d) => d.id === selectedDocId);
              const acces = doc ? getAccesDoc(doc) : null;
              if (!acces) return null;
              return (
                <div className="bg-red-50 border border-red-200 rounded p-2">
                  <p className="text-xs font-medium text-red-700 mb-1">🔒 Accès restreint :</p>
                  {acces.map((m, i) => (
                    <p key={i} className="text-xs text-red-600">
                      • {m}
                    </p>
                  ))}
                </div>
              );
            })()}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void handleLier()}
              disabled={!selectedDocId}
              className="text-xs px-3 py-1.5 bg-purple-600 text-white rounded disabled:opacity-50"
            >
              Lier
            </button>
            <button type="button" onClick={() => setShowLier(false)} className="text-xs text-gray-500">
              Annuler
            </button>
          </div>
        </div>
      )}

      <div className="space-y-2">
        {docs.length === 0 && <p className="text-sm text-gray-400">Aucun document lié</p>}
        {docs.map((doc) => {
          const natif = isNativeAuthorControlledUploadDoc(doc);
          const accesPersonnes = getAccesDocument(doc);
          return (
            <div key={doc.id} className="bg-white border border-gray-200 rounded-lg p-3">
              <div className="flex items-start justify-between gap-2 mb-2">
                <div className="flex items-start gap-2 flex-1 min-w-0">
                  <span className="text-lg">{getFileIcon(doc.fichierType)}</span>
                  <div className="min-w-0">
                    <a
                      href={`${API_BASE_URL}/documents/${doc.id}/view?token=${localStorage.getItem('token')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-sm font-medium text-blue-600 hover:underline truncate block"
                    >
                      {doc.nom}
                    </a>
                    <div className="flex gap-2 flex-wrap mt-0.5">
                      <span className="text-xs text-gray-500 capitalize">{doc.typeDocument}</span>
                      <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">{doc.statut}</span>
                    </div>
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  {doc.uploadedById === currentUser?.id && (
                    <button
                      type="button"
                      onClick={() => void openDocAcces(doc)}
                      disabled={convertingDocId === doc.id}
                      className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                    >
                      {convertingDocId === doc.id ? 'Conversion...' : `${'\u{1F511}'} Accès`}
                    </button>
                  )}
                  {canEdit && (
                    <button type="button" onClick={() => void handleDelier(doc.id)} className="text-xs text-red-500 hover:text-red-700">
                      Délier
                    </button>
                  )}
                </div>
              </div>

              <div className="border-t border-gray-100 pt-2 mt-2">
                <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accès :</p>
                {natif ? (
                  <div className="text-xs text-gray-700 space-y-2">
                    <div className="flex flex-col items-center w-fit">
                      <div className="w-14 h-14 bg-red-100 border border-red-300 rounded-lg flex flex-col items-center justify-center">
                        <span className="text-xl">{'\u{1F512}'}</span>
                      </div>
                      <span className="text-xs text-red-600 font-medium mt-1">Accès restreint</span>
                    </div>
                    <AccessContratLikeAdminLines
                      keyPrefix={`epic-doc-${doc.id}`}
                      users={users}
                      createdById={doc.uploadedById}
                      createdBy={doc.uploadedBy}
                      adminSansAccesUserIds={doc.adminSansAccesUserIds}
                      permissions={(doc.permissionsUtilisateurs || [])
                        .filter((p: any) => p.user?.role === 'admin')
                        .map((p: any) => ({
                          userId: p.userId || p.user?.id,
                          niveau: 'lecture',
                          user: p.user,
                        }))}
                      droitsAdminCompletLabel={DROITS_ADMIN_DOC_PROJET_NATIF}
                      creatorRightsLabel="auteur — tous les droits sur ce document"
                      niveauLabel={() => 'Lecture'}
                      limitedPrefix="Admin : accès limité —"
                    />
                    {(doc.permissionsUtilisateurs || [])
                      .filter((p: any) => p.user && p.user.role !== 'admin')
                      .map((p: any) => (
                        <div key={p.id || p.user.id} className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {p.user.prenom} {p.user.nom}
                          </span>
                          <span className="text-gray-500 italic ml-1">(Accès explicite : lecture)</span>
                        </div>
                      ))}
                  </div>
                ) : (
                  <div className="flex items-start gap-3 flex-wrap">
                    {doc.estConfidentiel ? (
                      <div className="flex flex-col items-center">
                        <div className="w-14 h-14 bg-red-100 border border-red-300 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xl">{'\u{1F512}'}</span>
                        </div>
                        <span className="text-xs text-red-600 font-medium mt-1">Accès restreint</span>
                      </div>
                    ) : (
                      <div className="flex flex-col items-center">
                        <div className="w-14 h-14 bg-green-100 border border-green-300 rounded-lg flex flex-col items-center justify-center">
                          <span className="text-xl">{'\u{1F310}'}</span>
                        </div>
                        <span className="text-xs text-green-600 font-medium mt-1">Accès libre</span>
                      </div>
                    )}
                    {accesPersonnes.map((p, i) => (
                      <div key={i} className="flex items-center gap-1.5">
                        <div className="w-8 h-8 rounded-full bg-blue-600 text-white flex items-center justify-center text-xs font-bold shrink-0">
                          {p.nom
                            .split(' ')
                            .map((n: string) => n[0])
                            .join('')
                            .slice(0, 2)
                            .toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-800">{p.nom}</p>
                          <p className="text-xs text-gray-500 italic">({p.droit})</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
      <div className="mt-4 border-t border-gray-100 pt-3">
        <h5 className="text-xs font-semibold text-gray-500 uppercase mb-2">
          📎 Documents des tâches liées ({linkedTaskDocsSafe.length})
        </h5>
        {linkedTaskDocsSafe.length === 0 ? (
          <p className="text-sm text-gray-400">Aucun document rattaché aux tâches de cet epic</p>
        ) : (
          <div className="space-y-2">
            {linkedTaskDocsSafe.map((row) => {
              const doc = normalizeDocumentAclFields(row.doc);
              const natif = isNativeAuthorControlledUploadDoc(doc);
              const accesPersonnes = getAccesDocument(doc);
              return (
                <div key={`${row.taskId}-${doc.id}`} className="bg-white border border-gray-200 rounded-lg p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex items-start gap-2 flex-1 min-w-0">
                      <span className="text-lg">{getFileIcon(doc.fichierType)}</span>
                      <div className="min-w-0">
                        <a
                          href={`${API_BASE_URL}/documents/${doc.id}/view?token=${localStorage.getItem('token')}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-sm font-medium text-blue-600 hover:underline truncate block"
                        >
                          {doc.nom}
                        </a>
                        <p className="text-[11px] text-gray-600 mt-0.5">
                          Lié à la tâche : <span className="font-medium">{row.taskNom}</span>
                          <span className="font-mono text-gray-400 ml-1">{row.taskId}</span>
                        </p>
                        <div className="flex gap-2 flex-wrap mt-0.5">
                          <span className="text-xs text-gray-500 capitalize">{doc.typeDocument}</span>
                          <span className="text-xs bg-green-100 text-green-700 px-1.5 rounded">{doc.statut}</span>
                        </div>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-gray-100 pt-2 mt-2">
                    <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Accès :</p>
                    {natif ? (
                      <div className="text-xs text-gray-700 space-y-1.5">
                        <p className="text-red-700 font-medium">🔒 Accès restreint (natif)</p>
                        {(getAccesDoc(doc) || []).map((m, i) => (
                          <p key={i}>• {m}</p>
                        ))}
                      </div>
                    ) : (
                      <div className="flex items-start gap-3 flex-wrap">
                        {doc.estConfidentiel ? (
                          <span className="text-xs text-red-700 font-medium">🔒 Accès restreint</span>
                        ) : (
                          <span className="text-xs text-green-700 font-medium">🌐 Accès libre</span>
                        )}
                        {accesPersonnes.map((p, i) => (
                          <span key={i} className="text-xs text-gray-700">
                            {p.nom} <span className="text-gray-500 italic">({p.droit})</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <DocumentAccesNatifModal
        open={!!natifAccesDoc}
        document={natifAccesDoc}
        users={users}
        onClose={() => setNatifAccesDoc(null)}
        onAfterMutation={() => onDocumentsChange?.()}
      />
    </div>
  );
}

// ─── Carte Tâche ─────────────────────────────────────────────────────────────
export function TacheCard({
  tache,
  onEdit,
  canEdit,
  users,
  currentUserRole,
  allUsers,
  onOpenEpic,
  onOpenUserStory,
  onSoftDelete,
  onRefreshData,
  defaultExpanded = false,
}: {
  tache: Tache;
  onEdit: () => void;
  canEdit: boolean;
  users: UserOption[];
  currentUserRole: string;
  allUsers: UserOption[];
  onOpenEpic?: (epicId: string) => void;
  onOpenUserStory?: (userStoryId: string) => void;
  onSoftDelete?: (id: string) => void;
  onRefreshData?: () => void;
  /** Ex. fiche projet : afficher directement le détail sans clic sur la ligne. */
  defaultExpanded?: boolean;
}) {
  const [expanded, setExpanded] = useState(defaultExpanded);
  const [showAccesModal, setShowAccesModal] = useState(false);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [newAssignUserId, setNewAssignUserId] = useState('');
  const [newAssignPerm, setNewAssignPerm] = useState('lecture');
  const [showHistModal, setShowHistModal] = useState(false);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  /** GET /taches/:id/acces pour fusionner l'aperçu « Personnes habilitées » avec les exclusions admin réelles. */
  const [accesApercuDetail, setAccesApercuDetail] = useState<any | null>(null);
  const [statutSaving, setStatutSaving] = useState(false);
  const [draftStatut, setDraftStatut] = useState(tache.statut);
  const now = new Date();
  const isLate = tache.dateFinApprox && new Date(tache.dateFinApprox) < now && tache.statut !== 'termine' && tache.statut !== 'archive';

  const assignesIdsKey = (tache.assignesUtilisateurs || [])
    .map((u) => u.id)
    .sort()
    .join(',');

  useEffect(() => {
    if (!expanded) {
      setAccesApercuDetail(null);
      return;
    }
    let cancel = false;
    void api.get(`/taches/${tache.id}/acces`).then(({ data }) => {
      if (!cancel) setAccesApercuDetail(data);
    });
    return () => {
      cancel = true;
    };
  }, [expanded, tache.id, assignesIdsKey]);

  useEffect(() => {
    setDraftStatut(tache.statut);
  }, [tache.id, tache.statut]);

  const handleStatutSave = async () => {
    if (!canEdit || draftStatut === tache.statut) return;
    setStatutSaving(true);
    try {
      await api.put(`/taches/${tache.id}`, { statut: draftStatut });
      await onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Impossible de mettre à jour le statut');
    } finally {
      setStatutSaving(false);
    }
  };

  const openAccesModal = async () => {
    setShowAccesModal(true);
    setAccesDetail(null);
    setNewAssignUserId('');
    setNewAssignPerm('lecture');
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/taches/${tache.id}/acces`);
      setAccesDetail(data);
      setAccesApercuDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setShowAccesModal(false);
    } finally {
      setAccesLoading(false);
    }
  };

  const refreshAcces = async () => {
    const { data } = await api.get(`/taches/${tache.id}/acces`);
    setAccesDetail(data);
    setAccesApercuDetail(data);
  };

  const handleAddAssigne = async () => {
    if (!newAssignUserId) return;
    try {
      await api.post(`/taches/${tache.id}/assignes`, {
        userId: newAssignUserId,
        permission: newAssignPerm,
      });
      setNewAssignUserId('');
      setNewAssignPerm('lecture');
      await refreshAcces();
      onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleChangeAssignPermission = async (assignId: string, permission: string) => {
    try {
      await api.patch(`/taches/${tache.id}/assignes/${assignId}`, { permission });
      await refreshAcces();
      onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemoveAssigne = async (assignId: string) => {
    if (!window.confirm('Retirer cette personne de la tâche ?')) return;
    try {
      await api.delete(`/taches/${tache.id}/assignes/${assignId}`);
      await refreshAcces();
      onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdmin = async (userId: string) => {
    if (!window.confirm("Rétablir l'accès admin implicite (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/taches/${tache.id}/admin-sans-acces/${userId}`);
      await refreshAcces();
      onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdmin = async (userId: string) => {
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur sur cette tâche ? Il ne la verra plus tant que vous ne lui accorderez pas un accès explicite."
      )
    )
      return;
    try {
      await api.post(`/taches/${tache.id}/admin-sans-acces`, { userId });
      await refreshAcces();
      onRefreshData?.();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openHistModal = async () => {
    setShowHistModal(true);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/taches/${tache.id}/history`, { params: { page: 1, limit: 80 } });
      setHistoList(Array.isArray(data?.data) ? data.data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement historique');
      setShowHistModal(false);
    } finally {
      setHistoLoading(false);
    }
  };

  const assignedIds = new Set((accesDetail?.delegations || []).map((d: any) => d.user?.id).filter(Boolean));
  const assignesRow = tache.assignesUtilisateurs || [];
  const assignesRowShow = assignesRow.slice(0, 4);
  const assignesRowMore = assignesRow.length - assignesRowShow.length;
  const clientsRow = tache.assignesClientsFournisseurs || [];
  const clientsRowShow = clientsRow.slice(0, 4);
  const clientsRowMore = clientsRow.length - clientsRowShow.length;
  const tacheDureePrevisionnelle = computePlannedDurationDays(tache.dateDebut, tache.dateFinApprox);
  const tachePlanningAdministre = !!(tache.dateDebut && tache.dateFinApprox);
  const tachePriorityScore = computeTaskPriorityScore(tache);
  const tacheTempsActifSecondes = (() => {
    const base = tache.tempsActifSecondes || 0;
    if (tache.statut === 'en_cours' && tache.chronoActifDepuis) {
      const elapsed = Math.max(0, Math.floor((Date.now() - new Date(tache.chronoActifDepuis).getTime()) / 1000));
      return base + elapsed;
    }
    return base;
  })();

  return (
    <>
    <div className={`bg-white border rounded-lg shadow overflow-hidden ${isLate ? 'border-red-300' : 'border-gray-200'}`}>
      <div className="flex w-full items-stretch">
        <div className="flex items-center shrink-0 px-2 sm:px-3 py-3 border-r border-gray-100 bg-gray-50/60">
          <span className="shrink-0 px-1" title={tache.statut}>
            <StatutBadge statut={tache.statut} />
          </span>
        </div>
        <button
          type="button"
          onClick={() => setExpanded(!expanded)}
          className="flex-1 min-w-0 flex flex-wrap items-center gap-2 sm:gap-3 px-3 sm:px-4 py-3 text-left hover:bg-gray-50 transition-colors"
          aria-expanded={expanded}
          aria-label={expanded ? 'Replier le détail de la tâche' : 'Afficher le détail et les actions de la tâche'}
        >
        <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">{tache.nom}</h2>
        <div
          className="flex items-center gap-1.5 shrink-0 min-w-0 max-w-[min(20rem,55vw)]"
          title={`${tache.projet?.nom ? `Projet : ${tache.projet.nom}` : 'Projet : N/A'} — ${tache.id}`}
        >
          <span className="text-xs text-gray-600 truncate font-sans font-medium">
            {tache.projet?.nom ?? 'N/A'}
          </span>
          <span className="text-gray-300 shrink-0" aria-hidden>
            ·
          </span>
          <span className="text-xs sm:text-sm text-gray-500 font-mono truncate min-w-0">{tache.id}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-[14rem] md:max-w-xs">
          {assignesRowShow.map((u) => (
            <span
              key={u.id}
              className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-full text-[11px] font-medium truncate max-w-[9rem]"
              title={`${u.prenom} ${u.nom}`}
            >
              {u.prenom} {u.nom}
            </span>
          ))}
          {assignesRowMore > 0 && (
            <span className="text-[11px] text-gray-500 font-medium">+{assignesRowMore}</span>
          )}
          {assignesRow.length === 0 && (
            <span className="text-[11px] text-gray-400 italic">Non assignée</span>
          )}
        </div>
        <span
          className={`px-2 py-0.5 rounded text-[11px] font-medium border shrink-0 ${priorityTagClasses(tache.priorite)}`}
          title="Priorité de la tâche"
        >
          {priorityLabel(tache.priorite)}
        </span>
        {tachePriorityScore && (
          <span className="px-2 py-0.5 rounded text-[11px] font-semibold border shrink-0 bg-indigo-50 text-indigo-800 border-indigo-200">
            🧠 Score {tachePriorityScore.score}
          </span>
        )}
        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-[18rem]">
          {tachePlanningAdministre ? (
            <>
              <span className="text-[11px] text-gray-600">
                🗓 {new Date(tache.dateDebut!).toLocaleDateString('fr-FR')}
              </span>
              <span className="text-gray-300 text-[11px]">→</span>
              <span className="text-[11px] text-gray-600">
                ⏰ {new Date(tache.dateFinApprox!).toLocaleDateString('fr-FR')}
              </span>
            </>
          ) : (
            <span className="text-[11px] text-gray-400 italic">📆 Non administré</span>
          )}
        </div>
        {clientsRow.length > 0 && (
          <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-[14rem] md:max-w-xs">
            {clientsRowShow.map((c) => (
              <span
                key={c.id}
                className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-[11px] font-medium truncate max-w-[9rem] border border-amber-200"
                title={`${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})`}
              >
                🤝 {c.nom}
              </span>
            ))}
            {clientsRowMore > 0 && (
              <span className="text-[11px] text-gray-500 font-medium">+{clientsRowMore}</span>
            )}
          </div>
        )}
        {isLate && (
          <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium shrink-0">⚠ Retard</span>
        )}
        {expanded && (
          <span className="text-gray-400 shrink-0 ml-auto sm:ml-0" aria-hidden>
            ▼
          </span>
        )}
        </button>
      </div>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/80">
          <div className="px-4 pt-3 pb-2 flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
            <div className="min-w-0 flex-1 space-y-2 text-xs text-gray-600">
              <div className="flex flex-wrap gap-3">
                {tache.projet && <span>📁 {tache.projet.nom}</span>}
                {tache.dateDebut && <span>🗓 {new Date(tache.dateDebut).toLocaleDateString('fr-FR')}</span>}
                {tache.dateFinApprox && <span>⏰ {new Date(tache.dateFinApprox).toLocaleDateString('fr-FR')}</span>}
                {tacheDureePrevisionnelle != null ? (
                  <span>⏳ {tacheDureePrevisionnelle} jour{tacheDureePrevisionnelle > 1 ? 's' : ''} nécessaires</span>
                ) : (
                  <span className="italic text-gray-400">⏳ Non administré</span>
                )}
                <span>⏱ Temps actif cumulé : {formatTempsActifDisplay(tacheTempsActifSecondes)}</span>
                {tache.createur && (
                  <span>
                    👤 {tache.createur.prenom} {tache.createur.nom}
                  </span>
                )}
              </div>
              <div className="space-y-0.5 text-[11px] font-mono text-gray-500 break-all">
                <div title="Identifiant de la tâche">
                  <span className="text-gray-400 font-sans">Tâche · </span>
                  {tache.id}
                </div>
                {tache.userStory && (
                  <div title="Identifiant de la user story">
                    <span className="text-gray-400 font-sans">User story · </span>
                    {tache.userStory.id}
                  </div>
                )}
                {tache.userStory?.epic && (
                  <div title="Identifiant de l’epic">
                    <span className="text-gray-400 font-sans">Epic · </span>
                    {tache.userStory.epic.id}
                  </div>
                )}
              </div>
              {tachePriorityScore && (
                <div className="mt-1.5">
                  <p className="text-xs text-gray-700">
                    <span className="font-semibold">Priorisation:</span> score {tachePriorityScore.score} —{' '}
                    {tachePriorityScore.justification}
                  </p>
                  {tachePriorityScore.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {tachePriorityScore.labels.map((lb) => (
                        <span key={`${tache.id}-${lb}`} className="px-2 py-0.5 rounded bg-indigo-100 text-indigo-800 text-[11px]">
                          {lb}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {(tache.assignesEntites?.length || 0) > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tache.assignesEntites?.map((e) => (
                    <span key={e.id} className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs">
                      🏢 {e.nom}
                    </span>
                  ))}
                </div>
              )}
              {(tache.assignesClientsFournisseurs?.length || 0) > 0 && (
                <div className="flex gap-1 flex-wrap">
                  {tache.assignesClientsFournisseurs?.map((c) => (
                    <span
                      key={c.id}
                      className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-xs border border-amber-200"
                    >
                      🤝 {c.nom}
                      <span className="text-amber-800/90 ml-1">
                        ({c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})
                      </span>
                    </span>
                  ))}
                </div>
              )}
              {tache.userStory && (
                <div className="flex flex-wrap gap-2 pt-1">
                  {tache.userStory.epic &&
                    (onOpenEpic ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenEpic(tache.userStory!.epic!.id);
                        }}
                        className="text-xs px-2 py-1 bg-indigo-50 text-indigo-800 rounded border border-indigo-200 hover:bg-indigo-100 text-left"
                      >
                        📗 Epic : {tache.userStory.epic.nom}
                      </button>
                    ) : (
                      <span className="text-xs px-2 py-1 bg-indigo-50 text-indigo-800 rounded border border-indigo-200">
                        📗 Epic : {tache.userStory.epic.nom}
                      </span>
                    ))}
                  {onOpenUserStory ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onOpenUserStory(tache.userStory!.id);
                      }}
                      className="text-xs px-2 py-1 bg-violet-50 text-violet-800 rounded border border-violet-200 hover:bg-violet-100"
                    >
                      📘 User story
                    </button>
                  ) : (
                    <span className="text-xs px-2 py-1 bg-violet-50 text-violet-800 rounded border border-violet-200">
                      📘 User story
                    </span>
                  )}
                </div>
              )}
              {(tache.liaisons?.length || 0) > 0 && (
                <div className="flex flex-wrap gap-1 pt-1">
                  {tache.liaisons?.map((l) => (
                    <span
                      key={l.id}
                      className={`text-xs px-2 py-0.5 rounded-full ${
                        l.type === 'concatenation' ? 'bg-orange-100 text-orange-700' : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {l.type === 'concatenation' ? '🔗' : '↔'} {l.tacheLiee?.nom}
                      {l.type === 'concatenation' && l.tacheLiee?.statut !== 'termine' && (
                        <span className="ml-1 text-red-500">(non terminée)</span>
                      )}
                    </span>
                  ))}
                </div>
              )}
            </div>
            <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
              {canEdit ? (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium text-center lg:text-left"
                  title="Vous pouvez modifier cette tâche"
                >
                  ✏️ Modification
                </span>
              ) : onSoftDelete ? (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-amber-50 text-amber-900 font-medium text-center lg:text-left border border-amber-200"
                  title="Pas d’édition du contenu : mise en corbeille / restauration autorisée selon votre délégation"
                >
                  🗑 Corbeille (sans édition)
                </span>
              ) : (
                <span
                  className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium text-center lg:text-left"
                  title="Vous avez uniquement accès en lecture"
                >
                  👁 Lecture seule
                </span>
              )}
              {canEdit && (
                <div className="rounded-md border border-gray-200 bg-white p-2 space-y-2">
                  <p className="text-[11px] font-semibold text-gray-500 uppercase tracking-wide">Statut</p>
                  <select
                    value={draftStatut}
                    disabled={statutSaving}
                    onChange={(e) => setDraftStatut(e.target.value)}
                    className="w-full text-xs font-medium border border-gray-300 rounded-md px-2 py-1.5 bg-white shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:opacity-60"
                    title="Choisir un statut"
                    aria-label="Nouveau statut de la tâche"
                  >
                    {STATUT_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleStatutSave()}
                    disabled={statutSaving || draftStatut === tache.statut}
                    className="w-full px-2 py-1.5 text-xs rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    {statutSaving ? 'Validation…' : 'Valider le statut'}
                  </button>
                </div>
              )}
              {canEdit && (
                <button
                  type="button"
                  onClick={onEdit}
                  className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-center"
                >
                  ✏️ Modifier
                </button>
              )}
              {onSoftDelete && (
                <button
                  type="button"
                  onClick={() => onSoftDelete(tache.id)}
                  className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 text-center"
                >
                  🗑 Mettre en corbeille
                </button>
              )}
              <button
                type="button"
                onClick={() => void openAccesModal()}
                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-center"
              >
                🔐 Accès
              </button>
              <button
                type="button"
                onClick={() => void openHistModal()}
                className="px-3 py-1.5 text-xs bg-amber-50 text-amber-900 rounded hover:bg-amber-100 text-center border border-amber-200"
              >
                📜 Historique
              </button>
            </div>
          </div>

        <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-4">
          {onRefreshData && <TacheLienUserStoryBlock tache={tache} onUpdated={onRefreshData} />}
          {tache.description && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{tache.description}</p>
            </div>
          )}
          {tache.scenarioExecution && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Scénario d'exécution</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{tache.scenarioExecution}</p>
            </div>
          )}
          {tache.critereAcceptation && (
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Critère d'acceptation</h4>
              <p className="text-sm text-gray-700 whitespace-pre-wrap">{tache.critereAcceptation}</p>
            </div>
          )}
          {/* Section Documents */}
          <DocumentsTache
            tacheId={tache.id}
            documents={tache.documents || []}
            canEdit={canEdit}
            users={users}
            onDocumentsChange={onRefreshData}
          />

          <div className="border-t border-gray-200 pt-4">
            <PvReunionsLieesBlock apiPath={`/taches/${tache.id}/pv-reunions`} />
          </div>

          <div className="scroll-mt-4 border-t border-gray-200 pt-4 space-y-2">
            <h4 className="text-xs font-semibold text-gray-500 uppercase">Personnes habilitées (aperçu)</h4>
            {tache.createdAt && (
              <p className="text-xs text-gray-600">
                Création : {new Date(tache.createdAt).toLocaleString('fr-FR')}
              </p>
            )}
            <p className="text-xs text-gray-500">
              Projet / entités / assignations, fusionnés avec les droits réels (API) lorsque le détail est chargé. Les
              assignations se retirent via « Modifier » la tâche.
            </p>
            <AccesPersonnesBlock
              personnes={mergeDeuxListesPersonnesAcces(
                filterInheritedPersonnesPourAccesTache(
                  getAccesPersonnes(tache, allUsers, { skipImplicitAdmins: !!accesApercuDetail }),
                  accesApercuDetail
                ),
                personnesFromAgileAccesApiDetail(accesApercuDetail, {
                  creatorRole: 'Créateur de la tâche',
                  explicitRole: 'Assignation sur la tâche',
                  adminImplicitRole: 'Administrateur',
                })
              )}
            />
          </div>

          <div className="border-t border-gray-200 pt-4">
            <CommentairesSection target={{ kind: 'tache', id: tache.id }} users={users} />
          </div>
        </div>
        </div>
      )}
    </div>

      {showAccesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {tache.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le <span className="font-medium">créateur</span> gère les accès de la tâche. Il peut retirer l&apos;accès
              implicite aux administrateurs, rétablir cet accès, et déléguer des droits explicites. Pour chaque{' '}
              <span className="font-medium">assigné</span>, choisissez :{' '}
              <span className="font-medium">Lecture</span>, <span className="font-medium">Modification</span>,{' '}
              <span className="font-medium">Suppression</span> (corbeille / restauration) ou{' '}
              <span className="font-medium">Gestion des accès</span>.
            </p>
            {accesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : accesDetail ? (
              <div className="space-y-5 text-sm">
          <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <ul className="space-y-2 text-gray-700">
                    {(accesDetail.admins || []).map((a: any) => {
                      const row = (accesDetail.delegations || []).find((d: any) => d.user?.id === a.id);
                      const excluded = (accesDetail.adminSansAccesUserIds || []).includes(a.id);
                      const isCreator = accesDetail.creator?.id === a.id;
                      return (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium">
                            {a.prenom} {a.nom}
                          </span>
                          {excluded && !row ? (
                            <span className="text-red-700 text-xs font-medium">
                              — aucun accès (exclu ; accorder un accès explicite ci-dessous pour le réintégrer)
                            </span>
                          ) : row ? (
                            <span className="text-amber-800 text-xs font-medium">
                              — accès explicite ({PERM_TACHE_LABEL[row.permission] || row.permission})
                            </span>
                          ) : (
                            <span className="text-gray-400">— accès complet (défaut administrateur)</span>
                          )}
                          {accesDetail.canManagePermissions && !isCreator && (
                            <div className="flex flex-wrap items-center gap-2 ml-auto">
                              {excluded && !row ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRestoreAdmin(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !row ? (
                                <button
                                  type="button"
                                  onClick={() => void handleRevokeAdmin(a.id)}
                                  className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                >
                                  Retirer l&apos;accès
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => void handleRemoveAssigne(row.id)}
                                  className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                >
                                  Révoquer l&apos;accès
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                  </div>
                  <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Créateur</p>
                  {accesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {accesDetail.creator.prenom} {accesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400"> — création de la tâche</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non renseigné.</p>
                  )}
                  </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Assignations</p>
                  <p className="text-[11px] text-gray-500 mb-2">
                    Pour ajouter ou retirer une personne assignée, utilisez le bouton « Modifier » sur la tâche. Ici vous
                    pouvez ajuster les droits des assignés déjà présents.
                  </p>
                  {(accesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucune personne assignée directement</p>
                  ) : (
                    <ul className="space-y-2">
                      {(accesDetail.delegations || []).map((d: any) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium shrink-0">
                            {d.user.prenom} {d.user.nom}
                          </span>
                          {accesDetail.canManagePermissions ? (
                            <select
                              value={d.permission || 'lecture'}
                              onChange={(e) => void handleChangeAssignPermission(d.id, e.target.value)}
                              className="text-xs border border-gray-300 rounded-md px-2 py-1.5 min-w-[12rem] flex-1 max-w-xs"
                            >
                              {PERM_TACHE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-500 text-sm">— {d.permissionLabel || d.permission || 'Lecture'}</span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {(accesDetail.entites || []).length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Entités</p>
                    <ul className="space-y-1 text-gray-700">
                      {(accesDetail.entites || []).map((row: any) => (
                        <li key={row.id}>
                          🏢 {row.entite?.nom || '—'}
                        </li>
                      ))}
                    </ul>
                    {accesDetail.noteEntites && (
                      <p className="text-xs text-gray-500 mt-2">{accesDetail.noteEntites}</p>
                    )}
            </div>
                )}
                {accesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Assigner un utilisateur</p>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                      <select
                        value={newAssignUserId}
                        onChange={(e) => setNewAssignUserId(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {allUsers
                          .filter(
                            (u) =>
                              !assignedIds.has(u.id) &&
                              u.id !== accesDetail.creator?.id
                          )
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.prenom} {u.nom}
                            </option>
                          ))}
                      </select>
                      <select
                        value={newAssignPerm}
                        onChange={(e) => setNewAssignPerm(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {PERM_TACHE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAddAssigne()}
                        disabled={!newAssignUserId}
                        className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0"
                      >
                        Ajouter
                      </button>
          </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowAccesModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showHistModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {tache.nom}</h3>
            {histoLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoList.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {histoList.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{new Date(h.timestamp).toLocaleString('fr-FR')}</span>
                      <span>
                        {h.user?.prenom} {h.user?.nom}
                      </span>
                    </div>
                    <p className="font-medium text-gray-800">
                      {LABEL_LOG_ACTION[h.action] || h.action}
                      {h.ressourceType && (
                        <span className="text-gray-500 font-normal">
                          {' '}
                          · {LABEL_RESSOURCE[h.ressourceType] || h.ressourceType}
                        </span>
                      )}
                    </p>
                    {h.ressourceNom && <p className="text-gray-600 text-xs mt-0.5">{h.ressourceNom}</p>}
                    {formatHistoryDetails(h).length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {formatHistoryDetails(h).map((line, idx) => (
                          <li key={`${h.id}-detail-${idx}`} className="text-xs text-gray-700">
                            - {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setShowHistModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

function isTacheEnRetardKpi(t: Tache, now: Date): boolean {
  if (t.statut === 'termine' || t.statut === 'archive') return false;
  if (t.statut === 'bloque') return true;
  if (t.dateFinApprox && new Date(t.dateFinApprox) < now) return true;
  return false;
}

function computePlannedDurationDays(dateDebut?: string, dateFinApprox?: string): number | null {
  if (!dateDebut || !dateFinApprox) return null;
  const start = new Date(dateDebut);
  const end = new Date(dateFinApprox);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return null;
  const diffDays = Math.floor((end.getTime() - start.getTime()) / (1000 * 3600 * 24)) + 1;
  return Math.max(1, diffDays);
}

function compareTachesByPriorityComplexityDueDate(a: Tache, b: Tache): number {
  const ap = PRIORITE_RANK[a.priorite || 'basse'] ?? 999;
  const bp = PRIORITE_RANK[b.priorite || 'basse'] ?? 999;
  if (ap !== bp) return ap - bp;
  const ac = COMPLEXITE_RANK[a.complexite || 'basse'] ?? 999;
  const bc = COMPLEXITE_RANK[b.complexite || 'basse'] ?? 999;
  if (ac !== bc) return ac - bc;
  const toTs = (d?: string) => {
    if (!d) return Number.POSITIVE_INFINITY;
    const t = new Date(d).getTime();
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  const ad = toTs(a.dateFinApprox);
  const bd = toTs(b.dateFinApprox);
  if (ad !== bd) return ad - bd;
  return (a.nom || '').localeCompare(b.nom || '', 'fr');
}

function priorityTagClasses(priority?: string): string {
  if (priority === 'haute') return 'bg-red-100 text-red-800 border-red-200';
  if (priority === 'moyenne') return 'bg-amber-100 text-amber-800 border-amber-200';
  return 'bg-green-100 text-green-800 border-green-200';
}

function priorityLabel(priority?: string): string {
  if (priority === 'haute') return 'Priorité haute';
  if (priority === 'moyenne') return 'Priorité moyenne';
  return 'Priorité basse';
}

export type TaskPriorityScore = {
  score: number;
  justification: string;
  labels: string[];
  daysToDue: number | null;
  isLate: boolean;
};

const STATUS_SCORE: Record<string, number> = {
  en_cours: 50,
  a_faire: 40,
  cree: 30,
  en_attente: 15,
  bloque: 10,
};
const PRIORITY_SCORE: Record<string, number> = { haute: 30, moyenne: 20, basse: 10 };

export function computeTaskPriorityScore(task: Tache, now = new Date()): TaskPriorityScore | null {
  if (task.statut === 'termine' || task.statut === 'archive') return null;
  const statusScore = STATUS_SCORE[task.statut] ?? 0;
  const priorityScore = PRIORITY_SCORE[task.priorite || 'basse'] ?? 10;
  const complexity = task.complexite || 'basse';
  const dueTs = task.dateFinApprox ? new Date(task.dateFinApprox).getTime() : NaN;
  const hasDue = Number.isFinite(dueTs);
  const daysToDue = hasDue ? Math.floor((dueTs - now.getTime()) / (1000 * 3600 * 24)) : null;
  const isLate = hasDue ? dueTs < now.getTime() : false;

  let urgencyScore = 5;
  if (isLate) urgencyScore = 100;
  else if (daysToDue != null && daysToDue <= 1) urgencyScore = 80;
  else if (daysToDue != null && daysToDue <= 3) urgencyScore = 60;
  else if (daysToDue != null && daysToDue <= 7) urgencyScore = 40;
  else if (daysToDue != null && daysToDue <= 14) urgencyScore = 20;

  let complexityScore = 0;
  if (complexity === 'haute' && daysToDue != null && daysToDue <= 7) complexityScore = 20;
  else if (complexity === 'moyenne') complexityScore = 10;
  else complexityScore = 5;

  let contextAdjust = 0;
  if (task.statut === 'bloque') {
    contextAdjust += daysToDue != null && daysToDue <= 3 ? 40 : -30;
  }
  if (task.statut === 'en_attente') contextAdjust -= 10;

  const score = statusScore + urgencyScore + priorityScore + complexityScore + contextAdjust;
  const labels: string[] = [];
  if (score > 120) labels.push('🔥 Urgent');
  if (daysToDue != null && daysToDue <= 3 && task.statut !== 'en_cours') labels.push('⚠️ À risque');
  if (task.statut === 'bloque' && daysToDue != null && daysToDue <= 3) labels.push('🚧 Bloquée critique');
  if (complexity === 'basse' && score > 70) labels.push('⚡ Quick win');

  const urgencyText =
    daysToDue == null ? 'échéance non renseignée' : isLate ? 'tâche en retard' : `échéance dans ${daysToDue} j`;
  const justification = `${priorityLabel(task.priorite)} · complexité ${complexity} · ${urgencyText} · statut ${
    statutLabelFromValue(task.statut) || task.statut
  }`;
  return { score, justification, labels, daysToDue, isLate };
}

function truncateUi(s: string, n: number) {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

/** Min début / max fin parmi les tâches (affichage liste comme les cartes tâche). */
function dateRangeFromTasks(tl: Tache[]): { dateDebut?: string; dateFinApprox?: string } {
  const debuts = tl.map((t) => t.dateDebut).filter(Boolean) as string[];
  const fins = tl.map((t) => t.dateFinApprox).filter(Boolean) as string[];
  let dateDebut: string | undefined;
  let dateFinApprox: string | undefined;
  if (debuts.length) dateDebut = debuts.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
  if (fins.length) dateFinApprox = fins.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  return { dateDebut, dateFinApprox };
}

function TacheLienUserStoryBlock({ tache, onUpdated }: { tache: Tache; onUpdated: () => void }) {
  const [userStoryId, setUserStoryId] = useState(tache.userStory?.id || '');
  const [options, setOptions] = useState<{ id: string; description: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const projetId = tache.projetId || '';

  useEffect(() => {
    setUserStoryId(tache.userStory?.id || '');
  }, [tache.id, tache.userStory?.id]);

  useEffect(() => {
    if (!projetId) {
      setOptions([]);
      return;
    }
    let cancel = false;
    api
      .get('/user-stories', { params: { projetId } })
      .then((r) => {
        if (!cancel) setOptions(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (!cancel) setOptions([]);
      });
    return () => {
      cancel = true;
    };
  }, [projetId]);

  const save = async () => {
    setSaving(true);
    try {
      await api.put(`/taches/${tache.id}`, { userStoryId: userStoryId || null });
      onUpdated();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors du rattachement');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white">
      <h4 className="text-xs font-semibold text-gray-500 uppercase mb-2">Lier à une user story</h4>
      {!projetId ? (
        <p className="text-xs text-amber-700">
          Associez d&apos;abord un projet à la tâche (bouton Modifier) pour afficher les user stories du projet.
        </p>
      ) : (
        <>
          <select
            value={userStoryId}
            onChange={(e) => setUserStoryId(e.target.value)}
            className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5 mb-2"
          >
            <option value="">— Aucune —</option>
            {options.map((us) => (
              <option key={us.id} value={us.id}>
                {truncateUi(us.description || '', 100)}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={saving}
            onClick={() => void save()}
            className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? 'Enregistrement…' : 'Enregistrer le lien'}
          </button>
        </>
      )}
    </div>
  );
}

function UserStoryLienEpicEtTachesBlock({
  us,
  epics,
  taches,
  onUpdated,
  onAddTache,
}: {
  us: UserStoryRow;
  epics: EpicRow[];
  taches: Tache[];
  onUpdated: () => void;
  /** Ouvre la création de tâche avec projet et user story présélectionnés. */
  onAddTache?: () => void;
}) {
  const projetId =
    us.epic?.projetId ||
    (us.taches || []).find((t) => t.projetId)?.projetId ||
    taches.find((t) => t.userStory?.id === us.id)?.projetId ||
    '';
  const epicsProjet = projetId ? epics.filter((e) => e.projetId === projetId) : [];

  const [epicId, setEpicId] = useState(us.epicId || '');
  const [selectedTacheIds, setSelectedTacheIds] = useState<string[]>(() =>
    (us.taches || []).map((t) => t.id)
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setEpicId(us.epicId || '');
    setSelectedTacheIds((us.taches || []).map((t) => t.id));
  }, [us.id, us.epicId, us.taches]);

  const candidateTaches = projetId
    ? taches.filter(
        (t) =>
          t.projetId === projetId &&
          (!t.userStory?.id || t.userStory?.id === us.id)
      )
    : [];

  const toggleTache = (id: string) => {
    setSelectedTacheIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]
    );
  };

  const save = async () => {
    if (!epicId) {
      alert('Sélectionnez un epic (requis).');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/user-stories/${us.id}`, {
        epicId,
        tacheIds: selectedTacheIds,
      });
      onUpdated();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-3 border border-gray-200 rounded-lg p-3 bg-white">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Epic</h4>
        <select
          value={epicId}
          onChange={(e) => setEpicId(e.target.value)}
          className="w-full text-sm border border-gray-300 rounded-md px-2 py-1.5"
        >
          <option value="">— Choisir un epic —</option>
          {epicsProjet.map((ep) => (
            <option key={ep.id} value={ep.id}>
              {ep.nom}
            </option>
          ))}
        </select>
      </div>
      {projetId ? (
        <div>
          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Tâches liées</h4>
          <div className="max-h-40 overflow-y-auto border border-gray-200 rounded-md p-2 space-y-1 text-sm">
            {candidateTaches.map((t) => (
              <label key={t.id} className="flex items-center gap-2 cursor-pointer hover:bg-gray-50 rounded px-1">
                <input
                  type="checkbox"
                  checked={selectedTacheIds.includes(t.id)}
                  onChange={() => toggleTache(t.id)}
                  className="rounded"
                />
                <span className="min-w-0 flex-1 truncate">{t.nom}</span>
                <span className="text-xs px-2 py-0.5 rounded bg-gray-100 text-gray-700 shrink-0">
                  {STATUT_OPTIONS.find((s) => s.value === t.statut)?.label || t.statut || '—'}
                </span>
              </label>
            ))}
            {candidateTaches.length === 0 && (
              <p className="text-xs text-gray-400">Aucune tâche éligible pour ce projet.</p>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-amber-700">
          Projet indéterminé : rattachez d&apos;abord un epic du bon projet ou une tâche du projet.
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          disabled={saving}
          onClick={() => void save()}
          className="text-xs px-3 py-1.5 bg-violet-600 text-white rounded hover:bg-violet-700 disabled:opacity-50"
        >
          {saving ? 'Enregistrement…' : 'Enregistrer epic et tâches'}
        </button>
        {onAddTache && projetId && (
          <button
            type="button"
            disabled={saving}
            onClick={onAddTache}
            className="text-xs px-3 py-1.5 border border-violet-300 text-violet-800 bg-violet-50 rounded hover:bg-violet-100 disabled:opacity-50"
          >
            + Ajouter une tâche
          </button>
        )}
      </div>
    </div>
  );
}

function EpicLienUserStoriesBlock({
  ep,
  userStories,
  taches,
  onUpdated,
}: {
  ep: EpicRow;
  userStories: UserStoryRow[];
  taches: Tache[];
  onUpdated: () => void;
}) {
  const storiesOnEpic = userStories.filter((u) => u.epicId === ep.id);
  const orphanCandidates = userStories.filter((u) => {
    if (u.epicId) return false;
    const viaTachesPage = taches.some(
      (t) => t.userStory?.id === u.id && t.projetId === ep.projetId
    );
    const viaSummary = (u.taches || []).some((t) => t.projetId === ep.projetId);
    return viaTachesPage || viaSummary;
  });

  const detach = async (usId: string) => {
    if (!window.confirm('Retirer cette user story de l’epic ?')) return;
    try {
      await api.put(`/user-stories/${usId}`, { epicId: null });
      onUpdated();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const attach = async (usId: string) => {
    try {
      await api.put(`/user-stories/${usId}`, { epicId: ep.id });
      onUpdated();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-white space-y-3">
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">User stories de l’epic</h4>
        {storiesOnEpic.length === 0 ? (
          <p className="text-xs text-gray-400">Aucune pour l’instant.</p>
        ) : (
          <ul className="text-sm space-y-1">
            {storiesOnEpic.map((u) => (
              <li key={u.id} className="flex justify-between items-center gap-2">
                <span className="truncate min-w-0">{truncateUi(u.description, 90)}</span>
                <button
                  type="button"
                  onClick={() => void detach(u.id)}
                  className="shrink-0 text-xs text-red-600 hover:underline"
                >
                  Retirer
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div>
        <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Rattacher une user story orpheline (même projet)</h4>
        {orphanCandidates.length === 0 ? (
          <p className="text-xs text-gray-400">Aucune orpheline éligible.</p>
        ) : (
          <ul className="text-sm space-y-1 max-h-36 overflow-y-auto">
            {orphanCandidates.map((u) => (
              <li key={u.id} className="flex justify-between items-center gap-2">
                <span className="truncate min-w-0">{truncateUi(u.description, 90)}</span>
                <button
                  type="button"
                  onClick={() => void attach(u.id)}
                  className="shrink-0 text-xs text-indigo-600 hover:underline"
                >
                  Rattacher
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Statut Kanban/Gantt pour une user story ou un epic, dérivé des tâches liées. */
function deriveAggregatedStatutFromTasks(
  taskList: { statut: string; dateFinApprox?: string }[],
  now: Date
): string {
  if (taskList.length === 0) return 'cree';
  const active = taskList.filter((t) => t.statut !== 'archive');
  if (active.length === 0) return 'termine';
  const nonTerm = active.filter((t) => t.statut !== 'termine');
  if (nonTerm.length === 0) return 'termine';
  const anyBlocked = nonTerm.some(
    (t) =>
      t.statut === 'bloque' ||
      Boolean(t.dateFinApprox && new Date(t.dateFinApprox) < now && t.statut !== 'termine')
  );
  if (anyBlocked) return 'bloque';
  if (nonTerm.some((t) => t.statut === 'en_cours')) return 'en_cours';
  if (nonTerm.some((t) => t.statut === 'en_attente')) return 'en_attente';
  if (nonTerm.some((t) => t.statut === 'a_faire')) return 'a_faire';
  return 'cree';
}

function collectAssignesFromTasks(tl: Tache[]): { id: string; nom: string; prenom: string }[] {
  const assignMap = new Map<string, { id: string; nom: string; prenom: string }>();
  for (const t of tl) {
    for (const u of t.assignesUtilisateurs || []) assignMap.set(u.id, u);
  }
  return [...assignMap.values()];
}

function userStoryToKanbanAndGantt(us: UserStoryRow, taches: Tache[]): { kanban: KanbanTache; gantt: TacheGantt } {
  const now = new Date();
  const tl = taches.filter((t) => t.userStory?.id === us.id);
  const statut = deriveAggregatedStatutFromTasks(
    tl.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
    now
  );
  const debuts = tl.map((t) => t.dateDebut).filter(Boolean) as string[];
  const fins = tl.map((t) => t.dateFinApprox).filter(Boolean) as string[];
  let dateDebut: string | undefined;
  let dateFinApprox: string | undefined;
  if (debuts.length) dateDebut = debuts.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
  if (fins.length) dateFinApprox = fins.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  const nom = truncateUi(us.description, 100);
  return {
    kanban: {
      id: us.id,
      entityType: 'user_story' as const,
      epicRefId: us.epic?.id,
      nom,
      statut,
      dateFinApprox,
      projet: us.epic?.projet,
      assignesUtilisateurs: collectAssignesFromTasks(tl),
      assignesClientsFournisseurs: userStoryClientsEffectifs(us, tl),
    },
    gantt: {
      id: us.id,
      entityType: 'user_story' as const,
      epicRefId: us.epic?.id,
      nom,
      statut,
      dateDebut,
      dateFinApprox,
      projet: us.epic?.projet,
    },
  };
}

function tasksForEpic(ep: EpicRow, allUserStories: UserStoryRow[], taches: Tache[]): Tache[] {
  const usIds = new Set(allUserStories.filter((us) => us.epicId === ep.id).map((us) => us.id));
  return taches.filter((t) => t.userStory?.id && usIds.has(t.userStory.id));
}

/** % tâches au statut « termine » (même règle que TachesAvancementBlock). */
function computeTaskProgressPct(tl: Tache[]): { pct: number | null; done: number; total: number } {
  if (tl.length === 0) return { pct: null, done: 0, total: 0 };
  const done = tl.filter((t) => t.statut === 'termine').length;
  return { pct: Math.round((done / tl.length) * 100), done, total: tl.length };
}

/** % de user stories dont le statut agrégé (via tâches) est « termine » ; dénominateur = US ayant au moins une tâche. */
function computeUserStoriesProgressPct(
  stories: UserStoryRow[],
  taches: Tache[],
  now: Date
): { pct: number | null; done: number; total: number; sansTache: number } {
  const withTasks = stories.filter((us) => taches.some((t) => t.userStory?.id === us.id));
  const sansTache = stories.length - withTasks.length;
  if (withTasks.length === 0) return { pct: null, done: 0, total: 0, sansTache };
  let done = 0;
  for (const us of withTasks) {
    const tl = taches.filter((t) => t.userStory?.id === us.id);
    const s = deriveAggregatedStatutFromTasks(
      tl.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
      now
    );
    if (s === 'termine') done++;
  }
  return { pct: Math.round((done / withTasks.length) * 100), done, total: withTasks.length, sansTache };
}

function blendProgressPct(a: number | null, b: number | null): number | null {
  if (a === null && b === null) return null;
  if (a === null) return b;
  if (b === null) return a;
  return Math.round((a + b) / 2);
}

function AgileAvancementDetailCard({
  title,
  subtitle,
  pctGlobal,
  taskPart,
  usPart,
}: {
  title: string;
  subtitle?: string;
  pctGlobal: number | null;
  taskPart: { pct: number | null; done: number; total: number };
  usPart: { pct: number | null; done: number; total: number };
}) {
  const emptyScope = taskPart.total === 0 && usPart.total === 0;
  return (
    <div className="rounded-lg border border-teal-100 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
        <div>
          <h4 className="font-semibold text-gray-800 text-sm">{title}</h4>
          {subtitle && <p className="text-xs text-gray-500 mt-0.5">{subtitle}</p>}
        </div>
        <span className="text-xl font-bold text-teal-700 tabular-nums shrink-0">
          {pctGlobal !== null ? `${pctGlobal}%` : emptyScope ? '—' : '—'}
        </span>
      </div>
      {pctGlobal !== null && (
        <div className="h-2.5 bg-gray-200/90 rounded-full overflow-hidden mb-3">
          <div
            className="h-full bg-gradient-to-r from-teal-500 to-emerald-500 rounded-full transition-all duration-500"
            style={{ width: `${pctGlobal}%` }}
            role="progressbar"
            aria-valuenow={pctGlobal}
            aria-valuemin={0}
            aria-valuemax={100}
          />
        </div>
      )}
      {emptyScope ? (
        <p className="text-xs text-gray-500">Aucune tâche ni user story avec tâches dans ce périmètre.</p>
      ) : (
        <ul className="space-y-1.5 text-xs text-gray-600">
          <li>
            <span className="font-medium text-gray-700">Tâches :</span>{' '}
            {taskPart.pct !== null ? (
              <>
                <span className="tabular-nums font-semibold text-gray-800">{taskPart.pct}%</span> —{' '}
                <span className="tabular-nums">{taskPart.done}</span> terminée{taskPart.done !== 1 ? 's' : ''} sur{' '}
                <span className="tabular-nums">{taskPart.total}</span>
              </>
            ) : (
              <span className="text-gray-400">aucune tâche</span>
            )}
          </li>
          <li>
            <span className="font-medium text-gray-700">User stories :</span>{' '}
            {usPart.pct !== null ? (
              <>
                <span className="tabular-nums font-semibold text-gray-800">{usPart.pct}%</span> —{' '}
                <span className="tabular-nums">{usPart.done}</span> terminée{usPart.done !== 1 ? 's' : ''} sur{' '}
                <span className="tabular-nums">{usPart.total}</span> (ayant au moins une tâche)
              </>
            ) : (
              <span className="text-gray-400">aucune US avec tâche</span>
            )}
          </li>
          <li className="text-gray-400 pt-1 border-t border-gray-100">
            Synthèse globale = moyenne des deux pourcentages lorsqu&apos;ils sont tous deux disponibles ; sinon le seul
            indicateur disponible.
          </li>
        </ul>
      )}
    </div>
  );
}

function epicToKanbanAndGantt(
  ep: EpicRow,
  taches: Tache[],
  allUserStories: UserStoryRow[]
): { kanban: KanbanTache; gantt: TacheGantt } {
  const now = new Date();
  const tl = tasksForEpic(ep, allUserStories, taches);
  const statut = deriveAggregatedStatutFromTasks(
    tl.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
    now
  );
  const debuts = tl.map((t) => t.dateDebut).filter(Boolean) as string[];
  const fins = tl.map((t) => t.dateFinApprox).filter(Boolean) as string[];
  let dateDebut: string | undefined;
  let dateFinApprox: string | undefined;
  if (debuts.length) dateDebut = debuts.reduce((a, b) => (new Date(a) < new Date(b) ? a : b));
  if (fins.length) dateFinApprox = fins.reduce((a, b) => (new Date(a) > new Date(b) ? a : b));
  return {
    kanban: {
      id: ep.id,
      entityType: 'epic' as const,
      nom: ep.nom,
      statut,
      dateFinApprox,
      projet: ep.projet,
      assignesUtilisateurs: collectAssignesFromTasks(tl),
      assignesClientsFournisseurs: epicClientsEffectifs(ep, tl),
    },
    gantt: {
      id: ep.id,
      entityType: 'epic' as const,
      nom: ep.nom,
      statut,
      dateDebut,
      dateFinApprox,
      projet: ep.projet,
    },
  };
}

function UserStoriesAgileDashboard({ userStories, taches }: { userStories: UserStoryRow[]; taches: Tache[] }) {
  const usIds = new Set(userStories.map((us) => us.id));
  const tachesScoped = taches.filter((t) => t.userStory?.id && usIds.has(t.userStory.id));

  const now = new Date();
  let termineAgg = 0;
  let bloqueAgg = 0;
  let encoursAgg = 0;
  let sansTache = 0;
  for (const us of userStories) {
    const tl = taches.filter((t) => t.userStory?.id === us.id);
    if (tl.length === 0) {
      sansTache++;
      continue;
    }
    const s = deriveAggregatedStatutFromTasks(
      tl.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
      now
    );
    if (s === 'termine') termineAgg++;
    else if (s === 'bloque') bloqueAgg++;
    else if (s === 'en_cours') encoursAgg++;
  }

  const tpVue = computeTaskProgressPct(tachesScoped);
  const upVue = computeUserStoriesProgressPct(userStories, taches, now);
  const pctVueGlobale = blendProgressPct(tpVue.pct, upVue.pct);

  type ProjetGrp = { nom: string; epicMap: Map<string, { nom: string; stories: UserStoryRow[] }> };
  const projetMap = new Map<string, ProjetGrp>();
  const ensureProjet = (id: string, nom: string): ProjetGrp => {
    if (!projetMap.has(id)) projetMap.set(id, { nom, epicMap: new Map() });
    return projetMap.get(id)!;
  };
  const ensureEpic = (p: ProjetGrp, eid: string, enom: string) => {
    if (!p.epicMap.has(eid)) p.epicMap.set(eid, { nom: enom, stories: [] });
    return p.epicMap.get(eid)!;
  };
  for (const us of userStories) {
    if (!us.epicId && !us.epic) {
      const pr = ensureProjet('__sans_epic__', 'Sans Epic');
      ensureEpic(pr, '__orpheline__', 'User stories sans epic').stories.push(us);
      continue;
    }
    const epicRef = us.epic;
    const projetId = epicRef?.projet?.id ?? epicRef?.projetId ?? '__sans_projet__';
    const projetNom = epicRef?.projet?.nom ?? 'Sans projet';
    const pr = ensureProjet(projetId, projetNom);
    const eid = us.epicId ?? epicRef?.id ?? '__epic__';
    const enom = epicRef?.nom ?? 'Epic';
    ensureEpic(pr, eid, enom).stories.push(us);
  }
  const projetsSorted = [...projetMap.entries()].sort((a, b) =>
    a[1].nom.localeCompare(b[1].nom, 'fr', { sensitivity: 'base' })
  );

  return (
    <div className="mb-4 space-y-4">
      <TachesAvancementBlock taches={tachesScoped} />
      {tachesScoped.length === 0 && userStories.length > 0 && (
        <p className="text-xs text-gray-500 -mt-2">
          Aucune tâche liée aux user stories affichées : barre « tâches seules » masquée ; la synthèse ci-dessous utilise
          tout de même les user stories (partie US si aucune tâche).
        </p>
      )}
      {pctVueGlobale !== null && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-800">Avancement global (user stories affichées)</span>
            <span className="text-2xl font-bold text-indigo-800 tabular-nums">{pctVueGlobale}%</span>
          </div>
          <div className="h-2 bg-white/80 rounded-full overflow-hidden mt-2 mb-2">
            <div
              className="h-full bg-indigo-500 rounded-full"
              style={{ width: `${pctVueGlobale}%` }}
              role="progressbar"
              aria-valuenow={pctVueGlobale}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="text-xs text-gray-600">
            Moyenne entre le % de <strong>tâches</strong> terminées ({tpVue.pct ?? '—'} %, {tpVue.done}/{tpVue.total}) et le %
            de <strong>user stories</strong> considérées comme terminées via leurs tâches ({upVue.pct ?? '—'} %,{' '}
            {upVue.done}/{upVue.total} US avec tâches).
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{userStories.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">User stories</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-green-600">{termineAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">Tâches toutes terminées</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-blue-600">{encoursAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">En cours (agrégé)</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-red-600">{bloqueAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">Retard / bloqué</div>
        </div>
      </div>
      {sansTache > 0 && (
        <p className="text-xs text-gray-500">
          {sansTache} user story(s) sans tâche liée (non comptées dans le % US ; statut « Créée » sur Kanban / Gantt).
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Par projet et par Epic</h3>
        <p className="text-xs text-gray-500 mb-3">
          Pour chaque projet : synthèse globale puis détail par epic (même formule : moyenne % tâches et % user stories
          terminées).
        </p>
        <div className="space-y-6">
          {projetsSorted.map(([pid, pr]) => {
            const allStories = [...pr.epicMap.values()].flatMap((e) => e.stories);
            const taskById = new Map<string, Tache>();
            for (const t of taches) {
              const usId = t.userStory?.id;
              if (usId && allStories.some((s) => s.id === usId)) taskById.set(t.id, t);
            }
            const taskList = [...taskById.values()];
            const tp = computeTaskProgressPct(taskList);
            const up = computeUserStoriesProgressPct(allStories, taches, now);
            const globalP = blendProgressPct(tp.pct, up.pct);
            const epicsSorted = [...pr.epicMap.entries()].sort((a, b) =>
              a[1].nom.localeCompare(b[1].nom, 'fr', { sensitivity: 'base' })
            );
            return (
              <div key={pid} className="space-y-3">
                <AgileAvancementDetailCard
                  title={`Projet : ${pr.nom}`}
                  subtitle={`${allStories.length} user story(s) · ${epicsSorted.length} epic(s) ou groupe(s)`}
                  pctGlobal={globalP}
                  taskPart={tp}
                  usPart={up}
                />
                <div className="grid gap-3 md:grid-cols-2 pl-2 md:pl-3 border-l-2 border-violet-200">
                  {epicsSorted.map(([eid, ep]) => {
                    const tl = taches.filter((t) => ep.stories.some((s) => s.id === t.userStory?.id));
                    const tDedup = [...new Map(tl.map((t) => [t.id, t])).values()];
                    const tpp = computeTaskProgressPct(tDedup);
                    const upp = computeUserStoriesProgressPct(ep.stories, taches, now);
                    const gp = blendProgressPct(tpp.pct, upp.pct);
                    return (
                      <AgileAvancementDetailCard
                        key={eid}
                        title={`Epic : ${ep.nom}`}
                        subtitle={`${ep.stories.length} user story(s)`}
                        pctGlobal={gp}
                        taskPart={tpp}
                        usPart={upp}
                      />
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function EpicsAgileDashboard({
  epics,
  taches,
  userStories,
}: {
  epics: EpicRow[];
  taches: Tache[];
  userStories: UserStoryRow[];
}) {
  const epicIds = new Set(epics.map((e) => e.id));
  const usIdsInEpics = new Set(
    userStories.filter((us) => us.epicId && epicIds.has(us.epicId)).map((us) => us.id)
  );
  const tachesScoped = taches.filter(
    (t) => t.userStory?.id && usIdsInEpics.has(t.userStory.id)
  );

  const now = new Date();
  let termineAgg = 0;
  let bloqueAgg = 0;
  let encoursAgg = 0;
  let sansTache = 0;
  for (const ep of epics) {
    const tl = tasksForEpic(ep, userStories, taches);
    if (tl.length === 0) {
      sansTache++;
      continue;
    }
    const s = deriveAggregatedStatutFromTasks(
      tl.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
      now
    );
    if (s === 'termine') termineAgg++;
    else if (s === 'bloque') bloqueAgg++;
    else if (s === 'en_cours') encoursAgg++;
  }

  const allScopedStories = userStories.filter((us) => us.epicId && epicIds.has(us.epicId));
  const tpVue = computeTaskProgressPct(tachesScoped);
  const upVue = computeUserStoriesProgressPct(allScopedStories, taches, now);
  const pctVueGlobale = blendProgressPct(tpVue.pct, upVue.pct);

  const projetMap = new Map<string, { nom: string; epics: EpicRow[] }>();
  for (const ep of epics) {
    const pid = ep.projet?.id ?? ep.projetId ?? '__sans_projet__';
    const nom = ep.projet?.nom ?? 'Sans projet';
    if (!projetMap.has(pid)) projetMap.set(pid, { nom, epics: [] });
    projetMap.get(pid)!.epics.push(ep);
  }
  const projetsSorted = [...projetMap.entries()].sort((a, b) =>
    a[1].nom.localeCompare(b[1].nom, 'fr', { sensitivity: 'base' })
  );

  return (
    <div className="mb-4 space-y-4">
      <TachesAvancementBlock taches={tachesScoped} />
      {tachesScoped.length === 0 && epics.length > 0 && (
        <p className="text-xs text-gray-500 -mt-2">
          Aucune tâche dans le périmètre des epics affichés : barre « tâches seules » masquée ; la synthèse utilise les
          user stories si possible.
        </p>
      )}
      {pctVueGlobale !== null && (
        <div className="rounded-lg border border-indigo-200 bg-indigo-50/80 p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm font-semibold text-gray-800">Avancement global (epics affichés)</span>
            <span className="text-2xl font-bold text-indigo-800 tabular-nums">{pctVueGlobale}%</span>
          </div>
          <div className="h-2 bg-white/80 rounded-full overflow-hidden mt-2 mb-2">
            <div
              className="h-full bg-indigo-500 rounded-full"
              style={{ width: `${pctVueGlobale}%` }}
              role="progressbar"
              aria-valuenow={pctVueGlobale}
              aria-valuemin={0}
              aria-valuemax={100}
            />
          </div>
          <p className="text-xs text-gray-600">
            Moyenne entre le % de <strong>tâches</strong> terminées sur toutes les US des epics visibles ({tpVue.pct ?? '—'}{' '}
            %, {tpVue.done}/{tpVue.total}) et le % de <strong>user stories</strong> terminées (agrégat tâches) dans ce
            périmètre ({upVue.pct ?? '—'} %, {upVue.done}/{upVue.total} US avec tâches).
          </p>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-gray-800">{epics.length}</div>
          <div className="text-xs text-gray-500 mt-0.5">Epics</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-green-600">{termineAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">Tâches toutes terminées</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-blue-600">{encoursAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">En cours (agrégé)</div>
        </div>
        <div className="bg-white rounded-lg shadow p-3 text-center border border-gray-100">
          <div className="text-2xl font-bold text-red-600">{bloqueAgg}</div>
          <div className="text-xs text-gray-500 mt-0.5">Retard / bloqué</div>
        </div>
      </div>
      {sansTache > 0 && (
        <p className="text-xs text-gray-500">
          {sansTache} epic(s) sans tâche via les user stories (non comptés dans le % US au niveau epic ; statut « Créée »
          sur Kanban / Gantt).
        </p>
      )}

      <div>
        <h3 className="text-sm font-semibold text-gray-800 mb-2">Avancement par projet</h3>
        <p className="text-xs text-gray-500 mb-3">
          Chaque carte regroupe les epics visibles du même projet : toutes les tâches des user stories rattachées et le %
          de user stories considérées comme terminées (via leurs tâches). La ligne « globale » est la moyenne des deux
          pourcentages.
        </p>
        <div className="grid gap-3 md:grid-cols-2">
          {projetsSorted.map(([pid, { nom, epics: eps }]) => {
            const seenT = new Set<string>();
            const taskList: Tache[] = [];
            for (const ep of eps) {
              for (const t of tasksForEpic(ep, userStories, taches)) {
                if (!seenT.has(t.id)) {
                  seenT.add(t.id);
                  taskList.push(t);
                }
              }
            }
            const usList = userStories.filter((us) => us.epicId && eps.some((e) => e.id === us.epicId));
            const tp = computeTaskProgressPct(taskList);
            const up = computeUserStoriesProgressPct(usList, taches, now);
            const globalP = blendProgressPct(tp.pct, up.pct);
            return (
              <AgileAvancementDetailCard
                key={pid}
                title={`Projet : ${nom}`}
                subtitle={`${eps.length} epic(s) · ${usList.length} user story(s)`}
                pctGlobal={globalP}
                taskPart={tp}
                usPart={up}
              />
            );
          })}
        </div>
      </div>
    </div>
  );
}

const noopKanbanMove = async (_id: string, _s: string) => {};

// ─── Page Principale ──────────────────────────────────────────────────────────
export default function Taches() {
  const { user: currentUser } = useAuth();
  const location = useLocation();
  const [taches, setTaches] = useState<Tache[]>([]);
  const [tachesEnRetard, setTachesEnRetard] = useState<TacheEnRetardItem[]>([]);
  const [projets, setProjets] = useState<ProjetOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [entites, setEntites] = useState<EntiteOption[]>([]);
  const [clientsFournisseursOptions, setClientsFournisseursOptions] = useState<ClientFournisseurOption[]>([]);
  const [epics, setEpics] = useState<EpicRow[]>([]);
  const [userStories, setUserStories] = useState<UserStoryRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editTache, setEditTache] = useState<Tache | undefined>();
  const [tacheModalLockProjetId, setTacheModalLockProjetId] = useState<string | undefined>(undefined);
  const [tacheModalLockUserStoryId, setTacheModalLockUserStoryId] = useState<string | undefined>(undefined);
  const [showDashboard, setShowDashboard] = useState(false);
  const [usViewMode, setUsViewMode] = useState<'list' | 'kanban' | 'gantt'>('list');
  const [epicViewMode, setEpicViewMode] = useState<'list' | 'kanban' | 'gantt'>('list');
  const [showUsDashboard, setShowUsDashboard] = useState(false);
  const [showEpicDashboard, setShowEpicDashboard] = useState(false);
  const [showEpicCreateModal, setShowEpicCreateModal] = useState(false);
  const [showUsCreateModal, setShowUsCreateModal] = useState(false);
  const [usCreateLockEpicId, setUsCreateLockEpicId] = useState<string | undefined>(undefined);
  const [detailEpicId, setDetailEpicId] = useState<string | null>(null);
  const [detailUserStoryId, setDetailUserStoryId] = useState<string | null>(null);
  const [editUserStoryId, setEditUserStoryId] = useState<string | null>(null);
  const [editEpicId, setEditEpicId] = useState<string | null>(null);
  const [expandedUsListId, setExpandedUsListId] = useState<string | null>(null);
  const [expandedEpicListId, setExpandedEpicListId] = useState<string | null>(null);
  const [journalModal, setJournalModal] = useState<{ path: string; title: string } | null>(null);
  const [journalRows, setJournalRows] = useState<any[]>([]);
  const [journalLoading, setJournalLoading] = useState(false);
  const [agileAccesModal, setAgileAccesModal] = useState<
    | { kind: 'epic'; epic: EpicRow }
    | { kind: 'us'; us: UserStoryRow }
    | null
  >(null);
  const [agileAccesDetail, setAgileAccesDetail] = useState<any | null>(null);
  const [agileAccesLoading, setAgileAccesLoading] = useState(false);
  /** Dernière réponse GET …/acces par epic ou user story (aperçu « Personnes habilitées » à jour). */
  const [agileAccesSnapshot, setAgileAccesSnapshot] = useState<Record<string, any>>({});
  const [agileNewUserId, setAgileNewUserId] = useState('');
  const [agileNewPerm, setAgileNewPerm] = useState('lecture');
  const [showAgileCorbeilleModal, setShowAgileCorbeilleModal] = useState(false);
  const [corbTaches, setCorbTaches] = useState<
    { id: string; nom: string; deletedAt?: string; projet?: { nom: string } }[]
  >([]);
  const [corbEpics, setCorbEpics] = useState<
    { id: string; nom: string; deletedAt?: string; projet?: { nom: string } }[]
  >([]);
  const [corbUserStories, setCorbUserStories] = useState<
    { id: string; description: string; deletedAt?: string; epic?: { nom: string } | null }[]
  >([]);
  const [viewMode, setViewMode] = useState<'list' | 'gantt' | 'kanban'>('list');
  const defaultSectionViews = { taches: true, userStories: true, epics: true };
  const [sectionViews, setSectionViews] = useState(defaultSectionViews);
  const [filters, setFilters] = useState({
    nom: '',
    nomUserStory: '',
    nomEpic: '',
    tacheId: '',
    userStoryId: '',
    epicId: '',
    idsRecherche: '',
    statut: '',
    projetId: '',
    assigneIds: [] as string[],
    entiteIds: [] as string[],
    dateDebutFrom: '',
    dateDebutTo: '',
    dateFinFrom: '',
    dateFinTo: '',
    triDate: '',
  });
  const [showFiltres, setShowFiltres] = useState(false);
  const [mesTachesOnly, setMesTachesOnly] = useState(false);
  const [mesTachesFinaliseesOnly, setMesTachesFinaliseesOnly] = useState(false);
  const [voirArchives, setVoirArchives] = useState(false);
  const [page, setPage] = useState(1);
  const [usPage, setUsPage] = useState(1);
  const [epicPage, setEpicPage] = useState(1);
  const [usRetardPage, setUsRetardPage] = useState(1);
  const [epicRetardPage, setEpicRetardPage] = useState(1);
  const [selectedTacheIdsBulk, setSelectedTacheIdsBulk] = useState<string[]>([]);
  const [selectedUsIdsBulk, setSelectedUsIdsBulk] = useState<string[]>([]);
  const [selectedEpicIdsBulk, setSelectedEpicIdsBulk] = useState<string[]>([]);
  const [bulkStatutTaches, setBulkStatutTaches] = useState('en_cours');
  const [bulkStatutUs, setBulkStatutUs] = useState('en_cours');
  const [bulkStatutEpics, setBulkStatutEpics] = useState('en_cours');

  const focusTaskIdFromUrl = useMemo(() => {
    const params = new URLSearchParams(location.search);
    return params.get('focusTaskId') || '';
  }, [location.search]);
  const pageSize = LIST_SECTION_PAGE_SIZE;

  const isAdmin = currentUser?.role === 'admin';
  const isContributeur = currentUser?.role === 'contributeur';
  const isLecteur = currentUser?.role === 'lecteur';

  useEffect(() => {
    loadAll();
  }, []);

  useEffect(() => {
    setPage(1);
    setUsPage(1);
    setEpicPage(1);
    setUsRetardPage(1);
    setEpicRetardPage(1);
  }, [filters, mesTachesOnly, mesTachesFinaliseesOnly]);

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const projetIdFromUrl = params.get('projetId') || '';
    if (!projetIdFromUrl) return;
    setFilters((prev) => {
      if (prev.projetId === projetIdFromUrl) return prev;
      return {
        ...prev,
        projetId: projetIdFromUrl,
        tacheId: '',
        userStoryId: '',
        epicId: '',
      };
    });
    setShowFiltres(true);
  }, [location.search]);

  useEffect(() => {
    if (!focusTaskIdFromUrl) return;
    setViewMode('list');
    setSectionViews((prev) => (prev.taches ? prev : { ...prev, taches: true }));
    setFilters((prev) => {
      if (prev.tacheId === focusTaskIdFromUrl) return prev;
      return {
        ...prev,
        tacheId: focusTaskIdFromUrl,
      };
    });
    setShowFiltres(true);
  }, [focusTaskIdFromUrl]);

  useEffect(() => {
    if (!agileAccesModal || !agileAccesDetail) return;
    const key = agileAccesModal.kind === 'epic' ? `epic:${agileAccesModal.epic.id}` : `us:${agileAccesModal.us.id}`;
    setAgileAccesSnapshot((prev) => ({ ...prev, [key]: agileAccesDetail }));
  }, [agileAccesDetail, agileAccesModal]);

  useEffect(() => {
    const id = expandedEpicListId;
    if (!id) return;
    let cancel = false;
    void api
      .get(`/epics/${id}/acces`)
      .then(({ data }) => {
        if (!cancel && data) setAgileAccesSnapshot((p) => ({ ...p, [`epic:${id}`]: data }));
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [expandedEpicListId]);

  useEffect(() => {
    const id = expandedUsListId;
    if (!id) return;
    let cancel = false;
    void api
      .get(`/user-stories/${id}/acces`)
      .then(({ data }) => {
        if (!cancel && data) setAgileAccesSnapshot((p) => ({ ...p, [`us:${id}`]: data }));
      })
      .catch(() => {});
    return () => {
      cancel = true;
    };
  }, [expandedUsListId]);

  const loadEpics = async () => {
    try {
      const r = await api.get('/epics');
      setEpics(Array.isArray(r.data) ? r.data : []);
    } catch {
      setEpics([]);
    }
  };

  const loadAgileCorbeille = async () => {
    try {
      const [tr, er, ur] = await Promise.all([
        api.get('/taches/corbeille'),
        api.get('/epics/corbeille'),
        api.get('/user-stories/corbeille'),
      ]);
      setCorbTaches(Array.isArray(tr.data) ? tr.data : []);
      setCorbEpics(Array.isArray(er.data) ? er.data : []);
      setCorbUserStories(Array.isArray(ur.data) ? ur.data : []);
    } catch {
      setCorbTaches([]);
      setCorbEpics([]);
      setCorbUserStories([]);
    }
  };

  const handleSoftDeleteTache = async (id: string) => {
    const t = taches.find((x) => x.id === id);
    if (!window.confirm(`Mettre la tâche « ${t?.nom || id} » en corbeille ?`)) return;
    try {
      await api.delete(`/taches/${id}`);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const handleSoftDeleteEpic = async (id: string) => {
    const ep = epics.find((x) => x.id === id);
    if (!window.confirm(`Mettre l’epic « ${ep?.nom || id} » en corbeille ?`)) return;
    try {
      await api.delete(`/epics/${id}`);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const handleSoftDeleteUserStory = async (id: string) => {
    const us = userStories.find((x) => x.id === id);
    if (!window.confirm(`Mettre cette user story en corbeille ?`)) return;
    try {
      await api.delete(`/user-stories/${id}`);
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur');
    }
  };

  const bulkUpdateTachesStatut = async (ids: string[], statut: string) => {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.put(`/taches/${id}`, { statut })));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const ko = results.length - ok;
    await loadAll();
    alert(`Mise à jour du statut terminée: ${ok} succès${ko > 0 ? `, ${ko} échec(s)` : ''}.`);
  };

  const bulkSoftDeleteByPath = async (entityPath: '/taches' | '/user-stories' | '/epics', ids: string[], label: string) => {
    if (ids.length === 0) return;
    const results = await Promise.allSettled(ids.map((id) => api.delete(`${entityPath}/${id}`)));
    const ok = results.filter((r) => r.status === 'fulfilled').length;
    const ko = results.length - ok;
    await loadAll();
    alert(`Mise en corbeille (${label}) terminée: ${ok} succès${ko > 0 ? `, ${ko} échec(s)` : ''}.`);
  };

  const restoreTacheCorbeille = async (id: string) => {
    try {
      await api.post(`/taches/${id}/restaurer`);
      await loadAgileCorbeille();
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur restauration');
    }
  };

  const restoreEpicCorbeille = async (id: string) => {
    try {
      await api.post(`/epics/${id}/restaurer`);
      await loadAgileCorbeille();
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur restauration');
    }
  };

  const restoreUserStoryCorbeille = async (id: string) => {
    try {
      await api.post(`/user-stories/${id}/restaurer`);
      await loadAgileCorbeille();
      await loadAll();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur restauration');
    }
  };

  /** `silent: true` : met à jour les données sans écran « Chargement… » (évite de démonter les modales ouvertes). */
  const loadAll = async (opts?: { silent?: boolean }) => {
    const silent = !!opts?.silent;
    if (!silent) setLoading(true);
    try {
      const [tRes, pRes, uRes, eRes, cfRes, epicRes, usRes, retardRes] = await Promise.all([
        api.get('/taches'),
        api.get('/projets'),
        api.get('/users'),
        api.get('/entites'),
        api.get('/clients-fournisseurs').catch(() => ({ data: [] })),
        api.get('/epics').catch(() => ({ data: [] })),
        api.get('/user-stories').catch(() => ({ data: [] })),
        api.get('/dashboard/taches-en-retard').catch(() => ({ data: [] as TacheEnRetardItem[] })),
      ]);
      setTaches(tRes.data);
      setProjets(pRes.data);
      setUsers(uRes.data);
      setEntites(eRes.data);
      const cfRaw = Array.isArray(cfRes.data) ? cfRes.data : [];
      setClientsFournisseursOptions(
        cfRaw.map((c: any) => ({ id: c.id, nom: c.nom, type: c.type || 'client' }))
      );
      setEpics(Array.isArray(epicRes.data) ? epicRes.data : []);
      setUserStories(Array.isArray(usRes.data) ? usRes.data : []);
      setTachesEnRetard(Array.isArray(retardRes.data) ? retardRes.data : []);
    } catch (err) {
      console.error('Erreur chargement:', err);
    } finally {
      if (!silent) setLoading(false);
    }
  };

  const loadAgileAccesDetail = async (modal: { kind: 'epic'; epic: EpicRow } | { kind: 'us'; us: UserStoryRow }) => {
    const path = modal.kind === 'epic' ? `/epics/${modal.epic.id}/acces` : `/user-stories/${modal.us.id}/acces`;
    const { data } = await api.get(path);
    setAgileAccesDetail(data);
  };

  useEffect(() => {
    if (!agileAccesModal) {
      setAgileAccesDetail(null);
      setAgileNewUserId('');
      setAgileNewPerm('lecture');
      return;
    }
    let cancelled = false;
    setAgileAccesLoading(true);
    setAgileAccesDetail(null);
    setAgileNewUserId('');
    setAgileNewPerm('lecture');
    void loadAgileAccesDetail(agileAccesModal)
      .catch((e: any) => {
        if (!cancelled) {
          alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
          setAgileAccesModal(null);
        }
      })
      .finally(() => {
        if (!cancelled) setAgileAccesLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [agileAccesModal]);

  const refreshAgileAcces = async () => {
    if (!agileAccesModal) return;
    await loadAgileAccesDetail(agileAccesModal);
  };

  const agilePermPathBase = agileAccesModal?.kind === 'epic' ? `/epics/${agileAccesModal.epic.id}` : agileAccesModal ? `/user-stories/${agileAccesModal.us.id}` : '';

  const handleAgileAddPermission = async () => {
    if (!agileAccesModal || !agileNewUserId) return;
    try {
      await api.post(`${agilePermPathBase}/permissions`, { userId: agileNewUserId, permission: agileNewPerm });
      setAgileNewUserId('');
      setAgileNewPerm('lecture');
      await refreshAgileAcces();
      await loadAll({ silent: true });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleAgileUpdatePermission = async (permissionId: string, permission: string) => {
    if (!agileAccesModal) return;
    try {
      await api.patch(`${agilePermPathBase}/permissions/${permissionId}`, { permission });
      await refreshAgileAcces();
      await loadAll({ silent: true });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleAgileDeletePermission = async (permissionId: string) => {
    if (!agileAccesModal) return;
    if (!window.confirm('Retirer cet accès ?')) return;
    try {
      await api.delete(`${agilePermPathBase}/permissions/${permissionId}`);
      await refreshAgileAcces();
      await loadAll({ silent: true });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleAgileRevokeAdmin = async (userId: string) => {
    if (!agileAccesModal) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus l'élément tant que vous ne lui accorderez pas un accès explicite."
      )
    )
      return;
    try {
      await api.post(`${agilePermPathBase}/admin-sans-acces`, { userId });
      await refreshAgileAcces();
      await loadAll({ silent: true });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleAgileRestoreAdmin = async (userId: string) => {
    if (!agileAccesModal) return;
    if (!window.confirm("Rétablir l'accès administrateur implicite pour cet utilisateur ?")) return;
    try {
      await api.delete(`${agilePermPathBase}/admin-sans-acces/${userId}`);
      await refreshAgileAcces();
      await loadAll({ silent: true });
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openAgileJournal = async (path: string, title: string) => {
    setJournalModal({ path, title });
    setJournalRows([]);
    setJournalLoading(true);
    try {
      const { data } = await api.get(path, { params: { page: 1, limit: 80 } });
      setJournalRows(Array.isArray(data?.data) ? data.data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement historique');
      setJournalModal(null);
    } finally {
      setJournalLoading(false);
    }
  };

  const handleKanbanMove = async (tacheId: string, newStatut: string) => {
    try {
      await api.put(`/taches/${tacheId}`, { statut: newStatut });
      const tRes = await api.get('/taches');
      setTaches(tRes.data);
    } catch (err: any) {
      alert(err.response?.data?.error || 'Impossible de mettre à jour le statut');
      throw err;
    }
  };

  const canEdit = (tache: Tache) => {
    if (isAdmin || isContributeur) return true;
    if (isLecteur && currentUser) {
      if (tache.createurId === currentUser.id) return true;
      const a = tache.assignesUtilisateurs?.find((u) => u.id === currentUser.id);
      const p = a?.permission || 'lecture';
      return p === 'modification' || p === 'suppression' || p === 'gestion';
    }
    return false;
  };

  const canSoftDeleteTache = (tache: Tache) => {
    if (isAdmin || isContributeur) return true;
    if (currentUser && tache.createurId === currentUser.id) return true;
    if (isLecteur && currentUser) {
      const a = tache.assignesUtilisateurs?.find((u) => u.id === currentUser.id);
      const p = a?.permission || 'lecture';
      return p === 'suppression' || p === 'gestion';
    }
    return false;
  };

  const canCreate = isAdmin || isContributeur || !!currentUser;
  const canEditUsEpic = isAdmin || isContributeur;

  const agileAccesAssigneeIds = useMemo(() => {
    if (!agileAccesModal) return new Set<string>();
    return agileAccesModal.kind === 'epic'
      ? getAssigneeUserIdsUnderEpic(agileAccesModal.epic, taches)
      : getAssigneeUserIdsUnderUserStory(agileAccesModal.us.id, taches);
  }, [agileAccesModal, taches]);

  const openNewTacheModal = (opts?: { lockProjetId?: string; lockUserStoryId?: string }) => {
    setEditTache(undefined);
    setTacheModalLockProjetId(opts?.lockProjetId);
    setTacheModalLockUserStoryId(opts?.lockUserStoryId);
    setShowModal(true);
  };
  const openNewUserStoryModal = (opts?: { lockEpicId?: string }) => {
    setUsCreateLockEpicId(opts?.lockEpicId);
    setShowUsCreateModal(true);
  };

  const openEditTacheModal = (t: Tache) => {
    setTacheModalLockProjetId(undefined);
    setTacheModalLockUserStoryId(undefined);
    setEditTache(t);
    setShowModal(true);
  };

  const closeTacheModal = () => {
    setShowModal(false);
    setEditTache(undefined);
    setTacheModalLockProjetId(undefined);
    setTacheModalLockUserStoryId(undefined);
  };

  const projectScopedEpics = useMemo(() => {
    if (!filters.projetId) return [] as EpicRow[];
    return epics
      .filter((ep) => ep.projetId === filters.projetId)
      .slice()
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
  }, [epics, filters.projetId]);

  const projectScopedUserStories = useMemo(() => {
    if (!filters.projetId) return [] as UserStoryRow[];
    const byId = new Map<string, UserStoryRow>();
    for (const us of userStories) {
      if (us.epic?.projetId === filters.projetId) byId.set(us.id, us);
    }
    for (const t of taches) {
      if (t.projetId !== filters.projetId || !t.userStory?.id) continue;
      if (!byId.has(t.userStory.id)) {
        byId.set(t.userStory.id, {
          id: t.userStory.id,
          description: t.userStory.description || '',
          epic: t.userStory.epic || null,
          taches: [],
        } as UserStoryRow);
      }
    }
    return Array.from(byId.values()).sort((a, b) =>
      (a.description || '').localeCompare(b.description || '', 'fr')
    );
  }, [filters.projetId, taches, userStories]);

  const projectScopedTaches = useMemo(() => {
    if (!filters.projetId) return [] as Tache[];
    return taches
      .filter((t) => t.projetId === filters.projetId)
      .slice()
      .sort((a, b) => (a.nom || '').localeCompare(b.nom || '', 'fr'));
  }, [filters.projetId, taches]);

  const filteredUserStoryOptions = useMemo(() => {
    if (!filters.projetId) return [] as UserStoryRow[];
    if (!filters.epicId) return projectScopedUserStories;
    return projectScopedUserStories.filter((us) => us.epic?.id === filters.epicId);
  }, [filters.projetId, filters.epicId, projectScopedUserStories]);

  const filteredTacheOptions = useMemo(() => {
    if (!filters.projetId) return [] as Tache[];
    return projectScopedTaches.filter((t) => {
      if (filters.epicId && t.userStory?.epic?.id !== filters.epicId) return false;
      if (filters.userStoryId && t.userStory?.id !== filters.userStoryId) return false;
      return true;
    });
  }, [filters.projetId, filters.epicId, filters.userStoryId, projectScopedTaches]);

  // Filtrage selon rôle + filtres UI
  const visibleTaches = taches.filter(t => {
    if (!voirArchives && t.statut === 'archive' && !mesTachesFinaliseesOnly) return false;

    if (mesTachesOnly) {
      const uid = currentUser?.id;
      const isAssignedToMe = !!uid && !!t.assignesUtilisateurs?.some((u) => u.id === uid);
      if (!isAssignedToMe) return false;
      if (t.statut === 'termine' || t.statut === 'archive') return false;
    }
    if (mesTachesFinaliseesOnly) {
      const uid = currentUser?.id;
      const isAssignedToMe = !!uid && !!t.assignesUtilisateurs?.some((u) => u.id === uid);
      if (!isAssignedToMe) return false;
      if (t.statut !== 'termine' && t.statut !== 'archive') return false;
    }

    // Filtre rôle
    if (isAdmin) {
      // voit tout
    } else if (isLecteur) {
      if (t.createurId !== currentUser?.id &&
        !(t.assignesUtilisateurs?.some(u => u.id === currentUser?.id))) return false;
    } else if (isContributeur) {
      // voit ses tâches + tâches des projets dont il est membre
      const isSien = t.createurId === currentUser?.id ||
        t.assignesUtilisateurs?.some(u => u.id === currentUser?.id);
      if (!isSien) return false;
    }

    // Filtres UI
    if (filters.projetId && t.projetId !== filters.projetId) return false;
    if (filters.tacheId && t.id !== filters.tacheId) return false;
    if (filters.userStoryId && t.userStory?.id !== filters.userStoryId) return false;
    if (filters.epicId && t.userStory?.epic?.id !== filters.epicId) return false;
    if (filters.assigneIds.length > 0 && !filters.assigneIds.every(id => t.assignesUtilisateurs?.some(u => u.id === id))) return false;
    if (filters.entiteIds.length > 0 && !filters.entiteIds.every(id => t.assignesEntites?.some(e => e.id === id))) return false;
    if (filters.nom && !t.nom.toLowerCase().includes(filters.nom.toLowerCase())) return false;
    if (filters.nomUserStory.trim()) {
      const q = filters.nomUserStory.trim().toLowerCase();
      if (!t.userStory?.description?.toLowerCase().includes(q)) return false;
    }
    if (filters.nomEpic.trim()) {
      const q = filters.nomEpic.trim().toLowerCase();
      if (!t.userStory?.epic?.nom?.toLowerCase().includes(q)) return false;
    }
    if (filters.statut && t.statut !== filters.statut) return false;
    if (filters.dateDebutFrom && t.dateDebut && new Date(t.dateDebut) < new Date(filters.dateDebutFrom)) return false;
    if (filters.dateDebutTo && t.dateDebut && new Date(t.dateDebut) > new Date(filters.dateDebutTo)) return false;
    if (filters.dateFinFrom && t.dateFinApprox && new Date(t.dateFinApprox) < new Date(filters.dateFinFrom)) return false;
    if (filters.dateFinTo && t.dateFinApprox && new Date(t.dateFinApprox) > new Date(filters.dateFinTo)) return false;

    const idQ = filters.idsRecherche.trim().toLowerCase();
    if (idQ) {
      const matchTache = t.id.toLowerCase().includes(idQ);
      const matchUs = t.userStory?.id?.toLowerCase().includes(idQ);
      const matchEpic = t.userStory?.epic?.id?.toLowerCase().includes(idQ);
      if (!matchTache && !matchUs && !matchEpic) return false;
    }

    return true;
  });

  const taskLevelFiltersActive =
    !!filters.nom.trim() ||
    !!filters.tacheId ||
    !!filters.userStoryId ||
    !!filters.epicId ||
    !!filters.idsRecherche.trim() ||
    !!filters.statut ||
    !!filters.dateDebutFrom ||
    !!filters.dateDebutTo ||
    !!filters.dateFinFrom ||
    !!filters.dateFinTo ||
    filters.assigneIds.length > 0 ||
    filters.entiteIds.length > 0;

  const visibleUserStories = userStories.filter((us) => {
    if (!voirArchives) {
      const usTasks = taches.filter((t) => t.userStory?.id === us.id);
      if (usTasks.length > 0) {
        const agg = deriveAggregatedStatutFromTasks(
          usTasks.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
          new Date()
        );
        if (agg === 'archive') return false;
      }
    }

    if (filters.projetId) {
      if (us.epicId) {
        if (us.epic?.projetId !== filters.projetId) return false;
      } else {
        const hasTask = taches.some((t) => t.userStory?.id === us.id && t.projetId === filters.projetId);
        if (!hasTask) return false;
      }
    }
    if (filters.userStoryId && us.id !== filters.userStoryId) return false;
    if (filters.epicId && us.epic?.id !== filters.epicId) return false;
    if (filters.nomUserStory.trim()) {
      if (!us.description.toLowerCase().includes(filters.nomUserStory.trim().toLowerCase())) return false;
    }
    if (filters.nomEpic.trim()) {
      const nom = us.epic?.nom?.toLowerCase() ?? '';
      if (!nom.includes(filters.nomEpic.trim().toLowerCase())) return false;
    }
    if (taskLevelFiltersActive) {
      if (!visibleTaches.some((t) => t.userStory?.id === us.id)) return false;
    }
    return true;
  });

  const visibleEpics = epics.filter((ep) => {
    if (!voirArchives) {
      const epicTasks = taches.filter((t) => t.userStory?.epic?.id === ep.id);
      if (epicTasks.length > 0) {
        const agg = deriveAggregatedStatutFromTasks(
          epicTasks.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
          new Date()
        );
        if (agg === 'archive') return false;
      }
    }

    if (filters.projetId && ep.projetId !== filters.projetId) return false;
    if (filters.epicId && ep.id !== filters.epicId) return false;
    if (filters.userStoryId) {
      const hasUs = (ep.userStories || []).some((u) => u.id === filters.userStoryId);
      if (!hasUs) return false;
    }
    if (filters.nomEpic.trim() && !ep.nom.toLowerCase().includes(filters.nomEpic.trim().toLowerCase())) return false;
    if (filters.nomUserStory.trim()) {
      const ok = (ep.userStories || []).some((us) =>
        us.description.toLowerCase().includes(filters.nomUserStory.trim().toLowerCase())
      );
      if (!ok) return false;
    }
    if (taskLevelFiltersActive) {
      if (!visibleTaches.some((t) => t.userStory?.epic?.id === ep.id)) return false;
    }
    return true;
  });

  const sortedVisibleTaches = useMemo(() => {
    const toTs = (d?: string) => {
      if (!d) return Number.POSITIVE_INFINITY;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    const toTsDesc = (d?: string) => {
      if (!d) return Number.NEGATIVE_INFINITY;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : Number.NEGATIVE_INFINITY;
    };
    return [...visibleTaches].sort((a, b) => {
      const as = computeTaskPriorityScore(a);
      const bs = computeTaskPriorityScore(b);
      const aScore = as?.score ?? Number.NEGATIVE_INFINITY;
      const bScore = bs?.score ?? Number.NEGATIVE_INFINITY;
      if (aScore !== bScore) return bScore - aScore;
      if (filters.triDate === 'createdAt') {
        const da = toTsDesc(a.createdAt);
        const db = toTsDesc(b.createdAt);
        if (da !== db) return db - da;
      }
      if (filters.triDate === 'dateDebut') {
        const da = toTsDesc(a.dateDebut);
        const db = toTsDesc(b.dateDebut);
        if (da !== db) return db - da;
      }
      if (filters.triDate === 'dateFin') {
        const da = toTsDesc(a.dateFinApprox);
        const db = toTsDesc(b.dateFinApprox);
        if (da !== db) return db - da;
      }
      return compareTachesByPriorityComplexityDueDate(a, b);
    });
  }, [visibleTaches, filters.triDate]);

  const sortedVisibleUserStories = useMemo(() => {
    const toTs = (d?: string) => {
      if (!d) return Number.POSITIVE_INFINITY;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    return [...visibleUserStories].sort((a, b) => {
      const ta = getTachesLieesUserStory(a.id, taches);
      const tb = getTachesLieesUserStory(b.id, taches);
      const sa = deriveAggregatedStatutFromTasks(
        ta.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
        new Date()
      );
      const sb = deriveAggregatedStatutFromTasks(
        tb.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
        new Date()
      );
      const ra = STATUT_SORT_RANK[sa] ?? 999;
      const rb = STATUT_SORT_RANK[sb] ?? 999;
      if (ra !== rb) return ra - rb;
      const da = toTs(dateRangeFromTasks(ta).dateFinApprox);
      const db = toTs(dateRangeFromTasks(tb).dateFinApprox);
      if (da !== db) return da - db;
      return (a.description || '').localeCompare(b.description || '', 'fr');
    });
  }, [visibleUserStories, taches]);

  const sortedVisibleEpics = useMemo(() => {
    const toTs = (d?: string) => {
      if (!d) return Number.POSITIVE_INFINITY;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    return [...visibleEpics].sort((a, b) => {
      const ta = getTachesLieesEpic(a, taches);
      const tb = getTachesLieesEpic(b, taches);
      const sa = deriveAggregatedStatutFromTasks(
        ta.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
        new Date()
      );
      const sb = deriveAggregatedStatutFromTasks(
        tb.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
        new Date()
      );
      const ra = STATUT_SORT_RANK[sa] ?? 999;
      const rb = STATUT_SORT_RANK[sb] ?? 999;
      if (ra !== rb) return ra - rb;
      const da = toTs(dateRangeFromTasks(ta).dateFinApprox);
      const db = toTs(dateRangeFromTasks(tb).dateFinApprox);
      if (da !== db) return da - db;
      return (a.nom || '').localeCompare(b.nom || '', 'fr');
    });
  }, [visibleEpics, taches]);

  const nowKpi = new Date();
  const usIdsEnRetard = new Set<string>();
  const epicIdsEnRetard = new Set<string>();
  for (const t of taches) {
    if (!isTacheEnRetardKpi(t, nowKpi)) continue;
    if (t.userStory?.id) usIdsEnRetard.add(t.userStory.id);
    if (t.userStory?.epic?.id) epicIdsEnRetard.add(t.userStory.epic.id);
  }
  const userStoriesEnRetardList = sortedVisibleUserStories.filter((us) => usIdsEnRetard.has(us.id));
  const epicsEnRetardList = sortedVisibleEpics.filter((ep) => epicIdsEnRetard.has(ep.id));

  const visibleTacheIds = new Set(sortedVisibleTaches.map((t) => t.id));
  const sortedTacheIndexById = new Map(sortedVisibleTaches.map((t, i) => [t.id, i]));
  const tachesEnRetardFiltrees = tachesEnRetard
    .filter((item) => visibleTacheIds.has(item.id))
    .sort((a, b) => (sortedTacheIndexById.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (sortedTacheIndexById.get(b.id) ?? Number.MAX_SAFE_INTEGER));
  const visibleTaskById = useMemo(() => new Map(visibleTaches.map((t) => [t.id, t])), [visibleTaches]);
  const getPriorityMetaByTaskId = useCallback(
    (taskId: string): { score: number; labels: string[] } | null => {
      const task = visibleTaskById.get(taskId);
      if (!task) return null;
      const ps = computeTaskPriorityScore(task);
      if (!ps) return null;
      return { score: ps.score, labels: ps.labels };
    },
    [visibleTaskById]
  );
  const getPriorityMetaForKanban = useCallback(
    (item: KanbanTache): { score: number; labels: string[] } | null => getPriorityMetaByTaskId(item.id),
    [getPriorityMetaByTaskId]
  );
  const getPriorityMetaForGantt = useCallback(
    (item: TacheGantt): { score: number; labels: string[] } | null => getPriorityMetaByTaskId(item.id),
    [getPriorityMetaByTaskId]
  );

  const usAgileKanbanItems = useMemo(
    () => sortedVisibleUserStories.map((us) => userStoryToKanbanAndGantt(us, taches).kanban),
    [sortedVisibleUserStories, taches]
  );
  const usAgileGanttItems = useMemo(
    () => sortedVisibleUserStories.map((us) => userStoryToKanbanAndGantt(us, taches).gantt),
    [sortedVisibleUserStories, taches]
  );
  const epicAgileKanbanItems = useMemo(
    () => sortedVisibleEpics.map((ep) => epicToKanbanAndGantt(ep, taches, userStories).kanban),
    [sortedVisibleEpics, taches, userStories]
  );
  const epicAgileGanttItems = useMemo(
    () => sortedVisibleEpics.map((ep) => epicToKanbanAndGantt(ep, taches, userStories).gantt),
    [sortedVisibleEpics, taches, userStories]
  );

  const pageTasksEff = clampListPage(page, sortedVisibleTaches.length, pageSize);
  const pagedTaches = sortedVisibleTaches.slice((pageTasksEff - 1) * pageSize, pageTasksEff * pageSize);

  useEffect(() => {
    if (!focusTaskIdFromUrl) return;
    if (!pagedTaches.some((t) => t.id === focusTaskIdFromUrl)) return;
    const el = document.getElementById(`task-card-${focusTaskIdFromUrl}`);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  }, [focusTaskIdFromUrl, pagedTaches]);

  const pageUsEff = clampListPage(usPage, sortedVisibleUserStories.length, pageSize);
  const pagedUserStories = sortedVisibleUserStories.slice((pageUsEff - 1) * pageSize, pageUsEff * pageSize);

  const pageEpicEff = clampListPage(epicPage, sortedVisibleEpics.length, pageSize);
  const pagedEpics = sortedVisibleEpics.slice((pageEpicEff - 1) * pageSize, pageEpicEff * pageSize);
  const selectedTachesSet = new Set(selectedTacheIdsBulk);
  const selectedUsSet = new Set(selectedUsIdsBulk);
  const selectedEpicsSet = new Set(selectedEpicIdsBulk);

  const pageUsRetardEff = clampListPage(usRetardPage, userStoriesEnRetardList.length, pageSize);
  const pagedUserStoriesEnRetard = userStoriesEnRetardList.slice(
    (pageUsRetardEff - 1) * pageSize,
    pageUsRetardEff * pageSize
  );
  const pageEpicRetardEff = clampListPage(epicRetardPage, epicsEnRetardList.length, pageSize);
  const pagedEpicsEnRetard = epicsEnRetardList.slice(
    (pageEpicRetardEff - 1) * pageSize,
    pageEpicRetardEff * pageSize
  );

  const sectionViewSelectedCount =
    (sectionViews.taches ? 1 : 0) + (sectionViews.userStories ? 1 : 0) + (sectionViews.epics ? 1 : 0);
  // Au moins une vue cochée : n’afficher que les sections cochées. Aucune : rien (message dans le bloc filtre).
  const showTachesSection = sectionViewSelectedCount > 0 && sectionViews.taches;
  const showUserStoriesSection = sectionViewSelectedCount > 0 && sectionViews.userStories;
  const showEpicsSection = sectionViewSelectedCount > 0 && sectionViews.epics;

  useEffect(() => {
    if (viewMode !== 'list') setSelectedTacheIdsBulk([]);
  }, [viewMode]);
  useEffect(() => {
    if (usViewMode !== 'list') setSelectedUsIdsBulk([]);
  }, [usViewMode]);
  useEffect(() => {
    if (epicViewMode !== 'list') setSelectedEpicIdsBulk([]);
  }, [epicViewMode]);

  if (loading) return <div className="p-6 text-gray-500">Chargement…</div>;

  return (
    <div className="p-6">
      {/* En-tête */}
      <div className="flex flex-wrap justify-between items-start mb-6 gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-800">Epics / User story / Tâches</h1>
          <p className="text-xs text-gray-500 mt-1 max-w-2xl">
            Les filtres ci-dessous s&apos;appliquent aux trois sections. Les vues Liste, Kanban et Gantt concernent uniquement les
            tâches. En liste : chaque ligne affiche le titre, l&apos;identifiant, les personnes assignées et les clients /
            fournisseurs (sur les tâches directement ; sur les user stories et epics, y compris par héritage depuis les tâches
            liées) — cliquez sur la ligne pour ouvrir le détail et les actions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 items-center justify-end">
          {(isAdmin || isContributeur) && (
            <button
              type="button"
              onClick={async () => {
                await loadAgileCorbeille();
                setShowAgileCorbeilleModal(true);
              }}
              className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50 font-medium"
            >
              🗑 Corbeille
          </button>
          )}
          {canCreate && (
            <>
              <BulkAgileCsvImportModal
                projects={projets.map((p: any) => ({
                  id: p.id,
                  nom: p.nom,
                  codeProjet: p.codeProjet || null,
                }))}
                users={users}
                clientsFournisseurs={clientsFournisseursOptions}
                onCloseAfterImport={(shouldRefresh) => {
                  if (shouldRefresh) {
                    void loadAll({ silent: true });
                  }
                }}
              />
              <button
                type="button"
                onClick={() => setShowEpicCreateModal(true)}
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                + Nouvel Epic
              </button>
              <button
                type="button"
                onClick={() => openNewUserStoryModal()}
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                + Nouvelle User Storie
              </button>
              <button
                type="button"
                onClick={() => openNewTacheModal()}
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
              + Nouvelle tâche
            </button>
            </>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filters.nom.trim() ||
              filters.nomUserStory.trim() ||
              filters.nomEpic.trim() ||
              filters.tacheId ||
              filters.userStoryId ||
              filters.epicId ||
              filters.idsRecherche.trim() ||
              filters.statut ||
              filters.projetId ||
              filters.assigneIds.length > 0 ||
              filters.entiteIds.length > 0 ||
              filters.dateDebutFrom ||
              filters.dateDebutTo ||
              filters.dateFinFrom ||
              filters.dateFinTo ||
              filters.triDate)
              ? ' ●'
              : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
          <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Projet</label>
                <select
                  value={filters.projetId}
                  onChange={(e) =>
                    setFilters({
                      ...filters,
                      projetId: e.target.value,
                      tacheId: '',
                      userStoryId: '',
                      epicId: '',
                    })
                  }
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
              <option value="">Tous les projets</option>
                  {projets.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.nom}
                    </option>
                  ))}
            </select>
                {filters.projetId && (
                  <Link
                    to={`/projets/${filters.projetId}`}
                    className="mt-2 inline-flex items-center justify-center w-full px-3 py-2 text-sm font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                  >
                    Voir détail projet
                  </Link>
                )}
          </div>

          <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filters.statut}
                  onChange={(e) => setFilters({ ...filters, statut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous les statuts</option>
                  {STATUT_OPTIONS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
          </div>

          <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Assigné à{' '}
                  {filters.assigneIds.length > 0 && (
                    <span className="text-blue-600">({filters.assigneIds.length})</span>
                  )}
            </label>
            <div className="border border-gray-300 rounded-md max-h-28 overflow-y-auto p-1">
                  {users.map((u) => (
                    <label
                      key={u.id}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer rounded text-sm"
                    >
                      <input
                        type="checkbox"
                    checked={filters.assigneIds.includes(u.id)}
                        onChange={(e) =>
                          setFilters({
                            ...filters,
                            assigneIds: e.target.checked
                              ? [...filters.assigneIds, u.id]
                              : filters.assigneIds.filter((id) => id !== u.id),
                          })
                        }
                        className="rounded"
                      />
                  {u.prenom} {u.nom}
                </label>
              ))}
            </div>
          </div>

          <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">
                  Entités assignées{' '}
                  {filters.entiteIds.length > 0 && (
                    <span className="text-blue-600">({filters.entiteIds.length})</span>
                  )}
            </label>
            <div className="border border-gray-300 rounded-md max-h-28 overflow-y-auto p-1">
                  {entites.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 px-2 py-1 hover:bg-gray-50 cursor-pointer rounded text-sm"
                    >
                      <input
                        type="checkbox"
                    checked={filters.entiteIds.includes(e.id)}
                        onChange={(ev) =>
                          setFilters({
                            ...filters,
                            entiteIds: ev.target.checked
                              ? [...filters.entiteIds, e.id]
                              : filters.entiteIds.filter((id) => id !== e.id),
                          })
                        }
                        className="rounded"
                      />
                  {e.nom}
                </label>
              ))}
            </div>
          </div>

              {filters.projetId ? (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Epic (liste)</label>
                    <select
                      value={filters.epicId}
                      onChange={(e) =>
                        setFilters({
                          ...filters,
                          epicId: e.target.value,
                          userStoryId: '',
                          tacheId: '',
                        })
                      }
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">Tous les epics du projet</option>
                      {projectScopedEpics.map((ep) => (
                        <option key={ep.id} value={ep.id}>
                          {ep.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">User story (liste)</label>
                    <select
                      value={filters.userStoryId}
                      onChange={(e) => {
                        const usId = e.target.value;
                        const selectedUs = filteredUserStoryOptions.find((u) => u.id === usId);
                        setFilters({
                          ...filters,
                          userStoryId: usId,
                          epicId: usId ? selectedUs?.epic?.id || filters.epicId : filters.epicId,
                          tacheId: '',
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">Toutes les user stories du projet</option>
                      {filteredUserStoryOptions.map((us) => (
                        <option key={us.id} value={us.id}>
                          {truncateUi(us.description || '', 90)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Tâche (liste)</label>
                    <select
                      value={filters.tacheId}
                      onChange={(e) => {
                        const tid = e.target.value;
                        const selectedTache = filteredTacheOptions.find((t) => t.id === tid);
                        setFilters({
                          ...filters,
                          tacheId: tid,
                          userStoryId: tid ? selectedTache?.userStory?.id || filters.userStoryId : filters.userStoryId,
                          epicId: tid ? selectedTache?.userStory?.epic?.id || filters.epicId : filters.epicId,
                        });
                      }}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    >
                      <option value="">Toutes les tâches du projet</option>
                      {filteredTacheOptions.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.nom}
                        </option>
                      ))}
                    </select>
                  </div>
                </>
              ) : (
                <>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la tâche</label>
                    <input
                      type="text"
                      value={filters.nom}
                      onChange={(e) => setFilters({ ...filters, nom: e.target.value })}
                      placeholder="Rechercher…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom de la User story</label>
                    <input
                      type="text"
                      value={filters.nomUserStory}
                      onChange={(e) => setFilters({ ...filters, nomUserStory: e.target.value })}
                      placeholder="Rechercher dans la description…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Nom de l&apos;Epic</label>
                    <input
                      type="text"
                      value={filters.nomEpic}
                      onChange={(e) => setFilters({ ...filters, nomEpic: e.target.value })}
                      placeholder="Rechercher…"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                    />
                  </div>
                </>
              )}

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ID (tâche, user story ou epic)</label>
                <input
                  type="text"
                  value={filters.idsRecherche}
                  onChange={(e) => setFilters({ ...filters, idsRecherche: e.target.value })}
                  placeholder="Sous-chaîne d’UUID…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                />
              </div>

          <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date de début</label>
            <div className="flex gap-2">
                  <input
                    type="date"
                    value={filters.dateDebutFrom}
                    onChange={(e) => setFilters({ ...filters, dateDebutFrom: e.target.value })}
                    className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm"
                    title="Du"
                  />
                  <input
                    type="date"
                    value={filters.dateDebutTo}
                    onChange={(e) => setFilters({ ...filters, dateDebutTo: e.target.value })}
                    className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm"
                    title="Au"
                  />
            </div>
          </div>

              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date de fin approximative</label>
                <div className="flex gap-2">
                  <input
                    type="date"
                    value={filters.dateFinFrom}
                    onChange={(e) => setFilters({ ...filters, dateFinFrom: e.target.value })}
                    className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm"
                    title="Du"
                  />
                  <input
                    type="date"
                    value={filters.dateFinTo}
                    onChange={(e) => setFilters({ ...filters, dateFinTo: e.target.value })}
                    className="w-full px-2 py-2 border border-gray-300 rounded-md text-sm"
                    title="Au"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Tri des tâches (date)</label>
                <select
                  value={filters.triDate}
                  onChange={(e) => setFilters({ ...filters, triDate: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Statut puis échéance (défaut)</option>
                  <option value="createdAt">Trier par date de création</option>
                  <option value="dateDebut">Trier par date de début</option>
                  <option value="dateFin">Trier par date de fin</option>
                </select>
              </div>
        </div>
        <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() =>
                  setFilters({
                    nom: '',
                    nomUserStory: '',
                    nomEpic: '',
                    tacheId: '',
                    userStoryId: '',
                    epicId: '',
                    idsRecherche: '',
                    statut: '',
                    projetId: '',
                    assigneIds: [],
                    entiteIds: [],
                    dateDebutFrom: '',
                    dateDebutTo: '',
                    dateFinFrom: '',
                    dateFinTo: '',
                    triDate: '',
                  })
                }
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
            Réinitialiser
          </button>
        </div>
          </div>
        )}
      </div>

      {/* Filtrer par vue (sections affichées) */}
      <div className="bg-white rounded-lg shadow border border-gray-200 p-4 mb-6">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <p className="text-sm font-semibold text-gray-800">Filtrer par vue</p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setVoirArchives((v) => !v)}
              className={`text-sm border rounded-md px-3 py-1.5 ${
                voirArchives
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'text-gray-600 hover:text-gray-900 border-gray-300 hover:bg-gray-50'
              }`}
            >
              {voirArchives ? 'Masquer archives' : 'Voir archives'}
            </button>
            <button
              type="button"
              onClick={() => setSectionViews({ ...defaultSectionViews })}
              className="text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-md px-3 py-1.5 hover:bg-gray-50"
            >
              Réinitialiser
            </button>
          </div>
        </div>
        <p className="text-xs text-gray-500 mb-3">
          Cochez une ou plusieurs vues : seules les sections correspondantes s&apos;affichent. Décochez pour masquer. Réinitialiser
          recoche les trois vues.
        </p>
        <div className="flex flex-wrap gap-6">
          <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={sectionViews.taches}
              onChange={(e) => setSectionViews((v) => ({ ...v, taches: e.target.checked }))}
            />
            Vue Tâches
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={sectionViews.userStories}
              onChange={(e) => setSectionViews((v) => ({ ...v, userStories: e.target.checked }))}
            />
            Vue User stories
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-800 cursor-pointer select-none">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={sectionViews.epics}
              onChange={(e) => setSectionViews((v) => ({ ...v, epics: e.target.checked }))}
            />
            Vue Epics
          </label>
        </div>
        {sectionViewSelectedCount === 0 && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2 mt-3">
            Aucune vue sélectionnée : cochez au moins une vue pour afficher du contenu, ou utilisez Réinitialiser.
          </p>
        )}
      </div>

      {/* Section Tâches */}
      {showTachesSection && (
      <section className="mb-10" aria-labelledby="sec-taches">
        <h2 id="sec-taches" className="text-xl font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          Tâches
        </h2>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`px-3 py-2 rounded border text-sm font-medium ${viewMode === 'list' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => setViewMode('kanban')}
            className={`px-3 py-2 rounded border text-sm font-medium ${viewMode === 'kanban' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Kanban
          </button>
          <button
            type="button"
            onClick={() => setViewMode('gantt')}
            className={`px-3 py-2 rounded border text-sm font-medium ${viewMode === 'gantt' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Gantt
          </button>
          <button
            type="button"
            onClick={() => setShowDashboard(!showDashboard)}
            className={`px-3 py-2 rounded border text-sm font-medium ${showDashboard ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {showDashboard ? 'Masquer le tableau de bord' : 'Tableau de bord'}
          </button>
          <button
            type="button"
            onClick={() =>
              setMesTachesOnly((v) => {
                const next = !v;
                if (next) setMesTachesFinaliseesOnly(false);
                return next;
              })
            }
            className={`px-3 py-2 rounded border text-sm font-medium ${
              mesTachesOnly ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            title="Afficher uniquement mes tâches assignées à faire / en cours"
          >
            Mes Tâches à faire / en cours
          </button>
          <button
            type="button"
            onClick={() =>
              setMesTachesFinaliseesOnly((v) => {
                const next = !v;
                if (next) setMesTachesOnly(false);
                return next;
              })
            }
            className={`px-3 py-2 rounded border text-sm font-medium ${
              mesTachesFinaliseesOnly
                ? 'bg-indigo-600 text-white border-indigo-600'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
            title="Afficher uniquement mes tâches assignées finalisées"
          >
            Mes Tâches Finalisées
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => openNewTacheModal()}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              + Nouvelle tâche
            </button>
          )}
        </div>
        {showDashboard && <TachesDashboard taches={visibleTaches} />}
        <TachesEnRetardBloc
          items={tachesEnRetardFiltrees}
          getPriorityMeta={getPriorityMetaByTaskId}
          hideFooterLink
          onTacheClick={(id) => {
            const t = taches.find((x) => x.id === id);
            if (t) openEditTacheModal(t);
          }}
        />

        {viewMode === 'gantt' ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <p className="text-sm text-gray-500">
                {visibleTaches.length} tâche(s) sur le diagramme (mêmes filtres que la liste)
              </p>
              {visibleTaches.length > 80 && (
                <p className="text-xs text-amber-700">Beaucoup de tâches : faites défiler horizontalement ou affinez les filtres.</p>
              )}
            </div>
            <TachesGanttView
              taches={visibleTaches}
              getCanEdit={(t) => canEdit(t as Tache)}
              getPriorityMeta={getPriorityMetaForGantt}
              onBarClick={(t) => {
                openEditTacheModal(t as Tache);
              }}
            />
          </div>
        ) : viewMode === 'kanban' ? (
          <TachesKanbanView
            taches={visibleTaches}
            columns={STATUT_OPTIONS}
            getCanEdit={(t) => canEdit(t as Tache)}
            getPriorityMeta={getPriorityMetaForKanban}
            onMoveTache={handleKanbanMove}
            onCardClick={(t) => {
              openEditTacheModal(t as Tache);
            }}
          />
        ) : (
          <>
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">{visibleTaches.length} tâche(s) trouvée(s)</p>
        </div>
        <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap gap-2 items-center">
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              className="rounded border-gray-300"
              checked={pagedTaches.length > 0 && pagedTaches.every((t) => selectedTachesSet.has(t.id))}
              onChange={(e) => {
                if (e.target.checked) {
                  setSelectedTacheIdsBulk((prev) => [...new Set([...prev, ...pagedTaches.map((t) => t.id)])]);
                } else {
                  const pageSet = new Set(pagedTaches.map((t) => t.id));
                  setSelectedTacheIdsBulk((prev) => prev.filter((id) => !pageSet.has(id)));
                }
              }}
            />
            Sélectionner la page ({pagedTaches.length})
          </label>
          <span className="text-xs text-gray-500">{selectedTacheIdsBulk.length} sélectionnée(s)</span>
          <select
            value={bulkStatutTaches}
            onChange={(e) => setBulkStatutTaches(e.target.value)}
            className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
          >
            {STATUT_OPTIONS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
          <button
            type="button"
            disabled={selectedTacheIdsBulk.length === 0}
            onClick={async () => {
              const allowed = selectedTacheIdsBulk.filter((id) => {
                const t = taches.find((x) => x.id === id);
                return t ? canEdit(t) : false;
              });
              if (allowed.length === 0) {
                alert('Aucune tâche sélectionnée modifiable.');
                return;
              }
              await bulkUpdateTachesStatut(allowed, bulkStatutTaches);
              setSelectedTacheIdsBulk([]);
            }}
            className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
          >
            Changer statut (masse)
          </button>
          <button
            type="button"
            disabled={selectedTacheIdsBulk.length === 0}
            onClick={async () => {
              const allowed = selectedTacheIdsBulk.filter((id) => {
                const t = taches.find((x) => x.id === id);
                return t ? canSoftDeleteTache(t) : false;
              });
              if (allowed.length === 0) {
                alert('Aucune tâche sélectionnée supprimable.');
                return;
              }
              if (!window.confirm(`Mettre ${allowed.length} tâche(s) en corbeille ?`)) return;
              await bulkSoftDeleteByPath('/taches', allowed, 'tâches');
              setSelectedTacheIdsBulk([]);
            }}
            className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50"
          >
            Corbeille (masse)
          </button>
        </div>
        {pagedTaches.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">Aucune tâche trouvée</div>
        )}
              {pagedTaches.map((t) => (
          <div key={t.id} id={`task-card-${t.id}`} className="relative">
            <label
              className="absolute left-3 top-3 z-20 bg-white/90 border border-gray-300 rounded px-1.5 py-1 shadow-sm"
              onClick={(e) => e.stopPropagation()}
              title="Sélectionner pour action de masse"
            >
              <input
                type="checkbox"
                className="rounded border-gray-300"
                checked={selectedTachesSet.has(t.id)}
                onChange={(e) =>
                  setSelectedTacheIdsBulk((prev) =>
                    e.target.checked ? [...new Set([...prev, t.id])] : prev.filter((id) => id !== t.id)
                  )
                }
              />
            </label>
          <TacheCard
            tache={t}
                  onEdit={() => {
                    openEditTacheModal(t);
                  }}
            canEdit={canEdit(t)}
            users={users}
            currentUserRole={currentUser?.role || ''}
            allUsers={users}
                  onOpenEpic={(id) => setDetailEpicId(id)}
                  onOpenUserStory={(id) => setDetailUserStoryId(id)}
                  onSoftDelete={canSoftDeleteTache(t) ? handleSoftDeleteTache : undefined}
                  onRefreshData={loadAll}
                  defaultExpanded={focusTaskIdFromUrl === t.id}
          />
          </div>
        ))}
      </div>

            <ListSectionPagination
              page={page}
              pageSize={pageSize}
              totalItems={visibleTaches.length}
              onPageChange={setPage}
            />
          </>
        )}
      </section>
      )}

      {/* Section User stories */}
      {showUserStoriesSection && (
      <section className="mb-10" aria-labelledby="sec-user-stories">
        <h2 id="sec-user-stories" className="text-xl font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          User stories
        </h2>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <button
            type="button"
            onClick={() => setUsViewMode('list')}
            className={`px-3 py-2 rounded border text-sm font-medium ${usViewMode === 'list' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => setUsViewMode('kanban')}
            className={`px-3 py-2 rounded border text-sm font-medium ${usViewMode === 'kanban' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Kanban
          </button>
          <button
            type="button"
            onClick={() => setUsViewMode('gantt')}
            className={`px-3 py-2 rounded border text-sm font-medium ${usViewMode === 'gantt' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Gantt
          </button>
          <button
            type="button"
            onClick={() => setShowUsDashboard(!showUsDashboard)}
            className={`px-3 py-2 rounded border text-sm font-medium ${showUsDashboard ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {showUsDashboard ? 'Masquer le tableau de bord' : 'Tableau de bord'}
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => openNewUserStoryModal()}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              + Nouvelle User Storie
            </button>
          )}
        </div>
        {showUsDashboard && <UserStoriesAgileDashboard userStories={visibleUserStories} taches={taches} />}
        {userStoriesEnRetardList.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow mb-4 border-l-4 border-amber-500">
            <h3 className="text-md font-semibold text-gray-800 mb-1">User stories en retard</h3>
            <p className="text-xs text-gray-500 mb-3">
              User stories pour lesquelles au moins une tâche liée est en retard, bloquée ou dépasse son échéance (hors terminé /
              archivé).
            </p>
            <ul className="divide-y divide-gray-100 text-sm">
              {pagedUserStoriesEnRetard.map((us) => (
                <li key={us.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="text-left text-blue-700 hover:underline font-medium"
                      onClick={() => setDetailUserStoryId(us.id)}
                    >
                      {truncateUi(us.description, 120)}
                    </button>
                    <p className="text-[10px] font-mono text-gray-400 mt-1 break-all" title="ID user story">
                      {us.id}
                    </p>
                  </div>
                  {us.epic && <span className="text-gray-500 text-xs shrink-0">Epic : {us.epic.nom}</span>}
                </li>
              ))}
            </ul>
            <ListSectionPagination
              page={usRetardPage}
              pageSize={pageSize}
              totalItems={userStoriesEnRetardList.length}
              onPageChange={setUsRetardPage}
            />
          </div>
        )}
        {usViewMode === 'gantt' ? (
          <div className="space-y-2">
          <p className="text-sm text-gray-500">
              {visibleUserStories.length} user story(s) — plage temporelle dérivée des dates des tâches liées (min début, max fin).
            </p>
            <TachesGanttView
              taches={usAgileGanttItems}
              rowLabelTitle="User story / projet"
              getPriorityMeta={getPriorityMetaForGantt}
              onBarClick={(row) => setDetailUserStoryId(row.id)}
            />
          </div>
        ) : usViewMode === 'kanban' ? (
          <TachesKanbanView
            taches={usAgileKanbanItems}
            columns={STATUT_OPTIONS}
            readOnly
            getPriorityMeta={getPriorityMetaForKanban}
            getCanEdit={() => false}
            onMoveTache={noopKanbanMove}
            onCardClick={(row) => setDetailUserStoryId(row.id)}
          />
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap gap-2 items-center mb-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={pagedUserStories.length > 0 && pagedUserStories.every((us) => selectedUsSet.has(us.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedUsIdsBulk((prev) => [...new Set([...prev, ...pagedUserStories.map((us) => us.id)])]);
                    } else {
                      const pageSet = new Set(pagedUserStories.map((us) => us.id));
                      setSelectedUsIdsBulk((prev) => prev.filter((id) => !pageSet.has(id)));
                    }
                  }}
                />
                Sélectionner la page ({pagedUserStories.length})
              </label>
              <span className="text-xs text-gray-500">{selectedUsIdsBulk.length} sélectionnée(s)</span>
              <select
                value={bulkStatutUs}
                onChange={(e) => setBulkStatutUs(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                {STATUT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={selectedUsIdsBulk.length === 0 || !canEditUsEpic}
                onClick={async () => {
                  const taskIds = [
                    ...new Set(
                      taches
                        .filter((t) => t.userStory?.id && selectedUsSet.has(t.userStory.id))
                        .filter((t) => canEdit(t))
                        .map((t) => t.id)
                    ),
                  ];
                  if (taskIds.length === 0) {
                    alert('Aucune tâche modifiable trouvée sous les user stories sélectionnées.');
                    return;
                  }
                  await bulkUpdateTachesStatut(taskIds, bulkStatutUs);
                  setSelectedUsIdsBulk([]);
                }}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
              >
                Changer statut (masse)
              </button>
              <button
                type="button"
                disabled={selectedUsIdsBulk.length === 0 || !canEditUsEpic}
                onClick={async () => {
                  if (!window.confirm(`Mettre ${selectedUsIdsBulk.length} user story(s) en corbeille ?`)) return;
                  await bulkSoftDeleteByPath('/user-stories', selectedUsIdsBulk, 'user stories');
                  setSelectedUsIdsBulk([]);
                }}
                className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50"
              >
                Corbeille (masse)
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-2">{visibleUserStories.length} user story(s)</p>
            <div className="space-y-4">
              {visibleUserStories.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">Aucune user story à afficher</div>
              )}
              {pagedUserStories.map((us) => {
                const usExpanded = expandedUsListId === us.id;
                const tasksUs = getTachesLieesUserStory(us.id, taches);
                const assignesUs = getAssignesDepuisTaches(tasksUs);
                const clientsUsEffectifs = userStoryClientsEffectifs(us, tasksUs);
                const entitesUsTaches = getEntitesDepuisTaches(tasksUs);
                const nowUs = new Date();
                const statutAggUs = deriveAggregatedStatutFromTasks(
                  tasksUs.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
                  nowUs
                );
                const { dateDebut: usDebut, dateFinApprox: usFin } = dateRangeFromTasks(tasksUs);
                const isUsLate = usIdsEnRetard.has(us.id);
                const createurTache = tasksUs.find((t) => t.createur)?.createur;
                const projetNomUsLigne =
                  us.epic?.projet?.nom ?? tasksUs.find((t) => t.projet?.nom)?.projet?.nom ?? null;
                const projetUsAffiche = projetNomUsLigne ?? 'N/A';
                return (
                  <div
                    key={us.id}
                    className={`bg-white border rounded-lg shadow overflow-hidden relative ${isUsLate ? 'border-red-300' : 'border-gray-200'}`}
                  >
                    <label
                      className="absolute left-3 top-3 z-20 bg-white/90 border border-gray-300 rounded px-1.5 py-1 shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                      title="Sélectionner pour action de masse"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={selectedUsSet.has(us.id)}
                        onChange={(e) =>
                          setSelectedUsIdsBulk((prev) =>
                            e.target.checked ? [...new Set([...prev, us.id])] : prev.filter((id) => id !== us.id)
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setExpandedUsListId(usExpanded ? null : us.id)}
                      className="w-full flex flex-wrap items-center gap-2 sm:gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      aria-expanded={usExpanded}
                      aria-label={
                        usExpanded ? 'Replier le détail de la user story' : 'Afficher le détail et les actions'
                      }
                    >
                      <span className="shrink-0" title="Statut dérivé des tâches liées">
                        <StatutBadge statut={statutAggUs} />
                      </span>
                      <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">
                        {truncateUi(us.description, 160)}
                      </h2>
                      <div
                        className="flex items-center gap-1.5 shrink-0 min-w-0 max-w-[min(20rem,55vw)]"
                        title={`Projet : ${projetUsAffiche} — ${us.id}`}
                      >
                        <span className="text-xs text-gray-600 truncate font-sans font-medium">{projetUsAffiche}</span>
                        <span className="text-gray-300 shrink-0" aria-hidden>
                          ·
                        </span>
                        <span className="text-xs sm:text-sm text-gray-500 font-mono truncate min-w-0">{us.id}</span>
                      </div>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs shrink-0">
                        {tasksUs.length} tâche{tasksUs.length !== 1 ? 's' : ''}
                      </span>
                      {isUsLate && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium shrink-0">
                          ⚠ Retard
                        </span>
                      )}
                      {assignesUs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-md">
                          {assignesUs.slice(0, 4).map((a) => (
                            <span
                              key={a.id}
                              className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-full text-[11px] font-medium truncate max-w-[9rem]"
                              title={a.label}
                            >
                              {a.label}
                            </span>
                          ))}
                          {assignesUs.length > 4 && (
                            <span className="text-[11px] text-gray-500 font-medium">+{assignesUs.length - 4}</span>
                          )}
                        </div>
                      )}
                      {clientsUsEffectifs.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-md">
                          {clientsUsEffectifs.slice(0, 4).map((c) => (
                            <span
                              key={c.id}
                              className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-[11px] font-medium truncate max-w-[9rem] border border-amber-200"
                              title={`${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'}) — hérité des tâches liées ou assigné sur l’US`}
                            >
                              🤝 {c.nom}
                            </span>
                          ))}
                          {clientsUsEffectifs.length > 4 && (
                            <span className="text-[11px] text-gray-500 font-medium">
                              +{clientsUsEffectifs.length - 4}
                            </span>
                          )}
                        </div>
                      )}
                      {usExpanded && (
                        <span className="text-gray-400 shrink-0 ml-auto sm:ml-0" aria-hidden>
                          ▼
                        </span>
                      )}
                    </button>
                    {usExpanded && (
                      <>
                        <div className="border-t border-gray-100 bg-gray-50/80">
                          <div className="px-4 pt-3 pb-2 flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                            <div className="min-w-0 flex-1 space-y-2 text-xs text-gray-600">
                              <div className="flex flex-wrap gap-3">
                                {us.epic?.projet && <span>📁 {us.epic.projet.nom}</span>}
                                {!us.epic && <span className="italic text-gray-400">Sans epic</span>}
                                {usDebut && <span>🗓 {new Date(usDebut).toLocaleDateString('fr-FR')}</span>}
                                {usFin && <span>⏰ {new Date(usFin).toLocaleDateString('fr-FR')}</span>}
                                {createurTache && (
                                  <span>
                                    👤 {createurTache.prenom} {createurTache.nom}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-gray-500 break-all">
                                <span className="text-gray-400 font-sans">User story · </span>
                                {us.id}
                              </div>
                              {entitesUsTaches.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {entitesUsTaches.map((e) => (
                                    <span
                                      key={e.id}
                                      className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs"
                                    >
                                      🏢 {e.nom}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {clientsUsEffectifs.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {clientsUsEffectifs.map((c) => (
                                    <span
                                      key={c.id}
                                      className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-xs border border-amber-200"
                                    >
                                      🤝 {c.nom}
                                      <span className="text-amber-800/90 ml-1">
                                        ({c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {us.epic && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  <button
                                    type="button"
                                    onClick={() => setDetailEpicId(us.epic!.id)}
                                    className="text-xs px-2 py-1 bg-indigo-50 text-indigo-800 rounded border border-indigo-200 hover:bg-indigo-100 text-left"
                                  >
                                    📗 Epic : {us.epic.nom}
                                  </button>
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                              {canEditUsEpic ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium text-center lg:text-left">
                                  ✏️ Modification
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium text-center lg:text-left">
                                  👁 Lecture seule
                                </span>
                              )}
                              {canEditUsEpic && (
                                <button
                                  type="button"
                                  onClick={() => setEditUserStoryId(us.id)}
                                  className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-center"
                                >
                                  ✏️ Modifier
                                </button>
                              )}
                              {canEditUsEpic && (
                                <button
                                  type="button"
                                  onClick={() => void handleSoftDeleteUserStory(us.id)}
                                  className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 text-center"
                                >
                                  🗑 Mettre en corbeille
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setAgileAccesModal({ kind: 'us', us })}
                                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-center"
                              >
                                🔐 Accès
                              </button>
                              <button
                                type="button"
                                onClick={() =>
                                  void openAgileJournal(
                                    `/user-stories/${us.id}/history`,
                                    truncateUi(us.description, 100)
                                  )
                                }
                                className="px-3 py-1.5 text-xs bg-amber-50 text-amber-900 rounded hover:bg-amber-100 text-center border border-amber-200"
                              >
                                📜 Historique
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-3 text-sm">
                        {canEditUsEpic && (
                          <UserStoryLienEpicEtTachesBlock
                            us={us}
                            epics={epics}
                            taches={taches}
                            onUpdated={loadAll}
                            onAddTache={
                              canCreate
                                ? () => {
                                    const pid =
                                      us.epic?.projetId ||
                                      (us.taches || []).find((t) => t.projetId)?.projetId ||
                                      taches.find((t) => t.userStory?.id === us.id)?.projetId ||
                                      '';
                                    if (!pid) {
                                      alert(
                                        'Projet indéterminé : rattachez un epic du bon projet ou une tâche du projet avant de créer une tâche.'
                                      );
                                      return;
                                    }
                                    openNewTacheModal({ lockProjetId: pid, lockUserStoryId: us.id });
                                  }
                                : undefined
                            }
                          />
                        )}
                        <AgileDocumentsUserStorySection
                          userStoryId={us.id}
                          documentsNatifs={us.documentsNatifs || []}
                          canEdit={!!canEditUsEpic}
                          onDocumentsChange={loadAll}
                          users={users}
                        />
                        <div>
                          <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</h4>
                          <p className="text-gray-800 whitespace-pre-wrap">{us.description}</p>
                        </div>
                        {(us.taches?.length ?? 0) > 0 && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Tâches liées</h4>
                            <ul className="list-disc pl-5 text-gray-700">
                              {(us.taches || []).map((t) => (
                                <li key={t.id}>
                                  {t.nom} <span className="text-gray-400">({t.statut})</span>
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}
                        <div className="scroll-mt-4 border-t border-gray-200 pt-4 space-y-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase">Personnes habilitées (aperçu)</h4>
                          <p className="text-xs text-gray-500">
                            Tâches liées, projet / entités, et accès délégués sur la user story (bouton « Accès »). Historique
                            : « Historique ».
                          </p>
                          <AccesPersonnesBlock personnes={getPersonnesHabiliteesUserStory(us.id, taches, users, agileAccesSnapshot)} />
                        </div>
                        <div className="border-t border-gray-200 pt-4">
                          <CommentairesSection target={{ kind: 'userStory', id: us.id }} users={users} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetailUserStoryId(us.id)}
                          className="text-sm text-blue-600 hover:underline font-medium"
                        >
                          Ouvrir la fiche complète…
                        </button>
                      </div>
                      </>
                    )}
                  </div>
                );
              })}
              <ListSectionPagination
                page={usPage}
                pageSize={pageSize}
                totalItems={visibleUserStories.length}
                onPageChange={setUsPage}
              />
            </div>
          </>
        )}
      </section>
      )}

      {/* Section Epics */}
      {showEpicsSection && (
      <section aria-labelledby="sec-epics">
        <h2 id="sec-epics" className="text-xl font-semibold text-gray-900 border-b border-gray-200 pb-2 mb-4">
          Epics
        </h2>
        <div className="flex flex-wrap gap-2 items-center mb-4">
          <button
            type="button"
            onClick={() => setEpicViewMode('list')}
            className={`px-3 py-2 rounded border text-sm font-medium ${epicViewMode === 'list' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Liste
          </button>
          <button
            type="button"
            onClick={() => setEpicViewMode('kanban')}
            className={`px-3 py-2 rounded border text-sm font-medium ${epicViewMode === 'kanban' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Kanban
          </button>
          <button
            type="button"
            onClick={() => setEpicViewMode('gantt')}
            className={`px-3 py-2 rounded border text-sm font-medium ${epicViewMode === 'gantt' ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            Gantt
          </button>
          <button
            type="button"
            onClick={() => setShowEpicDashboard(!showEpicDashboard)}
            className={`px-3 py-2 rounded border text-sm font-medium ${showEpicDashboard ? 'bg-indigo-600 text-white border-indigo-600' : 'border-gray-300 text-gray-700 hover:bg-gray-50'}`}
          >
            {showEpicDashboard ? 'Masquer le tableau de bord' : 'Tableau de bord'}
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowEpicCreateModal(true)}
              className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
            >
              + Nouvel Epic
            </button>
          )}
        </div>
        {showEpicDashboard && (
          <EpicsAgileDashboard epics={visibleEpics} taches={taches} userStories={userStories} />
        )}
        {epicsEnRetardList.length > 0 && (
          <div className="bg-white p-4 rounded-lg shadow mb-4 border-l-4 border-amber-500">
            <h3 className="text-md font-semibold text-gray-800 mb-1">Epics en retard</h3>
            <p className="text-xs text-gray-500 mb-3">
              Epics contenant au moins une tâche (via une user story) en retard, bloquée ou après l&apos;échéance (hors terminé /
              archivé).
            </p>
            <ul className="divide-y divide-gray-100 text-sm">
              {pagedEpicsEnRetard.map((ep) => (
                <li key={ep.id} className="py-2 flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <button
                      type="button"
                      className="text-left text-blue-700 hover:underline font-medium"
                      onClick={() => setDetailEpicId(ep.id)}
                    >
                      {ep.nom}
                    </button>
                    <p className="text-[10px] font-mono text-gray-400 mt-1 break-all" title="ID epic">
                      {ep.id}
                    </p>
                  </div>
                  <span className="text-gray-500 text-xs shrink-0">{ep.projet?.nom ?? '—'}</span>
                </li>
              ))}
            </ul>
            <ListSectionPagination
              page={epicRetardPage}
              pageSize={pageSize}
              totalItems={epicsEnRetardList.length}
              onPageChange={setEpicRetardPage}
            />
          </div>
        )}
        {epicViewMode === 'gantt' ? (
          <div className="space-y-2">
            <p className="text-sm text-gray-500">
              {visibleEpics.length} epic(s) — plage temporelle agrégée sur toutes les tâches des user stories de l&apos;epic.
            </p>
            <TachesGanttView
              taches={epicAgileGanttItems}
              rowLabelTitle="Epic / projet"
              getPriorityMeta={getPriorityMetaForGantt}
              onBarClick={(row) => setDetailEpicId(row.id)}
            />
          </div>
        ) : epicViewMode === 'kanban' ? (
          <TachesKanbanView
            taches={epicAgileKanbanItems}
            columns={STATUT_OPTIONS}
            readOnly
            getPriorityMeta={getPriorityMetaForKanban}
            getCanEdit={() => false}
            onMoveTache={noopKanbanMove}
            onCardClick={(row) => setDetailEpicId(row.id)}
          />
        ) : (
          <>
            <div className="bg-white border border-gray-200 rounded-lg p-3 flex flex-wrap gap-2 items-center mb-2">
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  className="rounded border-gray-300"
                  checked={pagedEpics.length > 0 && pagedEpics.every((ep) => selectedEpicsSet.has(ep.id))}
                  onChange={(e) => {
                    if (e.target.checked) {
                      setSelectedEpicIdsBulk((prev) => [...new Set([...prev, ...pagedEpics.map((ep) => ep.id)])]);
                    } else {
                      const pageSet = new Set(pagedEpics.map((ep) => ep.id));
                      setSelectedEpicIdsBulk((prev) => prev.filter((id) => !pageSet.has(id)));
                    }
                  }}
                />
                Sélectionner la page ({pagedEpics.length})
              </label>
              <span className="text-xs text-gray-500">{selectedEpicIdsBulk.length} sélectionné(s)</span>
              <select
                value={bulkStatutEpics}
                onChange={(e) => setBulkStatutEpics(e.target.value)}
                className="text-sm border border-gray-300 rounded px-2 py-1 bg-white"
              >
                {STATUT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={selectedEpicIdsBulk.length === 0 || !canEditUsEpic}
                onClick={async () => {
                  const selectedEpicRows = epics.filter((ep) => selectedEpicsSet.has(ep.id));
                  const taskIds = [
                    ...new Set(
                      selectedEpicRows
                        .flatMap((ep) => getTachesLieesEpic(ep, taches))
                        .filter((t) => canEdit(t))
                        .map((t) => t.id)
                    ),
                  ];
                  if (taskIds.length === 0) {
                    alert('Aucune tâche modifiable trouvée sous les epics sélectionnés.');
                    return;
                  }
                  await bulkUpdateTachesStatut(taskIds, bulkStatutEpics);
                  setSelectedEpicIdsBulk([]);
                }}
                className="px-3 py-1.5 rounded bg-indigo-600 text-white text-sm disabled:opacity-50"
              >
                Changer statut (masse)
              </button>
              <button
                type="button"
                disabled={selectedEpicIdsBulk.length === 0 || !canEditUsEpic}
                onClick={async () => {
                  if (!window.confirm(`Mettre ${selectedEpicIdsBulk.length} epic(s) en corbeille ?`)) return;
                  await bulkSoftDeleteByPath('/epics', selectedEpicIdsBulk, 'epics');
                  setSelectedEpicIdsBulk([]);
                }}
                className="px-3 py-1.5 rounded bg-red-600 text-white text-sm disabled:opacity-50"
              >
                Corbeille (masse)
              </button>
            </div>
            <p className="text-sm text-gray-500 mb-2">{visibleEpics.length} epic(s)</p>
            <div className="space-y-4">
              {visibleEpics.length === 0 && (
                <div className="bg-white rounded-lg shadow p-8 text-center text-gray-400">Aucun epic à afficher</div>
              )}
              {pagedEpics.map((ep) => {
                const epExpanded = expandedEpicListId === ep.id;
                const tasksEp = getTachesLieesEpic(ep, taches);
                const assignesEp = getAssignesDepuisTaches(tasksEp);
                const nowEp = new Date();
                const statutAggEp = deriveAggregatedStatutFromTasks(
                  tasksEp.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
                  nowEp
                );
                const { dateDebut: epDebut, dateFinApprox: epFin } = dateRangeFromTasks(tasksEp);
                const isEpLate = epicIdsEnRetard.has(ep.id);
                const entitesEpicDirect = (ep.assignesEntites || []).map((ae) => ({
                  id: ae.entite.id,
                  nom: ae.entite.nom,
                }));
                const entitesEpTaches = getEntitesDepuisTaches(tasksEp);
                const seenEnt = new Set<string>();
                const entitesEpMerged: { id: string; nom: string }[] = [];
                for (const e of [...entitesEpicDirect, ...entitesEpTaches]) {
                  if (seenEnt.has(e.id)) continue;
                  seenEnt.add(e.id);
                  entitesEpMerged.push(e);
                }
                const cfEpMerged = epicClientsEffectifs(ep, tasksEp);
                return (
                  <div
                    key={ep.id}
                    className={`bg-white border rounded-lg shadow overflow-hidden relative ${isEpLate ? 'border-red-300' : 'border-gray-200'}`}
                  >
                    <label
                      className="absolute left-3 top-3 z-20 bg-white/90 border border-gray-300 rounded px-1.5 py-1 shadow-sm"
                      onClick={(e) => e.stopPropagation()}
                      title="Sélectionner pour action de masse"
                    >
                      <input
                        type="checkbox"
                        className="rounded border-gray-300"
                        checked={selectedEpicsSet.has(ep.id)}
                        onChange={(e) =>
                          setSelectedEpicIdsBulk((prev) =>
                            e.target.checked ? [...new Set([...prev, ep.id])] : prev.filter((id) => id !== ep.id)
                          )
                        }
                      />
                    </label>
                    <button
                      type="button"
                      onClick={() => setExpandedEpicListId(epExpanded ? null : ep.id)}
                      className="w-full flex flex-wrap items-center gap-2 sm:gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                      aria-expanded={epExpanded}
                      aria-label={epExpanded ? 'Replier le détail de l’epic' : 'Afficher le détail et les actions'}
                    >
                      <span className="shrink-0" title="Statut dérivé des tâches des user stories de l’epic">
                        <StatutBadge statut={statutAggEp} />
                      </span>
                      <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate text-left">
                        {ep.nom}
                      </h2>
                      <div
                        className="flex items-center gap-1.5 shrink-0 min-w-0 max-w-[min(20rem,55vw)]"
                        title={`Projet : ${ep.projet?.nom ?? 'N/A'} — ${ep.id}`}
                      >
                        <span className="text-xs text-gray-600 truncate font-sans font-medium">
                          {ep.projet?.nom ?? 'N/A'}
                        </span>
                        <span className="text-gray-300 shrink-0" aria-hidden>
                          ·
                        </span>
                        <span className="text-xs sm:text-sm text-gray-500 font-mono truncate min-w-0">{ep.id}</span>
                      </div>
                      <span className="px-2 py-0.5 bg-gray-100 text-gray-600 rounded text-xs shrink-0">
                        {(ep.userStories?.length ?? 0)} US · {tasksEp.length} tâche{tasksEp.length !== 1 ? 's' : ''}
                      </span>
                      {isEpLate && (
                        <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs font-medium shrink-0">
                          ⚠ Retard
                        </span>
                      )}
                      {assignesEp.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-md">
                          {assignesEp.slice(0, 4).map((a) => (
                            <span
                              key={a.id}
                              className="px-2 py-0.5 bg-blue-50 text-blue-800 rounded-full text-[11px] font-medium truncate max-w-[9rem]"
                              title={a.label}
                            >
                              {a.label}
                            </span>
                          ))}
                          {assignesEp.length > 4 && (
                            <span className="text-[11px] text-gray-500 font-medium">+{assignesEp.length - 4}</span>
                          )}
                        </div>
                      )}
                      {cfEpMerged.length > 0 && (
                        <div className="flex flex-wrap items-center gap-1 min-w-0 basis-full sm:basis-auto sm:max-w-md">
                          {cfEpMerged.slice(0, 4).map((c) => (
                            <span
                              key={c.id}
                              className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-[11px] font-medium truncate max-w-[9rem] border border-amber-200"
                              title={`${c.nom} (${c.type === 'fournisseur' ? 'Fournisseur' : 'Client'}) — epic et/ou tâches liées`}
                            >
                              🤝 {c.nom}
                            </span>
                          ))}
                          {cfEpMerged.length > 4 && (
                            <span className="text-[11px] text-gray-500 font-medium">+{cfEpMerged.length - 4}</span>
                          )}
                        </div>
                      )}
                      {epExpanded && (
                        <span className="text-gray-400 shrink-0 ml-auto sm:ml-0" aria-hidden>
                          ▼
                        </span>
                      )}
                    </button>
                    {epExpanded && (
                      <>
                        <div className="border-t border-gray-100 bg-gray-50/80">
                          <div className="px-4 pt-3 pb-2 flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
                            <div className="min-w-0 flex-1 space-y-2 text-xs text-gray-600">
                              <div className="flex flex-wrap gap-3">
                                {ep.projet && <span>📁 {ep.projet.nom}</span>}
                                {epDebut && <span>🗓 {new Date(epDebut).toLocaleDateString('fr-FR')}</span>}
                                {epFin && <span>⏰ {new Date(epFin).toLocaleDateString('fr-FR')}</span>}
                                {ep.createdBy && (
                                  <span>
                                    👤 {ep.createdBy.prenom} {ep.createdBy.nom}
                                  </span>
                                )}
                              </div>
                              <div className="text-[11px] font-mono text-gray-500 break-all">
                                <span className="text-gray-400 font-sans">Epic · </span>
                                {ep.id}
                              </div>
                              {entitesEpMerged.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {entitesEpMerged.map((e) => (
                                    <span
                                      key={e.id}
                                      className="px-2 py-0.5 bg-purple-50 text-purple-700 rounded-full text-xs"
                                    >
                                      🏢 {e.nom}
                                    </span>
                                  ))}
                                </div>
                              )}
                              {cfEpMerged.length > 0 && (
                                <div className="flex gap-1 flex-wrap">
                                  {cfEpMerged.map((c) => (
                                    <span
                                      key={c.id}
                                      className="px-2 py-0.5 bg-amber-50 text-amber-900 rounded-full text-xs border border-amber-200"
                                    >
                                      🤝 {c.nom}
                                      <span className="text-amber-800/90 ml-1">
                                        ({c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})
                                      </span>
                                    </span>
                                  ))}
                                </div>
                              )}
                              {(ep.userStories?.length ?? 0) > 0 && (
                                <div className="flex flex-wrap gap-2 pt-1">
                                  {(ep.userStories || []).map((u) => (
                                    <button
                                      key={u.id}
                                      type="button"
                                      onClick={() => setDetailUserStoryId(u.id)}
                                      className="text-xs px-2 py-1 bg-violet-50 text-violet-800 rounded border border-violet-200 hover:bg-violet-100 text-left max-w-full sm:max-w-xs"
                                      title={u.description}
                                    >
                                      <span className="line-clamp-2">📘 {truncateUi(u.description, 80)}</span>
                                      <span className="block text-[10px] font-mono text-violet-600/90 mt-0.5 break-all">
                                        {u.id}
                                      </span>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                              {canEditUsEpic ? (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-green-100 text-green-700 font-medium text-center lg:text-left">
                                  ✏️ Modification
                                </span>
                              ) : (
                                <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-500 font-medium text-center lg:text-left">
                                  👁 Lecture seule
                                </span>
                              )}
                              {canEditUsEpic && (
                                <button
                                  type="button"
                                  onClick={() => setEditEpicId(ep.id)}
                                  className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 text-center"
                                >
                                  ✏️ Modifier
                                </button>
                              )}
                              {canEditUsEpic && (
                                <button
                                  type="button"
                                  onClick={() => void handleSoftDeleteEpic(ep.id)}
                                  className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 text-center"
                                >
                                  🗑 Mettre en corbeille
                                </button>
                              )}
                              <button
                                type="button"
                                onClick={() => setAgileAccesModal({ kind: 'epic', epic: ep })}
                                className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200 text-center"
                              >
                                🔐 Accès
                              </button>
                              <button
                                type="button"
                                onClick={() => void openAgileJournal(`/epics/${ep.id}/history`, ep.nom)}
                                className="px-3 py-1.5 text-xs bg-amber-50 text-amber-900 rounded hover:bg-amber-100 text-center border border-amber-200"
                              >
                                📜 Historique
                              </button>
                            </div>
                          </div>
                        </div>
                        <div className="border-t border-gray-100 p-4 bg-gray-50 space-y-3 text-sm">
                        {canEditUsEpic && (
                          <EpicLienUserStoriesBlock
                            ep={ep}
                            userStories={userStories}
                            taches={taches}
                            onUpdated={loadAll}
                          />
                        )}
                        {ep.description && (
                          <div>
                            <h4 className="text-xs font-semibold text-gray-500 uppercase mb-1">Description</h4>
                            <p className="text-gray-800 whitespace-pre-wrap">{ep.description}</p>
                          </div>
                        )}
                        <div>
                            <div className="flex flex-wrap items-center justify-between gap-2 mb-1">
                              <h4 className="text-xs font-semibold text-gray-500 uppercase">
                                Hiérarchie user stories et tâches
                              </h4>
                              {canEditUsEpic && (
                                <button
                                  type="button"
                                  onClick={() => openNewUserStoryModal({ lockEpicId: ep.id })}
                                  className="text-xs px-2.5 py-1 rounded border border-violet-200 bg-violet-50 text-violet-800 hover:bg-violet-100"
                                  title="Ajouter une user story liée automatiquement à cet epic"
                                >
                                  + Ajouter User Storie
                                </button>
                              )}
                            </div>
                            {(ep.userStories?.length ?? 0) === 0 ? (
                              <p className="text-xs text-gray-400 italic">Aucune user story liée à cet epic.</p>
                            ) : (
                            <ul className="space-y-3 text-gray-700">
                              {(ep.userStories || []).map((u) => {
                                const tasksUs = [...getTachesLieesUserStory(u.id, taches)].sort((a, b) => {
                                  const as = computeTaskPriorityScore(a)?.score ?? Number.NEGATIVE_INFINITY;
                                  const bs = computeTaskPriorityScore(b)?.score ?? Number.NEGATIVE_INFINITY;
                                  if (as !== bs) return bs - as;
                                  return (a.nom || '').localeCompare(b.nom || '', 'fr');
                                });
                                const statutUs = deriveAggregatedStatutFromTasks(
                                  tasksUs.map((t) => ({ statut: t.statut, dateFinApprox: t.dateFinApprox })),
                                  new Date()
                                );
                                return (
                                  <li key={u.id} className="text-sm rounded-md border border-gray-200 bg-white p-2.5">
                                    <div className="flex flex-wrap items-center gap-2">
                                      <span className="shrink-0">
                                        <StatutBadge statut={statutUs} />
                                      </span>
                                      <button
                                        type="button"
                                        onClick={() => {
                                          if (canEditUsEpic) setEditUserStoryId(u.id);
                                          else setDetailUserStoryId(u.id);
                                        }}
                                        className="font-medium text-gray-900 text-left hover:text-violet-700 hover:underline underline-offset-2"
                                        title={
                                          canEditUsEpic
                                            ? 'Ouvrir la user story pour modification'
                                            : 'Ouvrir le détail de la user story'
                                        }
                                      >
                                        📘 {truncateUi(u.description, 140)}
                                      </button>
                                      {canEditUsEpic && (
                                        <button
                                          type="button"
                                          onClick={() =>
                                            openNewTacheModal({ lockProjetId: ep.projetId, lockUserStoryId: u.id })
                                          }
                                          className="ml-auto text-xs px-2 py-1 rounded border border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100"
                                          title="Ajouter une tâche liée automatiquement à cette user story"
                                        >
                                          + Ajouter tâche
                                        </button>
                                      )}
                                    </div>
                                    <div className="text-[10px] font-mono text-gray-400 mt-0.5 break-all">{u.id}</div>
                                    <div className="mt-2 pl-3 border-l-2 border-indigo-100">
                                      {tasksUs.length === 0 ? (
                                        <p className="text-xs text-gray-400 italic">Aucune tâche liée à cette user story.</p>
                                      ) : (
                                        <ul className="space-y-1.5">
                                          {tasksUs.map((t) => (
                                            <li key={t.id} className="text-xs rounded border border-gray-200 bg-gray-50 px-2 py-1.5">
                                              {(() => {
                                                const nowTask = new Date();
                                                const isLate = isTacheEnRetardKpi(t, nowTask);
                                                const prioritySc = computeTaskPriorityScore(t);
                                                const dureePrevisionnelle = computePlannedDurationDays(
                                                  t.dateDebut,
                                                  t.dateFinApprox
                                                );
                                                const joursRetard =
                                                  t.dateFinApprox && new Date(t.dateFinApprox) < nowTask
                                                    ? Math.max(
                                                        0,
                                                        Math.floor(
                                                          (nowTask.getTime() - new Date(t.dateFinApprox).getTime()) /
                                                            (1000 * 3600 * 24)
                                                        )
                                                      )
                                                    : 0;
                                                const dateTerminee = (t as any).dateFinReelle as string | undefined;
                                                const isDone = t.statut === 'termine' || t.statut === 'archive';
                                                return (
                                                  <>
                                              <div className="flex flex-wrap items-center gap-2">
                                                <StatutBadge statut={t.statut} />
                                                <span
                                                  className={`px-2 py-0.5 rounded text-[11px] font-medium border ${priorityTagClasses(t.priorite)}`}
                                                  title="Priorité de la tâche"
                                                >
                                                  {priorityLabel(t.priorite)}
                                                </span>
                                                {prioritySc && (
                                                  <span className="px-2 py-0.5 rounded text-[11px] font-semibold border bg-indigo-50 text-indigo-800 border-indigo-200">
                                                    🧠 Score {prioritySc.score}
                                                  </span>
                                                )}
                                                {isLate && (
                                                  <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-[11px] font-medium">
                                                    ⚠ Retard{joursRetard > 0 ? ` (${joursRetard} j)` : ''}
                                                  </span>
                                                )}
                                                <button
                                                  type="button"
                                                  onClick={() => openEditTacheModal(t)}
                                                  disabled={!canEdit(t)}
                                                  className={`text-left underline-offset-2 ${
                                                    canEdit(t)
                                                      ? 'text-blue-700 hover:text-blue-900 hover:underline'
                                                      : 'text-gray-500 cursor-not-allowed'
                                                  }`}
                                                  title={
                                                    canEdit(t)
                                                      ? 'Ouvrir la tâche pour modification'
                                                      : 'Vous n’avez pas le droit de modifier cette tâche'
                                                  }
                                                >
                                                  🧩 {truncateUi(t.nom, 120)}
                                                </button>
                                                <span className="font-mono text-[10px] text-gray-400 break-all">{t.id}</span>
                                              </div>
                                              {isDone && dateTerminee && (
                                                <div className="mt-1 text-[11px] text-emerald-700">
                                                  ✅ Terminée le {new Date(dateTerminee).toLocaleDateString('fr-FR')}
                                                </div>
                                              )}
                                              <div className="mt-1 text-[11px] text-gray-600 flex flex-wrap items-center gap-2">
                                                {t.dateDebut && t.dateFinApprox ? (
                                                  <>
                                                    <span>🗓 {new Date(t.dateDebut).toLocaleDateString('fr-FR')}</span>
                                                    <span className="text-gray-300">→</span>
                                                    <span>⏰ {new Date(t.dateFinApprox).toLocaleDateString('fr-FR')}</span>
                                                    {dureePrevisionnelle != null && (
                                                      <span>
                                                        ⏳ {dureePrevisionnelle} jour{dureePrevisionnelle > 1 ? 's' : ''} nécessaires
                                                      </span>
                                                    )}
                                                  </>
                                                ) : (
                                                  <span className="italic text-gray-400">📆 Non administré</span>
                                                )}
                                              </div>
                                              {(t.assignesEntites || []).length > 0 && (
                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                  {(t.assignesEntites || []).map((e) => (
                                                    <span
                                                      key={`${t.id}-${e.id}`}
                                                      className="px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 text-[11px]"
                                                    >
                                                      🏢 {e.nom}
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                              {(t.assignesClientsFournisseurs || []).length > 0 && (
                                                <div className="mt-1.5 flex flex-wrap gap-1">
                                                  {(t.assignesClientsFournisseurs || []).map((c) => (
                                                    <span
                                                      key={`${t.id}-cf-${c.id}`}
                                                      className="px-1.5 py-0.5 rounded bg-amber-50 text-amber-900 text-[11px] border border-amber-200"
                                                    >
                                                      🤝 {c.nom}
                                                      <span className="text-amber-800/90 ml-1">
                                                        ({c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})
                                                      </span>
                                                    </span>
                                                  ))}
                                                </div>
                                              )}
                                                  </>
                                                );
                                              })()}
                                            </li>
                                          ))}
                                        </ul>
                                      )}
                                    </div>
                                  </li>
                                );
                              })}
                            </ul>
                            )}
                          </div>
                        <DocumentsEpic
                          epicId={ep.id}
                          documents={(ep.documents || []).map((ed) => ed.document)}
                          linkedTaskDocs={tasksEp.flatMap((task) =>
                            (task.documents || []).map((doc) => ({
                              taskId: task.id,
                              taskNom: task.nom,
                              doc,
                            }))
                          )}
                          canEdit={!!canEditUsEpic}
                          onDocumentsChange={loadAll}
                          users={users}
                        />
                        <div className="scroll-mt-4 border-t border-gray-200 pt-4 space-y-2">
                          <h4 className="text-xs font-semibold text-gray-500 uppercase">Personnes habilitées (aperçu)</h4>
                          {ep.createdBy && (
                            <p className="text-xs text-gray-600">
                              Créé par {ep.createdBy.prenom} {ep.createdBy.nom}
                            </p>
                          )}
                          <p className="text-xs text-gray-500">
                            Tâches liées, projet / entités, et accès délégués sur l&apos;epic (bouton « Accès »). Historique :
                            « Historique ».
                          </p>
                          <AccesPersonnesBlock personnes={getPersonnesHabiliteesEpic(ep, taches, users, agileAccesSnapshot)} />
                        </div>
                        <div className="border-t border-gray-200 pt-4">
                          <CommentairesSection target={{ kind: 'epic', id: ep.id }} users={users} />
                        </div>
                        <button
                          type="button"
                          onClick={() => setDetailEpicId(ep.id)}
                          className="text-sm text-blue-600 hover:underline font-medium"
                        >
                          Ouvrir la fiche complète…
                        </button>
                      </div>
                      </>
                    )}
                  </div>
                );
              })}
              <ListSectionPagination
                page={epicPage}
                pageSize={pageSize}
                totalItems={visibleEpics.length}
                onPageChange={setEpicPage}
              />
            </div>
          </>
        )}
      </section>
      )}

      {showAgileCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[88vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b sticky top-0 bg-white z-10">
              <h2 className="text-lg font-semibold">🗑 Corbeille agile</h2>
              <button
                type="button"
                onClick={() => setShowAgileCorbeilleModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-6 text-sm">
              <section>
                <h3 className="font-semibold text-gray-800 mb-2">Tâches</h3>
                {corbTaches.length === 0 && <p className="text-gray-500">Aucune tâche en corbeille.</p>}
                {corbTaches.map((ct) => (
                  <div
                    key={ct.id}
                    className="flex justify-between items-center gap-2 p-3 border border-gray-200 rounded-lg mb-2 bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{ct.nom}</p>
                      <p className="text-xs text-gray-500">
                        {ct.projet?.nom ?? '—'} ·{' '}
                        {ct.deletedAt ? new Date(ct.deletedAt).toLocaleString('fr-FR') : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreTacheCorbeille(ct.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="font-semibold text-gray-800 mb-2">Epics</h3>
                {corbEpics.length === 0 && <p className="text-gray-500">Aucun epic en corbeille.</p>}
                {corbEpics.map((ce) => (
                  <div
                    key={ce.id}
                    className="flex justify-between items-center gap-2 p-3 border border-gray-200 rounded-lg mb-2 bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 truncate">{ce.nom}</p>
                      <p className="text-xs text-gray-500">
                        {ce.projet?.nom ?? '—'} ·{' '}
                        {ce.deletedAt ? new Date(ce.deletedAt).toLocaleString('fr-FR') : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreEpicCorbeille(ce.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  </div>
                ))}
              </section>
              <section>
                <h3 className="font-semibold text-gray-800 mb-2">User stories</h3>
                {corbUserStories.length === 0 && <p className="text-gray-500">Aucune user story en corbeille.</p>}
                {corbUserStories.map((cu) => (
                  <div
                    key={cu.id}
                    className="flex justify-between items-center gap-2 p-3 border border-gray-200 rounded-lg mb-2 bg-gray-50"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-gray-900 line-clamp-2">{truncateUi(cu.description, 120)}</p>
                      <p className="text-xs text-gray-500">
                        {cu.epic?.nom ?? 'Sans epic'} ·{' '}
                        {cu.deletedAt ? new Date(cu.deletedAt).toLocaleString('fr-FR') : ''}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => void restoreUserStoryCorbeille(cu.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  </div>
                ))}
              </section>
              <p className="text-xs text-gray-400">
                La suppression définitive est réservée aux administrateurs (page Corbeille globale).
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <TacheModal
          onClose={closeTacheModal}
          onSave={loadAll}
          projets={projets}
          users={users}
          entites={entites}
          clientsFournisseurs={clientsFournisseursOptions}
          taches={taches}
          editTache={editTache}
          lockProjetId={tacheModalLockProjetId}
          lockUserStoryId={tacheModalLockUserStoryId}
        />
      )}

      {showEpicCreateModal && (
        <EpicCreateModal
          onClose={() => setShowEpicCreateModal(false)}
          onSaved={loadAll}
          projets={projets}
          entites={entites}
          clientsFournisseurs={clientsFournisseursOptions}
        />
      )}

      {showUsCreateModal && (
        <UserStoryCreateModalInner
          onClose={() => {
            setShowUsCreateModal(false);
            setUsCreateLockEpicId(undefined);
          }}
          onSaved={() => loadAll({ silent: true })}
          projets={projets}
          taches={taches}
          epics={epics}
          lockEpicId={usCreateLockEpicId}
        />
      )}

      {detailEpicId && (
        <EpicDetailModal epicId={detailEpicId} onClose={() => setDetailEpicId(null)} users={users} />
      )}

      {editUserStoryId && (
        <UserStoryEditModal
          userStoryId={editUserStoryId}
          onClose={() => setEditUserStoryId(null)}
          onSaved={loadAll}
          projets={projets}
          epics={epics}
          taches={taches}
        />
      )}

      {editEpicId && (
        <EpicEditModal
          epicId={editEpicId}
          onClose={() => setEditEpicId(null)}
          onSaved={loadAll}
          projets={projets}
          entites={entites}
          clientsFournisseurs={clientsFournisseursOptions}
        />
      )}

      {detailUserStoryId && (
        <UserStoryDetailModal
          userStoryId={detailUserStoryId}
          onClose={() => setDetailUserStoryId(null)}
          onOpenEpicId={(eid) => {
            setDetailUserStoryId(null);
            setDetailEpicId(eid);
          }}
          users={users}
          canEdit={!!canEditUsEpic}
        />
      )}

      {journalModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {journalModal.title}</h3>
            {journalLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : journalRows.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {journalRows.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{new Date(h.timestamp).toLocaleString('fr-FR')}</span>
                      <span>
                        {h.user?.prenom} {h.user?.nom}
                      </span>
                    </div>
                    <p className="font-medium text-gray-800">
                      {LABEL_LOG_ACTION[h.action] || h.action}
                      {h.ressourceType && (
                        <span className="text-gray-500 font-normal">
                          {' '}
                          · {LABEL_RESSOURCE[h.ressourceType] || h.ressourceType}
                        </span>
                      )}
                    </p>
                    {h.ressourceNom && <p className="text-gray-600 text-xs mt-0.5">{h.ressourceNom}</p>}
                    {formatHistoryDetails(h).length > 0 && (
                      <ul className="mt-1 space-y-1">
                        {formatHistoryDetails(h).map((line, idx) => (
                          <li key={`${h.id}-journal-detail-${idx}`} className="text-xs text-gray-700">
                            - {line}
                          </li>
                        ))}
                      </ul>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setJournalModal(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {agileAccesModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">
              {agileAccesModal.kind === 'epic'
                ? `Accès — ${agileAccesModal.epic.nom}`
                : 'Accès — User story'}
            </h3>
            {agileAccesModal.kind === 'us' && (
              <p className="text-sm text-gray-700 mb-4 whitespace-pre-wrap">{agileAccesModal.us.description}</p>
            )}
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le créateur gère les accès : exclusion d&apos;administrateurs, délégation explicite (lecture,
              modification, suppression, gestion). Sans délégation, un admin non exclu conserve un accès complet. Un
              utilisateur assigné à une tâche liée ne peut pas être retiré des accès tant qu&apos;il reste assigné sur
              la tâche.
            </p>
            {agileAccesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : agileAccesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <ul className="space-y-2 text-gray-700">
                    {(agileAccesDetail.admins || []).map((a: any) => {
                      const row = (agileAccesDetail.delegations || []).find((d: any) => d.user?.id === a.id);
                      const excluded = (agileAccesDetail.adminSansAccesUserIds || []).includes(a.id);
                      const isCreator = agileAccesDetail.creator?.id === a.id;
                      const bloqueAssigne = agileAccesAssigneeIds.has(a.id);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium">
                            {a.prenom} {a.nom}
                          </span>
                          {excluded && !row ? (
                            <span className="text-red-700 text-xs font-medium">— aucun accès (exclu)</span>
                          ) : row ? (
                            <span className="text-amber-800 text-xs font-medium">
                              — accès explicite ({PERM_TACHE_LABEL[row.permission] || row.permission})
                            </span>
                          ) : (
                            <span className="text-gray-400">— accès complet (défaut administrateur)</span>
                          )}
                          {agileAccesDetail.canManagePermissions && !isCreator && (
                            <div className="flex flex-wrap items-center gap-2 ml-auto">
                              {excluded && !row ? (
                                <button
                                  type="button"
                                  onClick={() => void handleAgileRestoreAdmin(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir
                                </button>
                              ) : !row ? (
                                <button
                                  type="button"
                                  disabled={bloqueAssigne}
                                  title={bloqueAssigne ? MSG_ACCES_ASSIGNE_TACHE : undefined}
                                  onClick={() => void handleAgileRevokeAdmin(a.id)}
                                  className={`text-xs px-3 py-1.5 rounded-md ${
                                    bloqueAssigne
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                      : 'bg-red-100 text-red-800 hover:bg-red-200'
                                  }`}
                                >
                                  Retirer l&apos;accès
                                </button>
                              ) : (
                                <button
                                  type="button"
                                  disabled={bloqueAssigne}
                                  title={bloqueAssigne ? MSG_ACCES_ASSIGNE_TACHE : undefined}
                                  onClick={() => void handleAgileDeletePermission(row.id)}
                                  className={`text-xs px-3 py-1.5 rounded-md ${
                                    bloqueAssigne
                                      ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                                      : 'bg-red-100 text-red-800 hover:bg-red-200'
                                  }`}
                                >
                                  Révoquer l&apos;accès
                                </button>
                              )}
                            </div>
                          )}
                        </li>
                      );
                    })}
                  </ul>
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Créateur</p>
                  {agileAccesDetail.creator ? (
                    <p>
                      <span className="font-medium">
                        {agileAccesDetail.creator.prenom} {agileAccesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400"> — tous les droits</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non renseigné.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
                  {(agileAccesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
                  ) : (
                    <ul className="space-y-2">
                      {(agileAccesDetail.delegations || []).map((d: any) => {
                        const bloqueD = agileAccesAssigneeIds.has(d.user?.id);
                        return (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium shrink-0">
                            {d.user.prenom} {d.user.nom}
                          </span>
                          {agileAccesDetail.canManagePermissions ? (
                            <select
                              value={d.permission || 'lecture'}
                              onChange={(e) => void handleAgileUpdatePermission(d.id, e.target.value)}
                              className="text-xs border border-gray-300 rounded-md px-2 py-1.5 min-w-[12rem] flex-1 max-w-xs"
                            >
                              {PERM_TACHE_OPTIONS.map((o) => (
                                <option key={o.value} value={o.value}>
                                  {o.label}
                                </option>
                              ))}
                            </select>
                          ) : (
                            <span className="text-gray-500 text-sm">— {PERM_TACHE_LABEL[d.permission] || d.permission}</span>
                          )}
                          {agileAccesDetail.canManagePermissions && (
                            <button
                              type="button"
                              disabled={bloqueD}
                              title={bloqueD ? MSG_ACCES_ASSIGNE_TACHE : undefined}
                              onClick={() => void handleAgileDeletePermission(d.id)}
                              className={`text-xs ml-auto ${
                                bloqueD ? 'text-gray-400 cursor-not-allowed' : 'text-red-600 hover:underline'
                              }`}
                            >
                              Retirer
                            </button>
                          )}
                        </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {agileAccesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-3 items-end">
                      <select
                        value={agileNewUserId}
                        onChange={(e) => setAgileNewUserId(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {users
                          .filter((u) => (!(u as any).statut || (u as any).statut === 'actif') && u.id !== agileAccesDetail.creator?.id)
                          .filter((u) => !(agileAccesDetail.delegations || []).some((d: any) => d.user?.id === u.id))
                          .map((u) => (
                            <option key={u.id} value={u.id}>
                              {u.prenom} {u.nom} {u.role === 'admin' ? '(admin)' : ''}
                            </option>
                          ))}
                      </select>
                      <select
                        value={agileNewPerm}
                        onChange={(e) => setAgileNewPerm(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {PERM_TACHE_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAgileAddPermission()}
                        disabled={!agileNewUserId}
                        className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
                      >
                        Ajouter
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-sm text-gray-500">Impossible de charger le détail.</p>
            )}
            <div className="flex justify-end mt-6">
              <button
                type="button"
                onClick={() => setAgileAccesModal(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
