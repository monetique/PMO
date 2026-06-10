import { prisma } from '../utils/prisma';

/** Clés gérées (alignées sur Configuration → Notifications). */
export const NOTIFICATION_SETTING_KEYS = [
  'mention',
  'mention_pv',
  'mention_document',
  'mention_licence',
  'mention_processus',
  'mention_projet',
  'mention_contrat',
  'assignation',
  'assignation_projet',
  'statut',
  'retard',
  'nouvelle_tache',
  'commentaire',
  'commentaire_epic',
  'commentaire_user_story',
  'document',
  'commentaire_pv',
  'assignation_action_pv',
  'licence_alerte',
] as const;

export type NotificationSettingKey = (typeof NOTIFICATION_SETTING_KEYS)[number];

const CACHE_TTL_MS = 5000;
let cache: { expires: number; map: Map<string, { emailEnabled: boolean; appEnabled: boolean }> } | null = null;

function invalidateCache() {
  cache = null;
}

/** Clé de paramétrage pour les contrôles email (agrège certains kinds techniques). */
export function resolveEmailSettingKey(kind: string): string {
  if (kind === 'nouvelle_tache_projet') return 'nouvelle_tache';
  if (kind === 'commentaire_pv_assigne') return 'commentaire_pv';
  return kind;
}

export class NotificationSettingService {
  private static async loadMap(): Promise<Map<string, { emailEnabled: boolean; appEnabled: boolean }>> {
    const now = Date.now();
    if (cache && cache.expires > now) return cache.map;
    const rows = await prisma.notificationSetting.findMany();
    const m = new Map<string, { emailEnabled: boolean; appEnabled: boolean }>();
    for (const r of rows) {
      m.set(r.key, { emailEnabled: r.emailEnabled, appEnabled: r.appEnabled });
    }
    cache = { expires: now + CACHE_TTL_MS, map: m };
    return m;
  }

  static async isEmailEnabled(settingKey: string): Promise<boolean> {
    const key = resolveEmailSettingKey(settingKey);
    if (!NOTIFICATION_SETTING_KEYS.includes(key as NotificationSettingKey)) return true;
    const m = await this.loadMap();
    const v = m.get(key);
    if (!v) return true;
    return v.emailEnabled;
  }

  static async isAppEnabled(settingKey: string): Promise<boolean> {
    const key =
      settingKey === 'commentaire_pv_assigne'
        ? 'commentaire_pv'
        : settingKey;
    if (!NOTIFICATION_SETTING_KEYS.includes(key as NotificationSettingKey)) return true;
    const m = await this.loadMap();
    const v = m.get(key);
    if (!v) return true;
    return v.appEnabled;
  }

  static async listForAdmin(): Promise<Array<{ key: string; emailEnabled: boolean; appEnabled: boolean }>> {
    const m = await this.loadMap();
    return NOTIFICATION_SETTING_KEYS.map((key) => ({
      key,
      emailEnabled: m.get(key)?.emailEnabled ?? true,
      appEnabled: m.get(key)?.appEnabled ?? true,
    }));
  }

  static async upsert(
    key: string,
    data: { emailEnabled?: boolean; appEnabled?: boolean }
  ): Promise<{ key: string; emailEnabled: boolean; appEnabled: boolean }> {
    if (!NOTIFICATION_SETTING_KEYS.includes(key as NotificationSettingKey)) {
      throw new Error('Clé de notification inconnue');
    }
    const existing = await prisma.notificationSetting.findUnique({ where: { key } });
    const emailEnabled = data.emailEnabled !== undefined ? data.emailEnabled : (existing?.emailEnabled ?? true);
    const appEnabled = data.appEnabled !== undefined ? data.appEnabled : (existing?.appEnabled ?? true);
    const row = await prisma.notificationSetting.upsert({
      where: { key },
      create: { key, emailEnabled, appEnabled },
      update: { emailEnabled, appEnabled },
    });
    invalidateCache();
    return row;
  }
}
