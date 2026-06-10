import { Request, Response } from 'express';
import { typeContratService } from '../services/type-contrat.service';

export const getTypesContrat = async (_req: Request, res: Response) => {
  try {
    const list = await typeContratService.findAll();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const createTypeContrat = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const libelle = String(req.body?.libelle || '').trim();
    if (!code || !libelle) return res.status(400).json({ error: 'Code et libellé sont obligatoires' });
    const row = await typeContratService.create({ code, libelle });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce code de type existe déjà' });
    }
    res.status(400).json({ error: e.message || 'Erreur' });
  }
};

export const updateTypeContrat = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const libelle = String(req.body?.libelle || '').trim();
    if (!code || !libelle) return res.status(400).json({ error: 'Code et libellé sont obligatoires' });
    const row = await typeContratService.update(req.params.id, { code, libelle });
    res.json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce code de type existe déjà' });
    }
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Type introuvable' });
    }
    res.status(400).json({ error: e.message || 'Erreur' });
  }
};

export const deleteTypeContrat = async (req: Request, res: Response) => {
  try {
    await typeContratService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Type introuvable' });
    }
    res.status(400).json({ error: e.message || 'Erreur' });
  }
};
