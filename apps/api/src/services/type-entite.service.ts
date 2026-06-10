import { prisma } from '../utils/prisma';

function normalizeCode(raw: string): string {
  return String(raw || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

export const typeEntiteService = {
  async findAll() {
    return prisma.typeEntite.findMany({ orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }] });
  },

  async findAllActifs() {
    return prisma.typeEntite.findMany({
      where: { actif: true },
      orderBy: [{ ordre: 'asc' }, { libelle: 'asc' }],
      select: { id: true, code: true, libelle: true, ordre: true },
    });
  },

  async create(data: { code: string; libelle: string; ordre?: number; actif?: boolean }) {
    const code = normalizeCode(data.code);
    if (!code) throw new Error('Code invalide');
    const libelle = String(data.libelle || '').trim();
    if (!libelle) throw new Error('Libellé requis');
    return prisma.typeEntite.create({
      data: {
        code,
        libelle,
        ordre: data.ordre ?? 0,
        actif: data.actif ?? true,
      },
    });
  },

  async update(
    id: string,
    data: { code: string; libelle: string; ordre?: number; actif?: boolean }
  ) {
    const code = normalizeCode(data.code);
    if (!code) throw new Error('Code invalide');
    const libelle = String(data.libelle || '').trim();
    if (!libelle) throw new Error('Libellé requis');
    const patch: { code: string; libelle: string; ordre?: number; actif?: boolean } = { code, libelle };
    if (data.ordre !== undefined) patch.ordre = data.ordre;
    if (data.actif !== undefined) patch.actif = data.actif;
    return prisma.typeEntite.update({
      where: { id },
      data: patch,
    });
  },

  async delete(id: string) {
    const n = await prisma.entite.count({ where: { typeEntiteId: id, deletedAt: null } });
    if (n > 0) {
      throw new Error(`Impossible de supprimer : ${n} entité(s) utilisent encore ce type`);
    }
    return prisma.typeEntite.delete({ where: { id } });
  },
};
