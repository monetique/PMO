/**
 * Types de document = enum Prisma `DocType` (schema.prisma).
 * À tenir aligné avec la base ; ajouter une valeur ici quand le schéma évolue.
 */
export const DOCUMENT_TYPE_OPTIONS: readonly { value: string; label: string }[] = [
  { value: 'general', label: 'Général' },
  { value: 'processus', label: 'Processus' },
  { value: 'projet', label: 'Projet' },
  { value: 'epic', label: 'Epic' },
  { value: 'user_story', label: 'User story' },
  { value: 'procedure', label: 'Procédure' },
  { value: 'formulaire', label: 'Formulaire' },
  { value: 'contrat', label: 'Contrat' },
  { value: 'licence', label: 'Licence' },
  { value: 'tache', label: 'Tâche' },
  { value: 'client_fournisseur', label: 'Client / Fournisseur' },
  { value: 'pv_reunion', label: 'PV de réunion' },
  { value: 'template', label: 'Modèle (template)' },
  { value: 'autre', label: 'Autre' },
] as const;

export function documentTypeLabel(value: string | null | undefined): string {
  if (!value) return '—';
  const o = DOCUMENT_TYPE_OPTIONS.find((x) => x.value === value);
  return o?.label ?? value;
}
