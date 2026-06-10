/**
 * Lignes « administrateurs » alignées sur la logique Contrat / Licence / PV :
 * créateur, admin exclu (sans permission), admin limité (permission explicite), admin complet.
 */
export function AccessContratLikeAdminLines({
  users,
  createdById,
  createdBy,
  adminSansAccesUserIds,
  permissions,
  droitsAdminCompletLabel,
  niveauLabel,
  creatorRightsLabel,
  keyPrefix,
  excludedHint = "— aucun accès (exclu ; réintégration via « Accès » → Accorder un accès)",
  limitedPrefix = 'Admin : accès limité —',
}: {
  users: any[];
  createdById?: string | null;
  createdBy?: { id: string; prenom: string; nom: string } | null;
  adminSansAccesUserIds?: string[];
  permissions: { userId: string; niveau: string; user?: { prenom?: string; nom?: string } }[];
  /** Libellé pour un admin qui est aussi créateur (si omis, utilise droitsAdminCompletLabel). */
  creatorRightsLabel?: string;
  droitsAdminCompletLabel: string;
  niveauLabel: (niveau: string) => string;
  /** Préfixe clés React (ex. id contrat, document) */
  keyPrefix: string;
  excludedHint?: string;
  limitedPrefix?: string;
}) {
  const actifAdmins = users.filter((u: any) => u.role === 'admin' && (!u.statut || u.statut === 'actif'));
  const creatorId = createdById || createdBy?.id;
  const excluded = new Set(adminSansAccesUserIds ?? []);
  const permByUserId = new Map(permissions.map((p) => [p.userId, p]));

  return (
    <>
      {actifAdmins.map((a: any) => {
        const isCreator = creatorId === a.id;
        const perm = permByUserId.get(a.id);
        const adminExclu = excluded.has(a.id) && !perm;
        const adminLimite = !!perm && !isCreator;
        return (
          <div key={`${keyPrefix}-adm-${a.id}`} className="min-w-0">
            <span className="font-medium text-gray-900">
              {a.prenom} {a.nom}
            </span>
            {isCreator ? (
              <span className="text-gray-500 italic block sm:inline sm:ml-1">
                (Administrateur et créateur : {creatorRightsLabel ?? droitsAdminCompletLabel})
              </span>
            ) : adminExclu ? (
              <span className="text-red-700 font-medium block sm:inline sm:ml-1">{excludedHint}</span>
            ) : adminLimite ? (
              <span className="text-amber-800 block sm:inline sm:ml-1">
                ({limitedPrefix} {niveauLabel(perm.niveau)} ; voir accès partagés ci-dessous)
              </span>
            ) : (
              <span className="text-gray-500 italic block sm:inline sm:ml-1">(Admin : {droitsAdminCompletLabel})</span>
            )}
          </div>
        );
      })}
      {createdBy && creatorId && !actifAdmins.some((a: any) => a.id === creatorId) && (
        <div className="min-w-0">
          <span className="font-medium text-gray-900">
            {createdBy.prenom} {createdBy.nom}
          </span>
          <span className="text-gray-500 italic block sm:inline sm:ml-1">
            (Créateur : {creatorRightsLabel ?? droitsAdminCompletLabel})
          </span>
        </div>
      )}
    </>
  );
}
