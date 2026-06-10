import { useEffect, useState, useMemo, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import ClientFournisseurQuickCreateModal from '../components/ClientFournisseurQuickCreateModal';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { ProjetAccesModal } from '../components/ProjetAccesModal';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';
import { canModifyModule } from '../utils/uiModuleRoute';

const PAGE_SIZE = 15;

const STATUS_COLORS: Record<string, string> = {
  en_preparation: 'bg-yellow-100 text-yellow-800',
  en_cours: 'bg-blue-100 text-blue-800',
  termine: 'bg-green-100 text-green-800',
  en_pause: 'bg-gray-100 text-gray-800',
  archive: 'bg-purple-100 text-purple-800',
};

const STATUS_LABELS: Record<string, string> = {
  en_preparation: 'En préparation',
  en_cours: 'En cours',
  termine: 'Terminé',
  en_pause: 'En pause',
  archive: 'Archivé',
};

const STATUS_SORT_ORDER: Record<string, number> = {
  en_preparation: 1,
  en_cours: 2,
  en_pause: 3,
  termine: 4,
  archive: 5,
};

const PRIORITY_COLORS: Record<string, string> = {
  haute: 'bg-red-100 text-red-800',
  moyenne: 'bg-orange-100 text-orange-800',
  basse: 'bg-green-100 text-green-800',
};

const LABEL_PERM_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
  gestion: 'gestion des droits',
};

const ACTION_JOURNAL: Record<string, string> = {
  connexion: 'Connexion',
  deconnexion: 'Déconnexion',
  lecture: 'Lecture / consultation',
  creation: 'Création',
  modification: 'Modification',
  suppression: 'Suppression',
  telechargement: 'Téléchargement',
  export: 'Export',
};

const TACHE_STATUT_LABELS: Record<string, string> = {
  cree: 'Créée',
  a_faire: 'À faire',
  en_cours: 'En cours',
  en_attente: 'En attente',
  bloque: 'Bloquée',
  termine: 'Terminée',
  archive: 'Archivée',
};

function permSummaryLine(perms: string[]) {
  return perms.map((p) => LABEL_PERM_ROW[p] || p).join(' + ');
}

function isAccesRestreintProjet(p: any) {
  return !!p.createdById || (p.accesApercu?.delegations?.length ?? 0) > 0;
}

function getClientLabel(p: any): string {
  const n = typeof p.nomClient === 'string' ? p.nomClient.trim() : '';
  if (n) return n;
  const cfs = p.clientsFournisseurs;
  if (Array.isArray(cfs) && cfs.length > 0) {
    const nom = cfs[0]?.clientFournisseur?.nom;
    if (nom) return nom;
  }
  return '— (sans client)';
}

function getProjetEntitesLabels(p: any): string[] {
  if (!Array.isArray(p?.entites)) return [];
  return p.entites
    .map((pe: any) => pe?.entite?.nom || pe?.entite?.code || '')
    .filter((v: string) => !!v);
}

function getProjetClientFournisseurLabels(p: any): string[] {
  if (!Array.isArray(p?.clientsFournisseurs)) return [];
  const labels = p.clientsFournisseurs
    .map((cf: any) => {
      const item = cf?.clientFournisseur;
      if (!item) return '';
      const nom = item.nom || '';
      const type = item.type || item.typeSociete?.nom || '';
      return [nom, type ? `(${type})` : ''].filter(Boolean).join(' ');
    })
    .filter((v: string) => !!v);
  return Array.from(new Set(labels));
}

function isProjetEnRetard(p: any): boolean {
  const tr = p.tachesResume || {};
  if ((tr.enRetard ?? 0) > 0) return true;
  if (p.statut === 'termine') return false;
  const alertes: string[] = p.alertesProjet || [];
  if (alertes.some((a) => a.includes('dépassée') || a.toLowerCase().includes('retard'))) return true;
  if (p.dateFinPrevue && new Date(p.dateFinPrevue).getTime() < Date.now()) return true;
  return false;
}

function activityScore(p: any): number {
  const tr = p.tachesResume || {};
  const total = Number(tr.total) || 0;
  const enRetard = Number(tr.enRetard) || 0;
  const term = Number(tr.terminees) || 0;
  const enCours = Math.max(0, total - term);
  return total * 2 + enRetard * 4 + enCours;
}

const droitsAdminLigne = 'modification + suppression + gestion des accès + lecture';

