import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { prisma } from '../utils/prisma';

export const getFavoris = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const [processus, documents] = await Promise.all([
      prisma.favorisProcessus.findMany({
        where: { userId },
        include: {
          processus: {
            select: {
              id: true,
              nom: true,
              codeProcessus: true,
              statut: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
      prisma.favorisDocument.findMany({
        where: { userId },
        include: {
          document: {
            select: {
              id: true,
              nom: true,
              typeDocument: true,
              statut: true,
              updatedAt: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    res.json({
      processus: processus.map((f) => f.processus),
      documents: documents.map((f) => f.document),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const ajouterProcessusFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const favori = await prisma.favorisProcessus.upsert({
      where: {
        userId_processusId: {
          userId,
          processusId: req.params.id,
        },
      },
      update: {},
      create: {
        userId,
        processusId: req.params.id,
      },
    });

    res.status(201).json(favori);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const retirerProcessusFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    await prisma.favorisProcessus.deleteMany({
      where: {
        userId,
        processusId: req.params.id,
      },
    });

    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const ajouterDocumentFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const favori = await prisma.favorisDocument.upsert({
      where: {
        userId_documentId: {
          userId,
          documentId: req.params.id,
        },
      },
      update: {},
      create: {
        userId,
        documentId: req.params.id,
      },
    });

    res.status(201).json(favori);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const retirerDocumentFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    await prisma.favorisDocument.deleteMany({
      where: {
        userId,
        documentId: req.params.id,
      },
    });

    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const estProcessusFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const favori = await prisma.favorisProcessus.findUnique({
      where: {
        userId_processusId: {
          userId,
          processusId: req.params.id,
        },
      },
    });

    res.json({ estFavori: !!favori });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const estDocumentFavori = async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user?.userId;
    if (!userId) return res.status(401).json({ error: 'Non authentifié' });

    const favori = await prisma.favorisDocument.findUnique({
      where: {
        userId_documentId: {
          userId,
          documentId: req.params.id,
        },
      },
    });

    res.json({ estFavori: !!favori });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};
