import { PermissionType, Role } from '../generated/prisma/enums';

export type CfAuth = { userId: string; role: Role };
export type CfAclRow = { id: string; createdById: string | null };

export function isAdminRole(role: string) {
  return role === 'admin';
}

export function isLegacyOpen(cf: CfAclRow) {
  return cf.createdById == null;
}

export function canViewCf(
  cf: CfAclRow,
  auth: CfAuth,
  userPermTypes: PermissionType[],
  adminImplicitRefused = false
) {
  if (auth.role === 'contributeur') {
    // Règle métier: un contributeur ne voit que les fiches avec droit explicite.
    return userPermTypes.length > 0;
  }
  if (isAdminRole(auth.role)) {
    if (cf.createdById === auth.userId) return true;
    if (adminImplicitRefused && userPermTypes.length === 0) return false;
    return true;
  }
  if (cf.createdById === auth.userId) return true;
  if (userPermTypes.length > 0) return true;
  return false;
}

export function canModifyCf(
  cf: CfAclRow,
  auth: CfAuth,
  userPermTypes: PermissionType[],
  adminImplicitRefused = false
) {
  if (isAdminRole(auth.role)) {
    if (cf.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return userPermTypes.some((p) => p === 'modification' || p === 'suppression' || p === 'gestion');
    }
    return true;
  }
  if (cf.createdById === auth.userId) return true;
  if (isLegacyOpen(cf) && auth.role === 'contributeur') return true;
  return userPermTypes.some((p) => p === 'modification' || p === 'suppression' || p === 'gestion');
}

export function canDeleteCf(
  cf: CfAclRow,
  auth: CfAuth,
  userPermTypes: PermissionType[],
  adminImplicitRefused = false
) {
  if (isAdminRole(auth.role)) {
    if (cf.createdById === auth.userId) return true;
    if (adminImplicitRefused) {
      return userPermTypes.includes('suppression');
    }
    return true;
  }
  if (cf.createdById === auth.userId) return true;
  if (isLegacyOpen(cf) && auth.role === 'contributeur') return true;
  return userPermTypes.includes('suppression');
}

/**
 * Créateur ; fiche sans créateur : admin implicite (sauf exclusion) ou admin exclu avec « gestion » ;
 * sinon : admin implicite ne gère plus les accès (aligné contrat).
 */
export function canManageCfPermissions(
  cf: CfAclRow,
  auth: CfAuth,
  userPermTypes: PermissionType[] = [],
  adminImplicitRefused = false
) {
  if (cf.createdById && cf.createdById === auth.userId) return true;
  if (isLegacyOpen(cf) && isAdminRole(auth.role)) {
    if (adminImplicitRefused) return userPermTypes.includes('gestion');
    return true;
  }
  if (isAdminRole(auth.role)) {
    if (adminImplicitRefused) return userPermTypes.includes('gestion');
    return false;
  }
  return false;
}

export function capabilitiesFor(
  cf: CfAclRow,
  auth: CfAuth,
  userPermTypes: PermissionType[],
  adminImplicitRefused = false
) {
  return {
    canView: canViewCf(cf, auth, userPermTypes, adminImplicitRefused),
    canModify: canModifyCf(cf, auth, userPermTypes, adminImplicitRefused),
    canDelete: canDeleteCf(cf, auth, userPermTypes, adminImplicitRefused),
    canManagePermissions: canManageCfPermissions(cf, auth, userPermTypes, adminImplicitRefused),
  };
}
