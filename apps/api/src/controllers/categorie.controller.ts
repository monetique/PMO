import { Request, Response } from 'express';
import { CategorieService } from '../services/categorie.service';
import { AuthRequest } from '../middleware/auth';
import { logAccess } from '../middleware/logger';

const categorieService = new CategorieService();

export const getAllCategories = async (req: AuthRequest, res: Response) => {
  try {
    const categories = await categorieService.findAll();
    res.json(categories);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const getCategorie = async (req: AuthRequest, res: Response) => {
  try {
    const categorie = await categorieService.findOne(req.params.id);
    if (!categorie) {
      return res.status(404).json({ error: 'Catégorie non trouvée' });
    }
    res.json(categorie);
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
};

export const createCategorie = async (req: AuthRequest, res: Response) => {
  try {
    const categorie = await categorieService.create(req.body);
    // Note: 'entite' est utilisé car il n'y a pas de ResourceType spécifique pour les catégories
    // et elles sont considérées comme des entités de configuration
    await logAccess(req, res, 'creation', 'entite', categorie.id, categorie.nom);
    res.status(201).json(categorie);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const updateCategorie = async (req: AuthRequest, res: Response) => {
  try {
    const categorie = await categorieService.update(req.params.id, req.body);
    await logAccess(req, res, 'modification', 'entite', categorie.id, categorie.nom);
    res.json(categorie);
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};

export const deleteCategorie = async (req: AuthRequest, res: Response) => {
  try {
    await categorieService.delete(req.params.id);
    await logAccess(req, res, 'suppression', 'entite', req.params.id);
    res.status(204).send();
  } catch (error: any) {
    res.status(400).json({ error: error.message });
  }
};
