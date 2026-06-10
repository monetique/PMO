import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { NotificationEmailFailureService } from '../services/notification-email-failure.service';

const service = new NotificationEmailFailureService();

export const listNotificationEmailFailures = async (req: AuthRequest, res: Response) => {
  try {
    const take = req.query.take ? parseInt(String(req.query.take), 10) : 200;
    const rows = await service.list(Number.isFinite(take) ? take : 200);
    res.json(rows);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur';
    res.status(500).json({ error: msg });
  }
};

export const deleteNotificationEmailFailure = async (req: AuthRequest, res: Response) => {
  try {
    await service.deleteById(req.params.id);
    res.status(204).send();
  } catch (e: unknown) {
    if ((e as { code?: string })?.code === 'P2025') {
      return res.status(404).json({ error: 'Entrée introuvable' });
    }
    const msg = e instanceof Error ? e.message : 'Erreur';
    res.status(500).json({ error: msg });
  }
};

export const resendNotificationEmailFailure = async (req: AuthRequest, res: Response) => {
  try {
    await service.resend(req.params.id);
    res.json({ ok: true, message: 'Email renvoyé avec succès.' });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur';
    if (msg === 'NOT_FOUND') return res.status(404).json({ error: 'Entrée introuvable' });
    res.status(400).json({ error: msg });
  }
};
