/**
 * Pièces confidentielles « natives » : ACL pilotée par l’auteur (fiche projet, processus, epic, user story).
 * Doit rester aligné avec `isNativeProjetUploadDocument` côté API.
 */
export function isNativeAuthorControlledUploadDoc(d: any): boolean {
  return (
    !!d?.estConfidentiel &&
    ((d?.typeDocument === 'tache') ||
      (!!d?.referenceId &&
        ((d?.typeDocument === 'projet' && d?.referenceType === 'projet') ||
      (d?.typeDocument === 'processus' && d?.referenceType === 'processus') ||
      (d?.typeDocument === 'epic' && d?.referenceType === 'epic') ||
          (d?.typeDocument === 'user_story' && d?.referenceType === 'userStory'))))
  );
}

/** Normalise `adminSansAcces` Prisma vers `adminSansAccesUserIds` attendu par l’UI. */
export function normalizeDocumentAclFields<T extends Record<string, any>>(raw: T): T {
  const adminSansAccesUserIds =
    (raw as any).adminSansAccesUserIds ??
    (Array.isArray((raw as any).adminSansAcces)
      ? (raw as any).adminSansAcces.map((x: { userId: string }) => x.userId)
      : undefined);
  const { adminSansAcces: _a, ...rest } = raw as any;
  return { ...rest, adminSansAccesUserIds } as T;
}
