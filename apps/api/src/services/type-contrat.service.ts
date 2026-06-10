import { prisma } from '../utils/prisma';

export const typeContratService = {
  async findAll() {
    return prisma.typeContrat.findMany({ orderBy: [{ libelle: 'asc' }] });
  },
  async create(data: { code: string; libelle: string }) {
    const code = data.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) throw new Error('Le code est obligatoire (lettres et chiffres)');
    const libelle = data.libelle.trim();
    if (!libelle) throw new Error('Le libellé est obligatoire');
    return prisma.typeContrat.create({
      data: { code, libelle },
    });
  },
  async update(id: string, data: { code: string; libelle: string }) {
    const code = data.code.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
    if (!code) throw new Error('Le code est obligatoire (lettres et chiffres)');
    const libelle = data.libelle.trim();
    if (!libelle) throw new Error('Le libellé est obligatoire');
    return prisma.typeContrat.update({
      where: { id },
      data: { code, libelle },
    });
  },
  async delete(id: string) {
    const n = await prisma.contrat.count({ where: { typeContratId: id } });
    if (n > 0) {
      throw new Error('Impossible de supprimer : un ou plusieurs contrats utilisent encore ce type');
    }
    return prisma.typeContrat.delete({ where: { id } });
  },
};
