import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';
import axios from 'axios';
import { useAuth } from '../store/auth';
import { canModifyModule } from '../utils/uiModuleRoute';
import { getPaginationPageNumbers } from '../utils/pagination';
import { PvReunionAccesModal } from '../components/PvReunionAccesModal';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { buildStructuredPvHtml } from '../utils/pv-reunion-html-template';
import { htmlElementToPdfBlob } from '../utils/pv-reunion-pdf-preview';

const PAGE_SIZE = 15;

const PV_NOUVEAU_DRAFT_LS = 'pmo-hub-pv-reunion-nouveau-draft-v1';

const PV_STATUTS = [
  { value: 'brouillon', label: 'Brouillon', color: 'bg-gray-100 text-gray-800' },
  { value: 'en_revision', label: 'En révision', color: 'bg-amber-100 text-amber-900' },
  { value: 'valide', label: 'Validé', color: 'bg-green-100 text-green-800' },
  { value: 'archive', label: 'Archivé', color: 'bg-slate-200 text-slate-700' },
];

function usLabel(us: { description?: string; id?: string }) {
  const d = String(us?.description || '').trim();
  if (!d) return us?.id || '—';
  return d.length > 72 ? `${d.slice(0, 72)}…` : d;
}

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

function clientFournisseurLabel(x: any) {
  const n = String(x?.nom || x?.raisonSociale || '').trim();
  return n || x?.id || '—';
}

/** Jour local YYYY-MM-DD pour comparer à des champs date HTML. */
function dateReunionDay(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const dt = new Date(iso);
  if (Number.isNaN(dt.getTime())) return null;
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const d = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function pvPresentUserIds(r: any): string[] {
  return (r.presentsUser || [])
    .map((p: any) => p.user?.id || p.userId)
    .filter(Boolean) as string[];
}

function pvPresentCfIds(r: any): string[] {
  return (r.presentsClientFournisseur || [])
    .map((p: any) => p.clientFournisseur?.id || p.clientFournisseurId)
    .filter(Boolean) as string[];
}

function pvLinkedIds(r: any, key: string, fk: string, nestedKey: string) {
  const arr = r[key] || [];
  return arr
    .map((x: any) => x[fk] || x[nestedKey]?.id)
    .filter(Boolean) as string[];
}

const uploadApi = axios.create({ baseURL: API_BASE_URL });
uploadApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

function tokenQs() {
  const t = localStorage.getItem('token');
  return t ? `?token=${encodeURIComponent(t)}` : '';
}

/** Libellés des niveaux PvReunionPermission (alignés sur la page Processus). */
const PV_NIVEAU_LABELS: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des accès',
};

const DROITS_ADMIN_LIGNE_PV =
  'consultation, modification, mise en corbeille, gestion des accès';

function isAccesRestreintPv(p: any) {
  const dels = p.accesApercu?.delegations?.length ?? p.permissions?.length ?? 0;
  return dels > 0 || !!p.createdById;
}

function delegationsRowsForPv(p: any) {
  const d = p.accesApercu?.delegations;
  if (d?.length) {
    return d.map((row: any) => ({
      key: `${row.user?.id || ''}-${row.niveau || ''}`,
      user: row.user,
      label: PV_NIVEAU_LABELS[row.niveau] || row.niveau,
    }));
  }
  return (p.permissions || []).map((perm: any) => ({
    key: perm.id,
    user: perm.user,
    label: PV_NIVEAU_LABELS[perm.niveau] || perm.niveau,
  }));
}

function IdChips({
  label,
  options,
  selected,
  onChange,
  renderLabel,
}: {
  label: string;
  options: { id: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  renderLabel: (x: any) => string;
}) {
  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-44 overflow-y-auto">
      <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
      <div className="space-y-1">
        {options.map((x: any) => (
          <label key={x.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-white/80 rounded px-1">
            <input
              type="checkbox"
              className="mt-1"
              checked={selected.includes(x.id)}
              onChange={() =>
                onChange(
                  selected.includes(x.id) ? selected.filter((i) => i !== x.id) : [...selected, x.id]
                )
              }
            />
            <span className="text-gray-800">{renderLabel(x)}</span>
          </label>
        ))}
      </div>
    </div>
  );
}

type PvActionInput = {
  id: string;
  action: string;
  userId: string;
  entiteId: string;
  dateLimite: string;
};

function makeActionRow(): PvActionInput {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    action: '',
    userId: '',
    entiteId: '',
    dateLimite: '',
  };
}

