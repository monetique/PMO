import * as fs from 'fs/promises';
import * as path from 'path';
import { prisma } from '../utils/prisma';

const DATA_DIR = path.join(process.cwd(), 'data');
const UPLOAD_DIR = path.join(process.cwd(), 'uploads');
const STORE_FILE = path.join(UPLOAD_DIR, 'company-info', 'company-info.json');
const LEGACY_STORE_FILE = path.join(DATA_DIR, 'company-info.json');

export type CompanyInfo = {
  nomEntreprise: string;
  formatEntreprise: string;
  tailleEntreprise: string;
  adresseEntreprise: string;
  logoFilename: string | null;
  updatedAt: string | null;
  updatedById: string | null;
  updatedBy?: { id: string; nom: string; prenom: string; email: string } | null;
};

type CompanyInfoStored = Omit<CompanyInfo, 'updatedBy'>;

const DEFAULT_INFO: CompanyInfoStored = {
  nomEntreprise: '',
  formatEntreprise: '',
  tailleEntreprise: '',
  adresseEntreprise: '',
  logoFilename: null,
  updatedAt: null,
  updatedById: null,
};

async function ensureStoreDir(): Promise<void> {
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
}

async function readStoredInfo(): Promise<CompanyInfoStored> {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_INFO, ...(parsed || {}) };
  } catch {
    // fallback legacy
  }
  try {
    const raw = await fs.readFile(LEGACY_STORE_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_INFO, ...(parsed || {}) };
  } catch {
    return DEFAULT_INFO;
  }
}

export class CompanyInfoService {
  async get(): Promise<CompanyInfo> {
    await ensureStoreDir();
    const stored = await readStoredInfo();
    let updatedBy: CompanyInfo['updatedBy'] = null;
    if (stored.updatedById) {
      updatedBy = await prisma.user.findUnique({
        where: { id: stored.updatedById },
        select: { id: true, nom: true, prenom: true, email: true },
      });
    }
    return { ...stored, updatedBy };
  }

  async save(input: {
    nomEntreprise?: string;
    formatEntreprise?: string;
    tailleEntreprise?: string;
    adresseEntreprise?: string;
    removeLogo?: boolean;
    logoFile?: Express.Multer.File;
    updatedById: string;
  }): Promise<CompanyInfo> {
    const current = await this.get();
    let logoFilename = current.logoFilename;

    if (input.removeLogo && logoFilename) {
      try {
        await fs.unlink(path.join(UPLOAD_DIR, logoFilename));
      } catch {
        // Fichier déjà supprimé.
      }
      logoFilename = null;
    }

    if (input.logoFile) {
      if (logoFilename && logoFilename !== input.logoFile.filename) {
        try {
          await fs.unlink(path.join(UPLOAD_DIR, logoFilename));
        } catch {
          // Fichier déjà supprimé.
        }
      }
      logoFilename = input.logoFile.filename;
    }

    const next: CompanyInfoStored = {
      nomEntreprise: (input.nomEntreprise ?? current.nomEntreprise ?? '').trim(),
      formatEntreprise: (input.formatEntreprise ?? current.formatEntreprise ?? '').trim(),
      tailleEntreprise: (input.tailleEntreprise ?? current.tailleEntreprise ?? '').trim(),
      adresseEntreprise: (input.adresseEntreprise ?? current.adresseEntreprise ?? '').trim(),
      logoFilename,
      updatedAt: new Date().toISOString(),
      updatedById: input.updatedById,
    };

    await ensureStoreDir();
    await fs.writeFile(STORE_FILE, JSON.stringify(next, null, 2), 'utf8');
    return this.get();
  }

  async readLogoBuffer(filename: string): Promise<Buffer> {
    return fs.readFile(path.join(UPLOAD_DIR, filename));
  }
}

