import { useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { AccessContratLikeAdminLines } from '../components/AccessContratLikeAdminLines';
import { api } from '../services/api';
import { useAuth } from '../store/auth';
import { getPaginationPageNumbers } from '../utils/pagination';

function isoToDateInput(iso: string | null | undefined): string {
  if (!iso) return '';
  return iso.slice(0, 10);
}

async function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(new Error('Impossible de lire le fichier logo.'));
    reader.readAsDataURL(file);
  });
}

type CsvRow = Record<string, string>;

function detectDelimiter(sample: string): string {
  const first = sample.split(/\r?\n/).find((l) => l.trim().length > 0) || '';
  const candidates = [',', ';', '\t'];
  let best = ',';
  let bestCount = -1;
  for (const d of candidates) {
    const c = first.split(d).length - 1;
    if (c > bestCount) {
      bestCount = c;
      best = d;
    }
  }
  return best;
}

function parseCsv(content: string): CsvRow[] {
  const delimiter = detectDelimiter(content);
  const normalized = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  if (!normalized.trim()) return [];
  const records: string[][] = [];
  let row: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < normalized.length; i++) {
    const ch = normalized[i];
    if (ch === '"') {
      if (inQuotes && normalized[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === delimiter && !inQuotes) {
      row.push(current);
      current = '';
      continue;
    }
    if (ch === '\n' && !inQuotes) {
      row.push(current);
      current = '';
      if (row.some((c) => c.trim() !== '')) records.push(row);
      row = [];
      continue;
    }
    current += ch;
  }
  row.push(current);
  if (row.some((c) => c.trim() !== '')) records.push(row);
  if (records.length === 0) return [];
  const headers = records[0].map((h) => String(h || '').trim().toLowerCase().replace(/^\uFEFF/, ''));
  return records.slice(1).map((cells) => {
    const r: CsvRow = {};
    headers.forEach((h, i) => {
      r[h] = String(cells[i] ?? '').trim();
    });
    return r;
  });
}

function clientsFournisseursCsvTemplate(typeSocieteExamples: string[]): string {
  const exampleA = typeSocieteExamples[0] || 'SA';
  const exampleB = typeSocieteExamples[1] || typeSocieteExamples[0] || 'SARL';
  return [
    'type,nom,type_societe,matricule_fiscale,adresse,pays,logo_url',
    `client,PAYSMART,${exampleA},MF-12345,"10 Rue de la Bourse, Tunis",Tunisie,`,
    `fournisseur,Orange Business,${exampleB},MF-67890,"Avenue Habib Bourguiba",Tunisie,`,
  ].join('\n');
}

function csvEscape(value: unknown): string {
  const s = String(value ?? '');
  if (s.includes('"') || s.includes(',') || s.includes('\n')) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/** Libellés courts sur la ligne (style aperçu type Documents). */
const LABEL_PERM_ROW: Record<string, string> = {
  lecture: 'lecture',
  modification: 'modification',
  suppression: 'suppression',
  gestion: 'gestion des droits',
};

const LABEL_PERM: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression (fiche)',
  gestion: 'Gestion',
};

const CF_PERM_LEVELS = [
  { value: 'lecture', label: '👁 Consultation' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression (fiche)' },
  { value: 'gestion', label: '🔐 Gestion des droits' },
];

const droitsAdminCfLigne = 'modification + suppression + gestion des droits + lecture';

function permSummaryLine(perms: string[]) {
  return perms.map((p) => LABEL_PERM_ROW[p] || p).join(' + ');
}

function cfPermissionsForAdminLines(delegations: any[]) {
  return (delegations || []).map((d: any) => ({
    userId: d.user?.id,
    niveau: permSummaryLine(d.permissions || []),
    user: d.user,
  }));
}

function isAccesRestreint(item: any) {
  const dels = item.accesApercu?.delegations?.length ?? 0;
  return !!item.createdById || dels > 0;
}

const LABEL_HISTO: Record<string, string> = {
  creation: 'Création de la fiche',
  modification_champs: 'Modification des champs',
  droit_ajoute: 'Droit d’accès accordé',
  droit_retire: 'Droit d’accès retiré',
  representant_ajout: 'Représentant ajouté',
  representant_modification: 'Représentant modifié',
  representant_suppression: 'Représentant supprimé',
  contrat_lie: 'Contrat lié',
  contrat_delie: 'Contrat retiré',
  projet_lie: 'Projet lié',
  projet_delie: 'Projet retiré',
  soft_delete: 'Mise en corbeille',
  restauration: 'Restauration',
};

export default function ClientsFournisseurs() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const canCreate = user?.role === 'admin' || user?.role === 'contributeur';

  const capModify = (item: any) =>
    item.capabilities?.canModify ?? (user?.role === 'admin' || user?.role === 'contributeur');
  const capDelete = (item: any) =>
    item.capabilities?.canDelete ?? (user?.role === 'admin' || user?.role === 'contributeur');

  const [items, setItems] = useState<any[]>([]);
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [search, setSearch] = useState('');
  const [searchIdCf, setSearchIdCf] = useState('');
  const [showFiltres, setShowFiltres] = useState(false);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const pageSize = 10;
  const [showModal, setShowModal] = useState(false);
  const [editing, setEditing] = useState<any>(null);
  const [showProjetSelect, setShowProjetSelect] = useState<string | null>(null);
  const [showContratSelect, setShowContratSelect] = useState<string | null>(null);
  const [typesSociete, setTypesSociete] = useState<any[]>([]);
  const [projets, setProjets] = useState<any[]>([]);
  const [contrats, setContrats] = useState<any[]>([]);
  const [showRepModal, setShowRepModal] = useState(false);
  const [repTarget, setRepTarget] = useState<any>(null);
  const [repEditingRep, setRepEditingRep] = useState<any | null>(null);
  const [repForm, setRepForm] = useState({
    nom: '',
    prenom: '',
    fonction: '',
    email: '',
    telephone: '',
    statut: 'en_exercice',
    dateDebut: '',
    dateFin: '',
  });
  const [usersList, setUsersList] = useState<any[]>([]);
  const [accesModalItem, setAccesModalItem] = useState<any | null>(null);
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [adminLimitPerm, setAdminLimitPerm] = useState<Record<string, string>>({});
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermType, setNewPermType] = useState('lecture');
  const [histModalItem, setHistModalItem] = useState<any | null>(null);
  const [histoList, setHistoList] = useState<any[]>([]);
  const [histoLoading, setHistoLoading] = useState(false);
  const [expandedCfIds, setExpandedCfIds] = useState<Set<string>>(() => new Set());
  const [showCorbeilleModal, setShowCorbeilleModal] = useState(false);
  const [corbeilleItems, setCorbeilleItems] = useState<any[]>([]);
  const [showImportModal, setShowImportModal] = useState(false);
  const [importFileName, setImportFileName] = useState('');
  const [importRows, setImportRows] = useState<CsvRow[]>([]);
  const [importErrors, setImportErrors] = useState<Array<{ line: number; field: string; message: string }>>([]);
  const [importBusy, setImportBusy] = useState(false);
  const [importReport, setImportReport] = useState<{
    totalRows: number;
    successRows: number;
    failedRows: number;
    createdRows: number;
  } | null>(null);

  const toggleCfRow = (id: string) => {
    setExpandedCfIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const isCfRowExpanded = (id: string) => expandedCfIds.has(id);

  const emptyForm = {
    type: 'client',
    nom: '',
    logoUrl: '',
    typeSocieteId: '',
    matriculeFiscale: '',
    adresse: '',
    pays: '',
    projetIds: [] as string[],
    contratIds: [] as string[],
  };
  const [form, setForm] = useState<any>(emptyForm);

  const load = async () => {
    setLoading(true);
    try {
      const [r1, r2, r3, r4] = await Promise.all([
        api.get('/clients-fournisseurs', { params: { type: typeFilter || undefined, search: search || undefined } }),
        api.get('/types-societe'),
        api.get('/projets'),
        api.get('/contrats').catch(() => ({ data: [] })),
      ]);
      setItems(r1.data);
      setTypesSociete(r2.data);
      setProjets(r3.data);
      setContrats(Array.isArray(r4.data) ? r4.data : []);
    } catch (e) { console.error(e); }
    setLoading(false);
  };

  useEffect(() => { load(); }, [typeFilter, search]);

  useEffect(() => {
    setPage(1);
  }, [typeFilter, search, searchIdCf]);

  useEffect(() => {
    (async () => {
      try {
        const r = await api.get('/users');
        setUsersList(Array.isArray(r.data) ? r.data : []);
      } catch {
        setUsersList([]);
      }
    })();
  }, []);

  const loadCorbeilleClientsFournisseurs = async () => {
    try {
      const r = await api.get('/clients-fournisseurs/corbeille');
      setCorbeilleItems(Array.isArray(r.data) ? r.data : []);
    } catch {
      setCorbeilleItems([]);
    }
  };

  const handleRestoreCfFromCorbeille = async (id: string) => {
    try {
      await api.post(`/corbeille/clients-fournisseurs/${id}/restaurer`);
      setShowCorbeilleModal(false);
      await load();
    } catch (e: any) {
      alert(e?.response?.data?.error || 'Erreur lors de la restauration');
    }
  };

  const canRestoreCfCorbeille = (row: any) =>
    user?.role === 'admin' || row.createdById === user?.id || row.createdBy?.id === user?.id;

  const openCreate = () => { setForm(emptyForm); setEditing(null); setShowModal(true); };
  const openEdit = (item: any) => {
    setForm({
      type: item.type,
      nom: item.nom,
      logoUrl: item.logoUrl || '',
      typeSocieteId: item.typeSocieteId || '',
      matriculeFiscale: item.matriculeFiscale || '',
      adresse: item.adresse || '',
      pays: item.pays || '',
      projetIds: item.projets?.map((p: any) => p.projetId || p.projet?.id) || [],
      contratIds: (item.contratsLies || []).map((c: any) => c.id),
    });
    setEditing(item);
    setShowModal(true);
  };

  const handleSave = async () => {
    try {
      const { contratIds, ...cfPayload } = form;
      if (editing) {
        await api.put(`/clients-fournisseurs/${editing.id}`, cfPayload);
        const prevIds = new Set((editing.contratsLies || []).map((c: any) => c.id));
        const nextIds = new Set(contratIds || []);
        for (const cid of nextIds) {
          if (!prevIds.has(cid)) {
            await api.post(`/clients-fournisseurs/${editing.id}/contrats`, { contratId: cid });
          }
        }
        for (const cid of prevIds) {
          if (!nextIds.has(cid)) {
            await api.delete(`/clients-fournisseurs/${editing.id}/contrats/${cid}`);
          }
        }
      } else {
        const res = await api.post('/clients-fournisseurs', cfPayload);
        const newId = res.data?.id as string | undefined;
        if (newId && contratIds?.length) {
          for (const cid of contratIds) {
            await api.post(`/clients-fournisseurs/${newId}/contrats`, { contratId: cid });
          }
        }
      }
      setShowModal(false);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur lors de la sauvegarde');
    }
  };

  const handleDelete = async (id: string, nom: string) => {
    if (!confirm(`Mettre « ${nom} » en corbeille ? Vous pourrez la restaurer depuis la corbeille (admin ou créateur).`)) return;
    try {
      await api.delete(`/clients-fournisseurs/${id}`);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const onAccesButtonClick = (item: any) => {
    void openAccesModal(item);
  };

  const openAccesModal = async (item: any) => {
    setAccesModalItem(item);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermType('lecture');
    setAdminLimitPerm({});
    setAccesLoading(true);
    try {
      const { data } = await api.get(`/clients-fournisseurs/${item.id}/acces`);
      setAccesDetail(data);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement accès');
      setAccesModalItem(null);
    } finally {
      setAccesLoading(false);
    }
  };

  const openHistoriqueModal = async (item: any) => {
    setHistModalItem(item);
    setHistoList([]);
    setHistoLoading(true);
    try {
      const { data } = await api.get(`/clients-fournisseurs/${item.id}/historique`);
      setHistoList(Array.isArray(data) ? data : []);
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur chargement historique');
      setHistModalItem(null);
    } finally {
      setHistoLoading(false);
    }
  };

  const refreshAccesDetail = async (cfId: string) => {
    const { data } = await api.get(`/clients-fournisseurs/${cfId}/acces`);
    setAccesDetail(data);
  };

  const handleAddPermission = async () => {
    if (!accesModalItem || !newPermUserId) return;
    try {
      await api.post(`/clients-fournisseurs/${accesModalItem.id}/permissions`, {
        userId: newPermUserId,
        permission: newPermType,
      });
      setNewPermUserId('');
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemovePermission = async (permissionId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit explicite sur cette fiche. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès »."
      : 'Retirer ce droit ?';
    if (!accesModalItem || !window.confirm(msg)) return;
    try {
      await api.delete(`/clients-fournisseurs/${accesModalItem.id}/permissions/${permissionId}`);
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const revokeAllCfDelegationsForUser = async (userId: string) => {
    if (!accesModalItem || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    if (rows.length === 0) return;
    if (!window.confirm('Révoquer tous les droits explicites pour cet utilisateur sur cette fiche ?')) return;
    try {
      for (const r of rows) {
        await api.delete(`/clients-fournisseurs/${accesModalItem.id}/permissions/${r.id}`);
      }
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultCf = async (userId: string) => {
    if (!accesModalItem) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/clients-fournisseurs/${accesModalItem.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitCf = async (userId: string) => {
    if (!accesModalItem) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus la fiche tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    ) {
      return;
    }
    try {
      await api.post(`/clients-fournisseurs/${accesModalItem.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const quickLimitAdminCf = async (userId: string) => {
    if (!accesModalItem) return;
    const permission = adminLimitPerm[userId] || 'lecture';
    try {
      await api.post(`/clients-fournisseurs/${accesModalItem.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const replaceAdminCfPermissionLevel = async (userId: string, permission: string) => {
    if (!accesModalItem || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    try {
      for (const r of rows) {
        await api.delete(`/clients-fournisseurs/${accesModalItem.id}/permissions/${r.id}`);
      }
      await api.post(`/clients-fournisseurs/${accesModalItem.id}/permissions`, { userId, permission });
      await refreshAccesDetail(accesModalItem.id);
      load();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const openAddRep = (item: any) => {
    setRepTarget(item);
    setRepEditingRep(null);
    setRepForm({
      nom: '',
      prenom: '',
      fonction: '',
      email: '',
      telephone: '',
      statut: 'en_exercice',
      dateDebut: '',
      dateFin: '',
    });
    setShowRepModal(true);
  };

  const openEditRep = (item: any, rep: any) => {
    setRepTarget(item);
    setRepEditingRep(rep);
    setRepForm({
      nom: rep.nom || '',
      prenom: rep.prenom || '',
      fonction: rep.fonction || '',
      email: rep.email || '',
      telephone: rep.telephone || '',
      statut: rep.statut === 'fin_exercice' ? 'fin_exercice' : 'en_exercice',
      dateDebut: isoToDateInput(rep.dateDebut),
      dateFin: isoToDateInput(rep.dateFin),
    });
    setShowRepModal(true);
  };

  const handleSaveRep = async () => {
    if (!repTarget) return;
    try {
      if (repEditingRep) {
        await api.put(`/clients-fournisseurs/${repTarget.id}/representants/${repEditingRep.id}`, repForm);
      } else {
        await api.post(`/clients-fournisseurs/${repTarget.id}/representants`, repForm);
      }
      setShowRepModal(false);
      setRepEditingRep(null);
      load();
    } catch (e: any) {
      const msg = e?.response?.data?.error || e?.message || 'Erreur lors de l’enregistrement du représentant';
      alert(msg);
    }
  };

  const handleUpdateRepStatut = async (cfId: string, repId: string, statut: string) => {
    await api.put(`/clients-fournisseurs/${cfId}/representants/${repId}`, { statut, dateFin: statut === 'fin_exercice' ? new Date().toISOString() : null });
    load();
  };

  const handleDeleteRep = async (cfId: string, repId: string) => {
    if (!confirm('Supprimer ce représentant ?')) return;
    await api.delete(`/clients-fournisseurs/${cfId}/representants/${repId}`);
    load();
  };

  const typeSocieteByKey = useMemo(() => {
    const m = new Map<string, any>();
    (typesSociete || []).forEach((t: any) => {
      m.set(String(t.id).toLowerCase(), t);
      m.set(String(t.nom || '').toLowerCase(), t);
    });
    return m;
  }, [typesSociete]);

  const latestTypeSocieteNames = useMemo(() => {
    const rows = Array.isArray(typesSociete) ? [...typesSociete] : [];
    rows.sort((a: any, b: any) => {
      const ta = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const tb = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return tb - ta;
    });
    return rows.map((r: any) => String(r?.nom || '').trim()).filter(Boolean).slice(0, 5);
  }, [typesSociete]);

  const downloadImportTemplate = () => {
    const blob = new Blob([clientsFournisseursCsvTemplate(latestTypeSocieteNames)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'template_import_clients_fournisseurs.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  const validateImportRows = (rowsToValidate: CsvRow[]) => {
    const errs: Array<{ line: number; field: string; message: string }> = [];
    if (rowsToValidate.length === 0) {
      errs.push({ line: 1, field: 'fichier', message: 'Le fichier est vide.' });
      return errs;
    }
    rowsToValidate.forEach((row, idx) => {
      const line = idx + 2;
      const type = String(row.type || '').toLowerCase();
      const nom = String(row.nom || '').trim();
      if (!type || (type !== 'client' && type !== 'fournisseur')) {
        errs.push({ line, field: 'type', message: "Le type doit être 'client' ou 'fournisseur'." });
      }
      if (!nom) errs.push({ line, field: 'nom', message: 'Le nom est requis.' });
      const tsRaw = String(row.type_societe || '').trim();
      if (tsRaw && !typeSocieteByKey.get(tsRaw.toLowerCase())) {
        errs.push({ line, field: 'type_societe', message: `Type de société introuvable: "${tsRaw}".` });
      }
    });
    return errs;
  };

  const onImportFileChange = async (file?: File | null) => {
    setImportReport(null);
    setImportErrors([]);
    setImportRows([]);
    if (!file) {
      setImportFileName('');
      return;
    }
    setImportFileName(file.name);
    const txt = await file.text();
    const parsed = parseCsv(txt);
    setImportRows(parsed);
    setImportErrors(validateImportRows(parsed));
  };

  const runMassImport = async () => {
    const pre = validateImportRows(importRows);
    setImportErrors(pre);
    if (pre.length > 0) return;
    setImportBusy(true);
    setImportReport(null);
    const errs: Array<{ line: number; field: string; message: string }> = [];
    const existingByTypeName = new Map<string, any>();
    const seenInFile = new Set<string>();
    try {
      const { data } = await api.get('/clients-fournisseurs');
      const existing = Array.isArray(data) ? data : [];
      existing.forEach((it: any) => {
        const key = `${String(it?.type || '').toLowerCase()}::${String(it?.nom || '').trim().toLowerCase()}`;
        if (key !== '::') existingByTypeName.set(key, it);
      });
    } catch {
      errs.push({
        line: 1,
        field: 'api',
        message: 'Impossible de charger la liste existante pour contrôler les doublons.',
      });
      setImportErrors(errs);
      setImportBusy(false);
      return;
    }
    let createdRows = 0;
    for (let i = 0; i < importRows.length; i++) {
      const row = importRows[i];
      const line = i + 2;
      try {
        const type = String(row.type || '').toLowerCase();
        const nom = String(row.nom || '').trim();
        const key = `${type}::${nom.toLowerCase()}`;
        if (seenInFile.has(key)) {
          errs.push({
            line,
            field: 'nom',
            message: `Doublon dans le fichier: ${type} "${nom}" déjà présent sur une autre ligne.`,
          });
          continue;
        }
        seenInFile.add(key);
        const typeSocieteRaw = String(row.type_societe || '').trim();
        const ts = typeSocieteRaw ? typeSocieteByKey.get(typeSocieteRaw.toLowerCase()) : null;
        const existing = existingByTypeName.get(key);
        if (existing) {
          const existingTypeSocieteNom = String(existing?.typeSociete?.nom || '').trim().toLowerCase();
          const importedTypeSocieteNom = String(ts?.nom || '').trim().toLowerCase();
          if (
            importedTypeSocieteNom &&
            existingTypeSocieteNom &&
            importedTypeSocieteNom !== existingTypeSocieteNom
          ) {
            errs.push({
              line,
              field: 'type_societe',
              message:
                `Conflit type_societe pour ${type} "${nom}": ` +
                `existant="${existing?.typeSociete?.nom}", import="${typeSocieteRaw}".`,
            });
          } else {
            errs.push({
              line,
              field: 'nom',
              message: `Doublon en base: ${type} "${nom}" existe déjà.`,
            });
          }
          continue;
        }
        await api.post('/clients-fournisseurs', {
          type,
          nom,
          typeSocieteId: ts?.id || null,
          matriculeFiscale: row.matricule_fiscale || null,
          adresse: row.adresse || null,
          pays: row.pays || null,
          logoUrl: row.logo_url || null,
        });
        existingByTypeName.set(key, { type, nom, typeSociete: ts ? { nom: ts.nom } : null });
        createdRows++;
      } catch (e: any) {
        errs.push({
          line,
          field: 'api',
          message: e?.response?.data?.error || e?.message || 'Erreur import',
        });
      }
    }
    setImportErrors(errs);
    setImportReport({
      totalRows: importRows.length,
      successRows: importRows.length - errs.length,
      failedRows: errs.length,
      createdRows,
    });
    setImportBusy(false);
    if (createdRows > 0) await load();
  };

  const filteredItems = useMemo(() => {
    const needle = searchIdCf.trim().toLowerCase();
    if (!needle) return items;
    return items.filter((it) => String(it.id).toLowerCase().includes(needle));
  }, [items, searchIdCf]);

  const exportClientsFournisseursCsv = () => {
    const headers = [
      'id',
      'type',
      'nom',
      'type_societe',
      'matricule_fiscale',
      'adresse',
      'pays',
      'logo_url',
      'createur',
      'created_at',
      'updated_at',
      'projets_lies',
      'contrats_lies',
      'representants',
    ];
    const lines = [headers.join(',')];
    for (const item of filteredItems) {
      const projetsLies = (item.projets || [])
        .map((p: any) => p?.projet?.nom || p?.projet?.id || '')
        .filter(Boolean)
        .join(' | ');
      const contratsLies = (item.contratsLies || [])
        .map((c: any) => c?.nom || c?.id || '')
        .filter(Boolean)
        .join(' | ');
      const representants = (item.representants || [])
        .map((r: any) => {
          const fullName = `${r?.prenom || ''} ${r?.nom || ''}`.trim();
          const fonction = r?.fonction ? ` (${r.fonction})` : '';
          return `${fullName}${fonction}`;
        })
        .filter(Boolean)
        .join(' | ');
      const createur = item?.createdBy ? `${item.createdBy.prenom || ''} ${item.createdBy.nom || ''}`.trim() : '';
      const row = [
        item.id,
        item.type,
        item.nom,
        item.typeSociete?.nom || '',
        item.matriculeFiscale || '',
        item.adresse || '',
        item.pays || '',
        item.logoUrl || '',
        createur,
        item.createdAt || '',
        item.updatedAt || '',
        projetsLies,
        contratsLies,
        representants,
      ].map(csvEscape);
      lines.push(row.join(','));
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const dateLabel = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = `clients-fournisseurs-export-${dateLabel}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const totalPages = Math.max(1, Math.ceil(filteredItems.length / pageSize));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * pageSize;
  const pagedItems = filteredItems.slice(startIdx, startIdx + pageSize);

  return (
    <div className="p-6">
      <div className="flex flex-col sm:flex-row sm:justify-between sm:items-center gap-4 mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Clients / Fournisseurs</h1>
        <div className="flex flex-wrap gap-2 justify-end">
          <button
            type="button"
            onClick={exportClientsFournisseursCsv}
            className="px-4 py-2 border border-emerald-300 text-emerald-700 rounded-lg hover:bg-emerald-50 text-sm font-medium"
          >
            ⬇ Export CSV
          </button>
          <button
            type="button"
            onClick={async () => {
              await loadCorbeilleClientsFournisseurs();
              setShowCorbeilleModal(true);
            }}
            className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 text-sm font-medium"
          >
            🗑 Corbeille
          </button>
          {canCreate && (
            <button
              type="button"
              onClick={() => setShowImportModal(true)}
              className="px-4 py-2 border border-indigo-300 text-indigo-700 rounded-lg hover:bg-indigo-50 text-sm font-medium"
            >
              ⬆ Import massif
            </button>
          )}
          {canCreate && (
            <button
              type="button"
              onClick={openCreate}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 text-sm font-medium shadow-sm"
            >
              + Ajouter
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
            {(search || typeFilter || searchIdCf.trim()) ? ' ●' : ''}
          </span>
          <span className="text-gray-400">{showFiltres ? '▼' : '▶'}</span>
        </button>
        {showFiltres && (
          <div className="px-4 pb-4 pt-0 border-t border-gray-100">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-4">
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Nom / recherche</label>
                <input
                  type="text"
                  placeholder="Rechercher…"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">ID client / fournisseur</label>
                <input
                  type="text"
                  placeholder="Extrait d’UUID…"
                  value={searchIdCf}
                  onChange={(e) => setSearchIdCf(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm font-mono"
                  autoComplete="off"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Type</label>
                <select
                  value={typeFilter}
                  onChange={(e) => setTypeFilter(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
                >
                  <option value="">Tous</option>
                  <option value="client">Clients</option>
                  <option value="fournisseur">Fournisseurs</option>
                </select>
              </div>
            </div>
            <div className="flex justify-end mt-3">
              <button
                type="button"
                onClick={() => {
                  setSearch('');
                  setSearchIdCf('');
                  setTypeFilter('');
                }}
                className="px-3 py-2 text-sm border border-gray-300 rounded-md text-gray-700 hover:bg-gray-50"
              >
                Réinitialiser
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Liste */}
      {loading ? <div className="text-center py-10 text-gray-400">Chargement...</div> : (
        <div className="space-y-4">
          {filteredItems.length === 0 && <div className="text-center py-10 text-gray-400">Aucune fiche trouvée</div>}
          {pagedItems.map((item) => {
            const rowOpen = isCfRowExpanded(item.id);
            return (
            <div key={item.id} className="bg-white rounded-lg shadow overflow-hidden">
              <button
                type="button"
                onClick={() => toggleCfRow(item.id)}
                className="w-full flex flex-wrap items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
                aria-expanded={rowOpen}
                aria-label={
                  rowOpen
                    ? 'Replier le détail de la fiche'
                    : 'Afficher le détail et les actions de la fiche'
                }
              >
                <span
                  className={`px-2 py-0.5 rounded text-xs font-medium shrink-0 ${item.type === 'client' ? 'bg-blue-100 text-blue-800' : 'bg-orange-100 text-orange-800'}`}
                >
                  {item.type === 'client' ? '👤 Client' : '🏭 Fournisseur'}
                </span>
                <h2 className="text-base sm:text-lg font-semibold text-gray-900 min-w-0 flex-1 truncate">{item.nom}</h2>
                {item.logoUrl && (
                  <img
                    src={item.logoUrl}
                    alt={`Logo ${item.nom}`}
                    className="h-8 w-8 rounded object-contain border border-gray-200 bg-white shrink-0"
                  />
                )}
                <span
                  className="text-[11px] text-gray-400 font-mono shrink-0 max-w-[7rem] sm:max-w-[10rem] truncate"
                  title={item.id}
                >
                  {item.id}
                </span>
                <span className="text-sm text-gray-500 font-mono shrink-0 hidden md:inline">{item.matriculeFiscale || '—'}</span>
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
                  <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 text-sm text-gray-600">
                    <div className="col-span-2 lg:col-span-4">
                      <span className="font-medium">ID : </span>
                      <span className="font-mono text-xs break-all">{item.id}</span>
                    </div>
                    {item.typeSociete && <div><span className="font-medium">Type : </span>{item.typeSociete.nom}</div>}
                    {item.matriculeFiscale && <div><span className="font-medium">MF/ID : </span>{item.matriculeFiscale}</div>}
                    {item.pays && <div><span className="font-medium">Pays : </span>{item.pays}</div>}
                    {item.adresse && <div><span className="font-medium">Adresse : </span>{item.adresse}</div>}
                    {item.logoUrl && (
                      <div className="col-span-2 lg:col-span-4 flex items-center gap-3">
                        <span className="font-medium">Logo : </span>
                        <img
                          src={item.logoUrl}
                          alt={`Logo ${item.nom}`}
                          className="h-16 w-16 rounded border border-gray-200 object-contain bg-white"
                        />
                      </div>
                    )}
                  </div>
                  {/* Représentants légaux */}
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">Représentants légaux</p>
                    {item.representants?.length > 0 ? (
                      <div className="space-y-2">
                        {item.representants.map((rep: any) => (
                          <div key={rep.id} className="flex flex-wrap items-center gap-2 text-sm border border-gray-100 rounded-md px-2 py-1.5 bg-gray-50/80">
                            <span className={`px-1.5 py-0.5 rounded text-xs shrink-0 ${rep.statut === 'en_exercice' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                              {rep.statut === 'en_exercice' ? '✅ En exercice' : '⛔ Fin d\'exercice'}
                            </span>
                            <span className="font-medium">{rep.prenom} {rep.nom}</span>
                            {rep.fonction && <span className="text-gray-400">— {rep.fonction}</span>}
                            {(rep.email || rep.telephone) && (
                              <span className="text-gray-500 text-xs w-full basis-full flex flex-wrap gap-x-3 gap-y-0.5">
                                {rep.email && (
                                  <span>
                                    E-mail :{" "}
                                    <a href={`mailto:${rep.email}`} className="text-blue-700 hover:underline break-all">
                                      {rep.email}
                                    </a>
                                  </span>
                                )}
                                {rep.telephone && (
                                  <span>
                                    Tél. :{" "}
                                    <a
                                      href={`tel:${String(rep.telephone).replace(/\s/g, "")}`}
                                      className="tabular-nums text-gray-700 hover:underline"
                                    >
                                      {rep.telephone}
                                    </a>
                                  </span>
                                )}
                              </span>
                            )}
                            {capModify(item) && (
                              <div className="flex flex-wrap gap-1 ml-auto">
                                <button type="button" onClick={() => openEditRep(item, rep)} className="text-xs px-2 py-0.5 bg-blue-100 text-blue-800 rounded hover:bg-blue-200">✏️ Modifier</button>
                                {rep.statut === 'en_exercice' && (
                                  <button type="button" onClick={() => handleUpdateRepStatut(item.id, rep.id, 'fin_exercice')} className="text-xs px-2 py-0.5 bg-yellow-100 text-yellow-700 rounded hover:bg-yellow-200">Fin d&apos;exercice</button>
                                )}
                                <button type="button" onClick={() => handleDeleteRep(item.id, rep.id)} className="text-xs px-2 py-0.5 bg-red-100 text-red-700 rounded hover:bg-red-200">🗑 Supprimer</button>
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400">Aucun représentant enregistré</p>
                    )}
                  </div>
                  {/* Contrats liés */}
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">Contrats liés</p>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {(item.contratsLies || []).map((c: any) => (
                        <div key={c.id} className="flex items-center gap-1 px-2 py-0.5 bg-amber-50 text-amber-900 border border-amber-100 rounded text-xs">
                          <button type="button" className="hover:underline text-left" onClick={() => navigate('/contrats')}>📄 {c.nom}</button>
                          <span className="text-amber-600/80">({c.statut})</span>
                          {capModify(item) && (
                            <button type="button" onClick={async () => { if (!confirm('Retirer ce contrat de la fiche ?')) return; await api.delete(`/clients-fournisseurs/${item.id}/contrats/${c.id}`); load(); }} className="text-red-500 hover:text-red-700 ml-1 font-bold">✕</button>
                          )}
                        </div>
                      ))}
                      {capModify(item) && showContratSelect !== item.id && (
                        <button type="button" onClick={() => setShowContratSelect(item.id)} className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded text-xs hover:bg-amber-200">+ Lier un contrat</button>
                      )}
                    </div>
                    {capModify(item) && showContratSelect === item.id && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        <select id={`contratSel-${item.id}`} className="flex-1 min-w-[12rem] border border-gray-300 rounded px-2 py-1 text-xs">
                          <option value="">— Sélectionner un contrat —</option>
                          {contrats.filter((ct: any) => !(item.contratsLies || []).some((cl: any) => cl.id === ct.id)).map((ct: any) => (
                            <option key={ct.id} value={ct.id}>{ct.nom}</option>
                          ))}
                        </select>
                        <button type="button" onClick={async () => {
                          const sel = document.getElementById(`contratSel-${item.id}`) as HTMLSelectElement;
                          if (!sel?.value) return;
                          try {
                            await api.post(`/clients-fournisseurs/${item.id}/contrats`, { contratId: sel.value });
                            setShowContratSelect(null);
                            load();
                          } catch (err: any) {
                            alert(err?.response?.data?.error || err?.message || 'Erreur');
                          }
                        }} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Lier</button>
                        <button type="button" onClick={() => setShowContratSelect(null)} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">✕</button>
                      </div>
                    )}
                  </div>
                  {/* Projets liés */}
                  <div className="mt-3">
                    <p className="text-xs font-medium text-gray-500 uppercase mb-1">Projets liés</p>
                    <div className="flex flex-wrap gap-1 mb-1">
                      {item.projets?.map((p: any) => (
                        <div key={p.id} className="flex items-center gap-1 px-2 py-0.5 bg-purple-100 text-purple-700 rounded text-xs">
                          <span className="cursor-pointer hover:underline" onClick={() => navigate(`/projets/${p.projet?.id}`)}>📁 {p.projet?.nom}</span>
                          {capModify(item) && <button type="button" onClick={async () => { await api.delete(`/clients-fournisseurs/${item.id}/projets/${p.projet?.id}`); load(); }} className="text-red-400 hover:text-red-600 ml-1 font-bold">✕</button>}
                        </div>
                      ))}
                      {capModify(item) && showProjetSelect !== item.id && (
                        <button type="button" onClick={() => setShowProjetSelect(item.id)} className="px-2 py-0.5 bg-green-100 text-green-700 rounded text-xs hover:bg-green-200">+ Lier projet</button>
                      )}
                    </div>
                    {capModify(item) && showProjetSelect === item.id && (
                      <div className="flex flex-wrap gap-2 mt-1">
                        <select id={`projetSel-${item.id}`} className="flex-1 min-w-[12rem] border border-gray-300 rounded px-2 py-1 text-xs">
                          <option value="">— Sélectionner —</option>
                          {projets.filter((pr: any) => !item.projets?.some((p: any) => p.projet?.id === pr.id)).map((pr: any) => (
                            <option key={pr.id} value={pr.id}>{pr.nom} ({pr.codeProjet})</option>
                          ))}
                        </select>
                        <button type="button" onClick={async () => { const sel = document.getElementById(`projetSel-${item.id}`) as HTMLSelectElement; if (!sel?.value) return; await api.post(`/clients-fournisseurs/${item.id}/projets`, { projetId: sel.value }); setShowProjetSelect(null); load(); }} className="px-2 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700">Lier</button>
                        <button type="button" onClick={() => setShowProjetSelect(null)} className="px-2 py-1 border border-gray-300 rounded text-xs hover:bg-gray-50">✕</button>
                      </div>
                    )}
                  </div>

                  {/* Aperçu accès — après projets liés */}
                  <div className="mt-3 flex flex-wrap items-start gap-2 sm:gap-3 text-xs text-gray-700 border border-slate-100 rounded-lg px-3 py-2.5 bg-slate-50/90">
                    <span className="font-semibold text-gray-600 uppercase shrink-0 pt-0.5">Accès :</span>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 min-w-0 flex-1">
                      {isAccesRestreint(item) ? (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-red-50 border border-red-100 text-red-900 shrink-0">
                          <span className="text-sm leading-none" aria-hidden>🔒</span>
                          <span className="text-[10px] font-semibold leading-tight mt-0.5 text-center">Accès restreint</span>
                        </div>
                      ) : (
                        <div className="inline-flex flex-col items-center justify-center px-2 py-1 rounded-md bg-green-50 border border-green-100 text-green-900 shrink-0">
                          <span className="text-[10px] font-semibold leading-tight text-center">Accès élargi</span>
                          <span className="text-[10px] text-green-800/90 text-center mt-0.5">Tous les contributeurs</span>
                        </div>
                      )}
                      <AccessContratLikeAdminLines
                        users={usersList}
                        createdById={item.createdById}
                        createdBy={item.createdBy}
                        adminSansAccesUserIds={item.adminSansAccesUserIds}
                        permissions={cfPermissionsForAdminLines(item.accesApercu?.delegations || [])}
                        droitsAdminCompletLabel={droitsAdminCfLigne}
                        niveauLabel={(n) => n}
                        keyPrefix={`liste-cf-${item.id}`}
                        creatorRightsLabel={droitsAdminCfLigne}
                      />
                      {(item.accesApercu?.delegations || []).map((d: any) => (
                        <div key={d.user.id} className="min-w-0">
                          <span className="font-medium text-gray-900">
                            {d.user.prenom} {d.user.nom}
                          </span>
                          <span className="text-gray-500 italic block sm:inline sm:ml-1">
                            {d.permissions?.includes('lecture') && d.permissions?.length === 1 ? (
                              <>👁 ({permSummaryLine(d.permissions)})</>
                            ) : (
                              <> ({permSummaryLine(d.permissions)})</>
                            )}
                          </span>
                        </div>
                      ))}
                      <p className="text-[10px] text-gray-500 w-full basis-full">
                        Aligné sur les contrats : exclusion ou droits explicites pour les administrateurs sont visibles ici
                        et gérés dans la modale « Accès » (créateur ou habilitation gestion sur la fiche).
                      </p>
                    </div>
                  </div>
                        </div>

                    <div className="flex flex-wrap gap-2 lg:flex-col lg:items-stretch shrink-0 lg:min-w-[11rem]">
                  <button type="button" onClick={() => onAccesButtonClick(item)} className="px-3 py-1.5 text-xs bg-slate-100 text-slate-800 rounded hover:bg-slate-200">🔐 Accès</button>
                  <button type="button" onClick={() => openHistoriqueModal(item)} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-800 rounded hover:bg-gray-200">📜 Historique</button>
                  {capModify(item) && (
                    <>
                      <button type="button" onClick={() => openAddRep(item)} className="px-3 py-1.5 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200">👤 + Représentant</button>
                      <button type="button" onClick={() => openEdit(item)} className="px-3 py-1.5 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200">✏️ Modifier la fiche</button>
                    </>
                  )}
                  {capDelete(item) && (
                    <button type="button" onClick={() => handleDelete(item.id, item.nom)} className="px-3 py-1.5 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200">🗑 Mettre en corbeille</button>
                  )}
                    </div>
                      </div>
                    </div>
                  )}
            </div>
            );
          })}
          {filteredItems.length > pageSize && (
            <div className="mt-6 flex items-center justify-between border-t border-gray-200 pt-4 flex-wrap gap-3">
              <div className="text-sm text-gray-700">
                Affichage {startIdx + 1}-{Math.min(startIdx + pageSize, filteredItems.length)} sur {filteredItems.length}
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
        </div>
      )}

      {showImportModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-lg font-semibold">Import massif Clients / Fournisseurs</h3>
              <button type="button" onClick={() => setShowImportModal(false)} className="text-gray-500 hover:text-gray-700">✕</button>
            </div>
            <div className="flex flex-wrap gap-2 items-center mb-3">
              <button
                type="button"
                onClick={downloadImportTemplate}
                className="px-3 py-2 rounded bg-slate-100 text-slate-800 text-sm hover:bg-slate-200"
              >
                Télécharger le template CSV
              </button>
              <label className="px-3 py-2 rounded border border-gray-300 text-sm cursor-pointer hover:bg-gray-50">
                Choisir un fichier CSV
                <input
                  type="file"
                  accept=".csv,text/csv"
                  className="hidden"
                  onChange={(e) => void onImportFileChange(e.target.files?.[0] || null)}
                />
              </label>
              <span className="text-sm text-gray-600">{importFileName || 'Aucun fichier sélectionné'}</span>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Colonnes attendues: type, nom, type_societe, matricule_fiscale, adresse, pays, logo_url
            </p>

            {importReport && (
              <div className="text-sm border border-green-200 bg-green-50 text-green-800 rounded p-3 mb-3">
                <p className="font-semibold mb-1">Rapport d&apos;upload</p>
                <p>
                  Total: {importReport.totalRows} • Succès: {importReport.successRows} • Erreurs: {importReport.failedRows} • Créés: {importReport.createdRows}
                </p>
              </div>
            )}

            {importErrors.length > 0 && (
              <div className="border border-red-200 bg-red-50 rounded p-3 mb-3">
                <p className="text-sm font-semibold text-red-800 mb-2">
                  {importErrors.length} erreur(s) à corriger avant réimport
                </p>
                <div className="max-h-56 overflow-auto">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="text-left text-red-900">
                        <th className="pr-3">Ligne</th>
                        <th className="pr-3">Champ</th>
                        <th>Message</th>
                      </tr>
                    </thead>
                    <tbody>
                      {importErrors.map((e, idx) => (
                        <tr key={`${e.line}-${idx}`} className="border-t border-red-100">
                          <td className="pr-3 py-1">{e.line}</td>
                          <td className="pr-3 py-1">{e.field}</td>
                          <td className="py-1">{e.message}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-2 mt-4">
              <button
                type="button"
                onClick={() => setShowImportModal(false)}
                className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
              >
                Fermer
              </button>
              <button
                type="button"
                onClick={() => void runMassImport()}
                disabled={importBusy || importRows.length === 0}
                className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-md hover:bg-indigo-700 disabled:opacity-50"
              >
                {importBusy ? 'Import en cours...' : 'Lancer l’import'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Créer/Modifier */}
      {showModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">{editing ? '✏️ Modifier' : '+ Ajouter'} une fiche</h3>
            <div className="space-y-3">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type *</label>
                <select value={form.type} onChange={e => setForm({...form, type: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                  <option value="client">Client</option>
                  <option value="fournisseur">Fournisseur</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l'entité *</label>
                <input type="text" value={form.nom} onChange={e => setForm({...form, nom: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Logo</label>
                <div className="flex flex-wrap items-center gap-3">
                  {form.logoUrl ? (
                    <img
                      src={form.logoUrl}
                      alt="Aperçu logo"
                      className="h-16 w-16 rounded border border-gray-200 object-contain bg-white"
                    />
                  ) : (
                    <div className="h-16 w-16 rounded border border-dashed border-gray-300 flex items-center justify-center text-[10px] text-gray-400">
                      Aucun logo
                    </div>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <label className="px-3 py-1.5 bg-gray-100 text-gray-700 rounded text-sm hover:bg-gray-200 cursor-pointer">
                      Choisir un fichier
                      <input
                        type="file"
                        accept="image/png,image/jpeg,image/webp,image/svg+xml"
                        className="hidden"
                        onChange={async (e) => {
                          const file = e.target.files?.[0];
                          if (!file) return;
                          const allowed = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'];
                          if (!allowed.includes(file.type)) {
                            alert('Format logo non supporté. Utilisez PNG, JPG, WEBP ou SVG.');
                            e.currentTarget.value = '';
                            return;
                          }
                          if (file.size > 2 * 1024 * 1024) {
                            alert('Logo trop volumineux (max 2 Mo).');
                            e.currentTarget.value = '';
                            return;
                          }
                          try {
                            const dataUrl = await fileToDataUrl(file);
                            setForm({ ...form, logoUrl: dataUrl });
                          } catch (err: any) {
                            alert(err?.message || 'Lecture du logo impossible');
                          } finally {
                            e.currentTarget.value = '';
                          }
                        }}
                      />
                    </label>
                    {form.logoUrl && (
                      <button
                        type="button"
                        onClick={() => setForm({ ...form, logoUrl: '' })}
                        className="px-3 py-1.5 border border-red-200 text-red-700 rounded text-sm hover:bg-red-50"
                      >
                        Retirer
                      </button>
                    )}
                  </div>
                </div>
                <p className="mt-2 text-xs text-gray-500">
                  Recommandé: format PNG (ou SVG), taille 512x512 px (minimum 256x256), fond transparent, poids &lt; 300 Ko.
                </p>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type de société</label>
                <select value={form.typeSocieteId} onChange={e => setForm({...form, typeSocieteId: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                  <option value="">— Sélectionner —</option>
                  {typesSociete.map(t => <option key={t.id} value={t.id}>{t.nom}</option>)}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Matricule Fiscale / Identifiant</label>
                <input type="text" value={form.matriculeFiscale} onChange={e => setForm({...form, matriculeFiscale: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Adresse</label>
                <input type="text" value={form.adresse} onChange={e => setForm({...form, adresse: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Pays</label>
                <input type="text" value={form.pays} onChange={e => setForm({...form, pays: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Projets liés</label>
                {form.projetIds?.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {form.projetIds.map((pid: string) => {
                      const p = projets.find((pr: any) => pr.id === pid);
                      return p ? (
                        <div key={pid} className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-0.5 bg-purple-100 text-purple-700 rounded">📁 {p.nom}</span>
                          <button type="button" onClick={() => setForm({...form, projetIds: form.projetIds.filter((id: string) => id !== pid)})} className="text-red-400 hover:text-red-600 text-xs">✕</button>
                        </div>
                      ) : null;
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <select id="newProjetSelect" className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm">
                    <option value="">— Ajouter un projet —</option>
                    {projets.filter((p: any) => !form.projetIds?.includes(p.id)).map((p: any) => <option key={p.id} value={p.id}>{p.nom} ({p.codeProjet})</option>)}
                  </select>
                  <button type="button" onClick={() => { const sel = document.getElementById('newProjetSelect') as HTMLSelectElement; if (sel?.value) { setForm({...form, projetIds: [...(form.projetIds||[]), sel.value]}); sel.value=''; }}} className="px-3 py-1.5 bg-blue-600 text-white rounded text-sm hover:bg-blue-700">+</button>
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Contrats liés</label>
                <p className="text-xs text-gray-500 mb-2">Optionnel — contrats déjà enregistrés dans l’application.</p>
                {form.contratIds?.length > 0 && (
                  <div className="space-y-1 mb-2">
                    {form.contratIds.map((cid: string) => {
                      const c = contrats.find((ct: any) => ct.id === cid);
                      return c ? (
                        <div key={cid} className="flex items-center gap-2 text-sm">
                          <span className="px-2 py-0.5 bg-amber-100 text-amber-900 rounded">📄 {c.nom}</span>
                          <button
                            type="button"
                            onClick={() => setForm({ ...form, contratIds: form.contratIds.filter((id: string) => id !== cid) })}
                            className="text-red-400 hover:text-red-600 text-xs"
                          >
                            ✕
                          </button>
                        </div>
                      ) : (
                        <div key={cid} className="text-xs text-gray-500">Contrat {cid.slice(0, 8)}…</div>
                      );
                    })}
                  </div>
                )}
                <div className="flex gap-2">
                  <select id="modalContratSelect" className="flex-1 border border-gray-300 rounded-md px-3 py-1.5 text-sm">
                    <option value="">— Ajouter un contrat —</option>
                    {contrats
                      .filter((ct: any) => !form.contratIds?.includes(ct.id))
                      .map((ct: any) => (
                        <option key={ct.id} value={ct.id}>
                          {ct.nom}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => {
                      const sel = document.getElementById('modalContratSelect') as HTMLSelectElement;
                      if (sel?.value) {
                        setForm({ ...form, contratIds: [...(form.contratIds || []), sel.value] });
                        sel.value = '';
                      }
                    }}
                    className="px-3 py-1.5 bg-amber-600 text-white rounded text-sm hover:bg-amber-700"
                  >
                    +
                  </button>
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => setShowModal(false)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Annuler</button>
              <button type="button" onClick={handleSave} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">Enregistrer</button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Représentant */}
      {showRepModal && repTarget && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-md">
            <h3 className="text-lg font-semibold mb-4">
              {repEditingRep ? '✏️ Modifier le représentant légal' : '👤 Ajouter un représentant légal'} — {repTarget.nom}
            </h3>
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Prénom *</label>
                  <input type="text" value={repForm.prenom} onChange={e => setRepForm({...repForm, prenom: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Nom *</label>
                  <input type="text" value={repForm.nom} onChange={e => setRepForm({...repForm, nom: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Fonction</label>
                <input type="text" value={repForm.fonction} onChange={e => setRepForm({...repForm, fonction: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">E-mail</label>
                <input
                  type="email"
                  autoComplete="off"
                  placeholder="Facultatif"
                  value={repForm.email}
                  onChange={(e) => setRepForm({ ...repForm, email: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Téléphone</label>
                <input
                  type="tel"
                  autoComplete="off"
                  placeholder="Facultatif"
                  value={repForm.telephone}
                  onChange={(e) => setRepForm({ ...repForm, telephone: e.target.value })}
                  className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Statut</label>
                <select value={repForm.statut} onChange={e => setRepForm({...repForm, statut: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm">
                  <option value="en_exercice">✅ En cours d'exercice</option>
                  <option value="fin_exercice">⛔ N'est plus dans l'exercice de ses fonctions</option>
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date début</label>
                  <input type="date" value={repForm.dateDebut} onChange={e => setRepForm({...repForm, dateDebut: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Date fin</label>
                  <input type="date" value={repForm.dateFin} onChange={e => setRepForm({...repForm, dateFin: e.target.value})} className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-2 mt-4">
              <button type="button" onClick={() => { setShowRepModal(false); setRepEditingRep(null); }} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Annuler</button>
              <button type="button" onClick={handleSaveRep} className="px-4 py-2 text-sm bg-blue-600 text-white rounded-md hover:bg-blue-700">{repEditingRep ? 'Enregistrer' : 'Ajouter'}</button>
            </div>
          </div>
        </div>
      )}

      {accesModalItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
          <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
            <h3 className="text-xl font-semibold mb-2">Accès — {accesModalItem.nom}</h3>
            <p className="text-sm text-gray-600 mb-5 leading-relaxed">
              Le <span className="font-medium">créateur</span> de la fiche et les utilisateurs habilités (selon les règles
              métier) peuvent gérer les accès. Pour un administrateur : sans ligne dans « Accès partagés » et sans exclusion,
              accès complet ; une ligne limite les droits ; « Retirer l&apos;accès » retire tout accès jusqu&apos;à octroi via
              « Accorder un accès » ; « Rétablir l&apos;accès admin par défaut » annule une exclusion.
            </p>
            {accesDetail && !accesDetail.canManagePermissions && (
              <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
                Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous avec un compte autorisé à
                gérer cette fiche (créateur ou droits de gestion).
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
                      const userDelegations = (accesDetail.delegations || []).filter((d: any) => d.user?.id === a.id);
                      const primaryDelegation = userDelegations[0];
                      const explicite = userDelegations.length > 0;
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
                                  onClick={() => void handleRestoreAdminDefaultCf(a.id)}
                                  className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                                >
                                  Rétablir l&apos;accès admin par défaut
                                </button>
                              ) : !explicite ? (
                                <>
                                  <select
                                    value={adminLimitPerm[a.id] ?? 'lecture'}
                                    onChange={(e) =>
                                      setAdminLimitPerm((prev) => ({ ...prev, [a.id]: e.target.value }))
                                    }
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {CF_PERM_LEVELS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void quickLimitAdminCf(a.id)}
                                    className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                                  >
                                    Limiter l&apos;accès
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void handleRevokeAdminImplicitCf(a.id)}
                                    className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                                  >
                                    Retirer l&apos;accès
                                  </button>
                                </>
                              ) : (
                                <>
                                  <select
                                    value={primaryDelegation?.permission ?? 'lecture'}
                                    onChange={(e) => {
                                      const permission = e.target.value;
                                      if (!accesModalItem || permission === primaryDelegation?.permission) return;
                                      void replaceAdminCfPermissionLevel(a.id, permission);
                                    }}
                                    className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                                  >
                                    {CF_PERM_LEVELS.map((n) => (
                                      <option key={n.value} value={n.value}>
                                        {n.label}
                                      </option>
                                    ))}
                                  </select>
                                  <button
                                    type="button"
                                    onClick={() => void revokeAllCfDelegationsForUser(a.id)}
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
                      <span className="font-medium">
                        {accesDetail.creator.prenom} {accesDetail.creator.nom}
                      </span>
                      <span className="text-gray-400"> — modification, suppression, octroi des droits</span>
                    </p>
                  ) : (
                    <p className="text-amber-800 text-sm leading-relaxed">
                      Aucun créateur enregistré (fiche existante avant la traçabilité). Les règles de modification et de
                      gestion des accès suivent la configuration métier en vigueur.
                    </p>
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
                          {d.grantedBy && (
                            <span className="text-xs text-gray-400">
                              par {d.grantedBy.prenom} {d.grantedBy.nom}
                            </span>
                          )}
                          {accesDetail.canManagePermissions ? (
                            <>
                              <select
                                value={d.permission}
                                onChange={(e) => {
                                  const permission = e.target.value;
                                  if (!accesModalItem || permission === d.permission) return;
                                  void replaceAdminCfPermissionLevel(d.user.id, permission);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {CF_PERM_LEVELS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void handleRemovePermission(d.id, d.user?.role === 'admin')}
                                className="text-xs text-red-600 hover:underline ml-auto"
                              >
                                {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                              </button>
                            </>
                          ) : (
                            <span className="text-gray-500">— {LABEL_PERM[d.permission] || d.permission}</span>
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
                      <select
                        value={newPermUserId}
                        onChange={(e) => setNewPermUserId(e.target.value)}
                        className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        <option value="">— Utilisateur —</option>
                        {(() => {
                          const actifs = usersList.filter(
                            (u: any) => (!u.statut || u.statut === 'actif') && u.id !== accesDetail.creator?.id
                          );
                          const adminsPick = actifs.filter((u: any) => u.role === 'admin');
                          const autresPick = actifs.filter((u: any) => u.role !== 'admin');
                          return (
                            <>
                              {adminsPick.length > 0 && (
                                <optgroup label="Administrateurs">
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
                      <select
                        value={newPermType}
                        onChange={(e) => setNewPermType(e.target.value)}
                        className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                      >
                        {CF_PERM_LEVELS.map((n) => (
                          <option key={n.value} value={n.value}>
                            {n.label}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => void handleAddPermission()}
                        disabled={!newPermUserId}
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
              <button type="button" onClick={() => setAccesModalItem(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {histModalItem && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl p-6 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <h3 className="text-lg font-semibold mb-4">Historique — {histModalItem.nom}</h3>
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
                    <p className="font-medium text-gray-800">{LABEL_HISTO[h.typeEvenement] || h.typeEvenement}</p>
                    {h.libelle && <p className="text-gray-600 text-xs mt-0.5">{h.libelle}</p>}
                    {h.details && typeof h.details === 'object' && (
                      <pre className="text-xs bg-gray-50 rounded p-2 mt-1 overflow-x-auto max-h-32">{JSON.stringify(h.details, null, 2)}</pre>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <div className="flex justify-end mt-4">
              <button type="button" onClick={() => setHistModalItem(null)} className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50">Fermer</button>
            </div>
          </div>
        </div>
      )}

      {showCorbeilleModal && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[85vh] overflow-y-auto">
            <div className="flex justify-between items-center p-5 border-b">
              <h2 className="text-lg font-semibold">🗑 Clients / fournisseurs en corbeille</h2>
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
              {corbeilleItems.length === 0 && (
                <p className="text-sm text-gray-500">Aucune fiche en corbeille.</p>
              )}
              {corbeilleItems.map((cp: any) => (
                <div
                  key={cp.id}
                  className="flex flex-wrap justify-between items-center gap-3 p-3 border rounded-lg bg-gray-50"
                >
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">{cp.nom}</p>
                    <p className="text-xs text-gray-500">
                      {cp.type === 'fournisseur' ? 'Fournisseur' : 'Client'}
                      {cp.deletedAt ? ` · Supprimé le ${new Date(cp.deletedAt).toLocaleString('fr-FR')}` : ''}
                      {cp.createdBy && ` · Créé par ${cp.createdBy.prenom} ${cp.createdBy.nom}`}
                    </p>
                  </div>
                  {canRestoreCfCorbeille(cp) ? (
                    <button
                      type="button"
                      onClick={() => handleRestoreCfFromCorbeille(cp.id)}
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
    </div>
  );
}
