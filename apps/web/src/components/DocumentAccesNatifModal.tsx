import { useEffect, useState } from 'react';
import { api } from '../services/api';

const PMO_DOCUMENTS_ACCES_CHANGED = 'pmo-documents-acces-changed';

function notifyDocumentsListAccesSync() {
  try {
    window.dispatchEvent(new CustomEvent(PMO_DOCUMENTS_ACCES_CHANGED));
  } catch {
    /* ignore */
  }
}

export type DocumentAccesNatifRef = { id: string; nom: string };

type Props = {
  open: boolean;
  document: DocumentAccesNatifRef | null;
  users: any[];
  onClose: () => void;
  /** Après toute mutation réussie (permissions / exclusions admin). */
  onAfterMutation?: () => void | Promise<void>;
  /** Ex. z-[90] quand la modale est ouverte au-dessus d’une autre modale (epic / US). */
  classNameZ?: string;
};

/**
 * Modal « type contrat » pour les pièces confidentielles natives (projet, processus, epic, user story) :
 * exclusions admin, accès explicites — alignée sur la fiche projet.
 */
export function DocumentAccesNatifModal({
  open,
  document: doc,
  users,
  onClose,
  onAfterMutation,
  classNameZ = 'z-50',
}: Props) {
  const [detail, setDetail] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [newUserId, setNewUserId] = useState('');

  useEffect(() => {
    if (!open || !doc?.id) {
      setDetail(null);
      setNewUserId('');
      return;
    }
    let cancel = false;
    setLoading(true);
    setDetail(null);
    setNewUserId('');
    api
      .get(`/documents/${doc.id}/acces`)
      .then((r) => {
        if (!cancel) setDetail(r.data);
      })
      .catch(() => {
        if (!cancel) setDetail(null);
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [open, doc?.id]);

  const refresh = async () => {
    if (!doc?.id) return;
    const { data } = await api.get(`/documents/${doc.id}/acces`);
    setDetail(data);
  };

  const afterOk = async () => {
    await refresh();
    notifyDocumentsListAccesSync();
    await onAfterMutation?.();
  };

  const handleDocRestoreAdmin = async (userId: string) => {
    if (!doc) return;
    if (!window.confirm("Rétablir l'accès administrateur implicite (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/documents/${doc.id}/admin-sans-acces/${userId}`);
      await afterOk();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDocRevokeAdminImplicit = async (userId: string) => {
    if (!doc) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur sur ce document ? Il ne le verra plus tant que vous ne lui accorderez pas un accès explicite."
      )
    ) {
      return;
    }
    try {
      await api.post(`/documents/${doc.id}/admin-sans-acces`, { userId });
      await afterOk();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDocQuickLimitAdmin = async (userId: string) => {
    if (!doc) return;
    try {
      await api.post(`/documents/${doc.id}/permissions`, { userId });
      await afterOk();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDocRemovePermissionRow = async (permissionId: string, targetIsAdmin?: boolean) => {
    if (!doc) return;
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus de droit explicite ; sans rétablissement il pourra être totalement exclu."
      : 'Retirer cet accès ?';
    if (!window.confirm(msg)) return;
    try {
      await api.delete(`/documents/${doc.id}/permissions/${permissionId}`);
      await afterOk();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleDocAddSharedPermission = async () => {
    if (!doc || !newUserId) return;
    try {
      await api.post(`/documents/${doc.id}/permissions`, { userId: newUserId });
      setNewUserId('');
      await afterOk();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  if (!open || !doc) return null;

  return (
    <div
      className={`fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center p-3 sm:p-6 ${classNameZ}`}
    >
      <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
        <h3 className="text-xl font-semibold mb-2">Accès — {doc.nom}</h3>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          <span className="font-medium">Seul l&apos;auteur du dépôt</span> peut gérer les accès. Pour un administrateur
          : sans ligne dans « Accès partagés » et sans exclusion, accès complet sur la pièce ; une ligne limite à la
          lecture ; « Retirer l&apos;accès » le prive totalement jusqu&apos;à un accès explicite ou « Rétablir l&apos;accès
          admin par défaut ».
        </p>
        {detail && !detail.canManagePermissions && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
            Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant qu&apos;auteur du
            document.
          </p>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : detail ? (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
              <ul className="space-y-3 text-gray-700 text-sm">
                {(detail.admins || []).map((a: any) => {
                  const userDelegations = (detail.delegations || []).filter((d: any) => d.user?.id === a.id);
                  const primaryDelegation = userDelegations[0];
                  const explicite = userDelegations.length > 0;
                  const isCreatorAdmin = detail.creator?.id === a.id;
                  const refuse = (detail.adminSansAccesUserIds || []).includes(a.id);
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
                            — accès limité (liste explicite — lecture)
                          </span>
                        )}
                      </div>
                      {detail.canManagePermissions && !isCreatorAdmin && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {refuse && !explicite ? (
                            <button
                              type="button"
                              onClick={() => void handleDocRestoreAdmin(a.id)}
                              className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                            >
                              Rétablir l&apos;accès admin par défaut
                            </button>
                          ) : !explicite ? (
                            <>
                              <button
                                type="button"
                                onClick={() => void handleDocQuickLimitAdmin(a.id)}
                                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                              >
                                Limiter l&apos;accès (lecture)
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleDocRevokeAdminImplicit(a.id)}
                                className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                              >
                                Retirer l&apos;accès
                              </button>
                            </>
                          ) : (
                            <button
                              type="button"
                              onClick={() => void handleDocRemovePermissionRow(primaryDelegation.id, a.role === 'admin')}
                              className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                            >
                              Révoquer l&apos;accès
                            </button>
                          )}
                        </div>
                      )}
                      {detail.canManagePermissions && isCreatorAdmin && (
                        <span className="text-xs text-gray-500">Auteur du document : accès complet, non modérable ici.</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Auteur du document</p>
              {detail.creator ? (
                <p>
                  <span className="font-medium">
                    {detail.creator.prenom} {detail.creator.nom}
                  </span>
                  <span className="text-gray-400"> — seul habilité à gérer les accès de cette pièce</span>
                </p>
              ) : (
                <p className="text-amber-800 text-sm">Auteur non résolu.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
              {(detail.delegations || []).length === 0 ? (
                <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
              ) : (
                <ul className="space-y-2">
                  {(detail.delegations || []).map((d: any) => (
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
                      <span className="text-gray-500 text-sm">— lecture</span>
                      {detail.canManagePermissions && (
                        <button
                          type="button"
                          onClick={() => void handleDocRemovePermissionRow(d.id, d.user?.role === 'admin')}
                          className="text-xs text-red-600 hover:underline ml-auto"
                        >
                          {d.user?.role === 'admin' ? 'Révoquer' : 'Retirer'}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail.canManagePermissions && (
              <div className="border-t border-gray-200 pt-4 space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Accorder un accès</p>
                <div className="flex flex-wrap items-end gap-3">
                  <select
                    value={newUserId}
                    onChange={(e) => setNewUserId(e.target.value)}
                    className="min-w-[12rem] border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    <option value="">— Utilisateur —</option>
                    {users
                      .filter((u: any) => (!u.statut || u.statut === 'actif') && u.id !== detail.creator?.id)
                      .map((u: any) => (
                        <option key={u.id} value={u.id}>
                          {u.prenom} {u.nom} {u.role === 'admin' ? '(admin)' : ''}
                        </option>
                      ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => void handleDocAddSharedPermission()}
                    disabled={!newUserId}
                    className="px-4 py-2 bg-blue-600 text-white rounded-md text-sm hover:bg-blue-700 disabled:opacity-50"
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
            onClick={onClose}
            className="px-4 py-2 border border-gray-300 rounded-md text-sm text-gray-700 hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
