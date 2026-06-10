import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import TachesKanbanView from './TachesKanbanView';
import TachesGanttView from './TachesGanttView';
import {
  TacheModal,
  TachesAvancementBlock,
  TachesDashboard,
  TachesParEntitePersonneGrid,
  TachesParClientFournisseurGrid,
  computeTotalJoursRetardTachesVisibles,
  computeTaskPriorityScore,
  STATUT_OPTIONS,
  type ClientFournisseurOption,
  type EntiteOption,
  type ProjetOption,
  type Tache,
  type UserOption,
} from '../pages/Taches';
import {
  exportProjetDashboardPdf,
  exportProjetGanttPdf,
  exportProjetKanbanPdf,
  exportProjetListePdf,
  exportProjetEpicsUsPdf,
} from '../utils/projetPdfExport';
import { exportProjetTachesUsEpicsExcel, type EpicExcelRow, type UserStoryExcelRow } from '../utils/projetExcelExport';
import {
  peutModifierTacheSelonApi,
  tacheVisiblePourUtilisateurSurProjetPage,
} from '../utils/tacheAccess';

type EpicRow = { id: string; nom: string; description?: string | null };
type UserStoryRow = {
  id: string;
  description: string;
  epic?: { id: string; nom: string } | null;
};

type ProgressRow = {
  key: string;
  label: string;
  total: number;
  done: number;
  pct: number;
};

type Props = {
  projetId: string;
  projet: any;
  usersForTaches: UserOption[];
  tachesBrutes: Tache[];
  onTachesRefresh?: () => void;
  /** Masque le titre d’introduction (ex. section repliée pilotée par la fiche projet). */
  hideIntro?: boolean;
};

function StatutBarChart({ taches }: { taches: Tache[] }) {
  const rows = STATUT_OPTIONS.map((s) => ({
    ...s,
    n: taches.filter((t) => t.statut === s.value).length,
  })).filter((r) => r.n > 0);
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (rows.length === 0) {
    return <p className="text-sm text-gray-400">Aucune tâche à représenter.</p>;
  }
  return (
    <div className="space-y-2">
      {rows.map((r) => (
        <div key={r.value} className="flex items-center gap-2 text-sm">
          <span className="w-36 shrink-0 text-gray-600 truncate" title={r.label}>
            {r.label}
          </span>
          <div className="flex-1 h-6 bg-gray-100 rounded overflow-hidden min-w-[80px]">
            <div
              className={`h-full ${r.color} transition-all`}
              style={{ width: `${(r.n / max) * 100}%` }}
            />
          </div>
          <span className="w-8 text-right tabular-nums font-medium text-gray-800">{r.n}</span>
        </div>
      ))}
    </div>
  );
}

function collectEntitesFromTaches(taches: Tache[]) {
  const m = new Map<string, { nom: string; n: number }>();
  for (const t of taches) {
    for (const e of t.assignesEntites || []) {
      const prev = m.get(e.id) || { nom: e.nom, n: 0 };
      m.set(e.id, { nom: e.nom, n: prev.n + 1 });
    }
  }
  return [...m.values()].sort((a, b) => b.n - a.n);
}

function buildProgressRows(
  taches: Tache[],
  collectKeys: (t: Tache) => Array<{ key: string; label: string }>
): ProgressRow[] {
  const m = new Map<string, { label: string; total: number; done: number }>();
  for (const t of taches) {
    const refs = collectKeys(t);
    const isDone = t.statut === 'termine';
    for (const r of refs) {
      const prev = m.get(r.key) || { label: r.label, total: 0, done: 0 };
      prev.total += 1;
      if (isDone) prev.done += 1;
      m.set(r.key, prev);
    }
  }
  return [...m.entries()]
    .map(([key, v]) => ({
      key,
      label: v.label,
      total: v.total,
      done: v.done,
      pct: v.total > 0 ? Math.round((v.done / v.total) * 100) : 0,
    }))
    .sort((a, b) => {
      if (b.pct !== a.pct) return b.pct - a.pct;
      if (b.total !== a.total) return b.total - a.total;
      return a.label.localeCompare(b.label, 'fr');
    });
}

