import { Response } from 'express';
import multer from 'multer';
import * as path from 'path';
import * as fs from 'fs';
import { AuthRequest } from '../middleware/auth';
import { CompanyInfoService } from '../services/company-info.service';

const uploadDir = path.join(process.cwd(), 'uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname || '').toLowerCase();
    const safeExt = ['.png', '.jpg', '.jpeg', '.webp', '.svg'].includes(ext) ? ext : '.png';
    const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}`;
    cb(null, `company-logo-${unique}${safeExt}`);
  },
});

export const uploadCompanyLogo = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Le logo doit être une image.'));
    cb(null, true);
  },
}).single('logo');

const service = new CompanyInfoService();

export const getCompanyInfo = async (_req: AuthRequest, res: Response) => {
  try {
    const info = await service.get();
    res.json(info);
  } catch (e: any) {
    res.status(500).json({ error: e?.message || 'Erreur serveur' });
  }
};

export const saveCompanyInfo = async (req: AuthRequest, res: Response) => {
  try {
    if (!req.user?.userId) return res.status(401).json({ error: 'Non authentifié' });
    const logoFile = req.file as Express.Multer.File | undefined;
    const removeLogo =
      String(req.body.removeLogo || '')
        .trim()
        .toLowerCase() === 'true';
    const info = await service.save({
      nomEntreprise: String(req.body.nomEntreprise ?? ''),
      formatEntreprise: String(req.body.formatEntreprise ?? ''),
      tailleEntreprise: String(req.body.tailleEntreprise ?? ''),
      adresseEntreprise: String(req.body.adresseEntreprise ?? ''),
      removeLogo,
      logoFile,
      updatedById: req.user.userId,
    });
    res.json(info);
  } catch (e: any) {
    res.status(400).json({ error: e?.message || 'Erreur de validation' });
  }
};

export const getCompanyLogo = async (_req: AuthRequest, res: Response) => {
  try {
    const info = await service.get();
    if (!info.logoFilename) return res.status(404).json({ error: 'Logo introuvable' });
    const buf = await service.readLogoBuffer(info.logoFilename);
    const ext = path.extname(info.logoFilename).toLowerCase();
    const contentType =
      ext === '.svg'
        ? 'image/svg+xml'
        : ext === '.jpg' || ext === '.jpeg'
          ? 'image/jpeg'
          : ext === '.webp'
            ? 'image/webp'
            : 'image/png';
    res.setHeader('Content-Type', contentType);
    res.setHeader('Cache-Control', 'private, max-age=300');
    res.send(buf);
  } catch (e: any) {
    res.status(404).json({ error: e?.message || 'Logo introuvable' });
  }
};

