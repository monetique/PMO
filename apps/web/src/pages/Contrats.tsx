import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';
import axios from 'axios';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';
import { PvReunionsLieesBlock } from '../components/PvReunionsLieesBlock';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';

const uploadApi = axios.create({ baseURL: API_BASE_URL });
uploadApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

const PAGE_SIZE = 15;

const STATUTS = [
  { value: 'actif', label: '✅ Actif', color: 'bg-green-100 text-green-700' },
  { value: 'expire', label: '⏰ Expiré', color: 'bg-red-100 text-red-700' },
  { value: 'resilie', label: '❌ Résilié', color: 'bg-gray-100 text-gray-600' },
  { value: 'suspendu', label: '⏸ Suspendu', color: 'bg-yellow-100 text-yellow-700' },
];

const NIVEAUX = [
  { value: 'lecture', label: '👁 Lecture' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression' },
];

const LABEL_PERM_MODAL: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
};

const LABEL_NIVEAU_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
};

const LABEL_HISTO_CONTRAT: Record<string, string> = {
  creation: 'Création du contrat',
  modification_champs: 'Modification des champs',
  droit_ajoute: 'Droit d’accès accordé',
  droit_retire: 'Droit d’accès retiré',
  document_lie: 'Document lié',
  document_delie: 'Document retiré',
  soft_delete: 'Mise en corbeille',
  restauration: 'Restauration',
};

function joursRestants(date: string) {
  return Math.ceil((new Date(date).getTime() - Date.now()) / 86400000);
}

function niveauSummary(niveau: string) {
  if (niveau === 'lecture') return 'lecture';
  if (niveau === 'modification') return 'modification + lecture';
  if (niveau === 'suppression') return 'suppression + modification + lecture';
  return niveau;
}

function isAccesRestreintContrat(c: any) {
  const dels = c.accesApercu?.delegations?.length ?? c.permissions?.length ?? 0;
  const conf = c.documents?.some((d: any) => d.document?.estConfidentiel);
  return dels > 0 || conf || !!c.createdById;
}

function delegationsRows(c: any) {
  if (c.accesApercu?.delegations?.length) return c.accesApercu.delegations;
  return (c.permissions || []).map((p: any) => ({ id: p.id, user: p.user, niveau: p.niveau }));
}

function sortMapEntriesDesc(m: Map<string, number>) {
  return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'fr'));
}

