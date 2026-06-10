import { Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { JourFerieService } from '../services/jour-ferie.service';

export const listJoursFeries = async (_req: AuthRequest, res: Response) => {
  try {
    const rows = await JourFerieService.list();
    res.json(rows);
  } catch (e: unknown) {
    res.status(500).json({ error: e instanceof Error ? e.message : 'Erreur' });
  }
};

export const createJourFerie = async (req: AuthRequest, res: Response) => {
  try {
    const date = String(req.body?.date || '');
    const libelle = String(req.body?.libelle || '');
    if (!date) return res.status(400).json({ error: 'La date est obligatoire' });
    const row = await JourFerieService.create({ date, libelle });
    res.status(201).json(row);
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur';
    if (msg.includes('Unique constraint') || msg.includes('unique')) {
      return res.status(409).json({ error: 'Un jour férié existe déjà pour cette date' });
    }
    if (msg.includes('obligatoire') || msg.includes('invalide')) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
};

export const deleteJourFerie = async (req: AuthRequest, res: Response) => {
  try {
    await JourFerieService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : 'Erreur';
    if (msg.includes('Record to delete does not exist')) {
      return res.status(404).json({ error: 'Jour férié introuvable' });
    }
    res.status(500).json({ error: msg });
  }
};
