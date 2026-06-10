import { useCallback, useEffect, useState } from 'react';
import { api, API_BASE_URL } from '../services/api';

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

function clientFournisseurLabel(x: { nom?: string; type?: string } | null | undefined) {
  const n = String(x?.nom || '').trim();
  const t = x?.type ? ` (${x.type})` : '';
  return (n || '—') + t;
}

export type PvReunionDelegation = {
  id: string;
  permission: string;
  user: { id: string; nom: string; prenom: string; email?: string; role?: string };
  grantedBy?: unknown;
  createdAt?: string;
};

export type PvReunionAccesDetail = {
  ficheNom?: string;
  pvId?: string;
  canManagePermissions?: boolean;
  visibilityNote?: string;
  admins?: { id: string; nom: string; prenom: string; email?: string; role?: string }[];
  creator?: { id: string; nom: string; prenom: string; email?: string; role?: string } | null;
  delegations?: PvReunionDelegation[];
  adminSansAccesUserIds?: string[];
  modificationDelegues?: { userId?: string; user?: { id: string; nom: string; prenom: string; email?: string } }[];
  presentsUser?: { user?: { id: string; nom: string; prenom: string; email?: string } }[];
  presentsClientFournisseur?: { clientFournisseur?: { id: string; nom: string; type?: string } }[];
  document?: { id: string; nom?: string; fichierNomOriginal?: string } | null;
};

