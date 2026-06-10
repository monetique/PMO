import { prisma } from '../utils/prisma';

function toDayStart(value: string | Date): Date {
  const d = typeof value === 'string' ? new Date(value) : new Date(value);
  if (Number.isNaN(d.getTime())) throw new Error('Date invalide');
  d.setHours(0, 0, 0, 0);
  return d;
}

export class JourFerieService {
  static async list() {
    const rows = await (prisma as any).jourFerie.findMany({
      orderBy: { date: 'asc' },
    });
    return rows.map((r: any) => ({
      ...r,
      date: r.date.toISOString().slice(0, 10),
    }));
  }

  static async create(data: { date: string; libelle: string }) {
    const libelle = String(data.libelle || '').trim();
    if (!libelle) throw new Error('Le libellé est obligatoire');
    const date = toDayStart(data.date);
    const row = await (prisma as any).jourFerie.create({
      data: { date, libelle },
    });
    return {
      ...row,
      date: row.date.toISOString().slice(0, 10),
    };
  }

  static async delete(id: string) {
    await (prisma as any).jourFerie.delete({ where: { id } });
  }
}
