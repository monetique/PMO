import { prisma } from '../utils/prisma';

function normCode(code: string) {
  return code.trim().toUpperCase();
}

export const deviseService = {
  async findAll() {
    return prisma.devise.findMany({ orderBy: { code: 'asc' } });
  },
  async create(data: { code: string; libelle?: string | null }) {
    return prisma.devise.create({
      data: {
        code: normCode(data.code),
        libelle: data.libelle?.trim() || null,
      },
    });
  },
  async update(id: string, data: { code: string; libelle?: string | null }) {
    return prisma.devise.update({
      where: { id },
      data: {
        code: normCode(data.code),
        libelle: data.libelle?.trim() || null,
      },
    });
  },
  async delete(id: string) {
    return prisma.devise.delete({ where: { id } });
  },
};
