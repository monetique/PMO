import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { api, API_BASE_URL } from '../services/api';
import { useAuth } from '../store/auth';
import { PvReunionsLieesBlock } from './PvReunionsLieesBlock';
import { DocumentAccesNatifModal } from './DocumentAccesNatifModal';
import { AgileDocumentsUserStorySection } from './AgileDocumentsUserStorySection';
import { isNativeAuthorControlledUploadDoc, normalizeDocumentAclFields } from '../utils/documentNativeAcces';
import type { ProjetOption, EntiteOption, DocTache, ClientFournisseurOption } from '../pages/Taches';

export type EpicRow = {
  id: string;
  nom: string;
  description?: string | null;
  projetId: string;
  projet?: { id: string; nom: string };
  createdBy?: { id: string; nom: string; prenom: string } | null;
  assignesEntites?: { entite: { id: string; nom: string } }[];
  assignesEntitesEffectives?: { entite: { id: string; nom: string } }[];
  entitesHeritees?: { id: string; nom: string }[];
  assignesClientsFournisseurs?: { clientFournisseur: { id: string; nom: string; type: string } }[];
  userStories?: { id: string; description: string; taches?: { id: string; nom: string; statut: string }[] }[];
  documents?: { document: DocTache }[];
};

export type UserStoryRow = {
  id: string;
  description: string;
  epicId?: string | null;
  epic?: EpicRow | null;
  taches?: { id: string; nom: string; statut: string; projetId?: string | null }[];
  /** Assignations directes sur l’US (héritage affiché aussi depuis les tâches liées). */
  assignesClientsFournisseurs?: { clientFournisseur: { id: string; nom: string; type: string } }[];
  documentsNatifs?: DocTache[];
};

function truncate(s: string, n: number) {
  const t = s.trim();
  return t.length <= n ? t : `${t.slice(0, n)}…`;
}

function epicEntitesEffectives(epic?: EpicRow | null): string[] {
  if (!epic) return [];
  const rows = epic.assignesEntitesEffectives || epic.assignesEntites || [];
  return rows.map((ae) => ae.entite.nom).filter(Boolean);
}

