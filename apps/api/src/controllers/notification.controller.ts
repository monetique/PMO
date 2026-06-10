import { Response } from 'express';
import { NotificationService } from '../services/notification.service';
import { AuthRequest } from '../middleware/auth';

const notificationService = new NotificationService();

export const getNotifications = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const notifications = await notificationService.getNotifications(req.user.userId);
    res.json(notifications);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const countNonLues = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const count = await notificationService.countNonLues(req.user.userId);
    res.json({ count });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const marquerLue = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await notificationService.marquerLue(req.params.id, req.user.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const marquerToutesLues = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    await notificationService.marquerToutesLues(req.user.userId);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
