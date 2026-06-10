import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { api, API_BASE_URL } from '../services/api';
import axios from 'axios';
import { useAuth } from '../store/auth';
import { canModifyModule } from '../utils/uiModuleRoute';
import { PvReunionAccesModal, type PvReunionAccesDetail } from '../components/PvReunionAccesModal';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { buildStructuredPvHtml } from '../utils/pv-reunion-html-template';
import { htmlElementToPdfBlob } from '../utils/pv-reunion-pdf-preview';

const PV_DETAIL_DROITS_ADMIN =
  'consultation, modification, mise en corbeille, gestion des accès';

const PV_DETAIL_NIVEAU_LABEL: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des accès',
};

const PV_STATUTS = [
  { value: 'brouillon', label: 'Brouillon', color: 'bg-gray-100 text-gray-800' },
  { value: 'en_revision', label: 'En révision', color: 'bg-amber-100 text-amber-900' },
  { value: 'valide', label: 'Validé', color: 'bg-green-100 text-green-800' },
  { value: 'archive', label: 'Archivé', color: 'bg-slate-200 text-slate-700' },
];

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

const uploadApi = axios.create({ baseURL: API_BASE_URL });
uploadApi.interceptors.request.use((config) => {
  const token = localStorage.getItem('token');
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

type PvActionInput = {
  id: string;
  action: string;
  userIds: string[];
  entiteId: string;
  clientFournisseurId: string;
  dateLimite: string;
  responsableLibre: string;
  notifyAssigned: boolean;
};

function makeActionRow(): PvActionInput {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
    action: '',
    userIds: [],
    entiteId: '',
    clientFournisseurId: '',
    dateLimite: '',
    responsableLibre: '',
    notifyAssigned: false,
  };
}

function normalizeSectionTitle(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function stripH2NumberingInHtml(html: string): string {
  return String(html || '').replace(/<h2([^>]*)>\s*\d+\.\s*/gi, '<h2$1>');
}

function normalizeKey(s: string): string {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parsePvStructuredFieldsFromHtml(html: string): {
  ordreDuJour: string;
  pointsDiscutes: string;
  decisions: string;
  risquesBlocages: string;
  conclusion: string;
  actions: PvActionInput[];
} {
  const toInputDate = (value: string): string => {
    const v = String(value || '').trim();
    if (!v) return '';
    // yyyy-MM-dd
    const isoMatch = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
    // dd/MM/yyyy or dd-MM-yyyy
    const frMatch = v.match(/^(\d{2})[\/-](\d{2})[\/-](\d{4})$/);
    if (frMatch) return `${frMatch[3]}-${frMatch[2]}-${frMatch[1]}`;
    const parsed = new Date(v);
    if (Number.isNaN(parsed.getTime())) return '';
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const d = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  if (!html || typeof window === 'undefined') {
    return { ordreDuJour: '', pointsDiscutes: '', decisions: '', risquesBlocages: '', conclusion: '', actions: [] };
  }
  const doc = new DOMParser().parseFromString(`<div id="pv-root">${html}</div>`, 'text/html');
  const root = doc.getElementById('pv-root');
  if (!root) return { ordreDuJour: '', pointsDiscutes: '', decisions: '', risquesBlocages: '', conclusion: '', actions: [] };

  const sections = new Map<string, Element[]>();
  let current = '';
  for (const node of Array.from(root.children)) {
    if (node.tagName.toLowerCase() === 'h2') {
      current = normalizeSectionTitle(node.textContent || '');
      if (!sections.has(current)) sections.set(current, []);
      continue;
    }
    if (!current) continue;
    sections.get(current)!.push(node);
  }

  const pick = (matcher: (k: string) => boolean): Element[] => {
    for (const [k, nodes] of sections.entries()) {
      if (matcher(k)) return nodes;
    }
    return [];
  };
  const textFromNodes = (nodes: Element[]) =>
    nodes
      .map((n) => (n.textContent || '').trim())
      .filter(Boolean)
      .join('\n');
  const listTextFromNodes = (nodes: Element[]) => {
    const lis = nodes.flatMap((n) => Array.from(n.querySelectorAll('li')));
    if (lis.length) return lis.map((li) => (li.textContent || '').trim()).filter(Boolean).join('\n');
    return textFromNodes(nodes);
  };

  const ordreNodes = pick((k) => k.includes('ordre du jour'));
  const pointsNodes = pick((k) => k.includes('points discutes'));
  const decisionsNodes = pick((k) => k.includes('decisions prises'));
  const risquesNodes = pick((k) => k.includes('risques / blocages') || k.includes('risques / blocage'));
  const conclusionNodes = pick((k) => k.includes('conclusion'));
  const actionsNodes = pick((k) => k.includes('actions a realiser'));
  const table = actionsNodes.find((n) => n.tagName.toLowerCase() === 'table') || actionsNodes[0]?.querySelector('table');
  const actionRows: PvActionInput[] = [];
  if (table) {
    const rows = Array.from(table.querySelectorAll('tbody tr, tr'));
    for (const tr of rows) {
      const cells = Array.from(tr.querySelectorAll('td'));
      if (!cells.length) continue;
      const action = (cells[0]?.textContent || '').trim();
      const responsable = (cells[1]?.textContent || '').trim();
      const dateLimite = toInputDate((cells[2]?.textContent || '').trim());
      const userIdAttr = (tr as HTMLTableRowElement).getAttribute('data-user-id') || '';
      const userIdsAttr = (tr as HTMLTableRowElement).getAttribute('data-user-ids') || '';
      const entiteIdAttr = (tr as HTMLTableRowElement).getAttribute('data-entite-id') || '';
      const cfIdAttr = (tr as HTMLTableRowElement).getAttribute('data-cf-id') || '';
      const notifyAttr = (tr as HTMLTableRowElement).getAttribute('data-notify') || '';
      let userIdsParsed: string[] = [];
      if (userIdsAttr) {
        try {
          const raw = JSON.parse(userIdsAttr);
          if (Array.isArray(raw)) {
            userIdsParsed = raw.map((x) => String(x || '').trim()).filter(Boolean);
          }
        } catch {
          userIdsParsed = [];
        }
      }
      if (!userIdsParsed.length && userIdAttr.trim()) {
        userIdsParsed = [userIdAttr.trim()];
      }
      if (!action && !responsable && !dateLimite) continue;
      actionRows.push({
        ...makeActionRow(),
        action,
        dateLimite,
        userIds: userIdsParsed,
        entiteId: entiteIdAttr.trim(),
        clientFournisseurId: cfIdAttr.trim(),
        responsableLibre: responsable,
        notifyAssigned: notifyAttr === '1',
      });
    }
  }

  return {
    ordreDuJour: listTextFromNodes(ordreNodes),
    pointsDiscutes: textFromNodes(pointsNodes),
    decisions: listTextFromNodes(decisionsNodes),
    risquesBlocages: textFromNodes(risquesNodes),
    conclusion: textFromNodes(conclusionNodes),
    actions: actionRows,
  };
}

function IdChips({
  label,
  options,
  selected,
  onChange,
  renderLabel,
  disabled,
  searchable,
  searchPlaceholder,
}: {
  label: string;
  options: { id: string }[];
  selected: string[];
  onChange: (ids: string[]) => void;
  renderLabel: (x: any) => string;
  disabled?: boolean;
  searchable?: boolean;
  searchPlaceholder?: string;
}) {
  const [query, setQuery] = useState('');
  const q = query.trim().toLowerCase();
  const shown = useMemo(() => {
    if (!q) return options;
    return options.filter((x: any) => String(renderLabel(x) || '').toLowerCase().includes(q));
  }, [options, q, renderLabel]);

  return (
    <div className="border border-gray-200 rounded-lg p-3 bg-gray-50 max-h-44 overflow-y-auto">
      <p className="text-xs font-semibold text-gray-600 mb-2">{label}</p>
      {searchable && (
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder || 'Rechercher...'}
          className="w-full border border-gray-200 rounded-md px-2 py-1 text-xs mb-2 bg-white"
        />
      )}
      <div className="space-y-1">
        {shown.map((x: any) => (
          <label
            key={x.id}
            className={`flex items-start gap-2 text-sm rounded px-1 ${disabled ? 'opacity-60' : 'cursor-pointer hover:bg-white/80'}`}
          >
            <input
              type="checkbox"
              className="mt-1"
              disabled={disabled}
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
        {shown.length === 0 && (
          <p className="text-xs text-gray-400 italic">Aucun résultat</p>
        )}
      </div>
    </div>
  );
}

export default function PvReunionDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const [pv, setPv] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [editMode, setEditMode] = useState(false);
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
  const [statutPv, setStatutPv] = useState('brouillon');
  const [dateReunion, setDateReunion] = useState('');
  const [presentUserIds, setPresentUserIds] = useState<string[]>([]);
  const [presentCfIds, setPresentCfIds] = useState<string[]>([]);
  const [projetIds, setProjetIds] = useState<string[]>([]);
  const [tacheIds, setTacheIds] = useState<string[]>([]);
  const [userStoryIds, setUserStoryIds] = useState<string[]>([]);
  const [epicIds, setEpicIds] = useState<string[]>([]);
  const [contratIds, setContratIds] = useState<string[]>([]);
  const [processusIds, setProcessusIds] = useState<string[]>([]);
  const [modificationDelegueIds, setModificationDelegueIds] = useState<string[]>([]);

  const [commentContenu, setCommentContenu] = useState('');
  const [commentAssigne, setCommentAssigne] = useState('');
  const [commentFile, setCommentFile] = useState<File | null>(null);
  const [commentSending, setCommentSending] = useState(false);

  const [showAccesModal, setShowAccesModal] = useState(false);
  const [accesSynth, setAccesSynth] = useState<PvReunionAccesDetail | null>(null);
  const [accesSynthLoading, setAccesSynthLoading] = useState(false);
  const [histOpen, setHistOpen] = useState(false);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);

  const [contenuHtml, setContenuHtml] = useState('');
  const [ordreDuJourInput, setOrdreDuJourInput] = useState('');
  const [pointsDiscutesInput, setPointsDiscutesInput] = useState('');
  const [decisionsInput, setDecisionsInput] = useState('');
  const [risquesBlocagesInput, setRisquesBlocagesInput] = useState('');
  const [conclusionInput, setConclusionInput] = useState('');
  const [actionsInput, setActionsInput] = useState<PvActionInput[]>([]);
  const previewPvRef = useRef<HTMLDivElement | null>(null);
  const [pdfPreviewDetailLoading, setPdfPreviewDetailLoading] = useState(false);
  const [contenuVersionsOpen, setContenuVersionsOpen] = useState(false);
  const [contenuVersions, setContenuVersions] = useState<
    { id: string; createdAt: string; preview: string; createdBy?: { prenom?: string; nom?: string } }[]
  >([]);
  const [contenuVersionsLoading, setContenuVersionsLoading] = useState(false);
  const [versionRestoreId, setVersionRestoreId] = useState<string | null>(null);

  const canModule = canModifyModule(user?.uiModules, 'pv_reunion');
  const canEdit = !!(pv?.capabilities?.canModify && canModule);
  const inferResponsableSelection = (
    row: PvActionInput
  ): { userIds: string[]; entiteId: string; clientFournisseurId: string } => {
    if ((row.userIds && row.userIds.length) || row.entiteId || row.clientFournisseurId) {
      return {
        userIds: row.userIds || [],
        entiteId: row.entiteId,
        clientFournisseurId: row.clientFournisseurId,
      };
    }
    const key = normalizeKey(row.responsableLibre);
    if (!key) {
      return {
        userIds: row.userIds || [],
        entiteId: row.entiteId,
        clientFournisseurId: row.clientFournisseurId,
      };
    }
    const matchedUser = users.find((u: any) => normalizeKey(`${u.prenom} ${u.nom}`) === key);
    if (matchedUser) return { userIds: [String(matchedUser.id)], entiteId: '', clientFournisseurId: '' };
    const matchedEntite = entites.find((e: any) => normalizeKey(e.nom || '') === key);
    if (matchedEntite) return { userIds: [], entiteId: String(matchedEntite.id), clientFournisseurId: '' };
    const matchedCf = clientsFournisseurs.find((cf: any) => normalizeKey(clientFournisseurLabel(cf)) === key);
    if (matchedCf) return { userIds: [], entiteId: '', clientFournisseurId: String(matchedCf.id) };
    return {
      userIds: row.userIds || [],
      entiteId: row.entiteId,
      clientFournisseurId: row.clientFournisseurId,
    };
  };
  const parseLines = (s: string) =>
    String(s || '')
      .split(/\n+/)
      .map((x) => x.trim())
      .filter(Boolean);
  const toFrDateLabel = (value: string): string => {
    const v = String(value || '').trim();
    if (!v) return '';
    const m = v.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!m) return v;
    const y = Number(m[1]);
    const mo = Number(m[2]);
    const d = Number(m[3]);
    const dt = new Date(y, mo - 1, d);
    if (Number.isNaN(dt.getTime())) return v;
    return dt.toLocaleDateString('fr-FR');
  };

  const projectScopedTaskIds = useMemo(() => {
    if (!projetIds.length) return new Set<string>();
    const selectedProjects = new Set(projetIds);
    return new Set(
      taches
        .filter((t: any) => t?.projetId && selectedProjects.has(String(t.projetId)))
        .map((t: any) => String(t.id))
    );
  }, [projetIds, taches]);

  const filteredTaches = useMemo(() => {
    if (!projetIds.length) return taches;
    return taches.filter((t: any) => projectScopedTaskIds.has(String(t.id)));
  }, [projetIds, taches, projectScopedTaskIds]);

  const filteredEpics = useMemo(() => {
    if (!projetIds.length) return epics;
    const selectedProjects = new Set(projetIds);
    return epics.filter((e: any) => e?.projetId && selectedProjects.has(String(e.projetId)));
  }, [projetIds, epics]);

  const filteredUserStories = useMemo(() => {
    if (!projetIds.length) return userStories;
    const selectedProjects = new Set(projetIds);
    return userStories.filter((us: any) => {
      const epicProjectId = us?.epic?.projetId ? String(us.epic.projetId) : '';
      if (epicProjectId && selectedProjects.has(epicProjectId)) return true;
      if (us?.projetId && selectedProjects.has(String(us.projetId))) return true;
      // Fallback: user story liée à une tâche du projet sélectionné.
      return taches.some(
        (t: any) =>
          t?.userStoryId === us?.id && t?.projetId && selectedProjects.has(String(t.projetId))
      );
    });
  }, [projetIds, userStories, taches]);

  useEffect(() => {
    if (!projetIds.length) return;
    const allowedTaskIds = new Set(filteredTaches.map((x: any) => String(x.id)));
    const allowedEpicIds = new Set(filteredEpics.map((x: any) => String(x.id)));
    const allowedUserStoryIds = new Set(filteredUserStories.map((x: any) => String(x.id)));

    setTacheIds((prev) => prev.filter((id) => allowedTaskIds.has(String(id))));
    setEpicIds((prev) => prev.filter((id) => allowedEpicIds.has(String(id))));
    setUserStoryIds((prev) => prev.filter((id) => allowedUserStoryIds.has(String(id))));
  }, [projetIds, filteredTaches, filteredEpics, filteredUserStories]);

  const load = async () => {
    if (!id) return;
    setLoading(true);
    try {
      const r = await api.get(`/pv-reunions/${id}`);
      setPv(r.data);
    } catch {
      setPv(null);
    } finally {
      setLoading(false);
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
      /* */
    }
  };

  useEffect(() => {
    load();
  }, [id]);

  useEffect(() => {
    if (!id) return;
    setAccesSynthLoading(true);
    api
      .get(`/pv-reunions/${id}/acces`)
      .then((r) => setAccesSynth(r.data))
      .catch(() => setAccesSynth(null))
      .finally(() => setAccesSynthLoading(false));
  }, [id]);

  useEffect(() => {
    const st = location.state as { openEdit?: boolean } | null;
    if (st?.openEdit) {
      setEditMode(true);
      navigate(location.pathname, { replace: true, state: {} });
    }
  }, [id]);

  useEffect(() => {
    if (!pv) return;
    setTitre(pv.titre || '');
    setStatutPv(pv.statut || 'brouillon');
    setDateReunion(pv.dateReunion ? pv.dateReunion.slice(0, 10) : '');
    setPresentUserIds(pv.presentsUser?.map((x: any) => x.userId || x.user?.id) || []);
    setPresentCfIds(
      pv.presentsClientFournisseur?.map((x: any) => x.clientFournisseurId || x.clientFournisseur?.id) || []
    );
    const le = pv.liensExplicites || {};
    setProjetIds(le.projetIds || []);
    setTacheIds(le.tacheIds || []);
    setUserStoryIds(le.userStoryIds || []);
    setEpicIds(le.epicIds || []);
    setContratIds(le.contratIds || []);
    setProcessusIds(le.processusIds || []);
    setModificationDelegueIds(pv.modificationDelegues?.map((x: any) => x.userId || x.user?.id) || []);
    setContenuHtml(pv.contenuHtml || '');
    const parsed = parsePvStructuredFieldsFromHtml(pv.contenuHtml || '');
    setOrdreDuJourInput(parsed.ordreDuJour || '');
    setPointsDiscutesInput(parsed.pointsDiscutes || '');
    setDecisionsInput(parsed.decisions || '');
    setRisquesBlocagesInput(parsed.risquesBlocages || '');
    setConclusionInput(parsed.conclusion || '');
    setActionsInput(parsed.actions || []);
  }, [pv]);

  useEffect(() => {
    if (!editMode || (!users.length && !entites.length)) return;
    setActionsInput((prev) => {
      let changed = false;
      const next = prev.map((row) => {
        if ((row.userIds && row.userIds.length) || row.entiteId || row.clientFournisseurId || !row.responsableLibre) return row;
        const inferred = inferResponsableSelection(row);
        if ((inferred.userIds && inferred.userIds.length) || inferred.entiteId || inferred.clientFournisseurId) {
          changed = true;
          return { ...row, ...inferred };
        }
        return row;
      });
      return changed ? next : prev;
    });
  }, [editMode, users, entites, clientsFournisseurs]);

  useEffect(() => {
    const statutLabel = PV_STATUTS.find((s) => s.value === statutPv)?.label || statutPv;
    const dateLabel = dateReunion
      ? new Date(dateReunion).toLocaleDateString('fr-FR', { day: '2-digit', month: 'long', year: 'numeric' })
      : '—';
    const usersLines = presentUserIds
      .map((uid) => {
        const u = users.find((x: any) => x.id === uid);
        return u ? `${u.prenom} ${u.nom}` : uid;
      })
      .filter(Boolean);
    const cfLines = presentCfIds
      .map((cid) => {
        const c = clientsFournisseurs.find((x: any) => x.id === cid);
        return c ? clientFournisseurLabel(c) : cid;
      })
      .filter(Boolean);
    const projetsLines = projetIds
      .map((pid) => {
        const p = projets.find((x: any) => x.id === pid);
        return p ? String(p.nom || p.codeProjet || pid) : pid;
      })
      .filter(Boolean);
    const tachesLines = tacheIds
      .map((tid) => {
        const t = taches.find((x: any) => x.id === tid);
        return t ? String(t.nom || tid) : tid;
      })
      .filter(Boolean);
    const usLines = userStoryIds
      .map((sid) => {
        const us = userStories.find((x: any) => x.id === sid);
        const d = String(us?.description || '').trim();
        return d ? (d.length > 120 ? `${d.slice(0, 120)}…` : d) : sid;
      })
      .filter(Boolean);
    const epicLines = epicIds
      .map((eid) => {
        const ep = epics.find((x: any) => x.id === eid);
        return ep ? String(ep.nom || eid) : eid;
      })
      .filter(Boolean);
    const actionsRows = actionsInput
      .map((a) => {
        const selectedUsers = users.filter((x: any) => (a.userIds || []).includes(String(x.id)));
        const en = entites.find((x: any) => x.id === a.entiteId);
        const cf = clientsFournisseurs.find((x: any) => x.id === a.clientFournisseurId);
        const usersLabel = selectedUsers.map((u: any) => `${u.prenom} ${u.nom}`).join(', ');
        const responsableAuto = [usersLabel, en ? en.nom : '', cf ? clientFournisseurLabel(cf) : '']
          .filter(Boolean)
          .join(' / ');
        const responsable = responsableAuto || String(a.responsableLibre || '').trim();
        return {
          action: a.action.trim(),
          responsable,
          dateLimite: a.dateLimite ? toFrDateLabel(a.dateLimite) : '',
          userIds: a.userIds || [],
          entiteId: a.entiteId,
          clientFournisseurId: a.clientFournisseurId,
          notifyAssigned: !!a.notifyAssigned,
        };
      })
      .filter((a) => a.action || a.responsable || a.dateLimite);

    setContenuHtml(
      buildStructuredPvHtml({
        titre: titre.trim() || pv?.titre || 'Réunion',
        statutLabel,
        dateReunionLabel: dateLabel,
        derniereMiseAJourLabel: pv?.contenuUpdatedAt
          ? new Date(pv.contenuUpdatedAt).toLocaleString('fr-FR')
          : pv?.updatedAt
            ? new Date(pv.updatedAt).toLocaleString('fr-FR')
            : '—',
        usersLines,
        cfLines,
        projetsLines,
        tachesLines,
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
    titre,
    statutPv,
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
    pv?.titre,
  ]);

  useEffect(() => {
    if (editMode) loadRefs();
  }, [editMode]);

  useEffect(() => {
    if (pv && !editMode) {
      api.get('/users').then((r) => setUsers(r.data || [])).catch(() => {});
    }
  }, [pv?.id, editMode]);

  const saveEdit = async () => {
    if (!id) return;
    setSaving(true);
    try {
      await api.put(`/pv-reunions/${id}`, {
        titre: titre.trim(),
        statut: statutPv,
        dateReunion: dateReunion ? new Date(dateReunion).toISOString() : null,
        presentUserIds,
        presentClientFournisseurIds: presentCfIds,
        projetIds,
        tacheIds,
        userStoryIds,
        epicIds,
        contratIds,
        processusIds,
        modificationDelegueIds,
        contenuHtml,
      });
      setEditMode(false);
      await load();
      try {
        const { data } = await api.get(`/pv-reunions/${id}/acces`);
        setAccesSynth(data);
      } catch {
        /* garde l’ancienne synthèse */
      }
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !window.confirm('Mettre ce PV en corbeille ? Vous pourrez le restaurer depuis la liste (bouton Corbeille).'))
      return;
    try {
      await api.delete(`/pv-reunions/${id}`);
      navigate('/pv-reunion');
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    }
  };

  const sendComment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!id || !commentContenu.trim()) return;
    setCommentSending(true);
    try {
      const fd = new FormData();
      fd.append('contenu', commentContenu.trim());
      if (commentAssigne) fd.append('assigneAId', commentAssigne);
      if (commentFile) fd.append('fichier', commentFile);
      await uploadApi.post(`/pv-reunions/${id}/commentaires`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setCommentContenu('');
      setCommentAssigne('');
      setCommentFile(null);
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message);
    } finally {
      setCommentSending(false);
    }
  };

  const downloadCommentPiece = async (commentId: string, filename: string) => {
    if (!id) return;
    try {
      const res = await api.get(`/pv-reunions/${id}/commentaires/${commentId}/piece`, {
        responseType: 'blob',
      });
      const url = window.URL.createObjectURL(res.data);
      const a = document.createElement('a');
      a.href = url;
      a.download = filename || 'piece-jointe';
      a.click();
      window.URL.revokeObjectURL(url);
    } catch {
      alert('Téléchargement impossible.');
    }
  };

  const openHistorique = async () => {
    if (!id) return;
    setHistOpen(true);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/pv-reunions/${id}/history?page=1&limit=200`);
      setHistoList(data?.data || []);
    } catch {
      setHistoList([]);
      alert("Impossible de charger l'historique.");
    } finally {
      setHistoLoading(false);
    }
  };

  const contenuHtmlHasText = (html: string) =>
    html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().length > 0;

  const openContenuVersions = async () => {
    if (!id) return;
    setContenuVersionsOpen(true);
    setContenuVersionsLoading(true);
    try {
      const { data } = await api.get(`/pv-reunions/${id}/contenu-versions`);
      setContenuVersions(Array.isArray(data) ? data : []);
    } catch {
      setContenuVersions([]);
    } finally {
      setContenuVersionsLoading(false);
    }
  };

  const restoreContenuVersion = async (versionId: string) => {
    if (!id) return;
    setVersionRestoreId(versionId);
    try {
      const { data } = await api.get(`/pv-reunions/${id}/contenu-versions/${versionId}`);
      setContenuHtml(data.contenuHtml || '');
      setContenuVersionsOpen(false);
    } catch {
      alert('Impossible de charger cette version.');
    } finally {
      setVersionRestoreId(null);
    }
  };

  const saveContenuVersionSnapshot = async () => {
    if (!id) return;
    if (!contenuHtmlHasText(contenuHtml)) {
      alert('Le contenu est vide.');
      return;
    }
    try {
      await api.patch(`/pv-reunions/${id}/contenu`, { contenuHtml });
      await load();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handlePreviewPdfDetail = async () => {
    if (!previewPvRef.current || !contenuHtmlHasText(contenuHtml)) {
      alert('Rédigez d’abord le contenu du PV.');
      return;
    }
    setPdfPreviewDetailLoading(true);
    try {
      const blob = await htmlElementToPdfBlob(previewPvRef.current, {
        footerAddress: String(companyInfo?.adresseEntreprise || '').trim(),
      });
      const url = URL.createObjectURL(blob);
      window.open(url, '_blank', 'noopener,noreferrer');
      window.setTimeout(() => URL.revokeObjectURL(url), 120_000);
    } catch {
      alert('Impossible de générer l’aperçu PDF.');
    } finally {
      setPdfPreviewDetailLoading(false);
    }
  };

  const handleOpenStoredPdfDetail = async () => {
    if (!pv?.document?.id) {
      alert('Document PDF du PV introuvable.');
      return;
    }
    if (!previewPvRef.current || !contenuHtmlHasText(contenuHtml)) {
      alert('Rédigez d’abord le contenu du PV.');
      return;
    }
    setPdfPreviewDetailLoading(true);
    try {
      // Génère le PDF avec le rendu "aperçu", puis l’enregistre comme nouvelle version
      // du document principal afin que la page Documents affiche exactement le même format.
      const blob = await htmlElementToPdfBlob(previewPvRef.current, {
        footerAddress: String(companyInfo?.adresseEntreprise || '').trim(),
      });
      const fileName = `${(pv.titre || 'PV').replace(/[^\w.-]+/g, '_')}.pdf`;
      const file = new File([blob], fileName, { type: 'application/pdf' });
      const fd = new FormData();
      // Même champ que multer (`upload.single('file')`) — voir document.controller.ts
      fd.append('file', file);
      fd.append('commentaireVersion', 'Synchronisation depuis aperçu PDF (détail PV)');
      await uploadApi.post(`/documents/${pv.document.id}/versions`, fd);
      await load();
      const token = localStorage.getItem('token');
      const url = `${API_BASE_URL}/documents/${pv.document.id}/view${token ? `?token=${token}` : ''}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      alert('Impossible de synchroniser le PDF du document avec le rendu aperçu.');
    } finally {
      setPdfPreviewDetailLoading(false);
    }
  };

  if (loading) {
    return <div className="p-6 text-center text-gray-500">Chargement…</div>;
  }

  if (!pv) {
    return (
      <div className="p-6">
        <p className="text-gray-600">PV introuvable.</p>
        <button
          type="button"
          onClick={() => navigate('/pv-reunion')}
          className="text-blue-600 hover:underline mt-4 text-sm"
        >
          ← Retour à la liste
        </button>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <div className="flex flex-col gap-1">
          <button
            type="button"
            onClick={() => navigate('/pv-reunion')}
            className="text-gray-500 hover:text-gray-700 text-sm flex items-center gap-1 w-fit"
          >
            ← Retour aux PV de réunion
          </button>
          <h1 className="text-2xl font-bold text-gray-900">PV de réunion</h1>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow p-5 mb-6">
        <div className="flex flex-col lg:flex-row lg:justify-between lg:items-start gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex flex-wrap items-center gap-2 mb-1">
              <h2 className="text-lg font-semibold text-gray-900">{pv.titre}</h2>
              {(() => {
                const st = PV_STATUTS.find((s) => s.value === pv.statut) || PV_STATUTS[0];
                return (
                  <span className={`px-2 py-0.5 rounded text-xs font-medium ${st.color}`}>{st.label}</span>
                );
              })()}
            </div>
            <p className="text-[11px] font-mono text-gray-400 break-all mb-3" title={pv.id}>
              ID : {pv.id}
            </p>

        {!editMode ? (
          <div className="grid md:grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-gray-500">Commentaires : </span>
              <span className="font-semibold text-blue-700">{pv.nombreCommentaires ?? 0}</span>
            </div>
            <div>
              <span className="text-gray-500">Vues (journal) : </span>
              <span className="font-semibold text-blue-700">{pv.nombreVues ?? 0}</span>
            </div>
            <div>
              <span className="text-gray-500">Date de réunion : </span>
              <span className="font-medium">
                {pv.dateReunion ? new Date(pv.dateReunion).toLocaleDateString('fr-FR') : '—'}
              </span>
            </div>
            <div>
              <span className="text-gray-500">Créé par : </span>
              <span className="font-medium">
                {pv.createdBy ? `${pv.createdBy.prenom} ${pv.createdBy.nom}` : '—'}
              </span>
            </div>
            <div className="md:col-span-2">
              <span className="text-gray-500">Document principal : </span>
              {pv.document?.id ? (
                <a
                  href={`${API_BASE_URL}/documents/${pv.document.id}/view?token=${localStorage.getItem('token')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline font-medium"
                >
                  {pv.document.nom || pv.document.fichierNomOriginal}
                </a>
              ) : (
                '—'
              )}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Titre</label>
              <input
                className="w-full border border-gray-200 rounded-md px-3 py-2"
                value={titre}
                onChange={(e) => setTitre(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Statut</label>
              <select
                className="w-full border border-gray-200 rounded-md px-3 py-2"
                value={statutPv}
                onChange={(e) => setStatutPv(e.target.value)}
              >
                {PV_STATUTS.map((s) => (
                  <option key={s.value} value={s.value}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1">Date de réunion</label>
              <input
                type="date"
                className="w-full border border-gray-200 rounded-md px-3 py-2"
                value={dateReunion}
                onChange={(e) => setDateReunion(e.target.value)}
              />
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
              Règles de propagation : user stories → tâches ; epics → user stories et tâches.
            </p>
            <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-3">
              <IdChips
                label="Projets"
                options={projets}
                selected={projetIds}
                onChange={setProjetIds}
                renderLabel={(x) => x.nom || x.codeProjet}
                searchable
                searchPlaceholder="Rechercher un projet..."
              />
              <IdChips
                label="Tâches"
                options={filteredTaches}
                selected={tacheIds}
                onChange={setTacheIds}
                renderLabel={(x) => x.nom}
                searchable
                searchPlaceholder="Rechercher une tâche..."
              />
              <IdChips
                label="User stories"
                options={filteredUserStories}
                selected={userStoryIds}
                onChange={setUserStoryIds}
                renderLabel={(x) =>
                  (x.description || '').length > 60
                    ? `${(x.description || '').slice(0, 60)}…`
                    : x.description || x.id
                }
                searchable
                searchPlaceholder="Rechercher une user story..."
              />
              <IdChips
                label="Epics"
                options={filteredEpics}
                selected={epicIds}
                onChange={setEpicIds}
                renderLabel={(x) => x.nom}
                searchable
                searchPlaceholder="Rechercher un epic..."
              />
              <IdChips
                label="Contrats"
                options={contrats}
                selected={contratIds}
                onChange={setContratIds}
                renderLabel={(x) => x.nom}
                searchable
                searchPlaceholder="Rechercher un contrat..."
              />
              <IdChips
                label="Processus"
                options={processusList}
                selected={processusIds}
                onChange={setProcessusIds}
                renderLabel={(x) => x.nom}
                searchable
                searchPlaceholder="Rechercher un processus..."
              />
            </div>
            <IdChips
              label="Délégués modification"
              options={users}
              selected={modificationDelegueIds}
              onChange={setModificationDelegueIds}
              renderLabel={(x) => `${x.prenom} ${x.nom}`}
            />

            <div className="border-t border-gray-100 pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Points discutés</h3>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => void saveContenuVersionSnapshot()}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Sauvegarder une version (historique)
                </button>
                <button
                  type="button"
                  onClick={() => void openContenuVersions()}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50"
                >
                  Versions enregistrées
                </button>
                <button
                  type="button"
                  onClick={() => void handlePreviewPdfDetail()}
                  disabled={pdfPreviewDetailLoading}
                  className="px-3 py-1.5 text-xs font-medium rounded-md border border-gray-300 bg-white hover:bg-gray-50 disabled:opacity-50"
                >
                  {pdfPreviewDetailLoading ? 'Aperçu…' : 'Aperçu PDF'}
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Ordre du jour</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[84px]"
                    placeholder="Une ligne par point..."
                    value={ordreDuJourInput}
                    onChange={(e) => setOrdreDuJourInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Points discutés</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[110px]"
                    value={pointsDiscutesInput}
                    onChange={(e) => setPointsDiscutesInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Décisions prises</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[84px]"
                    placeholder="Une ligne par décision..."
                    value={decisionsInput}
                    onChange={(e) => setDecisionsInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Risques / Blocages</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[84px]"
                    value={risquesBlocagesInput}
                    onChange={(e) => setRisquesBlocagesInput(e.target.value)}
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Conclusion</label>
                  <textarea
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[84px]"
                    value={conclusionInput}
                    onChange={(e) => setConclusionInput(e.target.value)}
                  />
                </div>
                <div className="border border-gray-200 rounded-lg p-3 bg-gray-50">
                  <div className="flex items-center justify-between mb-2">
                    <p className="text-xs font-semibold text-gray-700">Actions à réaliser</p>
                    <button
                      type="button"
                      onClick={() => setActionsInput((prev) => [...prev, makeActionRow()])}
                      className="px-2 py-1 text-xs rounded bg-indigo-600 text-white hover:bg-indigo-700"
                    >
                      + Ajouter une action
                    </button>
                  </div>
                  {!actionsInput.length && (
                    <p className="text-xs text-gray-400 italic">Aucune action.</p>
                  )}
                  <div className="space-y-2">
                    {actionsInput.map((row) => (
                      <div key={row.id} className="grid lg:grid-cols-14 gap-2 items-start">
                        <input
                          className="lg:col-span-4 border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                          placeholder="Action"
                          value={row.action}
                          onChange={(e) =>
                            setActionsInput((prev) =>
                              prev.map((x) => (x.id === row.id ? { ...x, action: e.target.value } : x))
                            )
                          }
                        />
                        <select
                          className="lg:col-span-2 border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                          value={row.entiteId}
                          onChange={(e) =>
                            setActionsInput((prev) =>
                              prev.map((x) => (x.id === row.id ? { ...x, entiteId: e.target.value } : x))
                            )
                          }
                        >
                          <option value="">Entité (optionnel)</option>
                          {entites.map((en: any) => (
                            <option key={en.id} value={en.id}>
                              {en.nom}
                            </option>
                          ))}
                        </select>
                        <div className="lg:col-span-3 border border-gray-200 rounded-md px-2 py-1.5 text-sm bg-white max-h-28 overflow-y-auto">
                          <p className="text-[11px] text-gray-500 mb-1">Utilisateurs (multi)</p>
                          <div className="space-y-1">
                            {users.map((u: any) => (
                              <label key={u.id} className="flex items-center gap-2 text-xs cursor-pointer">
                                <input
                                  type="checkbox"
                                  checked={(row.userIds || []).includes(String(u.id))}
                                  onChange={(e) =>
                                    setActionsInput((prev) =>
                                      prev.map((x) =>
                                        x.id === row.id
                                          ? {
                                              ...x,
                                              userIds: e.target.checked
                                                ? [...new Set([...(x.userIds || []), String(u.id)])]
                                                : (x.userIds || []).filter((id) => id !== String(u.id)),
                                            }
                                          : x
                                      )
                                    )
                                  }
                                />
                                <span>
                                  {u.prenom} {u.nom}
                                </span>
                              </label>
                            ))}
                          </div>
                        </div>
                        <select
                          className="lg:col-span-2 border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                          value={row.clientFournisseurId}
                          onChange={(e) =>
                            setActionsInput((prev) =>
                              prev.map((x) =>
                                x.id === row.id ? { ...x, clientFournisseurId: e.target.value } : x
                              )
                            )
                          }
                        >
                          <option value="">Client/Fournisseur (optionnel)</option>
                          {clientsFournisseurs.map((cf: any) => (
                            <option key={cf.id} value={cf.id}>
                              {clientFournisseurLabel(cf)}
                            </option>
                          ))}
                        </select>
                        <div className="lg:col-span-3 flex gap-2">
                          <input
                            type="date"
                            className="flex-1 border border-gray-200 rounded-md px-2 py-1.5 text-sm"
                            value={row.dateLimite}
                            onChange={(e) =>
                              setActionsInput((prev) =>
                                prev.map((x) => (x.id === row.id ? { ...x, dateLimite: e.target.value } : x))
                              )
                            }
                          />
                          <label className="inline-flex items-center gap-1 text-xs text-gray-700 px-2 border border-gray-200 rounded-md bg-white">
                            <input
                              type="checkbox"
                              checked={!!row.notifyAssigned}
                              onChange={(e) =>
                                setActionsInput((prev) =>
                                  prev.map((x) =>
                                    x.id === row.id ? { ...x, notifyAssigned: e.target.checked } : x
                                  )
                                )
                              }
                            />
                            Notifier
                          </label>
                          <button
                            type="button"
                            onClick={() =>
                              setActionsInput((prev) => prev.filter((x) => x.id !== row.id))
                            }
                            className="px-2 text-xs rounded border border-red-200 text-red-700 hover:bg-red-50"
                            title="Supprimer la ligne"
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <p className="text-[11px] text-gray-500">
                Les sections vides (ordre du jour, décisions, risques/blocages, actions, conclusion) ne seront pas affichées
                dans le PDF généré.
              </p>
            </div>
          </div>
        )}
          </div>

          <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
            <button
              type="button"
              onClick={handleOpenStoredPdfDetail}
              className="px-3 py-1.5 text-xs text-center bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
            >
              👁 Consulter le document
            </button>
            {!editMode && (
              <>
                <button
                  type="button"
                  onClick={() => setShowAccesModal(true)}
                  className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200"
                >
                  🔐 Accès
                </button>
                <button
                  type="button"
                  onClick={() => void openHistorique()}
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                >
                  📜 Historique
                </button>
              </>
            )}
            {canEdit && !editMode && (
              <button
                type="button"
                onClick={() => {
                  setContenuHtml(pv.contenuHtml || '');
                  setEditMode(true);
                }}
                className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200"
              >
                ✏️ Modifier
              </button>
            )}
            {canEdit && editMode && (
              <>
                <button
                  type="button"
                  onClick={() => {
                    setEditMode(false);
                    void load();
                  }}
                  className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200"
                >
                  Annuler
                </button>
                <button
                  type="button"
                  onClick={() => void saveEdit()}
                  disabled={saving}
                  className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-50"
                >
                  {saving ? 'Enregistrement…' : 'Enregistrer'}
                </button>
              </>
            )}
            {canEdit && !editMode && (
              <button
                type="button"
                onClick={() => void handleDelete()}
                className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200"
              >
                🗑 Mettre en corbeille
              </button>
            )}
          </div>
        </div>
      </div>

      {!editMode && (
        <>
          <section className="bg-white rounded-lg shadow border border-gray-100 p-6 mb-6">
            <div className="flex flex-col sm:flex-row sm:justify-between sm:items-start gap-3 mb-4">
              <h2 className="text-lg font-semibold text-gray-900">Accès et personnes concernées</h2>
              <button
                type="button"
                onClick={() => setShowAccesModal(true)}
                className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200 shrink-0"
              >
                🔐 Détail des accès (modale)
              </button>
            </div>
            {accesSynthLoading && <p className="text-sm text-gray-500">Chargement…</p>}
            {!accesSynthLoading && accesSynth && (
              <div className="space-y-4 text-sm text-gray-700">
                <p className="text-gray-600 leading-relaxed">{accesSynth.visibilityNote}</p>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Administrateurs</h3>
                  <p className="text-xs text-gray-500 mb-2">
                    Même lecture que la modale « Accès » : exclu, limité (ligne partagée) ou accès complet.
                  </p>
                  <div className="flex flex-col gap-2 text-xs">
                    <AccessContratLikeAdminLines
                      keyPrefix={`pv-detail-${id || 'pv'}`}
                      users={users}
                      createdById={pv?.createdById ?? accesSynth.creator?.id}
                      createdBy={accesSynth.creator}
                      adminSansAccesUserIds={accesSynth.adminSansAccesUserIds}
                      permissions={(accesSynth.delegations || [])
                        .filter((d: any) => d.user?.id)
                        .map((d: any) => ({
                          userId: d.user.id,
                          niveau: d.permission,
                          user: d.user,
                        }))}
                      droitsAdminCompletLabel={PV_DETAIL_DROITS_ADMIN}
                      niveauLabel={(n) => PV_DETAIL_NIVEAU_LABEL[n] || n}
                    />
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Créateur</h3>
                  <p>
                    {accesSynth.creator ? (
                      <>
                        <span className="font-medium">
                          {accesSynth.creator.prenom} {accesSynth.creator.nom}
                        </span>
                        {accesSynth.creator.email && (
                          <span className="text-gray-500 ml-1">({accesSynth.creator.email})</span>
                        )}
                      </>
                    ) : (
                      '—'
                    )}
                  </p>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Accès partagés</h3>
                  <div className="flex flex-wrap gap-2">
                    {(accesSynth.delegations || []).length === 0 && (
                      <span className="text-gray-400 italic">Aucune délégation explicite</span>
                    )}
                    {(accesSynth.delegations || []).map((d: any) => (
                      <span
                        key={d.id}
                        className="px-2 py-1 bg-indigo-50 text-indigo-900 rounded text-xs"
                        title={d.permission}
                      >
                        {d.user?.prenom} {d.user?.nom}
                        <span className="text-indigo-600 ml-1">
                          ({d.permission === 'lecture' ? 'lecture' : d.permission === 'modification' ? 'modif.' : d.permission === 'suppression' ? 'suppr.' : d.permission})
                        </span>
                      </span>
                    ))}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Délégués modification</h3>
                  <div className="flex flex-wrap gap-2">
                    {(accesSynth.modificationDelegues || []).map((d, i) => (
                      <span key={d.user?.id || d.userId || i} className="px-2 py-1 bg-blue-50 text-blue-900 rounded text-xs">
                        {d.user ? `${d.user.prenom} ${d.user.nom}` : d.userId}
                      </span>
                    ))}
                    {(accesSynth.modificationDelegues || []).length === 0 && (
                      <span className="text-gray-400 italic">Aucun</span>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">Présents (utilisateurs)</h3>
                  <div className="flex flex-wrap gap-2">
                    {(accesSynth.presentsUser || []).map((p, i) => (
                      <span key={p.user?.id || i} className="px-2 py-1 bg-gray-100 rounded text-xs">
                        {p.user ? `${p.user.prenom} ${p.user.nom}` : '—'}
                      </span>
                    ))}
                    {(accesSynth.presentsUser || []).length === 0 && (
                      <span className="text-gray-400 italic">Aucun</span>
                    )}
                  </div>
                </div>
                <div>
                  <h3 className="text-xs font-semibold text-gray-500 uppercase mb-2">
                    Présents (clients / fournisseurs)
                  </h3>
                  <div className="flex flex-wrap gap-2">
                    {(accesSynth.presentsClientFournisseur || []).map((p, i) => (
                      <span key={p.clientFournisseur?.id || i} className="px-2 py-1 bg-amber-50 rounded text-xs">
                        {clientFournisseurLabel(p.clientFournisseur)}
                      </span>
                    ))}
                    {(accesSynth.presentsClientFournisseur || []).length === 0 && (
                      <span className="text-gray-400 italic">Aucun</span>
                    )}
                  </div>
                </div>
              </div>
            )}
            {!accesSynthLoading && !accesSynth && (
              <p className="text-sm text-gray-500">Synthèse des accès indisponible.</p>
            )}
          </section>

          <section className="bg-white rounded-lg shadow border border-gray-100 p-6 mb-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Rattachements effectifs</h2>
            <div className="grid md:grid-cols-2 gap-4 text-sm">
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Projets</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  {pv.projets?.length
                    ? pv.projets.map((x: any) => (
                        <li key={x.projetId}>{x.projet?.nom || x.projetId}</li>
                      ))
                    : '—'}
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Tâches</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                  {pv.taches?.length
                    ? pv.taches.map((x: any) => (
                        <li key={x.tacheId}>{x.tache?.nom || x.tacheId}</li>
                      ))
                    : '—'}
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">User stories</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1 max-h-40 overflow-y-auto">
                  {pv.userStories?.length
                    ? pv.userStories.map((x: any) => (
                        <li key={x.userStoryId}>
                          {(x.userStory?.description || '').slice(0, 80)}
                          {(x.userStory?.description || '').length > 80 ? '…' : ''}
                        </li>
                      ))
                    : '—'}
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Epics</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  {pv.epics?.length
                    ? pv.epics.map((x: any) => (
                        <li key={x.epicId}>{x.epic?.nom || x.epicId}</li>
                      ))
                    : '—'}
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Contrats</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  {pv.contrats?.length
                    ? pv.contrats.map((x: any) => (
                        <li key={x.contratId}>{x.contrat?.nom || x.contratId}</li>
                      ))
                    : '—'}
                </ul>
              </div>
              <div>
                <h3 className="font-medium text-gray-700 mb-2">Processus</h3>
                <ul className="list-disc list-inside text-gray-600 space-y-1">
                  {pv.processus?.length
                    ? pv.processus.map((x: any) => (
                        <li key={x.processusId}>{x.processus?.nom || x.processusId}</li>
                      ))
                    : '—'}
                </ul>
              </div>
            </div>
          </section>

          {(pv.contenuHtml || '').replace(/<[^>]+>/g, '').trim().length > 0 && (
            <section className="bg-white rounded-lg shadow border border-gray-100 p-6 mb-6">
              <h2 className="text-lg font-semibold text-gray-900 mb-2">Contenu rédigé</h2>
              {pv.contenuUpdatedAt && (
                <p className="text-xs text-gray-500 mb-3">
                  Dernière mise à jour du texte :{' '}
                  {new Date(pv.contenuUpdatedAt).toLocaleString('fr-FR')}
                </p>
              )}
              <div
                className="prose-pv-read text-sm text-gray-800 border border-gray-100 rounded-lg p-4 bg-gray-50/50 max-h-[480px] overflow-y-auto"
                dangerouslySetInnerHTML={{ __html: stripH2NumberingInHtml(pv.contenuHtml || '') }}
              />
              <style>{`
                .prose-pv-read h2 { font-size: 1.05rem; font-weight: 700; margin: 0.6rem 0 0.25rem; }
                .prose-pv-read h3 { font-size: 0.95rem; font-weight: 600; margin: 0.45rem 0 0.2rem; }
                .prose-pv-read p { margin: 0.3rem 0; line-height: 1.5; }
                .prose-pv-read ul, .prose-pv-read ol { margin: 0.3rem 0 0.3rem 1.1rem; }
                .prose-pv-read table { border-collapse: collapse; width: 100%; margin: 0.4rem 0; font-size: 12px; }
                .prose-pv-read th, .prose-pv-read td { border: 1px solid #d1d5db; padding: 4px 6px; }
                .prose-pv-read th { background: #f3f4f6; font-weight: 600; }
              `}</style>
            </section>
          )}

          <section className="bg-white rounded-lg shadow border border-gray-100 p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-4">Commentaires</h2>
            <div className="space-y-4 mb-6">
              {(pv.commentaires || []).map((c: any) => (
                <div key={c.id} className="border border-gray-100 rounded-lg p-4 bg-gray-50/50">
                  <div className="flex justify-between text-xs text-gray-500 mb-2">
                    <span>
                      {c.user ? `${c.user.prenom} ${c.user.nom}` : '—'} ·{' '}
                      {new Date(c.createdAt).toLocaleString('fr-FR')}
                    </span>
                    {c.assigneUser && (
                      <span className="text-blue-700">
                        Assigné à {c.assigneUser.prenom} {c.assigneUser.nom}
                      </span>
                    )}
                  </div>
                  <p className="text-gray-800 whitespace-pre-wrap">{c.contenu}</p>
                  {c.pieceJointe && (
                    <button
                      type="button"
                      onClick={() =>
                        downloadCommentPiece(
                          c.id,
                          c.pieceJointe.fichierNomOriginal || c.pieceJointe.nom
                        )
                      }
                      className="mt-2 text-sm text-blue-600 hover:underline"
                    >
                      📎 {c.pieceJointe.fichierNomOriginal || c.pieceJointe.nom}
                    </button>
                  )}
                </div>
              ))}
              {!(pv.commentaires || []).length && (
                <p className="text-sm text-gray-500">Aucun commentaire.</p>
              )}
            </div>

            <form onSubmit={sendComment} className="border-t border-gray-100 pt-4 space-y-3">
              <h3 className="text-sm font-semibold text-gray-800">Ajouter un commentaire</h3>
              <textarea
                className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm min-h-[100px]"
                placeholder="Votre message…"
                value={commentContenu}
                onChange={(e) => setCommentContenu(e.target.value)}
                required
              />
              <div className="grid md:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Assigner à (optionnel)</label>
                  <select
                    className="w-full border border-gray-200 rounded-md px-3 py-2 text-sm"
                    value={commentAssigne}
                    onChange={(e) => setCommentAssigne(e.target.value)}
                  >
                    <option value="">—</option>
                    {users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.prenom} {u.nom}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs text-gray-600 mb-1">Pièce jointe (annexe)</label>
                  <input
                    type="file"
                    className="text-sm w-full"
                    onChange={(e) => setCommentFile(e.target.files?.[0] || null)}
                  />
                </div>
              </div>
              <button
                type="submit"
                disabled={commentSending}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm disabled:opacity-50"
              >
                {commentSending ? 'Envoi…' : 'Publier'}
              </button>
            </form>
          </section>
        </>
      )}

      <PvReunionAccesModal
        open={showAccesModal}
        onClose={() => setShowAccesModal(false)}
        pvId={id ?? null}
        titreFallback={pv.titre || ''}
        onPermissionsChanged={() => {
          void load();
          if (id) {
            api
              .get(`/pv-reunions/${id}/acces`)
              .then((r) => setAccesSynth(r.data))
              .catch(() => {});
          }
        }}
      />

      <div
        ref={previewPvRef}
        className="fixed left-[-10000px] top-0 w-[794px] bg-white p-10 text-[13px] leading-relaxed text-gray-900"
        aria-hidden
      >
        <header className="border-b border-gray-200 pb-3 mb-4">
          {companyInfo?.logoFilename ? (
            <div className="mb-3 flex items-center justify-between gap-4">
              <img
                src={`${API_BASE_URL}/company-info/logo?token=${encodeURIComponent(localStorage.getItem('token') || '')}`}
                alt="Logo entreprise"
                className="h-20 object-contain"
              />
              {String(companyInfo?.nomEntreprise || '').trim() ? (
                <p className="text-xl font-bold text-gray-800 text-right">{companyInfo.nomEntreprise}</p>
              ) : null}
            </div>
          ) : null}
          <h1 className="text-3xl font-extrabold text-gray-900 mt-1 text-center">PROCÈS-VERBAL DE RÉUNION</h1>
          <h2 className="text-2xl font-bold text-gray-900 mt-2 text-center">{titre.trim() || pv.titre}</h2>
          <div className="text-sm text-gray-600 mt-2 flex items-center justify-between">
            <span>Statut : {PV_STATUTS.find((s) => s.value === statutPv)?.label || statutPv}</span>
            <span>{dateReunion ? `Date réunion : ${new Date(dateReunion).toLocaleDateString('fr-FR')}` : 'Date réunion : —'}</span>
          </div>
        </header>
        <div className="prose-pv-preview" dangerouslySetInnerHTML={{ __html: contenuHtml || '<p></p>' }} />
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

      {contenuVersionsOpen && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full max-h-[85vh] overflow-y-auto p-5">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-lg font-semibold">Historique du contenu</h3>
              <button
                type="button"
                className="text-gray-500 hover:text-gray-800"
                onClick={() => setContenuVersionsOpen(false)}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            {contenuVersionsLoading ? (
              <p className="text-sm text-gray-500">Chargement…</p>
            ) : contenuVersions.length === 0 ? (
              <p className="text-sm text-gray-500">Aucune version enregistrée.</p>
            ) : (
              <ul className="space-y-3 text-sm">
                {contenuVersions.map((v) => (
                  <li key={v.id} className="border border-gray-100 rounded-md p-3">
                    <div className="text-xs text-gray-500 flex flex-wrap justify-between gap-1">
                      <span>{v.createdAt ? new Date(v.createdAt).toLocaleString('fr-FR') : ''}</span>
                      <span>
                        {v.createdBy?.prenom} {v.createdBy?.nom}
                      </span>
                    </div>
                    <p className="text-gray-700 mt-1 line-clamp-3">{v.preview || '—'}</p>
                    <button
                      type="button"
                      disabled={versionRestoreId === v.id}
                      onClick={() => void restoreContenuVersion(v.id)}
                      className="mt-2 text-xs text-blue-600 hover:underline disabled:opacity-50"
                    >
                      {versionRestoreId === v.id ? 'Chargement…' : 'Restaurer dans l’éditeur'}
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button
                type="button"
                onClick={() => setContenuVersionsOpen(false)}
                className="px-3 py-1.5 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
            </div>
          </div>
        </div>
      )}

      {histOpen && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {pv.titre}</h3>
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
                onClick={() => setHistOpen(false)}
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
