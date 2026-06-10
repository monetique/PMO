import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NotificationSettingService } from '../services/notification-setting.service';

export const listNotificationSettings = async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await NotificationSettingService.listForAdmin();
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Erreur' });
  }
};

export const patchNotificationSetting = async (req: AuthRequest, res: Response) => {
  try {
    const emailEnabled = req.body?.emailEnabled;
    const appEnabled = req.body?.appEnabled;
    if (emailEnabled === undefined && appEnabled === undefined) {
      return res.status(400).json({ error: 'Fournir emailEnabled et/ou appEnabled' });
    }
    const row = await NotificationSettingService.upsert(req.params.key, {
      ...(emailEnabled !== undefined ? { emailEnabled: !!emailEnabled } : {}),
      ...(appEnabled !== undefined ? { appEnabled: !!appEnabled } : {}),
    });
    res.json(row);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur';
    if (msg.includes('inconnue')) return res.status(400).json({ error: msg });
    res.status(500).json({ error: msg });
  }
};
