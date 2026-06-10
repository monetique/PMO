const PREFIXES: [string, string][] = [
  ['/dashboard', 'dashboard'],
  ['/processus', 'processus'],
  ['/projets', 'projets'],
  ['/taches', 'taches'],
  ['/calendrier', 'calendrier'],
  ['/clients-fournisseurs', 'clients_fournisseurs'],
  ['/contrats', 'contrats'],
  ['/pv-reunion', 'pv_reunion'],
  ['/ocr', 'ocr'],
  ['/licences', 'licences'],
  ['/entites', 'entites'],
  ['/documents', 'documents'],
  ['/users', 'users'],
  ['/journal', 'journal'],
  ['/configuration', 'configuration'],
  ['/corbeille', 'corbeille'],
];

/** Retourne la clé de module UI pour un chemin, ou undefined (ex. /profile). */
export function pathnameToUiModule(pathname: string): string | undefined {
  if (pathname.startsWith('/profile')) return undefined;
  for (const [prefix, mod] of PREFIXES) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return mod;
  }
  return undefined;
}

/** Lien menu principal → clé module (chemins exacts). */
const NAV_PATH_TO_MODULE: Record<string, string> = {
  '/dashboard': 'dashboard',
  '/processus': 'processus',
  '/projets': 'projets',
  '/taches': 'taches',
  '/calendrier': 'calendrier',
  '/clients-fournisseurs': 'clients_fournisseurs',
  '/contrats': 'contrats',
  '/pv-reunion': 'pv_reunion',
  '/ocr': 'ocr',
  '/licences': 'licences',
  '/entites': 'entites',
  '/documents': 'documents',
  '/users': 'users',
  '/journal': 'journal',
  '/configuration': 'configuration',
  '/corbeille': 'corbeille',
};

export function navPathToUiModule(navPath: string): string | undefined {
  return NAV_PATH_TO_MODULE[navPath];
}

export function isUiModuleAllowed(
  uiModules: Record<string, string> | undefined,
  module: string | undefined
): boolean {
  if (!module) return true;
  if (!uiModules || Object.keys(uiModules).length === 0) return true;
  const level = uiModules[module];
  // Clé absente (profil / JWT chargé avant ajout du module) : afficher l’entrée de menu
  if (level === undefined) return true;
  return level !== 'none';
}

export function canModifyModule(
  uiModules: Record<string, string> | undefined,
  module: string | undefined
): boolean {
  if (!module) return true;
  if (!uiModules || Object.keys(uiModules).length === 0) return true;
  const level = uiModules[module];
  if (level === undefined) return true;
  return level === 'modification';
}
