/** Texte sans accents, en minuscules (recherche) */
export const fold = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
