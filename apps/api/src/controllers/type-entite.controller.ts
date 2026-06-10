import { Request, Response } from 'express';
import { typeEntiteService } from '../services/type-entite.service';

export const getTypesEntite = async (req: Request, res: Response) => {
  try {
    const actifOnly = req.query.actif === 'true' || req.query.actif === '1';
    const list = actifOnly ? await typeEntiteService.findAllActifs() : await typeEntiteService.findAll();
    res.json(list);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
};

export const createTypeEntite = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const libelle = String(req.body?.libelle || '').trim();
    const ordre = req.body?.ordre != null && req.body?.ordre !== '' ? Number(req.body.ordre) : undefined;
    const actif = typeof req.body?.actif === 'boolean' ? req.body.actif : true;
    if (!code || !libelle) return res.status(400).json({ error: 'Code et libellé sont obligatoires' });
    const row = await typeEntiteService.create({ code, libelle, ordre, actif });
    res.status(201).json(row);
  } catch (e: any) {
    if (e.code === 'P2002') {
      return res.status(400).json({ error: 'Ce code de type existe déjà' });
    }
    res.status(400).json({ error: e.message || 'Erreur' });
  }
};

export const updateTypeEntite = async (req: Request, res: Response) => {
  try {
    const code = String(req.body?.code || '').trim();
    const libelle = String(req.body?.libelle || '').trim();
    const ordre = req.body?.ordre != null && req.body?.ordre !== '' ? Number(req.body.ordre) : undefined;
    const actif = typeof req.body?.actif === 'boolean' ? req.body.actif : undefined;
    if (!code || !libelle) return res.status(400).json({ error: 'Code et libellé sont obligatoires' });
    const row = await typeEntiteService.update(req.params.id, { code, libelle, ordre, actif });
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

export const deleteTypeEntite = async (req: Request, res: Response) => {
  try {
    await typeEntiteService.delete(req.params.id);
    res.json({ success: true });
  } catch (e: any) {
    if (e.code === 'P2025') {
      return res.status(404).json({ error: 'Type introuvable' });
    }
    res.status(400).json({ error: e.message || 'Erreur' });
  }
};
