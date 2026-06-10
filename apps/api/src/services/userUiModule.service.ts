import { prisma } from '../utils/prisma';
import { Role, UiModule, UiModuleLevel } from '../generated/prisma/enums';

const ADMIN_ONLY_MODULES: UiModule[] = [
  UiModule.users,
  UiModule.journal,
  UiModule.configuration,
  UiModule.corbeille,
];

export const UI_MODULE_LABELS: Record<UiModule, string> = {
  [UiModule.dashboard]: 'Dashboard',
  [UiModule.processus]: 'Processus',
  [UiModule.projets]: 'Projets',
  [UiModule.taches]: 'Epics / Tâches',
  [UiModule.clients_fournisseurs]: 'Clients / Fournisseurs',
  [UiModule.contrats]: 'Contrats',
  [UiModule.ocr]: 'OCR',
  [UiModule.licences]: 'Licences',
  [UiModule.entites]: 'Entités',
  [UiModule.documents]: 'Documents',
  [UiModule.pv_reunion]: 'PV de réunion',
  [UiModule.users]: 'Utilisateurs',
  [UiModule.journal]: 'Journal',
  [UiModule.configuration]: 'Configuration',
  [UiModule.corbeille]: 'Corbeille',
};

export function defaultUiModuleLevel(role: string, module: UiModule): UiModuleLevel {
  if (role === Role.admin) return UiModuleLevel.modification;
  if (role === Role.contributeur) {
    return ADMIN_ONLY_MODULES.includes(module) ? UiModuleLevel.none : UiModuleLevel.modification;
  }
  if (role === Role.lecteur) {
    return ADMIN_ONLY_MODULES.includes(module) ? UiModuleLevel.none : UiModuleLevel.lecture;
  }
  return UiModuleLevel.none;
}

export async function getEffectiveUiModules(
  userId: string,
  role: string
): Promise<Record<string, UiModuleLevel>> {
  const overrides = await prisma.userUiModuleAccess.findMany({ where: { userId } });
  const out: Record<string, UiModuleLevel> = {};
  for (const m of Object.values(UiModule)) {
    const o = overrides.find((x) => x.module === m);
    out[m] = o ? o.level : defaultUiModuleLevel(role, m);
  }
  return out;
}

export async function setUserUiModuleOverride(
  userId: string,
  module: UiModule,
  level: UiModuleLevel | null
): Promise<void> {
  if (level === null) {
    await prisma.userUiModuleAccess.deleteMany({ where: { userId, module } });
    return;
  }
  await prisma.userUiModuleAccess.upsert({
    where: { userId_module: { userId, module } },
    create: { userId, module, level },
    update: { level },
  });
}
