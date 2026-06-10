/** Fusion membres (UserEntite) + entités dont l’utilisateur est responsable. */
export type UserEntiteDisplayRow = {
  id: string;
  nom: string;
  code?: string | null;
  membre: boolean;
  responsable: boolean;
};

export function mergeUserEntitesForDisplay(user: {
  entitesMembres?: { entite?: { id: string; nom: string; code?: string | null } | null }[];
  entitesResponsable?: { id: string; nom: string; code?: string | null }[];
}): UserEntiteDisplayRow[] {
  const map = new Map<string, UserEntiteDisplayRow>();
  for (const ue of user.entitesMembres || []) {
    const e = ue.entite;
    if (!e?.id) continue;
    const prev = map.get(e.id);
    map.set(e.id, {
      id: e.id,
      nom: e.nom,
      code: e.code,
      membre: true,
      responsable: prev?.responsable ?? false,
    });
  }
  for (const e of user.entitesResponsable || []) {
    if (!e?.id) continue;
    const prev = map.get(e.id);
    map.set(e.id, {
      id: e.id,
      nom: e.nom,
      code: e.code,
      membre: prev?.membre ?? false,
      responsable: true,
    });
  }
  return Array.from(map.values()).sort((a, b) =>
    a.nom.localeCompare(b.nom, 'fr', { sensitivity: 'base' })
  );
}

export function userEntitesSortLabel(rows: UserEntiteDisplayRow[]): string {
  return rows.map((r) => r.nom).join(', ') || 'N/A';
}