function ProgressTable({
  title,
  rows,
  emptyLabel,
}: {
  title: string;
  rows: ProgressRow[];
  emptyLabel: string;
}) {
  return (
    <div>
      <h4 className="text-sm font-semibold text-gray-700 mb-2">{title}</h4>
      <div className="overflow-x-auto border border-gray-200 rounded-lg">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
            <tr>
              <th className="px-3 py-2">Élément</th>
              <th className="px-3 py-2">Terminées</th>
              <th className="px-3 py-2">Total</th>
              <th className="px-3 py-2">%</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {rows.map((r) => (
              <tr key={r.key}>
                <td className="px-3 py-2 font-medium text-gray-900 max-w-[340px] truncate" title={r.label}>
                  {r.label}
                </td>
                <td className="px-3 py-2 tabular-nums text-gray-700">{r.done}</td>
                <td className="px-3 py-2 tabular-nums text-gray-700">{r.total}</td>
                <td className="px-3 py-2 tabular-nums font-semibold text-gray-800">{r.pct}%</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="p-4 text-gray-400 text-sm">{emptyLabel}</p>}
      </div>
    </div>
  );
}

function buildPersonnesRessources(projet: any, taches: Tache[]) {
  type Acc = { nom: string; roles: Set<string>; assignTaches: number };
  const byId = new Map<string, Acc>();

  const touch = (id: string, nom: string) => {
    if (!byId.has(id)) byId.set(id, { nom, roles: new Set(), assignTaches: 0 });
    return byId.get(id)!;
  };

  const addRel = (arr: any[] | undefined, label: string) => {
    for (const s of arr || []) {
      const u = s.user || s;
      if (u?.id) touch(u.id, `${u.prenom} ${u.nom}`.trim()).roles.add(label);
    }
  };

  if (projet?.responsable?.id) {
    const u = projet.responsable;
    touch(u.id, `${u.prenom} ${u.nom}`).roles.add('Responsable projet');
  }
  if (projet?.gestionnaire?.id) {
    const u = projet.gestionnaire;
    touch(u.id, `${u.prenom} ${u.nom}`).roles.add('Gestionnaire projet');
  }
  addRel(projet?.sponsors, 'Sponsor');
  addRel(projet?.chefsProjet, 'Chef de projet');
  addRel(projet?.techLeads, 'Tech lead');
  addRel(projet?.equipe, "Membre d'équipe");

  for (const t of taches) {
    for (const u of t.assignesUtilisateurs || []) {
      const acc = touch(u.id, `${u.prenom} ${u.nom}`.trim());
      acc.assignTaches += 1;
    }
  }

  return [...byId.entries()]
    .map(([id, v]) => ({
      key: id,
      nom: v.nom,
      role: [...v.roles].join(' ; ') || '—',
      charge:
        v.assignTaches > 0
          ? `${v.assignTaches} tâche${v.assignTaches > 1 ? 's' : ''} assignée${v.assignTaches > 1 ? 's' : ''}`
          : '—',
    }))
    .sort((a, b) => a.nom.localeCompare(b.nom, 'fr'));
}

export default function ProjetPilotageAgile({
  projetId,
  projet,
  usersForTaches,
  tachesBrutes,
  onTachesRefresh,
  hideIntro = false,
}: Props) {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const [epics, setEpics] = useState<EpicRow[]>([]);
  const [userStories, setUserStories] = useState<UserStoryRow[]>([]);
  const [loadingAgile, setLoadingAgile] = useState(true);
  const [taskView, setTaskView] = useState<'list' | 'kanban' | 'gantt'>('list');
  const [projets, setProjets] = useState<ProjetOption[]>([]);
  const [entites, setEntites] = useState<EntiteOption[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<ClientFournisseurOption[]>([]);
  const [showModal, setShowModal] = useState(false);
  const [editTache, setEditTache] = useState<Tache | undefined>();

  const loadAgile = useCallback(async () => {
    if (!projetId) return;
    setLoadingAgile(true);
    try {
      const [er, usr] = await Promise.all([
        api.get('/epics', { params: { projetId } }).catch(() => ({ data: [] })),
        api
          .get('/user-stories', { params: { projetId } })
          .catch(() => ({ data: [] })),
      ]);
      setEpics(Array.isArray(er.data) ? er.data : []);
      setUserStories(Array.isArray(usr.data) ? usr.data : []);
    } catch {
      setEpics([]);
      setUserStories([]);
    } finally {
      setLoadingAgile(false);
    }
  }, [projetId]);

  useEffect(() => {
    void loadAgile();
  }, [loadAgile]);

  const loadMeta = useCallback(async () => {
    try {
      const [pRes, eRes, cfRes] = await Promise.all([
        api.get('/projets'),
        api.get('/entites'),
        api.get('/clients-fournisseurs').catch(() => ({ data: [] })),
      ]);
      setProjets((pRes.data || []).map((p: any) => ({ id: p.id, nom: p.nom })));
      setEntites((eRes.data || []).map((e: any) => ({ id: e.id, nom: e.nom })));
      const cfRaw = Array.isArray(cfRes.data) ? cfRes.data : [];
      setClientsFournisseurs(cfRaw.map((c: any) => ({ id: c.id, nom: c.nom, type: c.type || 'client' })));
    } catch {
      setProjets([]);
      setEntites([]);
      setClientsFournisseurs([]);
    }
  }, []);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  const tachesVisibles = useMemo(
    () =>
      tachesBrutes.filter((t) =>
        tacheVisiblePourUtilisateurSurProjetPage(t, currentUser, projet),
      ),
    [tachesBrutes, currentUser, projet],
  );
  const tachesVisiblesTriees = useMemo(
    () =>
      [...tachesVisibles].sort((a, b) => {
        const as = computeTaskPriorityScore(a)?.score ?? Number.NEGATIVE_INFINITY;
        const bs = computeTaskPriorityScore(b)?.score ?? Number.NEGATIVE_INFINITY;
        if (as !== bs) return bs - as;
        const ad = a.dateFinApprox ? new Date(a.dateFinApprox).getTime() : Number.POSITIVE_INFINITY;
        const bd = b.dateFinApprox ? new Date(b.dateFinApprox).getTime() : Number.POSITIVE_INFINITY;
        if (ad !== bd) return ad - bd;
        return (a.nom || '').localeCompare(b.nom || '', 'fr');
      }),
    [tachesVisibles]
  );

  const peutEdit = peutModifierTacheSelonApi(currentUser);
  const peutCreer = !!currentUser;
  const nbMasquees = tachesBrutes.length - tachesVisibles.length;

  const projetClientFournisseurIds = useMemo(
    () =>
      (projet?.clientsFournisseurs || [])
        .map((x: any) => x.clientFournisseurId || x.clientFournisseur?.id)
        .filter(Boolean),
    [projet],
  );

  const now = new Date();
  const term = tachesVisibles.filter((t) => t.statut === 'termine').length;
  const enc = tachesVisibles.filter((t) => t.statut === 'en_cours').length;
  const bloq = tachesVisibles.filter(
    (t) =>
      t.statut === 'bloque' ||
      (t.dateFinApprox &&
        new Date(t.dateFinApprox) < now &&
        t.statut !== 'termine' &&
        t.statut !== 'archive'),
  ).length;
  const pctGlobal = tachesVisibles.length
    ? Math.round((term / tachesVisibles.length) * 100)
    : 0;

  const personnesRes = useMemo(
    () => buildPersonnesRessources(projet, tachesVisibles),
    [projet, tachesVisibles],
  );
  const entitesRes = useMemo(() => collectEntitesFromTaches(tachesVisibles), [tachesVisibles]);

  const epicProgressRows = useMemo(
    () =>
      buildProgressRows(tachesVisibles, (t) =>
        t.userStory?.epic?.id
          ? [{ key: t.userStory.epic.id, label: t.userStory.epic.nom || `Epic ${t.userStory.epic.id}` }]
          : []
      ),
    [tachesVisibles]
  );

  const userStoryProgressRows = useMemo(
    () =>
      buildProgressRows(tachesVisibles, (t) =>
        t.userStory?.id
          ? [
              {
                key: t.userStory.id,
                label: t.userStory.description
                  ? t.userStory.description.length > 90
                    ? `${t.userStory.description.slice(0, 90)}…`
                    : t.userStory.description
                  : `User story ${t.userStory.id}`,
              },
            ]
          : []
      ),
    [tachesVisibles]
  );

  const totalJoursRetardProjet = useMemo(
    () => computeTotalJoursRetardTachesVisibles(tachesVisibles),
    [tachesVisibles],
  );

  const handleKanbanMove = async (tacheId: string, newStatut: string) => {
    try {
      await api.put(`/taches/${tacheId}`, { statut: newStatut });
      onTachesRefresh?.();
    } catch (err: any) {
      alert(err.response?.data?.error || 'Impossible de mettre à jour le statut');
      throw err;
    }
  };

  const canEditTache = (t: Tache) => {
    if (currentUser?.role === 'admin' || currentUser?.role === 'contributeur') return true;
    if (currentUser?.role === 'lecteur') {
      if (t.createurId === currentUser.id) return true;
      const a = t.assignesUtilisateurs?.find((u) => u.id === currentUser.id);
      const p = a?.permission || 'lecture';
      return p === 'modification' || p === 'suppression' || p === 'gestion';
    }
    return false;
  };

  const projetNom = projet?.nom || 'Projet';

  return (
    <div className={`space-y-8 ${hideIntro ? '' : 'mb-8'}`}>
      {!hideIntro && (
        <div className="border-b border-gray-200 pb-2">
          <h2 className="text-xl font-semibold text-gray-900">Pilotage agile & données</h2>
          <p className="text-sm text-gray-500 mt-1">
            Tableau de bord, tâches (liste / Kanban / Gantt), epics, user stories et ressources pour ce projet.
          </p>
        </div>
      )}

      {/* 1 Dashboard */}
      <section className="bg-white rounded-lg shadow border border-gray-100 p-6" aria-labelledby="dash-projet-title">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <h3 id="dash-projet-title" className="text-lg font-semibold text-gray-800 flex items-center gap-2">
            <span className="text-xl" aria-hidden>
              📊
            </span>
            Tableau de bord projet
          </h3>
          <button
            type="button"
            onClick={() =>
              exportProjetTachesUsEpicsExcel(
                projetNom,
                tachesBrutes,
                epics as EpicExcelRow[],
                userStories as UserStoryExcelRow[],
              )
            }
            className="px-3 py-2 text-sm font-medium rounded-lg border border-emerald-200 bg-emerald-50 text-emerald-900 hover:bg-emerald-100 shrink-0"
            title="Liste des tâches, user stories et epics : génère un fichier Excel (.xlsx) sur une seule feuille (blocs Tâches, User stories, Epics)."
            aria-label="Exporter la liste des tâches, user stories et epics au format Excel"
          >
            📥 Liste tâches, user stories & epics (Excel)
          </button>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg bg-gradient-to-br from-indigo-50 to-white border border-indigo-100 p-4 text-center">
            <div className="text-3xl font-bold text-indigo-700 tabular-nums">{pctGlobal}%</div>
            <div className="text-xs text-gray-600 mt-1">Avancement global</div>
            <div className="text-[10px] text-gray-400 mt-0.5">Tâches terminées / total</div>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-gray-800 tabular-nums">{tachesVisibles.length}</div>
            <div className="text-xs text-gray-500 mt-1">Tâches (visibles)</div>
            <div className="text-[10px] text-gray-400">
              {term} termin. · {enc} en cours · {bloq} bloq./retard
            </div>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-violet-700 tabular-nums">{epics.length}</div>
            <div className="text-xs text-gray-500 mt-1">Epics</div>
          </div>
          <div className="rounded-lg border border-gray-200 p-4 text-center">
            <div className="text-2xl font-bold text-teal-700 tabular-nums">{userStories.length}</div>
            <div className="text-xs text-gray-500 mt-1">User stories</div>
          </div>
        </div>

        {tachesVisibles.length > 0 && (
          <div className="rounded-lg border border-red-100 bg-red-50/50 px-4 py-3 mb-6 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-red-900/75">Retard (tâches visibles)</p>
              <p className="text-2xl font-bold text-red-700 tabular-nums mt-0.5">
                {totalJoursRetardProjet}
                <span className="text-base font-semibold text-red-800/90 ml-1.5">
                  jour{totalJoursRetardProjet === 1 ? '' : 's'} cumulé{totalJoursRetardProjet === 1 ? '' : 's'}
                </span>
              </p>
            </div>
            <p className="text-xs text-gray-600 max-w-xl leading-relaxed">
              Somme des jours de dépassement par rapport à la date de fin prévue : chaque tâche en retard ou bloquée avec échéance
              dépassée est comptée une fois. Les tâches sans date de fin ne contribuent pas aux jours (même si elles apparaissent
              comme « en retard » au niveau du nombre de tâches).
            </p>
          </div>
        )}

        <div className="space-y-6">
          <div className="grid md:grid-cols-2 gap-6">
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Répartition des statuts (tâches)</h4>
              <StatutBarChart taches={tachesVisibles} />
            </div>
            <div>
              <h4 className="text-sm font-semibold text-gray-700 mb-3">Charge de travail (aperçu)</h4>
              {tachesVisibles.length === 0 ? (
                <p className="text-sm text-gray-400">Aucune tâche.</p>
              ) : (
                <TachesDashboard
                  taches={tachesVisibles}
                  showStatutBreakdown={false}
                  showParPersonne={false}
                  hideAvancement
                  hideTables
                />
              )}
            </div>
          </div>
          <TachesParEntitePersonneGrid taches={tachesVisibles} />
          <TachesParClientFournisseurGrid taches={tachesVisibles} />
        </div>

        <div className="mt-6 grid md:grid-cols-2 gap-6">
          <ProgressTable
            title="Avancement global par Epic"
            rows={epicProgressRows}
            emptyLabel="Aucun epic lié aux tâches visibles."
          />
          <ProgressTable
            title="Avancement global par User story"
            rows={userStoryProgressRows}
            emptyLabel="Aucune user story liée aux tâches visibles."
          />
        </div>
      </section>

      {/* Export PDF */}
      <section className="bg-slate-50 rounded-lg border border-slate-200 p-4 no-print">
        <h3 className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <span aria-hidden>📤</span>
          Exports PDF
        </h3>
        <p className="text-xs text-gray-500 mb-3">
          Génère un fichier PDF selon la vue ou le rapport choisi (données = tâches visibles pour vous dans ce projet).
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() =>
              exportProjetDashboardPdf(projetNom, tachesVisibles, epics, userStories)
            }
            className="px-3 py-2 text-xs font-medium rounded-md bg-white border border-gray-300 hover:bg-gray-50"
          >
            PDF — Dashboard
          </button>
          <button
            type="button"
            onClick={() => exportProjetListePdf(projetNom, tachesVisibles)}
            className="px-3 py-2 text-xs font-medium rounded-md bg-white border border-gray-300 hover:bg-gray-50"
          >
            PDF — Liste
          </button>
          <button
            type="button"
            onClick={() => exportProjetKanbanPdf(projetNom, tachesVisibles)}
            className="px-3 py-2 text-xs font-medium rounded-md bg-white border border-gray-300 hover:bg-gray-50"
          >
            PDF — Kanban
          </button>
          <button
            type="button"
            onClick={() => exportProjetGanttPdf(projetNom, tachesVisibles)}
            className="px-3 py-2 text-xs font-medium rounded-md bg-white border border-gray-300 hover:bg-gray-50"
          >
            PDF — Gantt
          </button>
          <button
            type="button"
            onClick={() => exportProjetEpicsUsPdf(projetNom, epics, userStories)}
            className="px-3 py-2 text-xs font-medium rounded-md bg-white border border-gray-300 hover:bg-gray-50"
          >
            PDF — Epics & US
          </button>
        </div>
      </section>

      {/* 2 Données — Tâches avec vues */}
      <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="text-lg font-semibold text-gray-800 flex items-center gap-2">
              <span aria-hidden>📋</span>
              Tâches du projet
            </h3>
            <p className="text-sm text-gray-500 mt-1">
              {tachesVisibles.length} visible(s) pour vous
              {nbMasquees > 0 && (
                <span className="text-amber-600"> — {nbMasquees} masquée(s) (habilitation)</span>
              )}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setTaskView('list')}
              className={`px-3 py-2 rounded border text-sm font-medium ${
                taskView === 'list'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Liste
            </button>
            <button
              type="button"
              onClick={() => setTaskView('kanban')}
              className={`px-3 py-2 rounded border text-sm font-medium ${
                taskView === 'kanban'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Kanban
            </button>
            <button
              type="button"
              onClick={() => setTaskView('gantt')}
              className={`px-3 py-2 rounded border text-sm font-medium ${
                taskView === 'gantt'
                  ? 'bg-indigo-600 text-white border-indigo-600'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50'
              }`}
            >
              Gantt
            </button>
            <button
              type="button"
              onClick={() =>
                navigate(
                  projetId
                    ? `/taches?projetId=${encodeURIComponent(projetId)}`
                    : '/taches'
                )
              }
              className="px-3 py-2 rounded border border-gray-300 text-sm text-gray-700 hover:bg-gray-50"
            >
              Page Tâches
            </button>
            {peutCreer && (
              <button
                type="button"
                onClick={() => {
                  setEditTache(undefined);
                  setShowModal(true);
                }}
                className="px-3 py-2 rounded bg-blue-600 text-white text-sm font-medium hover:bg-blue-700"
              >
                + Tâche
              </button>
            )}
          </div>
        </div>

        {tachesVisibles.length > 0 && <TachesAvancementBlock taches={tachesVisibles} />}

        {taskView === 'gantt' && (
          <div className="mt-4 space-y-2">
            <p className="text-xs text-gray-500">
              Timeline à partir des dates de début / fin des tâches. Les{' '}
              <strong>liaisons</strong> (dépendances) se consultent et gèrent depuis chaque fiche tâche.
            </p>
            <TachesGanttView
              taches={tachesVisibles}
              getCanEdit={(t) => canEditTache(t as Tache)}
              onBarClick={(t) => {
                setEditTache(t as Tache);
                setShowModal(true);
              }}
            />
          </div>
        )}

        {taskView === 'kanban' && (
          <div className="mt-4">
            <TachesKanbanView
              taches={tachesVisibles}
              columns={STATUT_OPTIONS}
              getCanEdit={(t) => canEditTache(t as Tache)}
              onMoveTache={handleKanbanMove}
              onCardClick={(t) => {
                setEditTache(t as Tache);
                setShowModal(true);
              }}
            />
          </div>
        )}

        {taskView === 'list' && (
          <div className="mt-4 space-y-4">
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Tâche</th>
                    <th className="px-3 py-2">Statut</th>
                    <th className="px-3 py-2">Priorité</th>
                    <th className="px-3 py-2">Assignés (pers. / clients-fournisseurs)</th>
                    <th className="px-3 py-2">Début</th>
                    <th className="px-3 py-2">Fin</th>
                    <th className="px-3 py-2">Epic</th>
                    <th className="px-3 py-2">User story</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {tachesVisiblesTriees.map((t) => {
                    const ps = computeTaskPriorityScore(t);
                    return (
                    <tr
                      key={t.id}
                      className="hover:bg-gray-50 cursor-pointer"
                      onClick={() => {
                        setEditTache(t);
                        setShowModal(true);
                      }}
                    >
                      <td className="px-3 py-2 font-medium text-gray-900">{t.nom}</td>
                      <td className="px-3 py-2">
                        <span className="text-xs px-2 py-0.5 rounded bg-gray-100">
                          {STATUT_OPTIONS.find((s) => s.value === t.statut)?.label || t.statut}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-gray-600 text-xs">
                        <div className="flex flex-wrap items-center gap-1">
                          <span className="px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-800 border border-indigo-200">
                            {ps?.score ?? '—'}
                          </span>
                          {(ps?.labels || []).slice(0, 2).map((lb) => (
                            <span key={`${t.id}-${lb}`} className="px-1.5 py-0.5 rounded bg-indigo-100 text-indigo-800">
                              {lb}
                            </span>
                          ))}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        <div className="space-y-1.5">
                          <div>
                            {(t.assignesUtilisateurs || []).length > 0
                              ? (t.assignesUtilisateurs || []).map((u) => `${u.prenom} ${u.nom}`).join(', ')
                              : '—'}
                          </div>
                          {(t.assignesClientsFournisseurs || []).length > 0 && (
                            <div className="text-xs text-amber-900/95 leading-snug">
                              {(t.assignesClientsFournisseurs || []).map((c) => (
                                <span
                                  key={c.id}
                                  className="inline-block mr-1.5 mb-0.5 px-1.5 py-0.5 rounded border border-amber-200 bg-amber-50"
                                >
                                  🤝 {c.nom}
                                  <span className="text-amber-800/85">
                                    {' '}
                                    ({c.type === 'fournisseur' ? 'Fournisseur' : 'Client'})
                                  </span>
                                </span>
                              ))}
                            </div>
                          )}
                        </div>
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {t.dateDebut ? new Date(t.dateDebut).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600">
                        {t.dateFinApprox ? new Date(t.dateFinApprox).toLocaleDateString('fr-FR') : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-[180px] truncate" title={t.userStory?.epic?.nom || ''}>
                        {t.userStory?.epic?.nom
                          ? t.userStory.epic.nom.length > 50
                            ? `${t.userStory.epic.nom.slice(0, 50)}…`
                            : t.userStory.epic.nom
                          : '—'}
                      </td>
                      <td className="px-3 py-2 text-gray-600 max-w-[200px] truncate" title={t.userStory?.description}>
                        {t.userStory?.description
                          ? t.userStory.description.length > 60
                            ? `${t.userStory.description.slice(0, 60)}…`
                            : t.userStory.description
                          : '—'}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              {tachesVisiblesTriees.length === 0 && (
                <p className="p-6 text-center text-gray-400 text-sm">Aucune tâche à afficher.</p>
              )}
            </div>
            <p className="text-xs text-gray-500">
              Astuce : cliquez une ligne pour ouvrir la fiche (édition, liaisons, documents).
            </p>
          </div>
        )}
      </section>

      {/* Epics & US */}
      <section className="grid md:grid-cols-2 gap-6">
        <div className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span aria-hidden>📗</span>
            Epics
          </h3>
          {loadingAgile ? (
            <p className="text-sm text-gray-400">Chargement…</p>
          ) : epics.length === 0 ? (
            <p className="text-sm text-gray-400">Aucun epic pour ce projet.</p>
          ) : (
            <ul className="space-y-2 text-sm">
              {epics.map((e) => (
                <li key={e.id} className="border border-gray-100 rounded-md px-3 py-2">
                  <span className="font-medium text-gray-900">{e.nom}</span>
                  {e.description && (
                    <p className="text-xs text-gray-500 mt-1 line-clamp-2">{e.description}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="bg-white rounded-lg shadow border border-gray-100 p-6">
          <h3 className="text-lg font-semibold text-gray-800 mb-3 flex items-center gap-2">
            <span aria-hidden>📘</span>
            User stories
          </h3>
          {loadingAgile ? (
            <p className="text-sm text-gray-400">Chargement…</p>
          ) : userStories.length === 0 ? (
            <p className="text-sm text-gray-400">Aucune user story pour ce projet.</p>
          ) : (
            <ul className="space-y-2 text-sm max-h-[420px] overflow-y-auto">
              {userStories.map((us) => (
                <li key={us.id} className="border border-gray-100 rounded-md px-3 py-2">
                  <p className="text-gray-800">{us.description}</p>
                  {us.epic && (
                    <p className="text-xs text-indigo-600 mt-1">Epic : {us.epic.nom}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* Ressources */}
      <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
        <h3 className="text-lg font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <span aria-hidden>👥</span>
          Ressources
        </h3>
        <div className="grid md:grid-cols-2 gap-6">
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Personnes</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Nom</th>
                    <th className="px-3 py-2">Rôle / lien</th>
                    <th className="px-3 py-2">Charge</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {personnesRes.map((r) => (
                    <tr key={r.key}>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.nom}</td>
                      <td className="px-3 py-2 text-gray-600">{r.role}</td>
                      <td className="px-3 py-2 text-gray-600">{r.charge}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {personnesRes.length === 0 && (
                <p className="p-4 text-gray-400 text-sm">Aucune ressource listée.</p>
              )}
            </div>
          </div>
          <div>
            <h4 className="text-sm font-semibold text-gray-700 mb-2">Entités assignées (via tâches)</h4>
            <div className="overflow-x-auto border border-gray-200 rounded-lg">
              <table className="min-w-full text-sm">
                <thead className="bg-gray-50 text-left text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-3 py-2">Entité</th>
                    <th className="px-3 py-2">Tâches</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {entitesRes.map((r, i) => (
                    <tr key={i}>
                      <td className="px-3 py-2 font-medium text-gray-900">{r.nom}</td>
                      <td className="px-3 py-2 tabular-nums">{r.n}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {entitesRes.length === 0 && (
                <p className="p-4 text-gray-400 text-sm">Aucune entité assignée sur les tâches visibles.</p>
              )}
            </div>
          </div>
        </div>
      </section>

      {showModal && (
        <TacheModal
          key={editTache?.id || `nouvelle-${projetId}`}
          onClose={() => {
            setShowModal(false);
            setEditTache(undefined);
          }}
          onSave={async () => {
            onTachesRefresh?.();
            await loadAgile();
          }}
          projets={projets}
          users={usersForTaches}
          entites={entites}
          clientsFournisseurs={clientsFournisseurs}
          projetClientFournisseurIds={projetClientFournisseurIds}
          taches={tachesBrutes}
          editTache={editTache}
          lockProjetId={editTache ? undefined : projetId}
        />
      )}
    </div>
  );
}