export default function Contrats() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [contrats, setContrats] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [filtreStatut, setFiltreStatut] = useState('');
  const [filtreProjetIds, setFiltreProjetIds] = useState<string[]>([]);
  const [filtreParties, setFiltreParties] = useState<string[]>([]);
  const [filtreDateSignatureDebut, setFiltreDateSignatureDebut] = useState('');
  const [filtreDateSignatureFin, setFiltreDateSignatureFin] = useState('');
  const [filtreDateEnregDebut, setFiltreDateEnregDebut] = useState('');
  const [filtreDateEnregFin, setFiltreDateEnregFin] = useState('');
  const [filtreDateExpDebut, setFiltreDateExpDebut] = useState('');
  const [filtreDateExpFin, setFiltreDateExpFin] = useState('');
  const [filtreContratId, setFiltreContratId] = useState('');
  const [filtreCodeContrat, setFiltreCodeContrat] = useState('');
  const [filtreTypeContratIds, setFiltreTypeContratIds] = useState<string[]>([]);
  const [showFiltres, setShowFiltres] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<any[]>([]);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [tagInput, setTagInput] = useState('');

  const [accesModalContrat, setAccesModalContrat] = useState<any | null>(null);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermNiveau, setNewPermNiveau] = useState('lecture');
  /** Niveau choisi par ligne admin (section Administrateurs) avant « Limiter l'accès » */
  const [adminLimitNiveau, setAdminLimitNiveau] = useState<Record<string, string>>({});
  const [histModalContrat, setHistModalContrat] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleContrats, setCorbeilleContrats] = useState<any[]>([]);
  const [showDashboardModal, setShowDashboardModal] = useState(false);
  const [vuesPjByContrat, setVuesPjByContrat] = useState<Record<string, number>>({});
  const [dashboardVuesLoading, setDashboardVuesLoading] = useState(false);
  const [expandedContratIds, setExpandedContratIds] = useState<Set<string>>(() => new Set());
  const toggleContratRow = (id: string) => {
    setExpandedContratIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isContratRowExpanded = (id: string) => expandedContratIds.has(id);

  const [typesContrat, setTypesContrat] = useState<any[]>([]);

  const emptyForm = {
    nom: '',
    codeContrat: '',
    typeContratId: '',
    dateSignature: '',
    dateEnregistrement: '',
    dateExpiration: '',
    statut: 'actif',
    tags: [] as string[],
    projetIds: [] as string[],
    partiesPrenantes: [] as { nom: string; clientFournisseurId?: string }[],
  };
  const [form, setForm] = useState(emptyForm);
  const [ppInput, setPpInput] = useState('');
  const [ppCFId, setPpCFId] = useState('');
  const [files, setFiles] = useState<File[]>([]);

  const load = async () => {
    setLoading(true);
    try {
      const [c, u, p, cf, tc] = await Promise.all([
        api.get('/contrats'),
        api.get('/users'),
        api.get('/projets'),
        api.get('/clients-fournisseurs'),
        api.get('/types-contrat'),
      ]);
      setContrats(c.data);
      setUsers(u.data);
      setProjets(p.data);
      setClientsFournisseurs(cf.data);
      setTypesContrat(tc.data || []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    filtreStatut,
    filtreProjetIds,
    filtreParties,
    filtreDateSignatureDebut,
    filtreDateSignatureFin,
    filtreDateEnregDebut,
    filtreDateEnregFin,
    filtreDateExpDebut,
    filtreDateExpFin,
    filtreContratId,
    filtreCodeContrat,
    filtreTypeContratIds,
  ]);

  const capModify = (c: any) =>
    c.capabilities?.canModify ??
    (user?.role === 'admin' || c.createdById === user?.id || c.permissions?.some((p: any) => p.userId === user?.id && ['modification', 'suppression'].includes(p.niveau)));
  const capDelete = (c: any) =>
    c.capabilities?.canDelete ??
    (user?.role === 'admin' || c.createdById === user?.id || c.permissions?.some((p: any) => p.userId === user?.id && p.niveau === 'suppression'));
  const capManagePermissions = (c: any) => {
    if (c.capabilities?.canManagePermissions != null) return !!c.capabilities.canManagePermissions;
    return c.createdById === user?.id;
  };

  const openNew = () => {
    setEditing(null);
    setForm(emptyForm);
    setFiles([]);
    setTagInput('');
    setPpInput('');
    setPpCFId('');
    setShowForm(true);
  };

  const openEdit = (c: any) => {
    setEditing(c);
    setForm({
      nom: c.nom,
      codeContrat: c.codeContrat || '',
      typeContratId: c.typeContrat?.id || c.typeContratId || '',
      statut: c.statut,
      dateSignature: c.dateSignature ? c.dateSignature.split('T')[0] : '',
      dateEnregistrement: c.dateEnregistrement ? c.dateEnregistrement.split('T')[0] : '',
      dateExpiration: c.dateExpiration ? c.dateExpiration.split('T')[0] : '',
      tags: c.tags ? JSON.parse(c.tags) : [],
      projetIds: c.projets?.map((p: any) => p.projetId) || [],
      partiesPrenantes: c.partiesPrenantes || [],
    });
    setFiles([]);
    setTagInput('');
    setPpInput('');
    setPpCFId('');
    setShowForm(true);
  };

  const handleSave = async () => {
    if (!form.nom.trim()) return alert('Le nom est obligatoire');
    if (!editing && !form.typeContratId.trim()) return alert('Le type de contrat est obligatoire');
    const payload: Record<string, unknown> = {
      nom: form.nom,
      statut: form.statut,
      dateSignature: form.dateSignature || null,
      dateEnregistrement: form.dateEnregistrement || null,
      dateExpiration: form.dateExpiration || null,
      tags: form.tags,
      projetIds: form.projetIds,
      partiesPrenantes: form.partiesPrenantes,
      typeContratId: form.typeContratId,
    };
    if (editing) {
      payload.codeContrat = form.codeContrat.trim();
    } else if (form.codeContrat.trim()) {
      payload.codeContrat = form.codeContrat.trim();
    }
    try {
      let contratId: string;
      if (editing) {
        await api.put(`/contrats/${editing.id}`, payload);
        contratId = editing.id;
      } else {
        const res = await api.post('/contrats', payload);
        contratId = res.data.id;
      }
      if (files.length > 0) {
        for (const file of files) {
          try {
            const fd = new FormData();
            fd.append('documents', file, file.name);
            await uploadApi.post(`/contrats/${contratId}/upload`, fd);
          } catch (uploadErr: any) {
            console.warn('Upload échoué pour', file.name, uploadErr?.response?.data);
          }
        }
      }
      setShowForm(false);
      load();
    } catch (e: any) {
      alert(e.response?.data?.error || 'Erreur');
    }
  };

  const handleDelete = async (id: string, nom: string) => {
    if (!confirm(`Mettre le contrat « ${nom} » en corbeille ? (restauration possible par un administrateur)`)) return;
    try {
      await api.delete(`/contrats/${id}`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const onAccesButtonClick = (c: any) => {
    void openAccesModal(c);
  };

  const openAccesModal = async (c: any) => {
    setAccesModalContrat(c);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermNiveau('lecture');
    setAdminLimitNiveau({});
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/contrats/${c.id}/acces`);
      setAccesDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setAccesModalContrat(null);
    } finally {
      setAccesLoading(false);
    }
  };

  const refreshAccesDetail = async (contratId: string) => {
    const { data } = await api.get(`/contrats/${contratId}/acces`);
    setAccesDetail(data);
  };

  const handleAddPermission = async () => {
    if (!accesModalContrat || !newPermUserId) return;
    try {
      await api.post(`/contrats/${accesModalContrat.id}/permissions`, {
        userId: newPermUserId,
        niveau: newPermNiveau,
      });
      setNewPermUserId('');
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemovePermissionEntry = async (permissionEntryId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit sur ce contrat. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès » ci-dessous."
      : 'Retirer ce droit ?';
    if (!accesModalContrat || !window.confirm(msg)) return;
    try {
      await api.delete(`/contrats/${accesModalContrat.id}/permissions/entry/${permissionEntryId}`);
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitAccess = async (userId: string) => {
    if (!accesModalContrat) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus le contrat tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    )
      return;
    try {
      await api.post(`/contrats/${accesModalContrat.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultAccess = async (userId: string) => {
    if (!accesModalContrat) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/contrats/${accesModalContrat.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const patchPermissionLevel = async (targetUserId: string, niveau: string) => {
    if (!accesModalContrat) return;
    try {
      await api.post(`/contrats/${accesModalContrat.id}/permissions`, { userId: targetUserId, niveau });
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const quickLimitAdminAccess = async (adminId: string) => {
    if (!accesModalContrat) return;
    const niveau = adminLimitNiveau[adminId] || 'lecture';
    try {
      await api.post(`/contrats/${accesModalContrat.id}/permissions`, { userId: adminId, niveau });
      await refreshAccesDetail(accesModalContrat.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openHistoriqueModal = async (c: any) => {
    setHistModalContrat(c);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/contrats/${c.id}/historique`);
      setHistoList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement historique');
      setHistModalContrat(null);
    } finally {
      setHistoLoading(false);
    }
  };

  const handleRemoveDoc = async (contratId: string, documentId: string) => {
    try {
      await api.delete(`/contrats/${contratId}/documents/${documentId}`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const loadCorbeilleContrats = async () => {
    try {
      const r = await api.get('/contrats/corbeille');
      setCorbeilleContrats(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleContrats([]);
    }
  };

  const handleRestoreContratFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/contrats/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestoreContratCorbeille = (row: any) =>
    user?.role === 'admin' || row.createdById === user?.id || row.createdBy?.id === user?.id;

  const openDashboardModal = async () => {
    setShowDashboardModal(true);
    setDashboardVuesLoading(true);
    try {
      const { data } = await api.get<Record<string, number>>('/contrats/stats-vues-pj');
      setVuesPjByContrat(data && typeof data === 'object' ? data : {});
    } catch {
      setVuesPjByContrat({});
    } finally {
      setDashboardVuesLoading(false);
    }
  };

  const filtered = contrats.filter((c) => {
    const idNeedle = filtreContratId.trim().toLowerCase();
    const matchId = !idNeedle || String(c.id).toLowerCase().includes(idNeedle);
    const codeFilt = filtreCodeContrat.trim().toLowerCase();
    const matchCodeFilt =
      !codeFilt || (c.codeContrat && String(c.codeContrat).toLowerCase().includes(codeFilt));
    const tid = c.typeContrat?.id || c.typeContratId;
    const matchTypeFilt =
      filtreTypeContratIds.length === 0 || (tid && filtreTypeContratIds.includes(tid));
    const q = search.toLowerCase();
    const matchSearch =
      !q ||
      c.nom.toLowerCase().includes(q) ||
      (c.codeContrat && String(c.codeContrat).toLowerCase().includes(q));
    const matchStatut = !filtreStatut || c.statut === filtreStatut;
    const matchProjets = filtreProjetIds.length === 0 || c.projets?.some((p: any) => filtreProjetIds.includes(p.projetId || p.id));
    const matchParties = filtreParties.length === 0 || filtreParties.some((fp) =>
      c.partiesPrenantes?.some((p: any) => p.clientFournisseurId === fp || p.id === fp)
    );
    const dateSign = c.dateSignature ? new Date(c.dateSignature) : null;
    const matchSignDebut = !filtreDateSignatureDebut || (dateSign && dateSign >= new Date(filtreDateSignatureDebut));
    const matchSignFin = !filtreDateSignatureFin || (dateSign && dateSign <= new Date(filtreDateSignatureFin));
    const dateEnreg = c.dateEnregistrement ? new Date(c.dateEnregistrement) : null;
    const matchEnregDebut = !filtreDateEnregDebut || (dateEnreg && dateEnreg >= new Date(filtreDateEnregDebut));
    const matchEnregFin = !filtreDateEnregFin || (dateEnreg && dateEnreg <= new Date(filtreDateEnregFin));
    const dateExp = c.dateExpiration ? new Date(c.dateExpiration) : null;
    const matchExpDebut = !filtreDateExpDebut || (dateExp && dateExp >= new Date(filtreDateExpDebut));
    const matchExpFin = !filtreDateExpFin || (dateExp && dateExp <= new Date(filtreDateExpFin));
    return (
      matchId &&
      matchCodeFilt &&
      matchTypeFilt &&
      matchSearch &&
      matchStatut &&
      matchProjets &&
      matchParties &&
      matchSignDebut &&
      matchSignFin &&
      matchEnregDebut &&
      matchEnregFin &&
      matchExpDebut &&
      matchExpFin
    );
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const pageSlice = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const dashboard = useMemo(() => {
    const parStatut = new Map<string, number>();
    for (const c of filtered) {
      parStatut.set(c.statut, (parStatut.get(c.statut) || 0) + 1);
    }
    const plusVus = [...filtered]
      .map((c) => ({
        id: c.id,
        nom: c.nom,
        statut: c.statut,
        vues: vuesPjByContrat[c.id] ?? 0,
        nbDocs: c.documents?.length ?? 0,
      }))
      .sort((a, b) => b.vues - a.vues || a.nom.localeCompare(b.nom, 'fr'))
      .slice(0, 15);
    return { total: filtered.length, parStatut, plusVus };
  }, [filtered, vuesPjByContrat]);

  const alertes = contrats.filter((c) => c.dateExpiration && joursRestants(c.dateExpiration) <= 30 && joursRestants(c.dateExpiration) > 0);

  const droitsAdminLigne = 'droits étendus — gestion des accès partagés réservée au créateur du contrat';

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Contrats</h1>
          <p className="text-sm text-gray-500 mt-1">
            {filtered.length} contrat(s) sur {contrats.length} accessible(s)
          </p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleContrats();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          <button
            type="button"
            onClick={() => void openDashboardModal()}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            📊 Dashboard
          </button>
          <button
            type="button"
            onClick={openNew}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
          >
            + Nouveau contrat
          </button>
        </div>
      </div>

      {alertes.length > 0 && (
        <div className="mb-6 p-3 bg-orange-50 border border-orange-200 rounded-lg">
          <p className="text-sm font-medium text-orange-700 mb-1">⚠️ Contrats expirant bientôt :</p>
          <div className="flex flex-wrap gap-2">
            {alertes.map((c) => (
              <span key={c.id} className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">
                {c.nom} — dans {joursRestants(c.dateExpiration)} jour(s)
              </span>
            ))}
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow mb-6">
        <button
          type="button"
          onClick={() => setShowFiltres(!showFiltres)}
          className="w-full px-4 py-3 flex justify-between items-center text-left text-sm font-medium text-gray-700 hover:bg-gray-50 rounded-t-lg"
        >
          <span>
            Filtres
            {(filtreStatut ||
              filtreProjetIds.length > 0 ||
              filtreParties.length > 0 ||
              filtreTypeContratIds.length > 0 ||
              filtreDateSignatureDebut ||
              filtreDateSignatureFin ||
              filtreDateEnregDebut ||
              filtreDateEnregFin ||
              filtreDateExpDebut ||
              filtreDateExpFin ||
              search ||
              filtreContratId.trim() ||
              filtreCodeContrat.trim())
              ? ' ●'
              : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom, code ou texte libre</label>
                <input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Nom du contrat ou extrait de code…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Code contrat</label>
                <input
                  value={filtreCodeContrat}
                  onChange={(e) => setFiltreCodeContrat(e.target.value)}
                  placeholder="Contient…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ID technique (UUID)</label>
                <input
                  value={filtreContratId}
                  onChange={(e) => setFiltreContratId(e.target.value)}
                  placeholder="Extrait d’UUID…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  autoComplete="off"
                />
              </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
              <select value={filtreStatut} onChange={(e) => setFiltreStatut(e.target.value)} className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm">
                <option value="">Tous les statuts</option>
                {STATUTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Projets liés</label>
              <div className="border border-gray-300 rounded-md max-h-28 overflow-y-auto p-2 space-y-1 bg-white">
                {projets.length === 0 && <span className="text-xs text-gray-400">Aucun projet</span>}
                {projets.map((p: any) => (
                  <label key={p.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={filtreProjetIds.includes(p.id)} onChange={(e) => setFiltreProjetIds(e.target.checked ? [...filtreProjetIds, p.id] : filtreProjetIds.filter((id) => id !== p.id))} className="rounded" />
                    {p.nom}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Parties prenantes</label>
              <div className="border border-gray-300 rounded-md max-h-28 overflow-y-auto p-2 space-y-1 bg-white">
                {clientsFournisseurs.length === 0 && <span className="text-xs text-gray-400">Aucune partie</span>}
                {clientsFournisseurs.map((cf: any) => (
                  <label key={cf.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input type="checkbox" checked={filtreParties.includes(cf.id)} onChange={(e) => setFiltreParties(e.target.checked ? [...filtreParties, cf.id] : filtreParties.filter((id) => id !== cf.id))} className="rounded" />
                    {cf.nom}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Types de contrat</label>
              <div className="border border-gray-300 rounded-md max-h-28 overflow-y-auto p-2 space-y-1 bg-white">
                {typesContrat.length === 0 && <span className="text-xs text-gray-400">Aucun type (Configuration)</span>}
                {typesContrat.map((tc: any) => (
                  <label key={tc.id} className="flex items-center gap-2 text-xs cursor-pointer hover:bg-gray-50 px-1 py-0.5 rounded">
                    <input
                      type="checkbox"
                      checked={filtreTypeContratIds.includes(tc.id)}
                      onChange={(e) =>
                        setFiltreTypeContratIds(
                          e.target.checked
                            ? [...filtreTypeContratIds, tc.id]
                            : filtreTypeContratIds.filter((id) => id !== tc.id)
                        )
                      }
                      className="rounded"
                    />
                    <span className="font-mono text-[11px]">{tc.code}</span>
                    <span>{tc.libelle}</span>
                  </label>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date de signature</label>
              <div className="flex gap-2">
                <input type="date" value={filtreDateSignatureDebut} onChange={(e) => setFiltreDateSignatureDebut(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
                <input type="date" value={filtreDateSignatureFin} onChange={(e) => setFiltreDateSignatureFin(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date d&apos;enregistrement</label>
              <div className="flex gap-2">
                <input type="date" value={filtreDateEnregDebut} onChange={(e) => setFiltreDateEnregDebut(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
                <input type="date" value={filtreDateEnregFin} onChange={(e) => setFiltreDateEnregFin(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date d&apos;expiration</label>
              <div className="flex gap-2">
                <input type="date" value={filtreDateExpDebut} onChange={(e) => setFiltreDateExpDebut(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
                <input type="date" value={filtreDateExpFin} onChange={(e) => setFiltreDateExpFin(e.target.value)} className="flex-1 px-2 py-1.5 border border-gray-300 rounded-md text-xs" />
              </div>
            </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFiltreStatut('');
                  setFiltreProjetIds([]);
                  setFiltreParties([]);
                  setFiltreDateSignatureDebut('');
                  setFiltreDateSignatureFin('');
                  setFiltreDateEnregDebut('');
                  setFiltreDateEnregFin('');
                  setFiltreDateExpDebut('');
                  setFiltreDateExpFin('');
                  setFiltreContratId('');
                  setFiltreCodeContrat('');
                  setFiltreTypeContratIds([]);
                }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {loading ? <div className="text-center py-10 text-gray-400">Chargement...</div> : (
        <>
          <div className="space-y-4">
            {filtered.length === 0 && <div className="text-center py-10 text-gray-400">Aucun contrat trouvé</div>}
            {pageSlice.map((c) => {
              const statut = STATUTS.find((s) => s.value === c.statut);
              const jours = c.dateExpiration ? joursRestants(c.dateExpiration) : null;
              const tags = c.tags ? JSON.parse(c.tags) : [];
              const rows = delegationsRows(c);
              const rowOpen = isContratRowExpanded(c.id);
              return (
                <div key={c.id} className="bg-white rounded-lg shadow overflow-hidden">
                  <button
                    type="button"
                    onClick={() => toggleContratRow(c.id)}
                    className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                    aria-expanded={rowOpen}
                    aria-label={rowOpen ? 'Replier le détail du contrat' : 'Afficher le détail et les actions du contrat'}
                  >
                    <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${statut?.color}`}>{statut?.label}</span>
                    {c.codeContrat && (
                      <span
                        className="px-2 py-0.5 rounded text-xs font-mono bg-slate-100 text-slate-800 shrink-0 max-w-[14rem] truncate"
                        title={c.codeContrat}
                      >
                        {c.codeContrat}
                      </span>
                    )}
                    <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{c.nom}</h2>
                    <span
                      className="text-[11px] text-gray-400 font-mono shrink-0 max-w-[7rem] sm:max-w-[10rem] truncate"
                      title={c.id}
                    >
                      {c.id}
                    </span>
                    <span className="text-sm text-gray-500 font-mono shrink-0 hidden md:inline">
                      {c.dateExpiration ? new Date(c.dateExpiration).toLocaleDateString('fr-FR') : '—'}
                    </span>
                    {rowOpen && (
                      <span className="text-gray-400 shrink-0 ml-auto" aria-hidden>
                        ▼
                      </span>
                    )}
                  </button>

                  {rowOpen && (
                    <div className="px-4 sm:px-5 pb-4 pt-0 border-t border-gray-100">
                      <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4 pt-3">
                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-center gap-2 flex-wrap">
                            {jours !== null && jours <= 30 && jours > 0 && (
                              <span className="px-2 py-0.5 bg-orange-100 text-orange-700 rounded text-xs">⚠️ Expire dans {jours}j</span>
                            )}
                            {jours !== null && jours <= 0 && (
                              <span className="px-2 py-0.5 bg-red-100 text-red-700 rounded text-xs">🔴 Expiré</span>
                            )}
                          </div>
                      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                        {c.codeContrat && (
                          <div className="col-span-2 lg:col-span-4">
                            <span className="font-medium">Code contrat : </span>
                            <span className="font-mono text-xs">{c.codeContrat}</span>
                          </div>
                        )}
                        {c.typeContrat && (
                          <div className="col-span-2 lg:col-span-2">
                            <span className="font-medium">Type : </span>
                            <span>
                              {c.typeContrat.libelle}{' '}
                              <span className="text-gray-500 font-mono text-xs">({c.typeContrat.code})</span>
                            </span>
                          </div>
                        )}
                        <div className="col-span-2 lg:col-span-4">
                          <span className="font-medium">ID : </span>
                          <span className="font-mono text-xs break-all">{c.id}</span>
                        </div>
                        {c.dateSignature && <div><span className="font-medium">Signature : </span>{new Date(c.dateSignature).toLocaleDateString('fr-FR')}</div>}
                        {c.dateEnregistrement && <div><span className="font-medium">Enregistrement : </span>{new Date(c.dateEnregistrement).toLocaleDateString('fr-FR')}</div>}
                        {c.dateExpiration && <div><span className="font-medium">Expiration : </span>{new Date(c.dateExpiration).toLocaleDateString('fr-FR')}</div>}
                        <div><span className="font-medium">Créé par : </span>{c.createdBy?.prenom} {c.createdBy?.nom}</div>
                      </div>
                      {tags.length > 0 && <div className="flex flex-wrap gap-1 mt-2">{tags.map((t: string) => <span key={t} className="px-2 py-0.5 bg-blue-50 text-blue-600 rounded text-xs">🏷 {t}</span>)}</div>}
                      {c.partiesPrenantes?.length > 0 && (
                        <div className="mt-2">
                          <span className="text-xs font-medium text-gray-500 uppercase">Parties prenantes : </span>
                          <span className="text-sm text-gray-700">{c.partiesPrenantes.map((p: any) => p.nom).join(', ')}</span>
                        </div>
                      )}
                      {c.projets?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-2">
                          {c.projets.map((p: any) => (
                            <span key={p.id} role="button" tabIndex={0} onClick={() => navigate(`/projets/${p.projet?.id}`)} onKeyDown={(e) => e.key === 'Enter' && navigate(`/projets/${p.projet?.id}`)} className="cursor-pointer px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs hover:bg-purple-200">📁 {p.projet?.nom}</span>
                          ))}
                        </div>
                      )}
                      {c.documents?.length > 0 && (
                        <div className="mt-2">
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Documents :</p>
                          <div className="flex flex-wrap gap-1">
                            {c.documents.map((d: any) => (
                              <div key={d.id} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs">
                                <a href={`${API_BASE_URL}/documents/${d.document?.id}/view?token=${localStorage.getItem('token')}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">📎 {d.document?.nom}</a>
                                {capModify(c) && <button type="button" onClick={() => handleRemoveDoc(c.id, d.documentId)} className="text-red-400 hover:text-red-600 ml-1">✕</button>}
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                        <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                          {isAccesRestreintContrat(c) ? (
                            <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                              <span className="text-sm leading-none" aria-hidden>🔒</span>
                              <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                            </div>
                          ) : (
                            <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                              <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                            </div>
                          )}
                          <AccessContratLikeAdminLines
                            keyPrefix={c.id}
                            users={users}
                            createdById={c.createdById}
                            createdBy={c.createdBy}
                            adminSansAccesUserIds={
                              c.adminSansAccesUserIds ??
                              (c.adminSansAcces || []).map((x: { userId: string }) => x.userId)
                            }
                            permissions={(c.permissions || []).map((p: any) => ({
                              userId: p.userId,
                              niveau: p.niveau,
                              user: p.user,
                            }))}
                            droitsAdminCompletLabel={droitsAdminLigne}
                            niveauLabel={(n) => NIVEAUX.find((x) => x.value === n)?.label || n}
                          />
                          {rows.map((d: any) => (
                            <div key={d.id} className="min-w-0">
                              <span className="font-medium text-gray-900">{d.user.prenom} {d.user.nom}</span>
                              <span className="text-gray-500 italic block sm:inline sm:ml-1">
                                {d.niveau === 'lecture' ? (
                                  <>👁 ({NIVEAUX.find((n) => n.value === d.niveau)?.label} : {LABEL_NIVEAU_ROW[d.niveau] || d.niveau})</>
                                ) : (
                                  <> ({NIVEAUX.find((n) => n.value === d.niveau)?.label} : {niveauSummary(d.niveau)})</>
                                )}
                              </span>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="mt-3 pt-3 border-t border-gray-100">
                        <PvReunionsLieesBlock apiPath={`/contrats/${c.id}/pv-reunions`} />
                      </div>
                        </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                      {capModify(c) && <button type="button" onClick={() => openEdit(c)} className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">✏️ Modifier Contrat</button>}
                      <button type="button" onClick={() => onAccesButtonClick(c)} className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200">🔐 Accès</button>
                      <button type="button" onClick={() => openHistoriqueModal(c)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200">📜 Historique</button>
                      {capDelete(c) && <button type="button" onClick={() => handleDelete(c.id, c.nom)} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">🗑 Mettre en corbeille</button>}
                    </div>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {filtered.length > PAGE_SIZE && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
              <div className="text-sm text-gray-700">
                Affichage {startIdx + 1}-{Math.min(startIdx + PAGE_SIZE, filtered.length)} sur {filtered.length}
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={safePage === 1}
                  className={`px-4 py-2 rounded text-sm font-medium ${safePage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'}`}
                >
                  Précédent
                </button>
                <div className="flex gap-1 flex-wrap items-center">
                  {getPaginationPageNumbers(safePage, totalPages).map((p, idx) =>
                    typeof p === 'string' ? (
                      <span key={`ellipsis-${idx}`} className="px-2 text-gray-500">
                        {p}
                      </span>
                    ) : (
                      <button
                        key={p}
                        type="button"
                        onClick={() => setPage(p)}
                        className={`px-3 py-2 rounded text-sm font-medium ${safePage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
                      >
                        {p}
                      </button>
                    )
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
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

      {showForm && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? '✏️ Modifier le contrat' : '+ Nouveau contrat'}</h3>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom du contrat *</label>
                <input value={form.nom} onChange={(e) => setForm({ ...form, nom: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" placeholder="Ex: Contrat de prestation ABC" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de contrat *</label>
                <select
                  value={form.typeContratId}
                  onChange={(e) => setForm({ ...form, typeContratId: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                  required
                >
                  <option value="">— Choisir —</option>
                  {typesContrat.map((tc: any) => (
                    <option key={tc.id} value={tc.id}>
                      {tc.code} — {tc.libelle}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-gray-500 mt-1">
                  Définissez les types dans <strong>Configuration → Types de contrat</strong>.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Code contrat</label>
                <input
                  value={form.codeContrat}
                  onChange={(e) => setForm({ ...form, codeContrat: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm font-mono"
                  placeholder={
                    editing
                      ? 'Code unique du contrat'
                      : 'Optionnel — laisser vide pour génération automatique'
                  }
                />
                {!editing && (
                  <p className="text-xs text-gray-500 mt-1">
                    Si vide : format{' '}
                    <code className="bg-gray-100 px-1 rounded text-[11px]">[TYPE]-[ANNÉE]-[CLIENT]-[SÉQ]</code> selon le
                    type, les dates et la première partie prenante liée à un client/fournisseur (sinon « NA » pour le
                    segment client).
                  </p>
                )}
                {editing && (
                  <p className="text-xs text-gray-500 mt-1">Modifiable par le créateur ou un utilisateur avec droit de modification.</p>
                )}
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                  <select value={form.statut} onChange={(e) => setForm({ ...form, statut: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                    {STATUTS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date de signature</label>
                  <input type="date" value={form.dateSignature} onChange={(e) => setForm({ ...form, dateSignature: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d&apos;enregistrement</label>
                  <input type="date" value={form.dateEnregistrement} onChange={(e) => setForm({ ...form, dateEnregistrement: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date d&apos;expiration</label>
                  <input type="date" value={form.dateExpiration} onChange={(e) => setForm({ ...form, dateExpiration: e.target.value })} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Parties prenantes</label>
                {form.partiesPrenantes.map((pp, i) => (
                  <div key={i} className="flex items-center gap-2 mb-1">
                    <span className="px-2 py-0.5 bg-teal-100 text-teal-700 rounded text-xs">{pp.nom}</span>
                    <button type="button" onClick={() => setForm({ ...form, partiesPrenantes: form.partiesPrenantes.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                  </div>
                ))}
                <div className="flex gap-2 mt-1">
                  <select value={ppCFId} onChange={(e) => { setPpCFId(e.target.value); if (e.target.value) { const cf = clientsFournisseurs.find((x: any) => x.id === e.target.value); if (cf) setPpInput(cf.nom); } }} className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm">
                    <option value="">— Depuis la liste CF —</option>
                    {clientsFournisseurs.map((cf: any) => <option key={cf.id} value={cf.id}>{cf.nom}</option>)}
                  </select>
                  <input value={ppInput} onChange={(e) => { setPpInput(e.target.value); setPpCFId(''); }} placeholder="ou saisir manuellement" className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
                  <button type="button" onClick={() => { if (!ppInput.trim()) return; setForm({ ...form, partiesPrenantes: [...form.partiesPrenantes, { nom: ppInput.trim(), clientFournisseurId: ppCFId || undefined }] }); setPpInput(''); setPpCFId(''); }} className="px-3 py-1 bg-teal-600 text-white rounded text-sm">+</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Tags / Mots-clés</label>
                <div className="flex flex-wrap gap-1 mb-1">
                  {form.tags.map((t, i) => (
                    <span key={i} className="flex items-center gap-1 px-2 py-0.5 bg-blue-100 text-blue-700 rounded text-xs">
                      {t} <button type="button" onClick={() => setForm({ ...form, tags: form.tags.filter((_, j) => j !== i) })} className="text-red-400 hover:text-red-600">✕</button>
                    </span>
                  ))}
                </div>
                <div className="flex gap-2">
                  <input value={tagInput} onChange={(e) => setTagInput(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && tagInput.trim()) { setForm({ ...form, tags: [...form.tags, tagInput.trim()] }); setTagInput(''); e.preventDefault(); } }} placeholder="Ajouter un tag et appuyer Entrée" className="flex-1 border border-gray-300 rounded px-2 py-1 text-sm" />
                  <button type="button" onClick={() => { if (tagInput.trim()) { setForm({ ...form, tags: [...form.tags, tagInput.trim()] }); setTagInput(''); } }} className="px-3 py-1 bg-blue-600 text-white rounded text-sm">+</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Projets liés</label>
                {form.projetIds.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {form.projetIds.map((pid) => {
                      const p = projets.find((pr: any) => pr.id === pid);
                      return p ? (
                        <div key={pid} className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                          📁 {p.nom} <button type="button" onClick={() => setForm({ ...form, projetIds: form.projetIds.filter((id) => id !== pid) })} className="text-red-400 hover:text-red-600">✕</button>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
                <select onChange={(e) => { if (e.target.value && !form.projetIds.includes(e.target.value)) setForm({ ...form, projetIds: [...form.projetIds, e.target.value] }); e.target.value = ''; }} className="w-full border border-gray-300 rounded px-2 py-1 text-sm">
                  <option value="">— Ajouter un projet —</option>
                  {projets.filter((p: any) => !form.projetIds.includes(p.id)).map((p: any) => <option key={p.id} value={p.id}>{p.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Documents joints</label>
                {editing && editing.documents?.length > 0 && (
                  <div className="flex flex-wrap gap-1 mb-2">
                    {editing.documents.map((d: any) => (
                      <div key={d.id} className="flex items-center gap-1 px-2 py-0.5 bg-gray-100 rounded text-xs">
                        <a href={`${API_BASE_URL}/documents/${d.document?.id}/view?token=${localStorage.getItem('token')}`} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline">📎 {d.document?.nom}</a>
                        <button type="button" onClick={async () => { try { await api.delete(`/contrats/${editing.id}/documents/${d.documentId}`); setEditing({ ...editing, documents: editing.documents.filter((x: any) => x.id !== d.id) }); } catch (err: any) { alert(err?.response?.data?.error || err?.message); } }} className="text-red-400 hover:text-red-600 ml-1">✕</button>
                      </div>
                    ))}
                  </div>
                )}
                <input type="file" multiple onChange={(e) => setFiles(Array.from(e.target.files || []))} className="w-full text-sm text-gray-600 border border-gray-200 rounded p-1" />
                {files.length > 0 && <p className="text-xs text-gray-500 mt-1">📎 {files.length} fichier(s) sélectionné(s)</p>}
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-5">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Annuler</button>
              <button type="button" onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {accesModalContrat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {accesModalContrat.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              <span className="font-medium">Seul le créateur du contrat</span> peut gérer les accès. Pour un administrateur :
              sans ligne dans « Accès partagés » et sans exclusion, il a un accès complet ; une ligne dans « Accès partagés »
              limite ses droits ; « Retirer l&apos;accès » le prive totalement du contrat jusqu&apos;à ce qu&apos;un accès lui
              soit accordé via « Accorder un accès ». « Rétablir l&apos;accès admin par défaut » annule une exclusion et
              restaure l&apos;accès complet implicite (sans ligne).
            </p>
            {accesDetail && !accesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur du
                contrat.
              </p>
            )}
            {accesLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : accesDetail ? (
              <div className="space-y-5 text-sm">
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
                  <p className="text-xs text-gray-500 mb-2">
                    Limitez un admin avec « Limiter l&apos;accès », retirez-le entièrement avec « Retirer l&apos;accès », ou
                    rétablissez l&apos;accès complet implicite s&apos;il était exclu.
                  </p>
                  <ul className="space-y-3 text-gray-700 text-sm">
                    {(accesDetail.admins || []).map((a: any) => {
                      const delegation = (accesDetail.delegations || []).find((d: any) => d.user?.id === a.id);
                      const explicite = !!delegation;
                      const isCreatorAdmin = accesDetail.creator?.id === a.id;
                      const refuse = (accesDetail.adminSansAccesUserIds || []).includes(a.id);
                      return (
                        <li
                          key={a.id}
                          className="flex flex-col sm:flex-row sm:flex-wrap sm:items-center gap-2 border border-gray-100 rounded-lg px-3 py-2 bg-white"
                        >
                          <div className="min-w-0 flex-1">
                            <span className="font-medium text-base">
                              {a.prenom} {a.nom}
                            </span>
                            <span className="text-gray-500 ml-1">({a.email})</span>
                            {refuse && !explicite && (
                              <span className="text-red-700 block sm:inline sm:ml-1 text-xs font-medium">
                                — aucun accès (exclu ; accorder un accès via la liste ci-dessous pour le réintégrer)
                              </span>
                            )}
                            {!refuse && !explicite && (
                              <span className="text-gray-400 block sm:inline sm:ml-1">
                                — accès complet (défaut administrateur)
                              </span>
                            )}
                            {explicite && (
                              <span className="text-amber-800 block sm:inline sm:ml-1 text-xs font-medium">
                                — accès limité (ligne « Accès partagés »)
                              </span>
                            )}
                          </div>
                          {accesDetail.canManagePermissions && !isCreatorAdmin && (
                            <div className="flex flex-wrap items-center gap-2 shrink-0">
                              {refuse && !explicite ? (
                                <button
                                  type="button"
                                  onClick={() => handleRestoreAdminDefaultAccess(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={adminLimitNiveau[a.id] ?? 'lecture'}
                                    onChange={(e) =>
                                      setAdminLimitNiveau((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {NIVEAUX.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => quickLimitAdminAccess(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l’accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => handleRevokeAdminImplicitAccess(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={delegation.permission}
                                    onChange={async (e) => {
                                      const niveau = e.target.value;
                                      if (!accesModalContrat || niveau === delegation.permission) return;
                                      await patchPermissionLevel(a.id, niveau);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {NIVEAUX.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => handleRemovePermissionEntry(delegation.id, true)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Révoquer l&apos;accès
                                  </button>
                                </>
                              )}
                            </div>
                          )}
                          {accesDetail.canManagePermissions && isCreatorAdmin && (
                            <span className="text-xs text-gray-500">Créateur : accès complet, non modérable ici.</span>
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
                      <span className="font-medium">{accesDetail.creator.prenom} {accesDetail.creator.nom}</span>
                      <span className="text-gray-400">
                        {' '}
                        — seul habilité à gérer les accès partagés ; modification et mise en corbeille selon ses autres
                        droits sur le contrat
                      </span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm">Créateur non résolu.</p>
                  )}
                </div>
                <div>
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
                  {(accesDetail.delegations || []).length === 0 ? (
                    <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
                  ) : (
                    <ul className="space-y-2">
                      {(accesDetail.delegations || []).map((d: any) => (
                        <li
                          key={d.id}
                          className="flex flex-wrap items-center gap-2 border border-gray-100 rounded-md px-3 py-2 bg-gray-50"
                        >
                          <span className="font-medium">
                            {d.user.prenom} {d.user.nom}
                            {d.user.role === 'admin' && (
                              <span className="text-xs font-normal text-gray-500 ml-1">(admin)</span>
                            )}
                          </span>
                          {accesDetail.canManagePermissions ? (
                            <>
                              <select
                                value={d.permission}
                                onChange={async (e) => {
                                  const niveau = e.target.value;
                                  if (!accesModalContrat || niveau === d.permission) return;
                                  await patchPermissionLevel(d.user.id, niveau);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {NIVEAUX.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => handleRemovePermissionEntry(d.id, d.user?.role === 'admin')}
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">
                              — {LABEL_PERM_MODAL[d.permission] || d.permission}
                            </span>
                          )}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
                {accesDetail.canManagePermissions && (
                  <div className="border-t border-gray-200 pt-4 space-y-3">
                    <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                    <div className="grid grid-cols-1 lg:grid-cols-[1fr_auto_auto] gap-3 items-end">
                      <select value={newPermUserId} onChange={(e) => setNewPermUserId(e.target.value)} className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm">
                        <option value="">— Utilisateur —</option>
                        {(() => {
                          const actifs = users.filter(
                            (u: any) => (!u.statut || u.statut === 'actif') && u.id !== accesDetail.creator?.id
                          );
                          const adminsPick = actifs.filter((u: any) => u.role === 'admin');
                          const autresPick = actifs.filter((u: any) => u.role !== 'admin');
                          return (
                            <>
                              {adminsPick.length > 0 && (
                                <optgroup label="Administrateurs (modifiables par le créateur)">
                                  {adminsPick.map((u: any) => (
                                    <option key={u.id} value={u.id}>
                                      {u.prenom} {u.nom} — {u.email}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                              {autresPick.length > 0 && (
                                <optgroup label="Autres utilisateurs">
                                  {autresPick.map((u: any) => (
                                    <option key={u.id} value={u.id}>
                                      {u.prenom} {u.nom} — {u.email}
                                    </option>
                                  ))}
                                </optgroup>
                              )}
                            </>
                          );
                        })()}
                      </select>
                      <select value={newPermNiveau} onChange={(e) => setNewPermNiveau(e.target.value)} className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm">
                        {NIVEAUX.map((n) => <option key={n.value} value={n.value}>{n.label}</option>)}
                      </select>
                      <button type="button" onClick={handleAddPermission} disabled={!newPermUserId} className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0">Ajouter</button>
                    </div>
                  </div>
                )}
              </div>
            ) : null}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setAccesModalContrat(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {histModalContrat && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalContrat.nom}</h3>
            {histoLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : histoList.length === 0 ? (
              <p className="text-sm text-gray-400 italic">Aucun événement enregistré</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {histoList.map((h: any) => (
                  <li key={h.id} className="border-b border-gray-100 pb-2">
                    <div className="flex flex-wrap justify-between gap-1 text-xs text-gray-500">
                      <span>{new Date(h.createdAt).toLocaleString('fr-FR')}</span>
                      <span>{h.user?.prenom} {h.user?.nom}</span>
                    </div>
                    <p className="font-medium text-gray-800">{LABEL_HISTO_CONTRAT[h.typeEvenement] || h.typeEvenement}</p>
                    {h.libelle && <p className="text-gray-600 text-xs mt-0.5">{h.libelle}</p>}
                    {h.details && typeof h.details === 'object' && (
                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto max-h-32">{JSON.stringify(h.details, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setHistModalContrat(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Contrats en corbeille</h2>
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
              {corbeilleContrats.length === 0 && <p className="text-sm text-gray-500">Aucun contrat en corbeille.</p>}
              {corbeilleContrats.map((cc: any) => (
                <div key={cc.id} className="flex flex-wrap justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{cc.nom}</p>
                    <p className="text-xs text-gray-500">
                      Mis en corbeille le {cc.deletedAt ? new Date(cc.deletedAt).toLocaleString('fr-FR') : '—'}
                      {cc.createdBy && ` · Créé par ${cc.createdBy.prenom} ${cc.createdBy.nom}`}
                    </p>
                  </div>
                  {canRestoreContratCorbeille(cc) ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreContratFromCorbeille(cc.id)}
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
                <h2 className="text-lg font-semibold">📊 Dashboard contrats</h2>
                <p className="text-xs text-gray-500 mt-1">
                  Données basées sur les {dashboard.total} contrat(s) actuellement listés (mêmes filtres que la page). Les vues
                  comptabilisent les consultations (journal) des pièces jointes liées à chaque contrat.
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
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Total</h3>
                <p className="text-2xl font-bold text-gray-900">{dashboard.total}</p>
                {dashboardVuesLoading && (
                  <p className="text-xs text-gray-400 mt-2">Chargement des statistiques de vues…</p>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Par statut</h3>
                {dashboard.total === 0 ? (
                  <p className="text-gray-400 italic">Aucun contrat dans la liste filtrée</p>
                ) : (
                  <ul className="space-y-1">
                    {sortMapEntriesDesc(dashboard.parStatut).map(([k, n]) => (
                      <li key={k} className="flex justify-between">
                        <span>{STATUTS.find((s) => s.value === k)?.label || k}</span>
                        <span className="font-medium text-gray-900">{n}</span>
                      </li>
                    ))}
                  </ul>
                )}
              </section>

              <section>
                <h3 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                  Contrats les plus consultés (pièces jointes)
                </h3>
                <p className="text-xs text-gray-400 mb-2">
                  Somme des vues enregistrées pour tous les documents liés au contrat (top 15 de la liste filtrée).
                </p>
                {dashboard.plusVus.length === 0 ? (
                  <p className="text-gray-400 italic">Aucun contrat dans la liste filtrée</p>
                ) : (
                  <ul className="space-y-1.5">
                    {dashboard.plusVus.map((row, i) => (
                      <li key={row.id} className="flex flex-wrap justify-between gap-2 border-b border-gray-100 pb-1">
                        <span>
                          <span className="text-gray-400 mr-2">{i + 1}.</span>
                          <span className="font-medium text-gray-900">{row.nom}</span>
                          <span className="text-gray-500 text-xs ml-2">
                            {STATUTS.find((s) => s.value === row.statut)?.label || row.statut}
                            {row.nbDocs > 0 ? ` · ${row.nbDocs} pièce(s) jointe(s)` : ' · sans pièce jointe'}
                          </span>
                        </span>
                        <span className="text-sm font-bold text-blue-600 shrink-0">
                          {row.vues} vue{row.vues !== 1 ? 's' : ''}
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