export function EpicCreateModal({
  onClose,
  onSaved,
  projets,
  entites,
  clientsFournisseurs,
}: {
  onClose: () => void;
  onSaved: () => void;
  projets: ProjetOption[];
  entites: EntiteOption[];
  clientsFournisseurs: ClientFournisseurOption[];
}) {
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  const [projetId, setProjetId] = useState('');
  const [selectedEntiteIds, setSelectedEntiteIds] = useState<string[]>([]);
  const [selectedClientFournisseurIds, setSelectedClientFournisseurIds] = useState<string[]>([]);
  const [projetClientFournisseurIds, setProjetClientFournisseurIds] = useState<string[] | undefined>(undefined);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [orphanStories, setOrphanStories] = useState<UserStoryRow[]>([]);
  const [selectedUsIds, setSelectedUsIds] = useState<string[]>([]);
  const [docsLiables, setDocsLiables] = useState<DocTache[]>([]);
  const [searchDoc, setSearchDoc] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [uploadNom, setUploadNom] = useState('');
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (!projetId) {
      setProjetClientFournisseurIds(undefined);
      return;
    }
    let cancel = false;
    api
      .get(`/projets/${projetId}`)
      .then((r) => {
        if (cancel || !r.data) return;
        const links = Array.isArray(r.data.clientsFournisseurs) ? r.data.clientsFournisseurs : [];
        const ids = links
          .map((l: { clientFournisseur?: { id?: string }; clientFournisseurId?: string }) =>
            l.clientFournisseur?.id || l.clientFournisseurId
          )
          .filter(Boolean) as string[];
        setProjetClientFournisseurIds(ids);
      })
      .catch(() => {
        if (!cancel) setProjetClientFournisseurIds([]);
      });
    return () => {
      cancel = true;
    };
  }, [projetId]);

  useEffect(() => {
    if (!projetId) {
      setOrphanStories([]);
      return;
    }
    let cancel = false;
    api
      .get('/user-stories', { params: { orphelines: true, projetId } })
      .then((r) => {
        if (!cancel) setOrphanStories(Array.isArray(r.data) ? r.data : []);
      })
      .catch(() => {
        if (!cancel) setOrphanStories([]);
      });
    return () => {
      cancel = true;
    };
  }, [projetId]);

  const loadDocs = async () => {
    try {
      const r = await api.get('/taches/documents-liables', { params: { search: searchDoc } });
      setDocsLiables(Array.isArray(r.data) ? r.data : []);
    } catch {
      setDocsLiables([]);
    }
  };

  useEffect(() => {
    void loadDocs();
  }, [searchDoc]);

  const toggleDoc = (id: string) =>
    setDocIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleUs = (id: string) =>
    setSelectedUsIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleEntite = (id: string) =>
    setSelectedEntiteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleClientFournisseur = (id: string) =>
    setSelectedClientFournisseurIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!nom.trim() || !projetId) {
      setErr('Nom et projet sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      const { data: epic } = await api.post('/epics', {
        nom: nom.trim(),
        description: description.trim() || null,
        projetId,
        entiteIds: selectedEntiteIds,
        assignesClientFournisseurIds: selectedClientFournisseurIds,
        documentIds: docIds,
        userStoryIdsToAttach: selectedUsIds,
      });
      if (uploadFile && epic?.id) {
        const fd = new FormData();
        fd.append('fichier', uploadFile);
        fd.append('nom', uploadNom || uploadFile.name);
        await api.post(`/epics/${epic.id}/documents`, fd, {
          headers: { 'Content-Type': 'multipart/form-data' },
        });
      }
      onSaved();
      onClose();
    } catch (ex: any) {
      setErr(ex?.response?.data?.error || ex?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[70] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Nouvel Epic</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{err}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l&apos;Epic *</label>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Projet associé *</label>
            <select
              value={projetId}
              onChange={(e) => setProjetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">— Choisir —</option>
              {projets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entités assignées</label>
            <div className="border rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
              {entites.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input type="checkbox" checked={selectedEntiteIds.includes(e.id)} onChange={() => toggleEntite(e.id)} />
                  {e.nom}
                </label>
              ))}
              {entites.length === 0 && <p className="text-xs text-gray-400">Aucune entité</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clients / fournisseurs assignés</label>
            {projetId && projetClientFournisseurIds && projetClientFournisseurIds.length > 0 && (
              <p className="text-xs text-gray-500 mb-1">
                Liste priorisée sur les fiches rattachées au projet ; les fiches déjà cochées restent visibles.
              </p>
            )}
            <div className="border rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
              {clientsFournisseursAffiches.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input
                    type="checkbox"
                    checked={selectedClientFournisseurIds.includes(c.id)}
                    onChange={() => toggleClientFournisseur(c.id)}
                  />
                  <span>
                    <span className="font-medium">{c.nom}</span>
                    <span className="text-gray-500 text-xs ml-1">
                      ({c.type === 'fournisseur' ? 'Fournisseur' : c.type === 'client' ? 'Client' : c.type})
                    </span>
                  </span>
                </label>
              ))}
              {clientsFournisseursAffiches.length === 0 && (
                <p className="text-xs text-gray-400">Aucune fiche client / fournisseur</p>
              )}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Sélectionner un ou plusieurs documents</label>
            <input
              type="text"
              value={searchDoc}
              onChange={(e) => setSearchDoc(e.target.value)}
              placeholder="Rechercher…"
              className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm mb-2"
            />
            <div className="border rounded-md max-h-40 overflow-y-auto p-2 space-y-1">
              {docsLiables.map((d) => (
                <label key={d.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input type="checkbox" checked={docIds.includes(d.id)} onChange={() => toggleDoc(d.id)} />
                  {d.nom}
                </label>
              ))}
              {docsLiables.length === 0 && <p className="text-xs text-gray-400">Aucun document</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Rattacher des user stories orphelines (projet)</label>
            <p className="text-xs text-gray-500 mb-2">Choisissez d&apos;abord un projet.</p>
            <div className="border rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
              {orphanStories.map((us) => (
                <label key={us.id} className="flex items-start gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input type="checkbox" checked={selectedUsIds.includes(us.id)} onChange={() => toggleUs(us.id)} />
                  <span>{truncate(us.description, 120)}</span>
                </label>
              ))}
              {projetId && orphanStories.length === 0 && (
                <p className="text-xs text-gray-400">Aucune user story orpheline pour ce projet</p>
              )}
            </div>
          </div>
          <div className="border-t pt-4">
            <label className="block text-sm font-medium text-gray-700 mb-1">Ajouter un document (upload)</label>
            <input type="file" onChange={(e) => setUploadFile(e.target.files?.[0] || null)} className="text-sm w-full" />
            <input
              type="text"
              value={uploadNom}
              onChange={(e) => setUploadNom(e.target.value)}
              placeholder="Nom affiché (optionnel)"
              className="w-full mt-2 px-3 py-2 border border-gray-300 rounded-md text-sm"
            />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md text-gray-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Créer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/** Référence minimale tâche pour rattachement US (évite import circulaire). */
export type TacheForUserStoryLink = {
  id: string;
  nom: string;
  projetId?: string | null;
  userStory?: { id: string } | null;
};

export function UserStoryEditModal({
  userStoryId,
  onClose,
  onSaved,
  projets: _projets,
  epics,
  taches,
}: {
  userStoryId: string;
  onClose: () => void;
  onSaved: () => void;
  projets: ProjetOption[];
  epics: EpicRow[];
  taches: TacheForUserStoryLink[];
}) {
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [epicId, setEpicId] = useState('');
  const [projetFilter, setProjetFilter] = useState('');
  const [selectedTacheIds, setSelectedTacheIds] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr('');
    api
      .get(`/user-stories/${userStoryId}`)
      .then((r) => {
        if (cancel || !r.data) return;
        const us = r.data as UserStoryRow;
        setDescription(us.description || '');
        const eid = us.epicId || '';
        setEpicId(eid);
        const pid = (us.epic as EpicRow | undefined)?.projetId || '';
        setProjetFilter(pid);
        const linked = (us.taches || []).map((t) => t.id);
        setSelectedTacheIds(linked);
      })
      .catch(() => {
        if (!cancel) setErr('Impossible de charger la user story.');
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [userStoryId]);

  const epicObj = epics.find((e) => e.id === epicId);
  const lockProjetId = epicObj?.projetId || '';

  const filteredEpics = projetFilter ? epics.filter((e) => e.projetId === projetFilter) : epics;

  const tachesPourLier = taches.filter((t) => {
    if (lockProjetId && t.projetId !== lockProjetId) return false;
    if (t.userStory?.id && t.userStory.id !== userStoryId) return false;
    return true;
  });

  const toggleTache = (id: string) =>
    setSelectedTacheIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!description.trim() || !epicId) {
      setErr('Description et epic requis.');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/user-stories/${userStoryId}`, {
        description: description.trim(),
        epicId,
        tacheIds: selectedTacheIds,
      });
      onSaved();
      onClose();
    } catch (ex: any) {
      setErr(ex?.response?.data?.error || ex?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[75] p-4">
        <div className="bg-white rounded-xl p-8 shadow-xl">
          <p className="text-gray-600">Chargement…</p>
          <button type="button" onClick={onClose} className="mt-4 text-sm text-blue-600">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[75] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Modifier la User story</h2>
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
            >
              <option value="">Tous les projets</option>
              {_projets.map((p) => (
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
              onChange={(e) => setEpicId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
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
            <label className="block text-sm font-medium text-gray-700 mb-1">Tâches à rattacher</label>
            <p className="text-xs text-gray-500 mb-2">Projet de l&apos;epic : tâches libres ou déjà liées à cette user story.</p>
            <div className="border rounded-md max-h-44 overflow-y-auto p-2 space-y-1">
              {tachesPourLier.map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input type="checkbox" checked={selectedTacheIds.includes(t.id)} onChange={() => toggleTache(t.id)} />
                  <span>{t.nom}</span>
                </label>
              ))}
              {epicId && tachesPourLier.length === 0 && (
                <p className="text-xs text-gray-400">Aucune tâche disponible pour ce projet</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md text-gray-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-violet-600 text-white rounded-md disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EpicEditModal({
  epicId,
  onClose,
  onSaved,
  projets,
  entites,
  clientsFournisseurs,
}: {
  epicId: string;
  onClose: () => void;
  onSaved: () => void;
  projets: ProjetOption[];
  entites: EntiteOption[];
  clientsFournisseurs: ClientFournisseurOption[];
}) {
  const [loading, setLoading] = useState(true);
  const [nom, setNom] = useState('');
  const [description, setDescription] = useState('');
  const [projetId, setProjetId] = useState('');
  const [selectedEntiteIds, setSelectedEntiteIds] = useState<string[]>([]);
  const [selectedClientFournisseurIds, setSelectedClientFournisseurIds] = useState<string[]>([]);
  const [projetClientFournisseurIds, setProjetClientFournisseurIds] = useState<string[] | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    setErr('');
    api
      .get(`/epics/${epicId}`)
      .then((r) => {
        if (cancel || !r.data) return;
        const ep = r.data as EpicRow;
        setNom(ep.nom || '');
        setDescription(ep.description || '');
        setProjetId(ep.projetId || '');
        setSelectedEntiteIds((ep.assignesEntites || []).map((ae) => ae.entite.id));
        setSelectedClientFournisseurIds(
          (ep.assignesClientsFournisseurs || []).map((row) => row.clientFournisseur.id)
        );
      })
      .catch(() => {
        if (!cancel) setErr("Impossible de charger l'epic.");
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [epicId]);

  useEffect(() => {
    if (!projetId) {
      setProjetClientFournisseurIds(undefined);
      return;
    }
    let cancel = false;
    api
      .get(`/projets/${projetId}`)
      .then((r) => {
        if (cancel || !r.data) return;
        const links = Array.isArray(r.data.clientsFournisseurs) ? r.data.clientsFournisseurs : [];
        const ids = links
          .map((l: { clientFournisseur?: { id?: string }; clientFournisseurId?: string }) =>
            l.clientFournisseur?.id || l.clientFournisseurId
          )
          .filter(Boolean) as string[];
        setProjetClientFournisseurIds(ids);
      })
      .catch(() => {
        if (!cancel) setProjetClientFournisseurIds([]);
      });
    return () => {
      cancel = true;
    };
  }, [projetId]);

  const toggleEntite = (id: string) =>
    setSelectedEntiteIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  const toggleClientFournisseur = (id: string) =>
    setSelectedClientFournisseurIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));

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

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr('');
    if (!nom.trim() || !projetId) {
      setErr('Nom et projet sont obligatoires.');
      return;
    }
    setSaving(true);
    try {
      await api.put(`/epics/${epicId}`, {
        nom: nom.trim(),
        description: description.trim() || null,
        projetId,
        entiteIds: selectedEntiteIds,
        assignesClientFournisseurIds: selectedClientFournisseurIds,
      });
      onSaved();
      onClose();
    } catch (ex: any) {
      setErr(ex?.response?.data?.error || ex?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[75] p-4">
        <div className="bg-white rounded-xl p-8 shadow-xl">
          <p className="text-gray-600">Chargement…</p>
          <button type="button" onClick={onClose} className="mt-4 text-sm text-blue-600">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[75] p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[92vh] overflow-y-auto">
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Modifier l&apos;Epic</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {err && <div className="p-3 bg-red-50 border border-red-200 rounded text-red-700 text-sm">{err}</div>}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Nom de l&apos;Epic *</label>
            <input
              value={nom}
              onChange={(e) => setNom(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Projet associé *</label>
            <select
              value={projetId}
              onChange={(e) => setProjetId(e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-md"
              required
            >
              <option value="">— Choisir —</option>
              {projets.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nom}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Entités assignées</label>
            <div className="border rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
              {entites.map((e) => (
                <label key={e.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input type="checkbox" checked={selectedEntiteIds.includes(e.id)} onChange={() => toggleEntite(e.id)} />
                  {e.nom}
                </label>
              ))}
              {entites.length === 0 && <p className="text-xs text-gray-400">Aucune entité</p>}
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Clients / fournisseurs assignés</label>
            {projetId && projetClientFournisseurIds && projetClientFournisseurIds.length > 0 && (
              <p className="text-xs text-gray-500 mb-1">
                Liste priorisée sur les fiches rattachées au projet ; les fiches déjà cochées restent visibles.
              </p>
            )}
            <div className="border rounded-md max-h-36 overflow-y-auto p-2 space-y-1">
              {clientsFournisseursAffiches.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm cursor-pointer hover:bg-gray-50 p-1 rounded">
                  <input
                    type="checkbox"
                    checked={selectedClientFournisseurIds.includes(c.id)}
                    onChange={() => toggleClientFournisseur(c.id)}
                  />
                  <span>
                    <span className="font-medium">{c.nom}</span>
                    <span className="text-gray-500 text-xs ml-1">
                      ({c.type === 'fournisseur' ? 'Fournisseur' : c.type === 'client' ? 'Client' : c.type})
                    </span>
                  </span>
                </label>
              ))}
              {clientsFournisseursAffiches.length === 0 && (
                <p className="text-xs text-gray-400">Aucune fiche client / fournisseur</p>
              )}
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 border rounded-md text-gray-700">
              Annuler
            </button>
            <button type="submit" disabled={saving} className="px-4 py-2 bg-blue-600 text-white rounded-md disabled:opacity-50">
              {saving ? 'Enregistrement…' : 'Enregistrer'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function EpicDetailModal({
  epicId,
  onClose,
  users,
}: {
  epicId: string;
  onClose: () => void;
  users: { id: string; nom: string; prenom: string; role?: string; statut?: string }[];
}) {
  const { user: currentUser } = useAuth();
  const [epic, setEpic] = useState<EpicRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [natifAccesDoc, setNatifAccesDoc] = useState<{ id: string; nom: string } | null>(null);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .get(`/epics/${epicId}`)
      .then((r) => {
        if (!cancel) setEpic(r.data);
      })
      .catch(() => {
        if (!cancel) setEpic(null);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [epicId]);

  if (loading || !epic) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4" onClick={onClose}>
        <div className="bg-white rounded-xl p-8" onClick={(e) => e.stopPropagation()}>
          <p className="text-gray-600">{loading ? 'Chargement…' : 'Epic introuvable'}</p>
          <button type="button" onClick={onClose} className="mt-4 text-sm text-blue-600">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
          <h2 className="text-lg font-semibold">Epic : {epic.nom}</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          {epic.description && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Description</p>
              <p className="text-gray-800 whitespace-pre-wrap">{epic.description}</p>
            </div>
          )}
          <p>
            <span className="text-gray-500">Projet :</span>{' '}
            <span className="font-medium">{epic.projet?.nom || '—'}</span>
          </p>
          {epicEntitesEffectives(epic).length > 0 && (
            <p>
              <span className="text-gray-500">Entités :</span>{' '}
              <span className="font-medium">
                {epicEntitesEffectives(epic).join(', ')}
              </span>
            </p>
          )}
          {(epic.assignesClientsFournisseurs || []).length > 0 && (
            <p>
              <span className="text-gray-500">Clients / fournisseurs :</span>{' '}
              <span className="font-medium">
                {(epic.assignesClientsFournisseurs || [])
                  .map((row) => `${row.clientFournisseur.nom} (${row.clientFournisseur.type})`)
                  .join(', ')}
              </span>
            </p>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">User stories</p>
            <ul className="space-y-2">
              {(epic.userStories || []).map((us) => (
                <li key={us.id} className="border rounded-lg p-3 bg-gray-50">
                  <p className="font-medium text-gray-900">{truncate(us.description, 200)}</p>
                  <p className="text-xs text-gray-500 mt-1">
                    {(us.taches || []).length} tâche(s){' '}
                    {(us.taches || []).map((t) => t.nom).join(', ')}
                  </p>
                </li>
              ))}
              {(epic.userStories || []).length === 0 && <p className="text-gray-400">Aucune</p>}
            </ul>
          </div>
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase mb-2">Documents</p>
            <ul className="space-y-2">
              {(epic.documents || []).map((ed) => {
                const d = normalizeDocumentAclFields(ed.document);
                const natif = isNativeAuthorControlledUploadDoc(d);
                return (
                  <li key={d.id} className="flex flex-wrap items-center gap-2 text-sm">
                    <a
                      href={`${API_BASE_URL}/documents/${d.id}/view?token=${localStorage.getItem('token')}`}
                      target="_blank"
                      rel="noreferrer"
                      className="text-blue-600 hover:underline"
                    >
                      {d.nom}
                    </a>
                    {natif && d.uploadedById === currentUser?.id && (
                      <button
                        type="button"
                        onClick={() => setNatifAccesDoc({ id: d.id, nom: d.nom })}
                        className="text-xs px-2 py-0.5 bg-purple-100 text-purple-800 rounded"
                      >
                        Accès
                      </button>
                    )}
                  </li>
                );
              })}
              {(epic.documents || []).length === 0 && <p className="text-gray-400">Aucun</p>}
            </ul>
          </div>
          <div className="border-t border-gray-100 pt-4">
            <PvReunionsLieesBlock apiPath={`/epics/${epicId}/pv-reunions`} />
          </div>
        </div>
      </div>
      <DocumentAccesNatifModal
        open={!!natifAccesDoc}
        document={natifAccesDoc}
        users={users}
        classNameZ="z-[90]"
        onClose={() => setNatifAccesDoc(null)}
        onAfterMutation={async () => {
          const { data } = await api.get(`/epics/${epicId}`);
          setEpic(data);
        }}
      />
    </div>
  );
}

export function UserStoryDetailModal({
  userStoryId,
  onClose,
  onOpenEpicId,
  users,
  canEdit = true,
}: {
  userStoryId: string;
  onClose: () => void;
  onOpenEpicId?: (epicId: string) => void;
  users: { id: string; nom: string; prenom: string; role?: string; statut?: string }[];
  canEdit?: boolean;
}) {
  const [us, setUs] = useState<UserStoryRow | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancel = false;
    setLoading(true);
    api
      .get(`/user-stories/${userStoryId}`)
      .then((r) => {
        if (!cancel) setUs(r.data);
      })
      .catch(() => {
        if (!cancel) setUs(null);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [userStoryId]);

  if (loading || !us) {
    return (
      <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4" onClick={onClose}>
        <div className="bg-white rounded-xl p-8" onClick={(e) => e.stopPropagation()}>
          <p className="text-gray-600">{loading ? 'Chargement…' : 'User story introuvable'}</p>
          <button type="button" onClick={onClose} className="mt-4 text-sm text-blue-600">
            Fermer
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[80] p-4" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl w-full max-w-xl max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b px-5 py-3 flex justify-between items-center">
          <h2 className="text-lg font-semibold">User story</h2>
          <button type="button" onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl">
            ×
          </button>
        </div>
        <div className="p-5 space-y-4 text-sm">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Description</p>
            <p className="text-gray-800 whitespace-pre-wrap">{us.description}</p>
          </div>
          {us.epic && (
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase">Epic</p>
              <button
                type="button"
                onClick={() => {
                  if (us.epic?.id && onOpenEpicId) {
                    onClose();
                    onOpenEpicId(us.epic.id);
                  }
                }}
                className="text-left text-blue-600 hover:underline font-medium"
              >
                {us.epic.nom}
              </button>
              {us.epic.projet && <p className="text-xs text-gray-500 mt-1">Projet : {us.epic.projet.nom}</p>}
              {epicEntitesEffectives(us.epic).length > 0 && (
                <p className="text-xs text-gray-500 mt-1">
                  Entités : {epicEntitesEffectives(us.epic).join(', ')}
                </p>
              )}
            </div>
          )}
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase">Tâches</p>
            <ul className="list-disc pl-5 mt-1">
              {(us.taches || []).map((t) => (
                <li key={t.id}>
                  {t.nom} <span className="text-gray-400">({t.statut})</span>
                </li>
              ))}
              {(us.taches || []).length === 0 && <li className="text-gray-400 list-none">Aucune</li>}
            </ul>
          </div>
          <AgileDocumentsUserStorySection
            userStoryId={us.id}
            documentsNatifs={us.documentsNatifs || []}
            canEdit={canEdit}
            users={users}
            onDocumentsChange={async () => {
              const { data } = await api.get(`/user-stories/${userStoryId}`);
              setUs(data);
            }}
          />
          <div className="border-t border-gray-100 pt-4">
            <PvReunionsLieesBlock apiPath={`/user-stories/${userStoryId}/pv-reunions`} />
          </div>
        </div>
      </div>
    </div>
  );
}
