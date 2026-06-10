import { Request, Response } from 'express';
import { prisma } from '../utils/prisma';
import { AuthRequest } from '../middleware/auth';

export const getJournal = async (req: AuthRequest, res: Response) => {
  try {
    const { userId, action, ressourceType, ressourceId, startDate, endDate, limit = 100 } = req.query;
    
    const where: any = {};
    
    // Si non-admin, limiter à ses propres actions
    if (req.user?.role !== 'admin') {
      where.userId = req.user?.userId;
    } else if (userId) {
      where.userId = userId as string;
    }
    
    if (action) where.action = action;
    if (ressourceType) where.ressourceType = ressourceType;
    if (ressourceId) where.ressourceId = ressourceId;
    
    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate as string);
      if (endDate) where.timestamp.lte = new Date(endDate as string);
    }

    const logs = await prisma.journalAcces.findMany({
      where,
      include: {
        user: {
          select: { id: true, email: true, nom: true, prenom: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: parseInt(limit as string),
    });

    res.json(logs);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
