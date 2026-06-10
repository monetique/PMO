import { Request, Response } from 'express';
import { typeLicenceService } from '../services/type-licence.service';

export const getTypesLicence = async (_req: Request, res: Response) => {
  try {
    const list = await typeLicenceService.findAll();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const createTypeLicence = async (req: Request, res: Response) => {
  try {
    const nom = String(req.body?.nom || '').trim();
    if (!nom) return res.status(400).json({ error: 'Le nom est obligatoire' });
    const row = await typeLicenceService.create({ nom });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce nom de type existe déjà' });
    }
    res.status(500).json({ error: e.message });
  }
};

export const updateTypeLicence = async (req: Request, res: Response) => {
  try {
    const nom = String(req.body?.nom || '').trim();
    if (!nom) return res.status(400).json({ error: 'Le nom est obligatoire' });
    const row = await typeLicenceService.update(req.params.id, { nom });
    res.json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce nom de type existe déjà' });
    }
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Type introuvable' });
    }
    res.status(500).json({ error: e.message });
  }
};

export const deleteTypeLicence = async (req: Request, res: Response) => {
  try {
    await typeLicenceService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Type introuvable' });
    }
    res.status(500).json({ error: e.message });
  }
};