export default function PvReunionList() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [rows, setRows] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [saving, setSaving] = useState(false);
  const [users, setUsers] = useState<any[]>([]);
  const [clientsFournisseurs, setClientsFournisseurs] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [taches, setTaches] = useState<any[]>([]);
  const [userStories, setUserStories] = useState<any[]>([]);
  const [epics, setEpics] = useState<any[]>([]);
  const [contrats, setContrats] = useState<any[]>([]);
  const [processusList, setProcessusList] = useState<any[]>([]);
  const [entites, setEntites] = useState<any[]>([]);
  const [companyInfo, setCompanyInfo] = useState<any>(null);

  const [titre, setTitre] = useState('');
  const [statutForm, setStatutForm] = useState('brouillon');
  const [dateReunion, setDateReunion] = useState('');
  const [fichier, setFichier] = useState<File | null>(null);
  const [presentUserIds, setPresentUserIds] = useState<string[]>([]);
  const [presentCfIds, setPresentCfIds] = useState<string[]>([]);
  const [projetIds, setProjetIds] = useState<string[]>([]);
  const [tacheIds, setTacheIds] = useState<string[]>([]);
  const [userStoryIds, setUserStoryIds] = useState<string[]>([]);
  const [epicIds, setEpicIds] = useState<string[]>([]);
  const [contratIds, setContratIds] = useState<string[]>([]);
  const [processusIds, setProcessusIds] = useState<string[]>([]);
  const [modificationDelegueIds, setModificationDelegueIds] = useState<string[]>([]);

  const [sourceMode, setSourceMode] = useState<'fichier' | 'redaction'>('fichier');
  const [contenuHtml, setContenuHtml] = useState('');
  const [ordreDuJourInput, setOrdreDuJourInput] = useState('');
  const [pointsDiscutesInput, setPointsDiscutesInput] = useState('');
  const [decisionsInput, setDecisionsInput] = useState('');
  const [risquesBlocagesInput, setRisquesBlocagesInput] = useState('');
  const [conclusionInput, setConclusionInput] = useState('');
  const [actionsInput, setActionsInput] = useState<PvActionInput[]>([]);
  const previewPdfRootRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);

  const [page, setPage] = useState(1);
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleRows, setCorbeilleRows] = useState<any[]>([]);
  const [histModalPv, setHistModalPv] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  const [accesModalPv, setAccesModalPv] = useState<{ id: string; titre: string } | null>(null);
  const [showFiltres, setShowFiltres] = useState(false);
  const [filtreStatut, setFiltreStatut] = useState('');
  const [filtreDateDebut, setFiltreDateDebut] = useState('');
  const [filtreDateFin, setFiltreDateFin] = useState('');
  const [filtrePresentUserIds, setFiltrePresentUserIds] = useState<string[]>([]);
  const [filtrePresentCfIds, setFiltrePresentCfIds] = useState<string[]>([]);
  const [filtreProjetIds, setFiltreProjetIds] = useState<string[]>([]);
  const [filtreTacheIds, setFiltreTacheIds] = useState<string[]>([]);
  const [filtreUserStoryIds, setFiltreUserStoryIds] = useState<string[]>([]);
  const [filtreEpicIds, setFiltreEpicIds] = useState<string[]>([]);
  const [filtreContratIds, setFiltreContratIds] = useState<string[]>([]);
  const [filtreProcessusIds, setFiltreProcessusIds] = useState<string[]>([]);
  const [expandedPvIds, setExpandedPvIds] = useState<Set<string>>(() => new Set());
  const [sortConfig, setSortConfig] = useState<{ key: string; direction: 'asc' | 'desc' } | null>(null);

  const firstPvLoad = useRef(true);

  const canUseModule = canModifyModule(user?.uiModules, 'pv_reunion');

  const togglePvRow = (id: string) => {
    setExpandedPvIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };
  const isPvExpanded = (id: string) => expandedPvIds.has(id);

  const load = async () => {
    const showFullLoading = firstPvLoad.current;
    if (showFullLoading) setLoading(true);
    try {
      const r = await api.get('/pv-reunions');
      setRows(r.data || []);
    } catch {
      setRows([]);
    } finally {
      if (showFullLoading) {
        setLoading(false);
        firstPvLoad.current = false;
      }
    }
  };

  const loadRefs = async () => {
    try {
      const [u, cf, p, t, us, e, c, pr, ent, comp] = await Promise.all([
        api.get('/users'),
        api.get('/clients-fournisseurs'),
        api.get('/projets'),
        api.get('/taches'),
        api.get('/user-stories'),
        api.get('/epics'),
        api.get('/contrats'),
        api.get('/processus'),
        api.get('/entites').catch(() => ({ data: [] })),
        api.get('/company-info').catch(() => ({ data: null })),
      ]);
      setUsers(u.data || []);
      setClientsFournisseurs(cf.data || []);
      setProjets(p.data || []);
      setTaches((t.data || []).filter((x: any) => !x.deletedAt));
      setUserStories((us.data || []).filter((x: any) => !x.deletedAt));
      setEpics((e.data || []).filter((x: any) => !x.deletedAt));
      setContrats(c.data || []);
      setProcessusList(pr.data || []);
      setEntites(ent.data || []);
      setCompanyInfo(comp.data || null);
    } catch {
      /* silencieux */
    }
  };

  useEffect(() => {
    load();
    loadRefs();
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const u = await api.get('/users');
        setUsers(u.data || []);
      } catch {
        /* silencieux */
      }
    })();
  }, []);

  useEffect(() => {
    setPage(1);
  }, [
    search,
    filtreStatut,
    filtreDateDebut,
    filtreDateFin,
    filtrePresentUserIds,
    filtrePresentCfIds,
    filtreProjetIds,
    filtreTacheIds,
    filtreUserStoryIds,
    filtreEpicIds,
    filtreContratIds,
    filtreProcessusIds,
    sortConfig,
  ]);

  const handleSort = (key: string) => {
    let direction: 'asc' | 'desc' = 'asc';
    if (sortConfig && sortConfig.key === key && sortConfig.direction === 'asc') {
      direction = 'desc';
    }
    setSortConfig({ key, direction });
  };

  const resetSort = () => setSortConfig(null);

  useEffect(() => {
    if (showForm) loadRefs();
  }, [showForm]);

  const loadCorbeillePv = async () => {
    try {
      const r = await api.get('/pv-reunions/corbeille');
      setCorbeilleRows(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleRows([]);
    }
  };

  const openHistoriqueModal = async (pv: any) => {
    setHistModalPv(pv);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/pv-reunions/${pv.id}/history?page=1&limit=200`);
      setHistoList(data?.data || []);
    } catch {
      setHistoList([]);
      alert("Impossible de charger l'historique.");
      setHistModalPv(null);
    } finally {
      setHistoLoading(false);
    }
  };

  const handleRestorePvFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/pv-reunions/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestorePvCorbeille = (row: any) => {
    if (row.capabilities?.canDelete != null) return !!row.capabilities.canDelete;
    if (user?.role === 'admin') return true;
    if (row.createdById === user?.id || row.createdBy?.id === user?.id) return true;
    return (row.modificationDelegues || []).some((d: any) => (d.userId || d.user?.id) === user?.id);
  };

  const resetForm = () => {
    setTitre('');
    setStatutForm('brouillon');
    setDateReunion('');
    setFichier(null);
    setPresentUserIds([]);
    setPresentCfIds([]);
    setProjetIds([]);
    setTacheIds([]);
    setUserStoryIds([]);
    setEpicIds([]);
    setContratIds([]);
    setProcessusIds([]);
    setModificationDelegueIds([]);
    setSourceMode('fichier');
    setContenuHtml('');
    setOrdreDuJourInput('');
    setPointsDiscutesInput('');
    setDecisionsInput('');
    setRisquesBlocagesInput('');
    setConclusionInput('');
    setActionsInput([]);
  };

  const openForm = () => {
    resetForm();
    try {
      const raw = localStorage.getItem(PV_NOUVEAU_DRAFT_LS);
      if (raw) {
        const d = JSON.parse(raw) as Record<string, unknown>;
        if (d && typeof d === 'object') {
          if (typeof d.titre === 'string') setTitre(d.titre);
          if (typeof d.statutForm === 'string') setStatutForm(d.statutForm);
          if (typeof d.dateReunion === 'string') setDateReunion(d.dateReunion);
          if (Array.isArray(d.presentUserIds)) setPresentUserIds(d.presentUserIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.presentCfIds)) setPresentCfIds(d.presentCfIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.projetIds)) setProjetIds(d.projetIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.tacheIds)) setTacheIds(d.tacheIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.userStoryIds)) setUserStoryIds(d.userStoryIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.epicIds)) setEpicIds(d.epicIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.contratIds)) setContratIds(d.contratIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.processusIds)) setProcessusIds(d.processusIds.filter((x) => typeof x === 'string'));
          if (Array.isArray(d.modificationDelegueIds))
            setModificationDelegueIds(d.modificationDelegueIds.filter((x) => typeof x === 'string'));
          if (d.sourceMode === 'redaction' || d.sourceMode === 'fichier') setSourceMode(d.sourceMode);
          if (typeof d.contenuHtml === 'string') setContenuHtml(d.contenuHtml);
          if (typeof d.ordreDuJourInput === 'string') setOrdreDuJourInput(d.ordreDuJourInput);
          if (typeof d.pointsDiscutesInput === 'string') setPointsDiscutesInput(d.pointsDiscutesInput);
          if (typeof d.decisionsInput === 'string') setDecisionsInput(d.decisionsInput);
          if (typeof d.risquesBlocagesInput === 'string') setRisquesBlocagesInput(d.risquesBlocagesInput);
          if (typeof d.conclusionInput === 'string') setConclusionInput(d.conclusionInput);
          if (Array.isArray(d.actionsInput)) {
            setActionsInput(
              d.actionsInput
                .filter((x) => x && typeof x === 'object')
                .map((x: any) => ({
                  id: String(x.id || makeActionRow().id),
                  action: String(x.action || ''),
                  userId: String(x.userId || ''),
                  entiteId: String(x.entiteId || ''),
                  dateLimite: String(x.dateLimite || ''),
                }))
            );
          }
        }
      }
    } catch {
      /* brouillon illisible */
    }
    setShowForm(true);
  };

  useEffect(() => {
    if (!showForm) return;
    const t = window.setTimeout(() => {
      try {
        localStorage.setItem(
          PV_NOUVEAU_DRAFT_LS,
          JSON.stringify({
            titre,
            statutForm,
            dateReunion,
            presentUserIds,
            presentCfIds,
            projetIds,
            tacheIds,
            userStoryIds,
            epicIds,
            contratIds,
            processusIds,
            modificationDelegueIds,
            sourceMode,
            contenuHtml,
            ordreDuJourInput,
            pointsDiscutesInput,
            decisionsInput,
            risquesBlocagesInput,
            conclusionInput,
            actionsInput,
            savedAt: new Date().toISOString(),
          })
        );
      } catch {
        /* quota */
      }
    }, 600);
    return () => window.clearTimeout(t);
  }, [
    showForm,
    titre,
    statutForm,
    dateReunion,
    presentUserIds,
    presentCfIds,
    projetIds,
    tacheIds,
    userStoryIds,
    epicIds,
    contratIds,
    processusIds,
    modificationDelegueIds,
    sourceMode,
    contenuHtml,
    ordreDuJourInput,
    pointsDiscutesInput,
    decisionsInput,
    risquesBlocagesInput,
    conclusionInput,
    actionsInput,
  ]);

  const contenuHtmlHasText = useMemo(() => {
    const t = contenuHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return t.length > 0;
  }, [contenuHtml]);
  const parseLines = (s: string) =>
    String(s || '')
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const toFrDateLabel = (value: string): string => {
    const v = String(value || '').trim();
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return v;
    const dt = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    if (Number.isNaN(dt.getTime())) return v;
    return dt.toLocaleDateString('fr-FR');
  };

  useEffect(() => {
    if (sourceMode !== 'redaction') return;
    const st = PV_STATUTS.find((s) => s.value === statutForm)?.label || statutForm;
    const dateLabel = dateReunion
      ? new Date(dateReunion).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—';
    const uLines = presentUserIds
      .map((uid) => {
        const u = users.find((x: any) => x.id === uid);
        return u ? `${u.prenom} ${u.nom}` : uid;
      })
      .filter(Boolean);
    const cfLines = presentCfIds
      .map((id) => {
        const c = clientsFournisseurs.find((x: any) => x.id === id);
        return c ? clientFournisseurLabel(c) : id;
      })
      .filter(Boolean);
    const projLines = projetIds
      .map((id) => {
        const p = projets.find((x: any) => x.id === id);
        return p ? String(p.nom || p.codeProjet || id) : id;
      })
      .filter(Boolean);
    const tacheLines = tacheIds
      .map((id) => {
        const t = taches.find((x: any) => x.id === id);
        return t ? String(t.nom || id) : id;
      })
      .filter(Boolean);
    const usLines = userStoryIds
      .map((id) => {
        const us = userStories.find((x: any) => x.id === id);
        const d = String(us?.description || '').trim();
        return d ? (d.length > 120 ? `${d.slice(0, 120)}…` : d) : id;
      })
      .filter(Boolean);
    const epicLines = epicIds
      .map((id) => {
        const ep = epics.find((x: any) => x.id === id);
        return ep ? String(ep.nom || id) : id;
      })
      .filter(Boolean);
    const actionsRows = actionsInput
      .map((a) => {
        const u = users.find((x: any) => x.id === a.userId);
        const en = entites.find((x: any) => x.id === a.entiteId);
        const responsable = [u ? `${u.prenom} ${u.nom}` : '', en ? en.nom : ''].filter(Boolean).join(' / ');
        return {
          action: a.action.trim(),
          responsable,
          dateLimite: a.dateLimite ? toFrDateLabel(a.dateLimite) : '',
        };
      })
      .filter((a) => a.action || a.responsable || a.dateLimite);

    setContenuHtml(
      buildStructuredPvHtml({
        titre: titre.trim() || 'Réunion',
        statutLabel: st,
        dateReunionLabel: dateLabel,
        derniereMiseAJourLabel: new Date().toLocaleString('fr-FR'),
        usersLines: uLines,
        cfLines,
        projetsLines: projLines,
        tachesLines: tacheLines,
        userStoriesLines: usLines,
        epicsLines: epicLines,
        ordreDuJourLines: parseLines(ordreDuJourInput),
        pointsDiscutesText: pointsDiscutesInput,
        decisionsPrisesLines: parseLines(decisionsInput),
        risquesBlocagesText: risquesBlocagesInput,
        conclusionText: conclusionInput,
        actionsRows,
      })
    );
  }, [
    sourceMode,
    titre,
    statutForm,
    dateReunion,
    presentUserIds,
    presentCfIds,
    projetIds,
    tacheIds,
    userStoryIds,
    epicIds,
    ordreDuJourInput,
    pointsDiscutesInput,
    decisionsInput,
    risquesBlocagesInput,
    conclusionInput,
    actionsInput,
    users,
    entites,
    clientsFournisseurs,
    projets,
    taches,
    userStories,
    epics,
  ]);

  const handleGeneratePvTemplate = () => setSourceMode('redaction');

  const handlePreviewPdf = async () => {
    if (!previewPdfRootRef.current || !contenuHtmlHasText) {
      alert('Rédigez d’abord le contenu du PV pour générer un aperçu.');
      return;
    }
    setPdfPreviewLoading(true);
    try {
      const blob = await htmlElementToPdfBlob(previewPdfRootRef.current, {
        footerAddress: String(companyInfo?.adresseEntreprise || '').trim(),
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch {
      alert('Impossible de générer l’aperçu PDF.');
    } finally {
      setPdfPreviewLoading(false);
    }
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!titre.trim()) {
      alert('Le titre est requis.');
      return;
    }
    if (sourceMode === 'fichier' && !fichier) {
      alert('Choisissez un fichier pour le PV ou passez en mode « Rédaction dans l’application ».');
      return;
    }
    if (sourceMode === 'redaction' && !contenuHtmlHasText) {
      alert('Saisissez le contenu du PV (ou générez le modèle automatique).');
      return;
    }
    setSaving(true);
    try {
      const fd = new FormData();
      fd.append('titre', titre.trim());
      fd.append('statut', statutForm);
      if (dateReunion) fd.append('dateReunion', new Date(dateReunion).toISOString());
      if (sourceMode === 'fichier' && fichier) fd.append('fichier', fichier);
      if (sourceMode === 'redaction') fd.append('contenuHtml', contenuHtml);
      fd.append('presentUserIds', JSON.stringify(presentUserIds));
      fd.append('presentClientFournisseurIds', JSON.stringify(presentCfIds));
      fd.append('projetIds', JSON.stringify(projetIds));
      fd.append('tacheIds', JSON.stringify(tacheIds));
      fd.append('userStoryIds', JSON.stringify(userStoryIds));
      fd.append('epicIds', JSON.stringify(epicIds));
      fd.append('contratIds', JSON.stringify(contratIds));
      fd.append('processusIds', JSON.stringify(processusIds));
      fd.append('modificationDelegueIds', JSON.stringify(modificationDelegueIds));
      const res = await uploadApi.post('/pv-reunions', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      try {
        localStorage.removeItem(PV_NOUVEAU_DRAFT_LS);
      } catch {
        /* */
      }
      setShowForm(false);
      resetForm();
      await load();
      navigate(`/pv-reunion/${res.data.id}`);
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const hasDateBounds = !!(filtreDateDebut || filtreDateFin);

    const base = rows.filter((r) => {
      if (filtreStatut && r.statut !== filtreStatut) return false;

      if (q) {
        const matchText =
          r.titre?.toLowerCase().includes(q) ||
          r.createdBy?.nom?.toLowerCase().includes(q) ||
          r.createdBy?.prenom?.toLowerCase().includes(q) ||
          String(r.id || '')
            .toLowerCase()
            .includes(q);
        if (!matchText) return false;
      }

      if (hasDateBounds) {
        const day = dateReunionDay(r.dateReunion);
        if (!day) return false;
        if (filtreDateDebut && day < filtreDateDebut) return false;
        if (filtreDateFin && day > filtreDateFin) return false;
      }

      if (filtrePresentUserIds.length > 0) {
        const set = new Set(pvPresentUserIds(r));
        if (!filtrePresentUserIds.some((id) => set.has(id))) return false;
      }
      if (filtrePresentCfIds.length > 0) {
        const set = new Set(pvPresentCfIds(r));
        if (!filtrePresentCfIds.some((id) => set.has(id))) return false;
      }
      if (filtreProjetIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'projets', 'projetId', 'projet'));
        if (!filtreProjetIds.some((id) => set.has(id))) return false;
      }
      if (filtreTacheIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'taches', 'tacheId', 'tache'));
        if (!filtreTacheIds.some((id) => set.has(id))) return false;
      }
      if (filtreUserStoryIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'userStories', 'userStoryId', 'userStory'));
        if (!filtreUserStoryIds.some((id) => set.has(id))) return false;
      }
      if (filtreEpicIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'epics', 'epicId', 'epic'));
        if (!filtreEpicIds.some((id) => set.has(id))) return false;
      }
      if (filtreContratIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'contrats', 'contratId', 'contrat'));
        if (!filtreContratIds.some((id) => set.has(id))) return false;
      }
      if (filtreProcessusIds.length > 0) {
        const set = new Set(pvLinkedIds(r, 'processus', 'processusId', 'processus'));
        if (!filtreProcessusIds.some((id) => set.has(id))) return false;
      }

      return true;
    });
    if (!sortConfig) return base;
    const dir = sortConfig.direction === 'asc' ? 1 : -1;
    return [...base].sort((a, b) => {
      if (sortConfig.key === 'titre') {
        return dir * (a.titre || '').localeCompare(b.titre || '', 'fr', { sensitivity: 'base' });
      }
      if (sortConfig.key === 'statut') {
        return dir * (a.statut || '').localeCompare(b.statut || '', 'fr');
      }
      if (sortConfig.key === 'dateReunion') {
        const ta = a.dateReunion ? new Date(a.dateReunion).getTime() : 0;
        const tb = b.dateReunion ? new Date(b.dateReunion).getTime() : 0;
        return dir * (ta - tb);
      }
      if (sortConfig.key === 'createur') {
        const na = a.createdBy ? `${a.createdBy.prenom} ${a.createdBy.nom}` : '';
        const nb = b.createdBy ? `${b.createdBy.prenom} ${b.createdBy.nom}` : '';
        return dir * na.localeCompare(nb, 'fr', { sensitivity: 'base' });
      }
      return 0;
    });
  }, [
    rows,
    search,
    filtreStatut,
    filtreDateDebut,
    filtreDateFin,
    filtrePresentUserIds,
    filtrePresentCfIds,
    filtreProjetIds,
    filtreTacheIds,
    filtreUserStoryIds,
    filtreEpicIds,
    filtreContratIds,
    filtreProcessusIds,
    sortConfig,
  ]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const paged = filtered.slice(startIdx, startIdx + PAGE_SIZE);

  const usersActifsFiltre = useMemo(
    () => users.filter((u: any) => !u.statut || u.statut === 'actif'),
    [users]
  );

  const filtresAvancesActifs =
    !!filtreDateDebut ||
    !!filtreDateFin ||
    filtrePresentUserIds.length > 0 ||
    filtrePresentCfIds.length > 0 ||
    filtreProjetIds.length > 0 ||
    filtreTacheIds.length > 0 ||
    filtreUserStoryIds.length > 0 ||
    filtreEpicIds.length > 0 ||
    filtreContratIds.length > 0 ||
    filtreProcessusIds.length > 0;

  if (loading) {
    return (
      <div className="p-6">
        <div className="text-center py-10 text-gray-400">Chargement...</div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">PV de réunion</h1>
          <p className="text-sm text-gray-500 mt-1">{filtered.length} PV accessible(s)</p>
        </div>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={async () => {
              await loadCorbeillePv();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          {canUseModule && (
            <button
              type="button"
              onClick={openForm}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Nouveau PV
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
          <span>
            Filtres
            {search.trim() || filtreStatut || filtresAvancesActifs ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-4">
              <div className="md:col-span-2 lg:col-span-3">
                <label className="block text-xs font-medium text-gray-600 mb-1">Titre, créateur ou ID</label>
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Rechercher…"
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  value={filtreStatut}
                  onChange={(e) => setFiltreStatut(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  {PV_STATUTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date réunion — début</label>
                <input
                  type="date"
                  value={filtreDateDebut}
                  onChange={(e) => setFiltreDateDebut(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date réunion — fin</label>
                <input
                  type="date"
                  value={filtreDateFin}
                  onChange={(e) => setFiltreDateFin(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
            </div>
            <p className="text-xs text-gray-500 mt-2">
              Plage de dates : borne inclusive. Les PV <span className="font-medium">sans date de réunion</span> sont exclus
              dès qu’au moins une date est renseignée.
            </p>
            <p className="text-xs text-gray-500 mt-1">
              Présents et rattachements : dans chaque bloc, la sélection est en <span className="font-medium">OU</span> (au
              moins un critère coché doit correspondre). Les blocs actifs se combinent en <span className="font-medium">ET</span>.
            </p>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
              <IdChips
                label="Présents (utilisateurs)"
                options={usersActifsFiltre}
                selected={filtrePresentUserIds}
                onChange={setFiltrePresentUserIds}
                renderLabel={(u: any) => `${u.prenom} ${u.nom} (${u.email || u.id})`}
              />
              <IdChips
                label="Présents (clients / fournisseurs)"
                options={clientsFournisseurs}
                selected={filtrePresentCfIds}
                onChange={setFiltrePresentCfIds}
                renderLabel={(cf: any) => clientFournisseurLabel(cf)}
              />
              <IdChips
                label="Projet(s) lié(s)"
                options={projets}
                selected={filtreProjetIds}
                onChange={setFiltreProjetIds}
                renderLabel={(p: any) =>
                  `${p.nom || p.id}${p.codeProjet ? ` (${p.codeProjet})` : ''}`
                }
              />
              <IdChips
                label="Tâche(s) liée(s)"
                options={taches}
                selected={filtreTacheIds}
                onChange={setFiltreTacheIds}
                renderLabel={(t: any) => t.nom || t.id}
              />
              <IdChips
                label="User story / stories"
                options={userStories}
                selected={filtreUserStoryIds}
                onChange={setFiltreUserStoryIds}
                renderLabel={(us: any) => usLabel(us)}
              />
              <IdChips
                label="Epic(s)"
                options={epics}
                selected={filtreEpicIds}
                onChange={setFiltreEpicIds}
                renderLabel={(ep: any) => ep.nom || ep.id}
              />
              <IdChips
                label="Contrat(s)"
                options={contrats}
                selected={filtreContratIds}
                onChange={setFiltreContratIds}
                renderLabel={(c: any) =>
                  `${c.codeContrat ? `${c.codeContrat} — ` : ''}${c.nom || c.id}`
                }
              />
              <IdChips
                label="Processus"
                options={processusList}
                selected={filtreProcessusIds}
                onChange={setFiltreProcessusIds}
                renderLabel={(pr: any) => pr.nom || pr.id}
              />
            </div>
            <div className="flex flex-wrap justify-between items-center gap-2 mt-4 pt-2 border-t border-gray-100">
              <div className="flex flex-wrap gap-2 text-xs text-gray-500">
                <span className="font-medium">Tri rapide :</span>
                {(['titre', 'statut', 'dateReunion', 'createur'] as const).map((k) => (
                  <button
                    key={k}
                    type="button"
                    onClick={() => handleSort(k)}
                    className={`hover:text-blue-600 ${sortConfig?.key === k ? 'text-blue-600 font-semibold' : ''}`}
                  >
                    {k === 'dateReunion'
                      ? 'Date réunion'
                      : k === 'createur'
                        ? 'Créé par'
                        : k === 'titre'
                          ? 'Titre'
                          : 'Statut'}
                    {sortConfig?.key === k ? (sortConfig.direction === 'asc' ? ' ↑' : ' ↓') : ''}
                  </button>
                ))}
                {sortConfig && (
                  <button type="button" onClick={resetSort} className="text-gray-600 hover:underline ml-2">
                    Réinitialiser tri
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setFiltreStatut('');
                  setFiltreDateDebut('');
                  setFiltreDateFin('');
                  setFiltrePresentUserIds([]);
                  setFiltrePresentCfIds([]);
                  setFiltreProjetIds([]);
                  setFiltreTacheIds([]);
                  setFiltreUserStoryIds([]);
                  setFiltreEpicIds([]);
                  setFiltreContratIds([]);
                  setFiltreProcessusIds([]);
                }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="text-center py-10 text-gray-400 bg-white rounded-lg shadow">Aucun PV trouvé</div>
        ) : (
          paged.map((r) => {
            const c = r.capabilities || { canModify: false };
            const st = PV_STATUTS.find((x) => x.value === r.statut) || PV_STATUTS[0];
            const rowOpen = isPvExpanded(r.id);
            const docHref = r.document?.id
              ? `${API_BASE_URL}/documents/${r.document.id}/view${tokenQs()}`
              : '';
            const accesRows = delegationsRowsForPv(r);
            return (
              <div key={r.id} className="bg-white rounded-lg shadow overflow-hidden">
                <button
                  type="button"
                  onClick={() => togglePvRow(r.id)}
                  className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                  aria-expanded={rowOpen}
                  aria-label={
                    rowOpen ? 'Replier le détail du PV' : 'Afficher le détail et les actions du PV de réunion'
                  }
                >
                  <span className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${st.color}`}>{st.label}</span>
                  <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{r.titre}</h2>
                  <span
                    className="text-xs sm:text-sm text-gray-500 font-mono shrink-0 text-right max-w-[min(100%,14rem)]"
                    title={`${r.id}\n${r.dateReunion ? new Date(r.dateReunion).toLocaleDateString('fr-FR') : '—'}`}
                  >
                    <span className="block truncate">
                      {r.dateReunion ? new Date(r.dateReunion).toLocaleDateString('fr-FR') : '—'}
                    </span>
                    <span className="block truncate text-[11px] sm:text-xs text-gray-400">{r.id}</span>
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
                        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 text-sm text-gray-600">
                          <div>
                            <span className="font-medium">Commentaires : </span>
                            <span className="text-blue-700 font-semibold">{r.nombreCommentaires ?? 0}</span>
                          </div>
                          <div>
                            <span className="font-medium">Vues (journal) : </span>
                            <span className="text-blue-700 font-semibold">{r.nombreVues ?? 0}</span>
                          </div>
                          <div>
                            <span className="font-medium">Date réunion : </span>
                            {r.dateReunion ? new Date(r.dateReunion).toLocaleDateString('fr-FR') : '—'}
                          </div>
                          <div>
                            <span className="font-medium">Créé par : </span>
                            {r.createdBy ? `${r.createdBy.prenom} ${r.createdBy.nom}` : '—'}
                          </div>
                        </div>
                        <div className="text-[11px] font-mono text-gray-400 break-all">
                          <span className="font-medium text-gray-600">ID : </span>
                          {r.id}
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Pièce jointe principale</p>
                          {r.document?.id ? (
                            <a
                              href={docHref}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline font-medium"
                            >
                              📎 {r.document.nom || r.document.fichierNomOriginal}
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </div>

                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Présents (utilisateurs)</p>
                          <div className="flex flex-wrap gap-1">
                            {(r.presentsUser || []).length === 0 && (
                              <span className="text-gray-400 text-xs">Aucun</span>
                            )}
                            {(r.presentsUser || []).map((p: any) => (
                              <span key={p.user?.id || p.userId} className="px-2 py-0.5 bg-gray-100 rounded text-xs">
                                {p.user ? `${p.user.prenom} ${p.user.nom}` : p.userId}
                              </span>
                            ))}
                          </div>
                        </div>
                        <div>
                          <p className="text-xs font-medium text-gray-500 uppercase mb-1">Présents (clients / fournisseurs)</p>
                          <div className="flex flex-wrap gap-1">
                            {(r.presentsClientFournisseur || []).length === 0 && (
                              <span className="text-gray-400 text-xs">Aucun</span>
                            )}
                            {(r.presentsClientFournisseur || []).map((p: any) => (
                              <span key={p.clientFournisseur?.id || p.clientFournisseurId} className="px-2 py-0.5 bg-amber-50 rounded text-xs">
                                {clientFournisseurLabel(p.clientFournisseur)}
                              </span>
                            ))}
                          </div>
                        </div>

                        <div className="mt-3 space-y-2 border-t border-gray-100 pt-3">
                          {(r.projets || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Projets</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.projets || []).map((x: any) => (
                                  <button
                                    key={x.projetId}
                                    type="button"
                                    onClick={() => navigate(`/projets/${x.projet?.id || x.projetId}`)}
                                    className="px-2 py-0.5 bg-purple-100 text-purple-800 rounded text-xs hover:bg-purple-200"
                                  >
                                    📁 {x.projet?.nom || x.projetId}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {(r.taches || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Tâches</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.taches || []).map((x: any) => (
                                  <button
                                    key={x.tacheId}
                                    type="button"
                                    onClick={() => navigate(`/taches/${x.tache?.id || x.tacheId}`)}
                                    className="px-2 py-0.5 bg-cyan-100 text-cyan-900 rounded text-xs hover:bg-cyan-200"
                                  >
                                    ✓ {x.tache?.nom || x.tacheId}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {(r.userStories || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">User stories</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.userStories || []).map((x: any) => (
                                  <span
                                    key={x.userStoryId}
                                    className="px-2 py-0.5 bg-indigo-50 text-indigo-900 rounded text-xs max-w-full"
                                  >
                                    📋 {usLabel(x.userStory || {})}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(r.epics || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Epics</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.epics || []).map((x: any) => (
                                  <span
                                    key={x.epicId}
                                    className="px-2 py-0.5 bg-violet-100 text-violet-900 rounded text-xs"
                                  >
                                    🎯 {x.epic?.nom || x.epicId}
                                  </span>
                                ))}
                              </div>
                            </div>
                          )}
                          {(r.contrats || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Contrats</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.contrats || []).map((x: any) => (
                                  <button
                                    key={x.contratId}
                                    type="button"
                                    onClick={() => navigate(`/contrats`)}
                                    className="px-2 py-0.5 bg-emerald-50 text-emerald-900 rounded text-xs hover:bg-emerald-100"
                                  >
                                    📄 {x.contrat?.codeContrat ? `${x.contrat.codeContrat} — ` : ''}
                                    {x.contrat?.nom || x.contratId}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {(r.processus || []).length > 0 && (
                            <div>
                              <p className="text-xs font-medium text-gray-500 uppercase mb-1">Processus</p>
                              <div className="flex flex-wrap gap-1">
                                {(r.processus || []).map((x: any) => (
                                  <button
                                    key={x.processusId}
                                    type="button"
                                    onClick={() => navigate(`/processus/${x.processus?.id || x.processusId}`)}
                                    className="px-2 py-0.5 bg-teal-100 text-teal-900 rounded text-xs hover:bg-teal-200"
                                  >
                                    ⚙ {x.processus?.nom || x.processusId}
                                  </button>
                                ))}
                              </div>
                            </div>
                          )}
                          {!(r.projets || []).length &&
                            !(r.taches || []).length &&
                            !(r.userStories || []).length &&
                            !(r.epics || []).length &&
                            !(r.contrats || []).length &&
                            !(r.processus || []).length && (
                              <p className="text-xs text-gray-400 italic">Aucun rattachement explicite</p>
                            )}
                        </div>

                        <div className="mt-3 space-y-2">
                          <p className="text-[11px] text-gray-500 leading-snug">
                            <span className="font-medium text-gray-600">Détail du PV</span> et{' '}
                            <span className="font-medium text-gray-600">document principal</span> : mêmes règles
                            d’accès (consultation, modification selon les droits ci-dessous).
                          </p>
                          <div className="flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                            <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                              {isAccesRestreintPv(r) ? (
                                <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                                  <span className="text-sm leading-none" aria-hidden>
                                    🔒
                                  </span>
                                  <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">
                                    Accès restreint
                                  </span>
                                </div>
                              ) : (
                                <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                                  <span className="text-[10px] font-semibold leading-tight text-center">
                                    Accès élargi
                                  </span>
                                </div>
                              )}
                              <AccessContratLikeAdminLines
                                keyPrefix={r.id}
                                users={users}
                                createdById={r.createdById}
                                createdBy={r.createdBy}
                                adminSansAccesUserIds={
                                  r.adminSansAccesUserIds ??
                                  (r.adminSansAcces || []).map((x: { userId: string }) => x.userId)
                                }
                                permissions={(r.permissions || []).map((p: any) => ({
                                  userId: p.userId,
                                  niveau: p.niveau,
                                  user: p.user,
                                }))}
                                droitsAdminCompletLabel={DROITS_ADMIN_LIGNE_PV}
                                niveauLabel={(n) => PV_NIVEAU_LABELS[n] || n}
                              />
                              {accesRows.map((row: { key: string; user: any; label: string }) => (
                                <div key={row.key} className="min-w-0">
                                  <span className="font-medium text-gray-900">
                                    {row.user?.prenom} {row.user?.nom}
                                  </span>
                                  <span className="text-gray-500 italic block sm:inline sm:ml-1">
                                    ({row.label})
                                  </span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                        <button
                          type="button"
                          onClick={() => navigate(`/pv-reunion/${r.id}`)}
                          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                        >
                          👁 Détails
                        </button>
                        {c.canModify && canUseModule && (
                          <button
                            type="button"
                            onClick={() => navigate(`/pv-reunion/${r.id}`, { state: { openEdit: true } })}
                            className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
                          >
                            ✏️ Modifier
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => setAccesModalPv({ id: r.id, titre: r.titre || 'PV' })}
                          className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                        >
                          🔐 Accès
                        </button>
                        <button
                          type="button"
                          onClick={() => openHistoriqueModal(r)}
                          className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                        >
                          📜 Historique
                        </button>
                        {c.canModify && canUseModule && (
                          <button
                            type="button"
                            onClick={async () => {
                              if (!window.confirm(`Mettre le PV « ${r.titre} » en corbeille ?`)) return;
                              try {
                                await api.delete(`/pv-reunions/${r.id}`);
                                await load();
                              } catch (e: any) {
                                alert(e?.response?.data?.error || 'Erreur');
                              }
                            }}
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
          })
        )}
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
              className={`px-4 py-2 rounded text-sm font-medium ${
                safePage === 1 ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
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
                    className={`px-3 py-2 rounded text-sm font-medium ${
                      safePage === p ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
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
              className={`px-4 py-2 rounded text-sm font-medium ${
                safePage === totalPages
                  ? 'bg-gray-100 text-gray-400 cursor-not-allowed'
                  : 'bg-blue-600 text-white hover:bg-blue-700'
              }`}
            >
              Suivant
            </button>
          </div>
        </div>
      )}

      <PvReunionAccesModal
        open={!!accesModalPv}
        onClose={() => setAccesModalPv(null)}
        pvId={accesModalPv?.id ?? null}
        titreFallback={accesModalPv?.titre ?? ''}
        onPermissionsChanged={load}
      />

      {histModalPv && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalPv.titre}</h3>
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
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setHistModalPv(null)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
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
              <h2 className="text-lg font-semibold">🗑 PV en corbeille</h2>
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
              {corbeilleRows.length === 0 && <p className="text-sm text-gray-500">Aucun PV en corbeille.</p>}
              {corbeilleRows.map((cp: any) => (
                <div
                  key={cp.id}
                  className="flex flex-wrap items-center justify-between gap-2 border border-gray-100 rounded-lg p-3"
                >
                  <div>
                    <p className="font-medium text-gray-900">{cp.titre}</p>
                    <p className="text-xs text-gray-500">
                      Supprimé le{' '}
                      {cp.deletedAt ? new Date(cp.deletedAt).toLocaleString('fr-FR') : '—'}
                    </p>
                  </div>
                  {canRestorePvCorbeille(cp) ? (
                    <button
                      type="button"
                      onClick={() => handleRestorePvFromCorbeille(cp.id)}
                      className="px-3 py-1.5 bg-green-100 text-green-800 rounded text-sm hover:bg-green-200"
                    >
                      Restaurer
                    </button>
                  ) : (
                    <span className="text-xs text-gray-400">Restauration : droit suppression requis</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-xl shadow-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-lg font-semibold">Nouveau PV de réunion</h2>
              <button
                type="button"
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setShowForm(false)}
              >
                ✕
              </button>
            </div>
            <form onSubmit={submit} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Titre *</label>
                <input
                  className="w-full border border-gray-200 rounded-md px-3 py-2"
                  value={titre}
                  onChange={(e) => setTitre(e.target.value)}
                  required
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
                <select
                  className="w-full border border-gray-200 rounded-md px-3 py-2"
                  value={statutForm}
                  onChange={(e) => setStatutForm(e.target.value)}
                >
                  {PV_STATUTS.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Date de la réunion</label>
                <input
                  type="date"
                  className="w-full border border-gray-200 rounded-md px-3 py-2"
                  value={dateReunion}
                  onChange={(e) => setDateReunion(e.target.value)}
                />
              </div>
              <div className="rounded-lg border border-gray-200 bg-slate-50/80 p-3 space-y-3">
                <p className="text-xs font-semibold text-gray-700">Document principal</p>
                <div className="flex flex-wrap gap-4 text-sm">
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pv-source"
                      checked={sourceMode === 'fichier'}
                      onChange={() => setSourceMode('fichier')}
                    />
                    Importer un fichier
                  </label>
                  <label className="inline-flex items-center gap-2 cursor-pointer">
                    <input
                      type="radio"
                      name="pv-source"
                      checked={sourceMode === 'redaction'}
                      onChange={() => setSourceMode('redaction')}
                    />
                    Rédiger dans l’application
                  </label>
                </div>
                {sourceMode === 'fichier' ? (
                  <div>
                    <label className="block text-xs font-medium text-gray-600 mb-1">Fichier *</label>
                    <input
                      type="file"
                      className="text-sm"
                      onChange={(e) => setFichier(e.target.files?.[0] || null)}
                    />
                  </div>
                ) : (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <button
                        type="button"
                        onClick={handleGeneratePvTemplate}
                        className="px-3 py-1.5 text-xs font-medium rounded-md bg-indigo-600 text-white hover:bg-indigo-700"
                      >
                        Générer automatiquement le contenu du PV
                      </button>
                      <button
                        type="button"
                        onClick={handlePreviewPdf}
                        disabled={pdfPreviewLoading || !contenuHtmlHasText}
                        className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                      >
                        {pdfPreviewLoading ? 'Aperçu…' : 'Aperçu PDF'}
                      </button>
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Ordre du jour</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-md px-3 py-2 min-h-[90px]"
                        value={ordreDuJourInput}
                        onChange={(e) => setOrdreDuJourInput(e.target.value)}
                        placeholder="Une ligne par point."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Points discutés</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-md px-3 py-2 min-h-[110px]"
                        value={pointsDiscutesInput}
                        onChange={(e) => setPointsDiscutesInput(e.target.value)}
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Décisions prises</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-md px-3 py-2 min-h-[90px]"
                        value={decisionsInput}
                        onChange={(e) => setDecisionsInput(e.target.value)}
                        placeholder="Une ligne par décision."
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Risques / blocages</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-md px-3 py-2 min-h-[90px]"
                        value={risquesBlocagesInput}
                        onChange={(e) => setRisquesBlocagesInput(e.target.value)}
                      />
                    </div>
                    <div>
                      <div className="flex items-center justify-between mb-1">
                        <label className="block text-xs font-medium text-gray-600">Actions à réaliser</label>
                        <button
                          type="button"
                          onClick={() => setActionsInput((prev) => [...prev, makeActionRow()])}
                          className="px-2 py-1 text-xs rounded border border-gray-300 hover:bg-gray-50"
                        >
                          + Ajouter une action
                        </button>
                      </div>
                      {actionsInput.length === 0 ? (
                        <p className="text-xs text-gray-500">Aucune action pour le moment.</p>
                      ) : (
                        <div className="space-y-2">
                          {actionsInput.map((a, idx) => (
                            <div key={a.id} className="grid grid-cols-1 md:grid-cols-5 gap-2 border border-gray-200 rounded-md p-2 bg-white">
                              <input
                                className="md:col-span-2 border border-gray-200 rounded px-2 py-1.5 text-sm"
                                placeholder={`Action ${idx + 1}`}
                                value={a.action}
                                onChange={(e) =>
                                  setActionsInput((prev) =>
                                    prev.map((x) => (x.id === a.id ? { ...x, action: e.target.value } : x))
                                  )
                                }
                              />
                              <select
                                className="border border-gray-200 rounded px-2 py-1.5 text-sm"
                                value={a.entiteId}
                                onChange={(e) =>
                                  setActionsInput((prev) =>
                                    prev.map((x) => (x.id === a.id ? { ...x, entiteId: e.target.value } : x))
                                  )
                                }
                              >
                                <option value="">Entité</option>
                                {entites.map((en: any) => (
                                  <option key={en.id} value={en.id}>
                                    {en.nom || en.id}
                                  </option>
                                ))}
                              </select>
                              <select
                                className="border border-gray-200 rounded px-2 py-1.5 text-sm"
                                value={a.userId}
                                onChange={(e) =>
                                  setActionsInput((prev) =>
                                    prev.map((x) => (x.id === a.id ? { ...x, userId: e.target.value } : x))
                                  )
                                }
                              >
                                <option value="">Utilisateur</option>
                                {users.map((u: any) => (
                                  <option key={u.id} value={u.id}>
                                    {u.prenom} {u.nom}
                                  </option>
                                ))}
                              </select>
                              <div className="flex gap-2">
                                <input
                                  type="date"
                                  className="border border-gray-200 rounded px-2 py-1.5 text-sm flex-1"
                                  value={a.dateLimite}
                                  onChange={(e) =>
                                    setActionsInput((prev) =>
                                      prev.map((x) => (x.id === a.id ? { ...x, dateLimite: e.target.value } : x))
                                    )
                                  }
                                />
                                <button
                                  type="button"
                                  className="px-2 py-1 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50"
                                  onClick={() => setActionsInput((prev) => prev.filter((x) => x.id !== a.id))}
                                >
                                  ✕
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-600 mb-1">Conclusion</label>
                      <textarea
                        className="w-full border border-gray-200 rounded-md px-3 py-2 min-h-[90px]"
                        value={conclusionInput}
                        onChange={(e) => setConclusionInput(e.target.value)}
                      />
                    </div>
                    <p className="text-[11px] text-gray-500">
                      Les sections vides ne seront pas affichées dans le PDF final.
                    </p>
                  </div>
                )}
              </div>

              <div
                ref={previewPdfRootRef}
                className="fixed left-[-10000px] top-0 w-[794px] bg-white p-10 text-[13px] leading-relaxed text-gray-900 shadow-sm"
                aria-hidden
              >
                <header className="border-b border-gray-200 pb-3 mb-4">
                  {companyInfo?.logoFilename ? (
                    <div className="flex items-center justify-between mb-2">
                      <img
                        src={`${API_BASE_URL}/company-info/logo${tokenQs()}`}
                        alt="Logo entreprise"
                        className="h-10 object-contain"
                      />
                      <span className="text-[11px] text-gray-500">
                        {[companyInfo?.nomEntreprise, companyInfo?.formatEntreprise, companyInfo?.tailleEntreprise]
                          .filter((x: string) => String(x || '').trim())
                          .join(' • ')}
                      </span>
                    </div>
                  ) : null}
                  <p className="text-xs uppercase tracking-wide text-gray-500">Procès-verbal de réunion</p>
                  <h1 className="text-xl font-bold text-gray-900 mt-1">{titre.trim() || '—'}</h1>
                  <p className="text-xs text-gray-500 mt-2">
                    Aperçu généré le {new Date().toLocaleString('fr-FR')} — statut :{' '}
                    {PV_STATUTS.find((s) => s.value === statutForm)?.label || statutForm}
                    {dateReunion
                      ? ` — date réunion : ${new Date(dateReunion).toLocaleDateString('fr-FR')}`
                      : ''}
                  </p>
                </header>
                <div
                  className="prose-pv-preview"
                  dangerouslySetInnerHTML={{ __html: contenuHtml || '<p></p>' }}
                />
                <style>{`
                  .prose-pv-preview h2 { font-size: 1.05rem; font-weight: 700; margin: 0.65rem 0 0.3rem; }
                  .prose-pv-preview h3 { font-size: 0.95rem; font-weight: 600; margin: 0.5rem 0 0.25rem; }
                  .prose-pv-preview p { margin: 0.3rem 0; }
                  .prose-pv-preview ul, .prose-pv-preview ol { margin: 0.3rem 0 0.3rem 1.1rem; }
                  .prose-pv-preview table { border-collapse: collapse; width: 100%; margin: 0.4rem 0; font-size: 12px; }
                  .prose-pv-preview th, .prose-pv-preview td { border: 1px solid #ccc; padding: 4px 6px; }
                  .prose-pv-preview th { background: #f3f4f6; font-weight: 600; }
                `}</style>
              </div>

              <div className="grid md:grid-cols-2 gap-3">
                <IdChips
                  label="Présents (utilisateurs)"
                  options={users}
                  selected={presentUserIds}
                  onChange={setPresentUserIds}
                  renderLabel={(x) => `${x.prenom} ${x.nom}`}
                />
                <IdChips
                  label="Présents (clients / fournisseurs)"
                  options={clientsFournisseurs}
                  selected={presentCfIds}
                  onChange={setPresentCfIds}
                  renderLabel={clientFournisseurLabel}
                />
              </div>

              <p className="text-xs text-gray-500">
                Rattachements : les user stories impliquent leurs tâches ; les epics impliquent leurs user stories
                et leurs tâches.
              </p>
              <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
                <IdChips
                  label="Projets"
                  options={projets}
                  selected={projetIds}
                  onChange={setProjetIds}
                  renderLabel={(x) => x.nom || x.codeProjet}
                />
                <IdChips
                  label="Tâches"
                  options={taches}
                  selected={tacheIds}
                  onChange={setTacheIds}
                  renderLabel={(x) => x.nom}
                />
                <IdChips
                  label="User stories"
                  options={userStories}
                  selected={userStoryIds}
                  onChange={setUserStoryIds}
                  renderLabel={(x) =>
                    (x.description || '').length > 70
                      ? `${(x.description || '').slice(0, 70)}…`
                      : x.description || x.id
                  }
                />
                <IdChips
                  label="Epics"
                  options={epics}
                  selected={epicIds}
                  onChange={setEpicIds}
                  renderLabel={(x) => x.nom}
                />
                <IdChips
                  label="Contrats"
                  options={contrats}
                  selected={contratIds}
                  onChange={setContratIds}
                  renderLabel={(x) => x.nom}
                />
                <IdChips
                  label="Processus"
                  options={processusList}
                  selected={processusIds}
                  onChange={setProcessusIds}
                  renderLabel={(x) => x.nom}
                />
              </div>

              <IdChips
                label="Délégués modification (en plus du créateur)"
                options={users}
                selected={modificationDelegueIds}
                onChange={setModificationDelegueIds}
                renderLabel={(x) => `${x.prenom} ${x.nom}`}
              />

              <div className="flex justify-end gap-2 pt-4 border-t border-gray-100">
                <button
                  type="button"
                  className="px-4 py-2 text-gray-700 border border-gray-200 rounded-lg"
                  onClick={() => setShowForm(false)}
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg disabled:opacity-50"
                >
                  {saving ? 'Enregistrement…' : 'Créer le PV'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
