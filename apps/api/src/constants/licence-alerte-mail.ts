/** Sujet et corps par défaut (variables […] remplacées à l’envoi). */
export const LICENCE_ALERTE_SUJET_DEFAUT = 'Alerte licence : [Nom licence]';

export const LICENCE_ALERTE_CORPS_DEFAUT = `Bonjour [Prenom Nom],

Ceci est une alerte concernant la licence suivante :
• Nom : [Nom licence]
• Référence : [Reference]
• Type : [Type licence]
• Date de début : [Date debut]
• Date de fin : [Date fin]
• Contexte : [Contexte alerte]

Consultez l’application pour plus de détails : [Lien application]

— PMO Hub`;

export type LicenceAlerteVariables = {
  prenomNom: string;
  nomLicence: string;
  reference: string;
  typeLicence: string;
  dateDebut: string;
  dateFin: string;
  contexteAlerte: string;
  lienApplication: string;
};

export function applyLicenceAlerteTemplate(template: string, v: LicenceAlerteVariables): string {
  return template
    .replace(/\[Prenom Nom\]/g, v.prenomNom)
    .replace(/\[Nom licence\]/g, v.nomLicence)
    .replace(/\[Reference\]/g, v.reference)
    .replace(/\[Type licence\]/g, v.typeLicence)
    .replace(/\[Date debut\]/g, v.dateDebut)
    .replace(/\[Date fin\]/g, v.dateFin)
    .replace(/\[Contexte alerte\]/g, v.contexteAlerte)
    .replace(/\[Lien application\]/g, v.lienApplication);
}
