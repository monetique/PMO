import { useEffect, useState } from 'react';
import { api } from '../services/api';

const LABEL_PERM_MODAL: Record<string, string> = {
  lecture: 'Consultation',
  modification: 'Modification',
  suppression: 'Suppression',
  gestion: 'Gestion des droits',
};

const PROJET_PERM_LEVELS = [
  { value: 'lecture', label: '👁 Consultation' },
  { value: 'modification', label: '✏️ Modification' },
  { value: 'suppression', label: '🗑 Suppression (mise en corbeille)' },
  { value: 'gestion', label: '🔐 Gestion des droits' },
];

type ProjetRef = { id: string; nom: string };

export function ProjetAccesModal({
  projet,
  users,
  onClose,
  onAfterChange,
}: {
  projet: ProjetRef | null;
  users: any[];
  onClose: () => void;
  onAfterChange: () => void;
}) {
  const [accesDetail, setAccesDetail] = useState<any | null>(null);
  const [accesLoading, setAccesLoading] = useState(false);
  const [adminLimitPerm, setAdminLimitPerm] = useState<Record<string, string>>({});
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermType, setNewPermType] = useState('lecture');

  useEffect(() => {
    if (!projet) {
      setAccesDetail(null);
      setNewPermUserId('');
      setAdminLimitPerm({});
      return;
    }
    let cancelled = false;
    setAccesLoading(true);
    setAccesDetail(null);
    setNewPermUserId('');
    setNewPermType('lecture');
    setAdminLimitPerm({});
    (async () => {
      try {
        const { data } = await api.get(`/projets/${projet.id}/acces`);
        if (!cancelled) setAccesDetail(data);
      } catch (err: any) {
        if (!cancelled) {
          alert(err?.response?.data?.error || err?.message || 'Erreur chargement accès');
          onClose();
        }
      } finally {
        if (!cancelled) setAccesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fermeture stable gérée par le parent
  }, [projet?.id]);

  const refreshAccesDetail = async (id: string) => {
    const { data } = await api.get(`/projets/${id}/acces`);
    setAccesDetail(data);
  };

  const handleAddPermission = async () => {
    if (!projet || !newPermUserId) return;
    try {
      await api.post(`/projets/${projet.id}/permissions`, {
        userId: newPermUserId,
        permission: newPermType,
      });
      setNewPermUserId('');
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRemovePermission = async (permissionId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit explicite sur ce projet. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès »."
      : 'Retirer ce droit ?';
    if (!projet || !window.confirm(msg)) return;
    try {
      await api.delete(`/projets/${projet.id}/permissions/${permissionId}`);
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const revokeAllProjetDelegationsForUser = async (userId: string) => {
    if (!projet || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    if (rows.length === 0) return;
    if (!window.confirm('Révoquer tous les droits explicites pour cet utilisateur sur ce projet ?')) return;
    try {
      for (const r of rows) {
        await api.delete(`/projets/${projet.id}/permissions/${r.id}`);
      }
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultProjet = async (userId: string) => {
    if (!projet) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/projets/${projet.id}/admin-sans-acces/${userId}`);
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitProjet = async (userId: string) => {
    if (!projet) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus le projet tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    ) {
      return;
    }
    try {
      await api.post(`/projets/${projet.id}/admin-sans-acces`, { userId });
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const quickLimitAdminProjet = async (userId: string) => {
    if (!projet) return;
    const permission = adminLimitPerm[userId] || 'lecture';
    try {
      await api.post(`/projets/${projet.id}/permissions`, { userId, permission });
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const replaceAdminProjetPermissionLevel = async (userId: string, permission: string) => {
    if (!projet || !accesDetail) return;
    const rows = (accesDetail.delegations || []).filter((d: any) => d.user?.id === userId);
    try {
      for (const r of rows) {
        await api.delete(`/projets/${projet.id}/permissions/${r.id}`);
      }
      await api.post(`/projets/${projet.id}/permissions`, { userId, permission });
      await refreshAccesDetail(projet.id);
      onAfterChange();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  if (!projet) return null;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
        <h3 className="text-xl font-semibold mb-2">Accès — {projet.nom}</h3>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          Le <span className="font-medium">créateur</span> du projet et les utilisateurs avec la permission{' '}
          <span className="font-medium">« Gestion des droits »</span> peuvent gérer les accès. Pour un administrateur : sans
          ligne dans « Accès partagés » et sans exclusion, accès complet ; une ligne limite les droits ; « Retirer
          l&apos;accès » retire tout accès jusqu&apos;à octroi via « Accorder un accès » ; « Rétablir l&apos;accès admin par
          défaut » annule une exclusion.
        </p>
        {accesDetail && !accesDetail.canManagePermissions && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
            Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur ou avec la
            délégation « Gestion des droits ».
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
                              onClick={() => void handleRestoreAdminDefaultProjet(a.id)}
                              className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                            >
                              Rétablir l&apos;accès admin par défaut
                            </button>
                          ) : !explicite ? (
                            <>
                              <select
                                value={adminLimitPerm[a.id] ?? 'lecture'}
                                onChange={(ev) =>
                                  setAdminLimitPerm((prev) => ({ ...prev, [a.id]: ev.target.value }))
                                }
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {PROJET_PERM_LEVELS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void quickLimitAdminProjet(a.id)}
                                className="text-xs px-3 py-1.5 bg-blue-600 text-white rounded-md hover:bg-blue-700"
                              >
                                Limiter l&apos;accès
                              </button>
                              <button
                                type="button"
                                onClick={() => void handleRevokeAdminImplicitProjet(a.id)}
                                className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                              >
                                Retirer l&apos;accès
                              </button>
                            </>
                          ) : (
                            <>
                              <select
                                value={primaryDelegation?.permission ?? 'lecture'}
                                onChange={(ev) => {
                                  const permission = ev.target.value;
                                  if (permission === primaryDelegation?.permission) return;
                                  void replaceAdminProjetPermissionLevel(a.id, permission);
                                }}
                                className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                              >
                                {PROJET_PERM_LEVELS.map((n) => (
                                  <option key={n.value} value={n.value}>
                                    {n.label}
                                  </option>
                                ))}
                              </select>
                              <button
                                type="button"
                                onClick={() => void revokeAllProjetDelegationsForUser(a.id)}
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
                  <span className="text-gray-400">
                    {' '}
                    — gestion des accès (avec délégation « Gestion des droits ») et droits étendus sur le projet
                  </span>
                </p>
              ) : (
                <p className="text-amber-800 text-sm">Aucun créateur enregistré (données historiques).</p>
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
                            onChange={(ev) => {
                              const permission = ev.target.value;
                              if (permission === d.permission) return;
                              void replaceAdminProjetPermissionLevel(d.user.id, permission);
                            }}
                            className="text-sm border border-gray-300 rounded-md px-2 py-1 bg-white"
                          >
                            {PROJET_PERM_LEVELS.map((n) => (
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
                        <span className="text-gray-500">— {LABEL_PERM_MODAL[d.permission] || d.permission}</span>
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
                    onChange={(ev) => setNewPermUserId(ev.target.value)}
                    className="w-full min-w-0 border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
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
                    onChange={(ev) => setNewPermType(ev.target.value)}
                    className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {PROJET_PERM_LEVELS.map((n) => (
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
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-50"
          >
            Fermer
          </button>
        </div>
      </div>
    </div>
  );
}
