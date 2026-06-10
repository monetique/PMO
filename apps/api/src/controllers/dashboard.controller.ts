import { Request, Response } from 'express';
import { DashboardService } from '../services/dashboard.service';
import { AuthRequest } from '../middleware/auth';

const dashboardService = new DashboardService();

export const getKPIs = async (req: AuthRequest, res: Response) => {
  try {
    const kpis = await dashboardService.getKPIs(req.user?.userId, req.user?.role);
    res.json(kpis);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getTachesEnRetard = async (req: AuthRequest, res: Response) => {
  try {
    const list = await dashboardService.getTachesEnRetard(req.user?.userId, req.user?.role);
    res.json(list);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