export default function Projets() {
  const navigate = useNavigate();
  const { user: currentUser } = useAuth();
  const canCreateProjet = canModifyModule(currentUser?.uiModules, 'projets');
  const canEditClients = currentUser?.role === 'admin' || currentUser?.role === 'contributeur';

  const [projets, setProjets] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [showQuickClientModal, setShowQuickClientModal] = useState(false);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({
    nom: '',
    statut: '',
    priorite: '',
    type: '',
    periodeDebut: '',
    periodeFin: '',
  });
  const [page, setPage] = useState(1);
  const [showFiltres, setShowFiltres] = useState(false);
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleProjets, setCorbeilleProjets] = useState<any[]>([]);
  const [showDashboardModal, setShowDashboardModal] = useState(false);
  const [createFormKey, setCreateFormKey] = useState(0);
  const [modalType, setModalType] = useState<'interne' | 'client' | 'communautaire'>('interne');
  const [fichesClient, setFichesClient] = useState<{ id: string; nom: string }[]>([]);
  const [devisesCreate, setDevisesCreate] = useState<{ id: string; code: string; libelle?: string | null }[]>([]);
  const [selectedClientId, setSelectedClientId] = useState('');
  const [showArchives, setShowArchives] = useState(false);

  const [accesModalProjet, setAccesModalProjet] = useState<any | null>(null);
  const [histModalProjet, setHistModalProjet] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  const [expandedProjetIds, setExpandedProjetIds] = useState<Set<string>>(() => new Set());

  const toggleProjetRow = (id: string) => {
    setExpandedProjetIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isProjetRowExpanded = (id: string) => expandedProjetIds.has(id);

  useEffect(() => {
    loadProjets();
    loadUsers();
  }, []);

  useEffect(() => {
    loadProjets();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.nom, filters.statut, filters.priorite, filters.type, filters.periodeDebut, filters.periodeFin]);

  useEffect(() => {
    setPage(1);
  }, [filters.nom, filters.statut, filters.priorite, filters.type, filters.periodeDebut, filters.periodeFin]);

  useEffect(() => {
    if (!showCreateModal) return;
    let cancelled = false;
    setSelectedClientId('');
    (async () => {
      try {
        const [cf, dv] = await Promise.all([
          api.get('/clients-fournisseurs', { params: { type: 'client' } }),
          api.get('/devises').catch(() => ({ data: [] })),
        ]);
        if (!cancelled) {
          setFichesClient(Array.isArray(cf.data) ? cf.data : []);
          setDevisesCreate(Array.isArray(dv.data) ? dv.data : []);
        }
      } catch {
        if (!cancelled) {
          setFichesClient([]);
          setDevisesCreate([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [showCreateModal]);

  const loadUsers = async () => {
    try {
      const r = await api.get('/users');
      setUsers(r.data);
    } catch {
      setUsers([]);
    }
  };

  const loadProjets = async () => {
    setLoading(true);
    try {
      const params: any = {};
      if (filters.nom) params.nom = filters.nom;
      if (filters.statut) params.statut = filters.statut;
      if (filters.priorite) params.priorite = filters.priorite;
      if (filters.type) params.type = filters.type;
      if (filters.periodeDebut) params.periodeDebut = filters.periodeDebut;
      if (filters.periodeFin) params.periodeFin = filters.periodeFin;
      const response = await api.get('/projets', { params });
      setProjets(response.data);
    } catch (err) {
      console.error('Erreur chargement projets:', err);
    } finally {
      setLoading(false);
    }
  };

  const cap = (p: any) => ({
    canView: p.capabilities?.canView !== false,
    canModify: !!p.capabilities?.canModify,
    canDelete: !!p.capabilities?.canDelete,
    canManagePermissions: !!p.capabilities?.canManagePermissions,
  });

  const onAccesButtonClick = (p: any) => {
    setAccesModalProjet(p);
  };

  const projetPermissionsForAdminLines = (delegations: any[]) => {
    const m = new Map<string, { userId: string; niveau: string; user?: any }>();
    for (const d of delegations || []) {
      const uid = d.user?.id;
      if (!uid) continue;
      const ex = m.get(uid);
      const part =
      (
        {
          lecture: 'Consultation',
          modification: 'Modification',
          suppression: 'Suppression',
          gestion: 'Gestion des droits',
        } as Record<string, string>
      )[d.permission] || d.permission;
      m.set(uid, {
        userId: uid,
        niveau: ex ? `${ex.niveau} + ${part}` : part,
        user: d.user,
      });
    }
    return Array.from(m.values());
  };

  const openHistoriqueModal = async (p: any) => {
    setHistModalProjet(p);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/projets/${p.id}/history?page=1&limit=200`);
      setHistoList(data?.data || []);
    } catch {
      setHistoList([]);
      alert('Impossible de charger l’historique.');
      setHistModalProjet(null);
    } finally {
      setHistoLoading(false);
    }
  };

  const loadCorbeilleProjets = async () => {
    try {
      const r = await api.get('/projets/corbeille');
      setCorbeilleProjets(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleProjets([]);
    }
  };

  const handleRestoreProjetFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/projets/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await loadProjets();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestoreProjetCorbeille = (row: any) =>
    currentUser?.role === 'admin' || row.createdById === currentUser?.id || row.createdBy?.id === currentUser?.id;

  const handleSoftDelete = async (id: string, nom: string) => {
    if (!window.confirm(`Mettre le projet « ${nom} » en corbeille ?`)) return;
    try {
      await api.delete(`/projets/${id}`);
      await loadProjets();
    } catch (err: any) {
      alert(err?.response?.data?.error || 'Erreur');
    }
  };

  const openCreateModal = () => {
    setError('');
    setModalType('interne');
    setSelectedClientId('');
    setShowQuickClientModal(false);
    setCreateFormKey((k) => k + 1);
    setShowCreateModal(true);
  };

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setShowQuickClientModal(false);
    setError('');
  };

  const handleCreateSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError('');
    const fd = new FormData(e.currentTarget);
    const nom = String(fd.get('createProjetNom') ?? '').trim();
    if (!nom) {
      setError('Le nom du projet est obligatoire.');
      return;
    }
    const type = String(fd.get('createProjetType') ?? 'interne') as 'interne' | 'client' | 'communautaire';
    const payload: Record<string, unknown> = {
      nom,
      type,
      statut: String(fd.get('createProjetStatut') ?? 'en_preparation'),
      priorite: String(fd.get('createProjetPriorite') ?? 'moyenne'),
    };
    if (type === 'client') {
      const cfId = String(fd.get('createProjetClientFournisseurId') ?? '').trim();
      if (!cfId) {
        setError('Choisissez un client dans la liste ou créez une fiche client.');
        return;
      }
      payload.clientFournisseurId = cfId;
    }
    const codeProjet = String(fd.get('createProjetCode') ?? '').trim();
    if (codeProjet) payload.codeProjet = codeProjet;
    const dateDebut = String(fd.get('createProjetDateDebut') ?? '').trim();
    if (dateDebut) payload.dateDebut = dateDebut;
    const dateFinPrevue = String(fd.get('createProjetDateFin') ?? '').trim();
    if (dateFinPrevue) payload.dateFinPrevue = dateFinPrevue;
    const budgetPrevu = String(fd.get('createProjetBudgetPrevu') ?? '').trim();
    if (budgetPrevu) payload.budgetPrevu = budgetPrevu;
    const budgetConsomme = String(fd.get('createProjetBudgetConsomme') ?? '').trim();
    if (budgetConsomme) payload.budgetConsomme = budgetConsomme;
    const deviseId = String(fd.get('createProjetDeviseId') ?? '').trim();
    if (deviseId) payload.deviseId = deviseId;

    setCreating(true);
    try {
      await api.post('/projets', payload);
      await loadProjets();
      closeCreateModal();
    } catch (err: any) {
      setError(err.response?.data?.error || 'Erreur lors de la création');
    } finally {
      setCreating(false);
    }
  };

  const projetsVisibles = useMemo(
    () =>
      projets.filter((p) => (showArchives ? p.statut === 'archive' : p.statut !== 'archive')),
    [projets, showArchives]
  );

  const sortedProjets = useMemo(() => {
    const toTs = (d?: string | null) => {
      if (!d) return Number.POSITIVE_INFINITY;
      const t = new Date(d).getTime();
      return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
    };
    return [...projetsVisibles].sort((a, b) => {
      const sa = STATUS_SORT_ORDER[a.statut] ?? 999;
      const sb = STATUS_SORT_ORDER[b.statut] ?? 999;
      if (sa !== sb) return sa - sb;

      const da = toTs(a.dateFinPrevue);
      const db = toTs(b.dateFinPrevue);
      if (da !== db) return da - db;

      return String(a.nom || '').localeCompare(String(b.nom || ''), 'fr');
    });
  }, [projetsVisibles]);

  const totalPages = Math.max(1, Math.ceil(sortedProjets.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageSlice = sortedProjets.slice(startIdx, startIdx + PAGE_SIZE);

  const dashboard = useMemo(() => {
    const list = projetsVisibles;
    const plusActifs = [...list].sort((a, b) => activityScore(b) - activityScore(a)).slice(0, 15);

    const parStatut = new Map<string, number>();
    for (const p of list) {
      const k = p.statut || '—';
      parStatut.set(k, (parStatut.get(k) || 0) + 1);
    }

    const parEntite = new Map<string, number>();
    for (const p of list) {
      const ents = p.entites;
      if (!ents?.length) {
        parEntite.set('(Non renseigné)', (parEntite.get('(Non renseigné)') || 0) + 1);
      } else {
        for (const pe of ents) {
          const label = pe.entite?.nom || pe.entite?.code || '—';
          parEntite.set(label, (parEntite.get(label) || 0) + 1);
        }
      }
    }

    const parCreateur = new Map<string, number>();
    const parChefs = new Map<string, number>();
    for (const p of list) {
      if (p.createdBy) {
        const nm = `${p.createdBy.prenom || ''} ${p.createdBy.nom || ''}`.trim() || '—';
        parCreateur.set(nm, (parCreateur.get(nm) || 0) + 1);
      } else {
        parCreateur.set('(Non renseigné)', (parCreateur.get('(Non renseigné)') || 0) + 1);
      }
      const chefs = p.chefsProjetData || [];
      if (!chefs.length) {
        parChefs.set('(Aucun chef de projet)', (parChefs.get('(Aucun chef de projet)') || 0) + 1);
      } else {
        for (const u of chefs) {
          const nm = `${u.prenom || ''} ${u.nom || ''}`.trim() || '—';
          parChefs.set(nm, (parChefs.get(nm) || 0) + 1);
        }
      }
    }

    const parClient = new Map<string, number>();
    for (const p of list) {
      const c = getClientLabel(p);
      parClient.set(c, (parClient.get(c) || 0) + 1);
    }

    const enRetard = list.filter(isProjetEnRetard);

    return {
      plusActifs,
      parStatut,
      parEntite,
      parCreateur,
      parChefs,
      parClient,
      enRetard,
      total: list.length,
    };
  }, [projetsVisibles]);

  const sortMapEntriesDesc = (m: Map<string, number>) =>
    [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Projets</h1>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleProjets();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          <button
            type="button"
            onClick={() => setShowDashboardModal(true)}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            📊 Dashboard
          </button>
          <button
            type="button"
            onClick={() => {
              setShowArchives((v) => !v);
              setPage(1);
            }}
            className={`px-4 py-2 border rounded-lg text-sm font-medium ${
              showArchives
                ? 'border-purple-300 bg-purple-50 text-purple-800 hover:bg-purple-100'
                : 'border-gray-300 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {showArchives ? 'Voir projets actifs' : 'Voir archives'}
          </button>
          {canCreateProjet && (
            <button
              type="button"
              onClick={openCreateModal}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Nouveau projet
            </button>
          )}
        </div>
      </div>

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>Filtres</span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <p className="text-xs text-gray-500 pt-3">
              Période : les projets affichés chevauchent l’intervalle choisi (date de début et/ou fin prévue du projet par rapport aux dates ci-dessous).
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom / code</label>
                <input
                  type="text"
                  value={filters.nom}
                  onChange={(e) => setFilters({ ...filters, nom: e.target.value })}
                  placeholder="Rechercher…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filters.statut}
                  onChange={(e) => setFilters({ ...filters, statut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  <option value="en_preparation">En préparation</option>
                  <option value="en_cours">En cours</option>
                  <option value="termine">Terminé</option>
                  <option value="en_pause">En pause</option>
                  <option value="archive">Archivé</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Priorité</label>
                <select
                  value={filters.priorite}
                  onChange={(e) => setFilters({ ...filters, priorite: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Toutes</option>
                  <option value="haute">Haute</option>
                  <option value="moyenne">Moyenne</option>
                  <option value="basse">Basse</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters({ ...filters, type: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  <option value="interne">Interne</option>
                  <option value="client">Client</option>
                  <option value="communautaire">Communautaire</option>
                </select>
              </div>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Période — date de début (filtre)</label>
                <input
                  type="date"
                  value={filters.periodeDebut}
                  onChange={(e) => setFilters({ ...filters, periodeDebut: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Période — date de fin (filtre)</label>
                <input
                  type="date"
                  value={filters.periodeFin}
                  onChange={(e) => setFilters({ ...filters, periodeFin: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() =>
                  setFilters({ nom: '', statut: '', priorite: '', type: '', periodeDebut: '', periodeFin: '' })
                }
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? (
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      ) : (
        <>
          <div className="space-y-4">
            {projetsVisibles.length === 0 && (
              <div className="text-center py-10 text-gray-400">
                {showArchives ? 'Aucun projet archivé' : 'Aucun projet actif'}
              </div>
            )}
            {pageSlice.map((p) => {
              const c = cap(p);
              const tr = p.tachesResume || { total: 0, parStatut: {}, enRetard: 0, avancementPct: null };
              const rowOpen = isProjetRowExpanded(p.id);
              const entiteLabels = getProjetEntitesLabels(p);
              const clientFournisseurLabels = getProjetClientFournisseurLabels(p);
              return (
                <div key={p.id} className="bg-white rounded-lg shadow overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleProjetRow(p.id)}
                    className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    aria-expanded={rowOpen}
                    aria-label={rowOpen ? 'Replier le détail du projet' : 'Afficher le détail et les actions du projet'}
                  >
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${STATUS_COLORS[p.statut] || 'bg-gray-100 text-gray-700'}`}
                    >
                      {STATUS_LABELS[p.statut] || p.statut}
                    </span>
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{p.nom}</h2>
                    <span className="text-sm text-gray-500 font-mono shrink-0">{p.codeProjet}</span>
                    {rowOpen && (
                      <span className="text-gray-400 shrink-0 ml-auto" aria-hidden>
                        ▼
                      </span>
                    )}
                    <div className="w-full flex flex-wrap gap-2 text-xs mt-1">
                      <span className="text-gray-500 font-medium">Entités :</span>
                      {entiteLabels.length > 0 ? (
                        entiteLabels.map((label) => (
                          <span key={`ent-${p.id}-${label}`} className="px-2 py-0.5 rounded bg-indigo-50 text-indigo-700 border border-indigo-100">
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">Sans entité</span>
                      )}
                    </div>
                    <div className="w-full flex flex-wrap gap-2 text-xs">
                      <span className="text-gray-500 font-medium">Clients/Fournisseurs :</span>
                      {clientFournisseurLabels.length > 0 ? (
                        clientFournisseurLabels.map((label) => (
                          <span key={`cf-${p.id}-${label}`} className="px-2 py-0.5 rounded bg-emerald-50 text-emerald-700 border border-emerald-100">
                            {label}
                          </span>
                        ))
                      ) : (
                        <span className="text-gray-400">Aucun</span>
                      )}
                    </div>
                  </button>

                  {rowOpen && (
                    <div className="px-4 sm:px-5 pb-4 pt-0 border-t border-gray-100">
                      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 pt-3">
                        <div className="min-w-0 flex-1 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-xs font-medium text-gray-500 uppercase shrink-0">Priorité</span>
                        <span
                          className={`px-2 py-0.5 rounded text-xs capitalize ${PRIORITY_COLORS[p.priorite] || 'bg-gray-100 text-gray-700'}`}
                        >
                          {p.priorite}
                        </span>
                      </div>
                      {p.nomClient && <p className="text-sm text-gray-600">Client : {p.nomClient}</p>}
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                        <div>
                          <span className="font-medium">Début : </span>
                          {p.dateDebut ? new Date(p.dateDebut).toLocaleDateString('fr-FR') : '—'}
                        </div>
                        <div>
                          <span className="font-medium">Fin prévue : </span>
                          {p.dateFinPrevue ? new Date(p.dateFinPrevue).toLocaleDateString('fr-FR') : '—'}
                        </div>
                        {p.createdBy && (
                          <div>
                            <span className="font-medium">Créé par : </span>
                            {p.createdBy.prenom} {p.createdBy.nom}
                          </div>
                        )}
                        {tr.avancementPct != null && (
                          <div>
                            <span className="font-medium">Avancement tâches : </span>
                            {tr.avancementPct}%
                          </div>
                        )}
                      </div>

                      <div className="mt-3 flex flex-wrap gap-2 items-center">
                        <span className="text-xs font-semibold text-gray-500 uppercase">Tâches</span>
                        {tr.total === 0 ? (
                          <span className="text-xs text-gray-400">Aucune tâche</span>
                        ) : (
                          <>
                            <span className="text-xs text-gray-700 font-medium">{tr.total} au total</span>
                            {Object.entries(tr.parStatut || {}).map(([st, n]) =>
                              (n as number) > 0 ? (
                                <span key={st} className="px-2 py-0.5 bg-slate-100 text-slate-700 rounded text-xs">
                                  {TACHE_STATUT_LABELS[st] || st} : {n as number}
                                </span>
                              ) : null
                            )}
                          </>
                        )}
                      </div>

                      {(p.alertesProjet?.length ?? 0) > 0 && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {p.alertesProjet.map((a: string, i: number) => (
                            <span key={i} className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded text-xs font-medium">
                              ⚠ {a}
                            </span>
                          ))}
                        </div>
                      )}

                      {(p.documentsListe?.length ?? 0) > 0 && (
                        <div className="mt-3">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Documents</p>
                          <div className="flex flex-wrap gap-1">
                            {p.documentsListe.map((d: any) => (
                              <a
                                key={d.id}
                                href={`${API_BASE_URL}/documents/${d.id}/view?token=${localStorage.getItem('token')}`}
                                target="_blank"
                                rel="noreferrer"
                                className="px-2 py-0.5 bg-gray-100 rounded text-xs text-blue-600 hover:underline"
                              >
                                📎 {d.nom}
                              </a>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                        <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                          {isAccesRestreintProjet(p) ? (
                            <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                              <span className="text-sm leading-none" aria-hidden>
                                🔒
                              </span>
                              <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                            </div>
                          ) : (
                            <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                              <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                            </div>
                          )}
                          <AccessContratLikeAdminLines
                            users={users}
                            createdById={p.createdById}
                            createdBy={p.createdBy}
                            adminSansAccesUserIds={p.adminSansAccesUserIds}
                            permissions={projetPermissionsForAdminLines(p.permissions || [])}
                            droitsAdminCompletLabel={droitsAdminLigne}
                            niveauLabel={(n) => n}
                            keyPrefix={`liste-proj-${p.id}`}
                            creatorRightsLabel={droitsAdminLigne}
                          />
                          {(p.accesApercu?.delegations || []).map((d: any) => (
                            <div key={`${d.user?.id}-${(d.permissionEntryIds || []).join('-')}`} className="min-w-0">
                              <span className="font-medium text-gray-900">
                                {d.user.prenom} {d.user.nom}
                              </span>
                              <span className="text-gray-500 italic block sm:inline sm:ml-1">({permSummaryLine(d.permissions || [])})</span>
                            </div>
                          ))}
                          <p className="text-[10px] text-gray-500 w-full basis-full">
                            Aligné sur les contrats : exclusion ou droits explicites pour les administrateurs sont visibles
                            ici et gérés dans la modale « Accès » (créateur ou délégation « Gestion des droits »).
                          </p>
                        </div>
                      </div>
                        </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                      {c.canView && (
                        <button
                          type="button"
                          onClick={() => navigate(`/projets/${p.id}`)}
                          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                        >
                          👁 Détails
                        </button>
                      )}
                      {c.canModify && (
                        <button
                          type="button"
                          onClick={() => navigate(`/projets/${p.id}`, { state: { openEdit: true } })}
                          className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                        >
                          ✏️ Modifier
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => onAccesButtonClick(p)}
                        className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                      >
                        🔐 Accès
                      </button>
                      <button
                        type="button"
                        onClick={() => openHistoriqueModal(p)}
                        className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                      >
                        📜 Historique
                      </button>
                      {c.canDelete && (
                        <button
                          type="button"
                          onClick={() => handleSoftDelete(p.id, p.nom)}
                          className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
                        >
                          🗑 Mettre en corbeille
                        </button>
                      )}
                    </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {projetsVisibles.length > PAGE_SIZE && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
              <div className="text-sm text-gray-700">
                Affichage {startIdx + 1}-{Math.min(startIdx + PAGE_SIZE, projetsVisibles.length)} sur {projetsVisibles.length}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPage((pg) => Math.max(1, pg - 1))}
                  disabled={safePage === 1}
                  className={`px-4 py-2 rounded text-sm font-medium ${safePage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  Précédent
                </button>
                <div className="flex gap-1 flex-wrap items-center">
                  {getPaginationPageNumbers(safePage, totalPages).map((pg, idx) =>
                    typeof pg === 'string' ? (
                      <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                        {pg}
                      </span>
                    ) : (
                      <button
                        key={pg}
                        type="button"
                        onClick={() => setPage(pg)}
                        className={`px-3 py-2 rounded text-sm font-medium ${safePage === pg ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        {pg}
                      </button>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPage((pg) => Math.min(totalPages, pg + 1))}
                  disabled={safePage === totalPages}
                  className={`px-4 py-2 rounded text-sm font-medium ${safePage === totalPages ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  Suivant
                </button>
              </div>
            </div>
          )}
        </>
      )}

      {showCreateModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full mx-4 max-h-[85vh] overflow-y-auto relative z-50">
            <button type="button" onClick={closeCreateModal} className="absolute top-3 right-3 text-gray-500 hover:text-gray-700 text-xl">
              ×
            </button>
            <div className="p-6">
              <h2 className="text-xl font-bold mb-1">Nouveau projet</h2>
              <p className="text-xs text-gray-500 mb-4">Code projet facultatif. Type « Client » : liste des fiches + bouton nouvelle fiche.</p>
              {error && <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{error}</div>}
              <form key={createFormKey} onSubmit={handleCreateSubmit} autoComplete="off" noValidate className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetNom">
                    Nom du projet <span className="text-red-500">*</span>
                  </label>
                  <input id="createProjetNom" name="createProjetNom" type="text" className="w-full px-3 py-2 border border-gray-300 rounded-md" autoComplete="off" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetCode">
                    Code projet <span className="text-gray-500 font-normal">(facultatif)</span>
                  </label>
                  <input
                    id="createProjetCode"
                    name="createProjetCode"
                    type="text"
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    placeholder="Laissé vide : code généré automatiquement"
                    autoComplete="off"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetType">
                    Type <span className="text-red-500">*</span>
                  </label>
                  <select
                    id="createProjetType"
                    name="createProjetType"
                    defaultValue="interne"
                    onChange={(ev) => {
                      const v = ev.target.value as typeof modalType;
                      setModalType(v);
                      if (v !== 'client') setSelectedClientId('');
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-md"
                  >
                    <option value="interne">Interne</option>
                    <option value="client">Client</option>
                    <option value="communautaire">Communautaire</option>
                  </select>
                </div>
                {modalType === 'client' && (
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetClientFournisseurId">
                      Client <span className="text-red-500">*</span>
                    </label>
                    <select
                      id="createProjetClientFournisseurId"
                      name="createProjetClientFournisseurId"
                      value={selectedClientId}
                      onChange={(ev) => setSelectedClientId(ev.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                    >
                      <option value="">— Choisir un client —</option>
                      {fichesClient.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.nom}
                        </option>
                      ))}
                    </select>
                    {canEditClients ? (
                      <button
                        type="button"
                        onClick={() => setShowQuickClientModal(true)}
                        className="w-full px-3 py-2 text-sm border border-dashed border-blue-400 text-blue-700 rounded-md hover:bg-blue-50"
                      >
                        + Nouvelle fiche client…
                      </button>
                    ) : (
                      <p className="text-xs text-amber-700">Pour créer une fiche client, demandez à un administrateur ou contributeur.</p>
                    )}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetDateDebut">
                      Date de début <span className="text-gray-500 font-normal">(facultatif)</span>
                    </label>
                    <input id="createProjetDateDebut" name="createProjetDateDebut" type="date" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetDateFin">
                      Date de fin prévue
                    </label>
                    <input id="createProjetDateFin" name="createProjetDateFin" type="date" className="w-full px-3 py-2 border border-gray-300 rounded-md" />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetStatut">
                      Statut
                    </label>
                    <select id="createProjetStatut" name="createProjetStatut" defaultValue="en_preparation" className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option value="en_preparation">En préparation</option>
                      <option value="en_cours">En cours</option>
                      <option value="termine">Terminé</option>
                      <option value="en_pause">En pause</option>
                      <option value="archive">Archivé</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetPriorite">
                      Priorité
                    </label>
                    <select id="createProjetPriorite" name="createProjetPriorite" defaultValue="moyenne" className="w-full px-3 py-2 border border-gray-300 rounded-md">
                      <option value="haute">Haute</option>
                      <option value="moyenne">Moyenne</option>
                      <option value="basse">Basse</option>
                    </select>
                  </div>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetBudgetPrevu">
                      Budget prévu <span className="text-gray-500 font-normal">(facultatif)</span>
                    </label>
                    <input
                      id="createProjetBudgetPrevu"
                      name="createProjetBudgetPrevu"
                      type="text"
                      inputMode="decimal"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetBudgetConsomme">
                      Budget consommé <span className="text-gray-500 font-normal">(facultatif)</span>
                    </label>
                    <input
                      id="createProjetBudgetConsomme"
                      name="createProjetBudgetConsomme"
                      type="text"
                      inputMode="decimal"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      autoComplete="off"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1" htmlFor="createProjetDeviseId">
                      Devise <span className="text-gray-500 font-normal">(Configuration)</span>
                    </label>
                    <select
                      id="createProjetDeviseId"
                      name="createProjetDeviseId"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md"
                      defaultValue=""
                    >
                      <option value="">
                        {devisesCreate.length ? '— Aucune —' : 'Aucune devise (voir Configuration)'}
                      </option>
                      {devisesCreate.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.code}
                          {d.libelle ? ` — ${d.libelle}` : ''}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="flex justify-end space-x-3 mt-6 pt-4 border-t">
                  <button type="button" onClick={closeCreateModal} className="px-4 py-2 border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50">
                    Annuler
                  </button>
                  <button type="submit" disabled={creating} className="px-4 py-2 bg-blue-600 text-white rounded-md hover:bg-blue-700 disabled:opacity-50">
                    {creating ? 'Création...' : 'Créer'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}

      {showQuickClientModal && (
        <ClientFournisseurQuickCreateModal
          open={showQuickClientModal}
          onClose={() => setShowQuickClientModal(false)}
          onCreated={(fiche) => {
            setFichesClient((prev) => {
              const rest = prev.filter((x) => x.id !== fiche.id);
              return [fiche, ...rest];
            });
            setSelectedClientId(fiche.id);
          }}
        />
      )}

      {accesModalProjet && (
        <ProjetAccesModal
          projet={{ id: accesModalProjet.id, nom: accesModalProjet.nom }}
          users={users}
          onClose={() => setAccesModalProjet(null)}
          onAfterChange={loadProjets}
        />
      )}

      {histModalProjet && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalProjet.nom}</h3>
            {histoLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoList.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm max-h-[60vh] overflow-y-auto">
                {histoList.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{h.timestamp ? new Date(h.timestamp).toLocaleString('fr-FR') : ''}</span>
                      <span>
                        {h.user?.prenom} {h.user?.nom}
                      </span>
                    </div>
                    <p className="font-medium text-gray-800">{ACTION_JOURNAL[h.action] || h.action}</p>
                    {h.ressourceNom && <p className="text-gray-600 text-xs mt-0.5">{h.ressourceNom}</p>}
                    {h.details && typeof h.details === 'object' && Object.keys(h.details).length > 0 && (
                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto max-h-32">{JSON.stringify(h.details, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setHistModalProjet(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Projets en corbeille</h2>
              <button
                type="button"
                onClick={() => setShowCorbeilleModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-3">
              {corbeilleProjets.length === 0 && <p className="text-sm text-gray-500">Aucun projet en corbeille.</p>}
              {corbeilleProjets.map((cp: any) => (
                <div key={cp.id} className="flex flex-wrap justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{cp.nom}</p>
                    <p className="text-xs text-gray-500">
                      Supprimé le {cp.deletedAt ? new Date(cp.deletedAt).toLocaleString('fr-FR') : '—'}
                      {cp.createdBy && ` · Créé par ${cp.createdBy.prenom} ${cp.createdBy.nom}`}
                    </p>
                  </div>
                  {canRestoreProjetCorbeille(cp) ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreProjetFromCorbeille(cp.id)}
                      className="shrink-0 px-3 py-1.5 bg-green-600 text-white text-xs rounded-lg hover:bg-green-700"
                    >
                      Restaurer
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400 shrink-0">Restauration : admin ou créateur</span>
                  )}
                </div>
              ))}
              <p className="text-xs text-gray-400 pt-2">
                La suppression définitive reste réservée aux administrateurs (corbeille globale).
              </p>
            </div>
          </div>
        </div>
      )}

      {showDashboardModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-4xl max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b sticky top-0 bg-white z-10">
              <div>
                <h2 className="text-lg font-semibold">📊 Dashboard projets</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Données basées sur les {dashboard.total} projet(s) actuellement listés (mêmes filtres que la page).
                </p>
              </div>
              <button
                type="button"
                onClick={() => setShowDashboardModal(false)}
                className="text-gray-400 hover:text-gray-600 text-xl shrink-0"
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            <div className="p-5 space-y-8 text-sm">
              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Projets les plus actifs</h3>
                <p className="text-xs text-gray-400 mb-2">Score = volume de tâches, tâches en cours et en retard (top 15).</p>
                {dashboard.plusActifs.length === 0 ? (
                  <p className="text-gray-400 italic">Aucun projet</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dashboard.plusActifs.map((p: any, i: number) => (
                      <li key={p.id} className="flex justify-between gap-2 border-b border-gray-100 pb-1">
                        <span>
                          <span className="text-gray-400 mr-2">{i + 1}.</span>
                          <span className="font-medium text-gray-900">{p.nom}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            {p.tachesResume?.total ?? 0} tâche(s), {p.tachesResume?.enRetard ?? 0} en retard
                          </span>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Par statut</h3>
                <ul className="space-y-1">
                  {sortMapEntriesDesc(dashboard.parStatut).map(([k, n]) => (
                    <li key={k} className="flex justify-between">
                      <span>{STATUS_LABELS[k] || k}</span>
                      <span className="font-medium text-gray-900">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Par entité (département)</h3>
                <ul className="space-y-1">
                  {sortMapEntriesDesc(dashboard.parEntite).map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="truncate">{k}</span>
                      <span className="font-medium text-gray-900 shrink-0">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Par utilisateurs</h3>
                <p className="text-xs text-gray-400 mb-2">Créateurs</p>
                <ul className="space-y-1 mb-4">
                  {sortMapEntriesDesc(dashboard.parCreateur).map(([k, n]) => (
                    <li key={`c-${k}`} className="flex justify-between gap-2">
                      <span className="truncate">{k}</span>
                      <span className="font-medium text-gray-900 shrink-0">{n}</span>
                    </li>
                  ))}
                </ul>
                <p className="text-xs text-gray-400 mb-2">Chefs de projet</p>
                <ul className="space-y-1">
                  {sortMapEntriesDesc(dashboard.parChefs).map(([k, n]) => (
                    <li key={`ch-${k}`} className="flex justify-between gap-2">
                      <span className="truncate">{k}</span>
                      <span className="font-medium text-gray-900 shrink-0">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Par client</h3>
                <ul className="space-y-1">
                  {sortMapEntriesDesc(dashboard.parClient).map(([k, n]) => (
                    <li key={k} className="flex justify-between gap-2">
                      <span className="truncate">{k}</span>
                      <span className="font-medium text-gray-900 shrink-0">{n}</span>
                    </li>
                  ))}
                </ul>
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Projets en retard</h3>
                <p className="text-xs text-gray-400 mb-2">Échéance dépassée, alertes ou tâches en retard.</p>
                {dashboard.enRetard.length === 0 ? (
                  <p className="text-gray-400 italic">Aucun projet en retard dans cette liste.</p>
                ) : (
                  <ul className="space-y-2">
                    {dashboard.enRetard.map((p: any) => (
                      <li key={p.id} className="border border-amber-100 bg-amber-50/80 rounded-lg px-3 py-2">
                        <span className="font-medium text-gray-900">{p.nom}</span>
                        <span className="text-xs text-gray-600 block">
                          {STATUS_LABELS[p.statut] || p.statut}
                          {p.dateFinPrevue && ` · Fin prévue ${new Date(p.dateFinPrevue).toLocaleDateString('fr-FR')}`}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
