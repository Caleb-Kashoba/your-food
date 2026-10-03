import { describe, expect, it } from 'vitest';

import { parseAuthLink } from '@/features/auth/auth-link';
import {
  buildAccessLink,
  isCompleteAccessCode,
  normalizeAccessCode,
  parseAccessLink,
  setPendingAccess,
  takePendingAccess
} from '@/features/client-access/access-link';

describe('lien d’accès client', () => {
  it('place le code et le nom après le « # »', () => {
    const link = buildAccessLink('https://exemple.test/', 'abcd 2345', 'Mireille Kabongo');
    expect(link).toBe('https://exemple.test/bienvenue#acces=ABCD2345&nom=Mireille_Kabongo');
    expect(new URL(link).search).toBe('');
  });

  it('ne contient ni espace, ni « %20 », ni « + » : le nom entier reste dans le lien cliquable', () => {
    const link = buildAccessLink('https://x.test', 'ABCD2345', 'Alfredo Alfredo Isasole');
    expect(link).not.toMatch(/\s|%20|\+/);
    expect(parseAccessLink(link)).toEqual({ code: 'ABCD2345', name: 'Alfredo Alfredo Isasole' });
  });

  it('lit encore les anciens liens (« + », « %20 ») et ceux dont l’espace a été décodé', () => {
    for (const nom of ['Ephrem+Matuta', 'Ephrem%20Matuta', 'Ephrem Matuta', 'Ephrem_Matuta']) {
      expect(parseAccessLink(`https://x.test/bienvenue#acces=ABCD2345&nom=${nom}`)?.name).toBe('Ephrem Matuta');
    }
  });

  it('ne fusionne pas les « s » d’un nom', () => {
    expect(parseAccessLink(buildAccessLink('https://x.test', 'ABCD2345', 'Moïse Kassa'))?.name).toBe('Moïse Kassa');
  });

  it('relit le code et le nom, même avec des « + » ou des accents', () => {
    expect(parseAccessLink('https://x.test/bienvenue#acces=ABCD2345&nom=Mireille+Kabongo')).toEqual({ code: 'ABCD2345', name: 'Mireille Kabongo' });
    expect(parseAccessLink(buildAccessLink('https://x.test', 'ABCD2345', 'Éloïse N’Dour'))).toEqual({ code: 'ABCD2345', name: 'Éloïse N’Dour' });
  });

  it('refuse un lien sans code valable', () => {
    expect(parseAccessLink('https://x.test/bienvenue')).toBeNull();
    expect(parseAccessLink('https://x.test/bienvenue#nom=Marie')).toBeNull();
    expect(parseAccessLink('https://x.test/bienvenue#acces=court')).toBeNull();
    expect(parseAccessLink('https://x.test/bienvenue#acces=ABCD0123')).toBeNull(); // 0 et 1 n'existent pas dans l'alphabet
  });

  it('n’est jamais pris pour un code d’authentification Supabase', () => {
    expect(parseAuthLink(buildAccessLink('https://x.test', 'ABCD2345', 'Marie Kabongo'))).toEqual({ kind: 'none' });
  });

  it('normalise le code saisi (espaces, minuscules)', () => {
    expect(normalizeAccessCode(' vvcf fyqv ')).toBe('VVCFFYQV');
    expect(isCompleteAccessCode('vvcf fyqv')).toBe(true);
    expect(isCompleteAccessCode('VVCFFYQ')).toBe(false);
    expect(isCompleteAccessCode('VVCFFYQO')).toBe(false); // « O » absent de l'alphabet
  });

  it('garde le lien en mémoire une seule fois', () => {
    setPendingAccess({ code: 'ABCD2345', name: 'Marie' });
    expect(takePendingAccess()).toEqual({ code: 'ABCD2345', name: 'Marie' });
    expect(takePendingAccess()).toBeNull();
  });
});
