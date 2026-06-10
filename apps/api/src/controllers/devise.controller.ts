import { Request, Response } from 'express';
import { deviseService } from '../services/devise.service';

export const getDevises = async (_req: Request, res: Response) => {
  try {
    const list = await deviseService.findAll();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const createDevise = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Le code est obligatoire' });
    const libelle =
      req.body?.libelle != null && String(req.body.libelle).trim() !== ''
        ? String(req.body.libelle).trim()
        : null;
    const row = await deviseService.create({ code, libelle });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce code devise existe déjà' });
    }
    res.status(500).json({ error: e.message });
  }
};

export const updateDevise = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    if (!code) return res.status(400).json({ error: 'Le code est obligatoire' });
    const libelle =
      req.body?.libelle != null && String(req.body.libelle).trim() !== ''
        ? String(req.body.libelle).trim()
        : null;
    const row = await deviseService.update(req.params.id, { code, libelle });
    res.json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce code devise existe déjà' });
    }
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Devise introuvable' });
    }
    res.status(500).json({ error: e.message });
  }
};

export const deleteDevise = async (req: Request, res: Response) => {
  try {
    await deviseService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Devise introuvable' });
    }
    res.status(500).json({ error: e.message });
  }
};