export function PvReunionAccesModal({
  open,
  onClose,
  pvId,
  titreFallback,
  onPermissionsChanged,
}: {
  open: boolean;
  onClose: () => void;
  pvId: string | null;
  titreFallback: string;
  /** Appelé après une mutation réussie (permissions / admin sans accès) pour rafraîchir la liste ou la fiche. */
  onPermissionsChanged?: () => void;
}) {
  const [loading, setLoading] = useState(false);
  const [detail, setDetail] = useState<PvReunionAccesDetail | null>(null);
  const [users, setUsers] = useState<any[]>([]);
  const [newPermUserId, setNewPermUserId] = useState('');
  const [newPermNiveau, setNewPermNiveau] = useState('lecture');
  const [adminLimitNiveau, setAdminLimitNiveau] = useState<Record<string, string>>({});

  const refreshDetail = useCallback(async () => {
    if (!pvId) return;
    const { data } = await api.get<PvReunionAccesDetail>(`/pv-reunions/${pvId}/acces`);
    setDetail(data);
  }, [pvId]);

  useEffect(() => {
    if (!open || !pvId) {
      setDetail(null);
      setNewPermUserId('');
      setNewPermNiveau('lecture');
      setAdminLimitNiveau({});
      return;
    }
    let cancel = false;
    setLoading(true);
    setDetail(null);
    Promise.all([api.get<PvReunionAccesDetail>(`/pv-reunions/${pvId}/acces`), api.get('/users')])
      .then(([accesRes, usersRes]) => {
        if (cancel) return;
        setDetail(accesRes.data);
        setUsers(usersRes.data || []);
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
  }, [open, pvId]);

  const notifyChanged = () => {
    onPermissionsChanged?.();
  };

  const handleAddPermission = async () => {
    if (!pvId || !newPermUserId) return;
    try {
      await api.post(`/pv-reunions/${pvId}/permissions`, {
        userId: newPermUserId,
        niveau: newPermNiveau,
      });
      setNewPermUserId('');
      await refreshDetail();
      notifyChanged();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRemovePermissionEntry = async (permissionEntryId: string, targetIsAdmin?: boolean) => {
    const msg = targetIsAdmin
      ? "Révoquer cet accès ? L'administrateur n'aura plus aucun droit sur ce PV. Vous pourrez lui accorder à nouveau un accès via « Accorder un accès » ci-dessous."
      : 'Retirer ce droit ?';
    if (!pvId || !window.confirm(msg)) return;
    try {
      await api.delete(`/pv-reunions/${pvId}/permissions/entry/${permissionEntryId}`);
      await refreshDetail();
      notifyChanged();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRevokeAdminImplicitAccess = async (userId: string) => {
    if (!pvId) return;
    if (
      !window.confirm(
        "Retirer tout accès à cet administrateur ? Il ne verra plus le PV tant que vous ne lui aurez pas accordé un accès via la liste ci-dessous."
      )
    )
      return;
    try {
      await api.post(`/pv-reunions/${pvId}/admin-sans-acces`, { userId });
      await refreshDetail();
      notifyChanged();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const handleRestoreAdminDefaultAccess = async (userId: string) => {
    if (!pvId) return;
    if (!window.confirm("Rétablir l'accès administrateur par défaut (complet) pour cet utilisateur ?")) return;
    try {
      await api.delete(`/pv-reunions/${pvId}/admin-sans-acces/${userId}`);
      await refreshDetail();
      notifyChanged();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  const patchPermissionLevel = async (targetUserId: string, niveau: string) => {
    if (!pvId) return;
    try {
      await api.post(`/pv-reunions/${pvId}/permissions`, { userId: targetUserId, niveau });
      await refreshDetail();
      notifyChanged();
    } catch (err: any) {
      alert(err?.response?.data?.error || err?.message || 'Erreur');
    }
  };

  const quickLimitAdminAccess = async (adminId: string) => {
    if (!pvId) return;
    const niveau = adminLimitNiveau[adminId] || 'lecture';
    try {
      await api.post(`/pv-reunions/${pvId}/permissions`, { userId: adminId, niveau });
      await refreshDetail();
      notifyChanged();
    } catch (e: any) {
      alert(e?.response?.data?.error || e?.message || 'Erreur');
    }
  };

  if (!open) return null;

  const title = detail?.ficheNom || titreFallback;

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-3 sm:p-6">
      <div className="bg-white rounded-lg shadow-xl p-6 sm:p-8 w-full max-w-5xl max-h-[min(94vh,960px)] overflow-y-auto">
        <h3 className="text-xl font-semibold mb-2">Accès — {title}</h3>
        <p className="text-sm text-gray-600 mb-5 leading-relaxed">
          {detail?.visibilityNote ||
            'Seul le créateur du PV peut gérer les accès partagés. Pour un administrateur : sans ligne dans « Accès partagés » et sans exclusion, il a un accès complet ; une ligne limite ses droits ; « Retirer l’accès » le prive totalement jusqu’à un nouvel accès explicite. Les « présents » restent informatifs (réunion).'}
        </p>
        {detail && !detail.canManagePermissions && (
          <p className="text-sm text-amber-800 bg-amber-50 border border-amber-100 rounded-md px-3 py-2 mb-4">
            Vous consultez la liste en lecture seule. Pour modifier les droits, connectez-vous en tant que créateur du PV.
          </p>
        )}
        {loading ? (
          <p className="text-sm text-gray-500">Chargement…</p>
        ) : detail ? (
          <div className="space-y-5 text-sm">
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Administrateurs</p>
              <p className="text-xs text-gray-500 mb-2">
                Limitez un admin avec « Limiter l’accès », retirez-le entièrement avec « Retirer l’accès », ou rétablissez
                l’accès complet implicite s’il était exclu.
              </p>
              <ul className="space-y-3 text-gray-700 text-sm">
                {(detail.admins || []).map((a) => {
                  const delegation = (detail.delegations || []).find((d) => d.user?.id === a.id);
                  const explicite = !!delegation;
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
                        {a.email && <span className="text-gray-500 ml-1">({a.email})</span>}
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
                      {detail.canManagePermissions && !isCreatorAdmin && (
                        <div className="flex flex-wrap items-center gap-2 shrink-0">
                          {refuse && !explicite ? (
                            <button
                              type="button"
                              onClick={() => handleRestoreAdminDefaultAccess(a.id)}
                              className="text-xs px-3 py-1.5 bg-green-100 text-green-800 rounded-md hover:bg-green-200"
                            >
                              Rétablir l’accès admin par défaut
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
                                Retirer l’accès
                              </button>
                            </>
                          ) : (
                            <>
                              <select
                                value={delegation!.permission}
                                onChange={async (e) => {
                                  const niveau = e.target.value;
                                  if (!pvId || niveau === delegation!.permission) return;
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
                                onClick={() => handleRemovePermissionEntry(delegation!.id, true)}
                                className="text-xs px-3 py-1.5 bg-red-100 text-red-800 rounded-md hover:bg-red-200"
                              >
                                Révoquer l’accès
                              </button>
                            </>
                          )}
                        </div>
                      )}
                      {detail.canManagePermissions && isCreatorAdmin && (
                        <span className="text-xs text-gray-500">Créateur : accès complet, non modérable ici.</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Créateur</p>
              {detail.creator ? (
                <p>
                  <span className="font-medium">
                    {detail.creator.prenom} {detail.creator.nom}
                  </span>
                  <span className="text-gray-400">
                    {' '}
                    — seul habilité à gérer les accès partagés ; modification et mise en corbeille selon ses autres droits
                    sur le PV
                  </span>
                </p>
              ) : (
                <p className="text-amber-800 text-sm">Créateur non résolu.</p>
              )}
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Accès partagés</p>
              {(detail.delegations || []).length === 0 ? (
                <p className="text-gray-400 text-xs italic">Aucun accès délégué</p>
              ) : (
                <ul className="space-y-2">
                  {(detail.delegations || []).map((d) => (
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
                      {detail.canManagePermissions ? (
                        <>
                          <select
                            value={d.permission}
                            onChange={async (e) => {
                              const niveau = e.target.value;
                              if (!pvId || niveau === d.permission) return;
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
                        <span className="text-gray-500">— {LABEL_PERM_MODAL[d.permission] || d.permission}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {detail.canManagePermissions && (
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
                      const actifs = users.filter(
                        (u: any) => (!u.statut || u.statut === 'actif') && u.id !== detail.creator?.id
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
                  <select
                    value={newPermNiveau}
                    onChange={(e) => setNewPermNiveau(e.target.value)}
                    className="w-full lg:w-56 border border-gray-300 rounded-md px-3 py-2 text-sm"
                  >
                    {NIVEAUX.map((n) => (
                      <option key={n.value} value={n.value}>
                        {n.label}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={handleAddPermission}
                    disabled={!newPermUserId}
                    className="w-full lg:w-auto px-4 py-2 bg-blue-600 text-white rounded-md text-sm font-medium hover:bg-blue-700 disabled:opacity-50 shrink-0"
                  >
                    Ajouter
                  </button>
                </div>
              </div>
            )}
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Délégués modification (formulaire)
              </p>
              <p className="text-xs text-gray-500 mb-2">
                Alignés sur les permissions « modification » ou « suppression » ; modifiables aussi depuis l’édition du
                PV.
              </p>
              <ul className="list-disc list-inside space-y-1">
                {(detail.modificationDelegues || []).map((d, i) => (
                  <li key={d.user?.id || d.userId || i}>
                    {d.user
                      ? `${d.user.prenom} ${d.user.nom}${d.user.email ? ` (${d.user.email})` : ''}`
                      : d.userId || '—'}
                  </li>
                ))}
                {(detail.modificationDelegues || []).length === 0 && (
                  <li className="text-gray-400 list-none italic">Aucun (hors créateur / admins implicites)</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Présents (utilisateurs)</p>
              <ul className="flex flex-wrap gap-2">
                {(detail.presentsUser || []).map((p, i) => (
                  <li key={p.user?.id || i} className="px-2 py-1 bg-gray-100 rounded text-xs">
                    {p.user ? `${p.user.prenom} ${p.user.nom}` : '—'}
                  </li>
                ))}
                {(detail.presentsUser || []).length === 0 && (
                  <li className="text-gray-400 italic list-none">Aucun</li>
                )}
              </ul>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Présents (clients / fournisseurs)
              </p>
              <ul className="flex flex-wrap gap-2">
                {(detail.presentsClientFournisseur || []).map((p, i) => (
                  <li key={p.clientFournisseur?.id || i} className="px-2 py-1 bg-amber-50 rounded text-xs">
                    {clientFournisseurLabel(p.clientFournisseur)}
                  </li>
                ))}
                {(detail.presentsClientFournisseur || []).length === 0 && (
                  <li className="text-gray-400 italic list-none">Aucun</li>
                )}
              </ul>
            </div>
            {detail.document?.id && (
              <div>
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Document principal</p>
                <a
                  href={`${API_BASE_URL}/documents/${detail.document.id}/view?token=${localStorage.getItem('token')}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-blue-600 hover:underline"
                >
                  {detail.document.nom || detail.document.fichierNomOriginal}
                </a>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-red-600">Impossible de charger le détail des accès.</p>
        )}
        <div className="flex justify-end mt-6 pt-4 border-t border-gray-100">
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
