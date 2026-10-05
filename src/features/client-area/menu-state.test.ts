import { describe, expect, it } from 'vitest';

import type { TodayMenu } from '@/features/client-area/client.service';
import {
  deriveMenuState,
  formatCountdown,
  formatHour,
  isComplete,
  kinshasaClock,
  picksChanged,
  requiredCategories,
  secondsLeft,
  timeToSeconds
} from '@/features/client-area/menu-state';

function menu(overrides: Partial<TodayMenu> = {}): TodayMenu {
  return {
    date: '2026-10-06',
    menu_status: 'normal',
    subscription: { state: 'actif', plan_name: 'Formule 2' },
    meat_allowed_today: true,
    menu: {
      id: 'm1',
      deadline_time: '13:00:00',
      lock_time: '20:00',
      options: [
        { option_id: 'p1', item_id: 'i1', name: 'Pondu', category: 'plat' },
        { option_id: 'a1', item_id: 'i2', name: 'Fufu', category: 'accompagnement' },
        { option_id: 'v1', item_id: 'i3', name: 'Poulet', category: 'viande' }
      ]
    },
    order: null,
    review_due: null,
    server_now: '2026-10-06T09:00:00.000Z',
    device_offset_ms: 0,
    ...overrides
  };
}

const order = (overrides: Partial<NonNullable<TodayMenu['order']>> = {}): NonNullable<TodayMenu['order']> => ({
  id: 'o1',
  status: 'confirmed',
  is_default: false,
  plat_option_id: 'p1',
  accompagnement_option_id: 'a1',
  viande_option_id: 'v1',
  updated_at: '2026-10-06T08:00:00Z',
  ...overrides
});

describe('états du menu client', () => {
  it('normal, en retard et verrouillé', () => {
    expect(deriveMenuState(menu())).toBe('normal');
    expect(deriveMenuState(menu({ menu_status: 'en_retard' }))).toBe('en_retard');
    expect(deriveMenuState(menu({ menu_status: 'verrouille', order: order() }))).toBe('verrouille');
  });

  it('repas attribué par défaut après verrouillage', () => {
    expect(deriveMenuState(menu({ menu_status: 'verrouille', order: order({ is_default: true }) }))).toBe('defaut');
  });

  it('annulé, avec reprise possible avant 20h seulement', () => {
    const cancelled = order({ status: 'cancelled', plat_option_id: null, accompagnement_option_id: null, viande_option_id: null });
    expect(deriveMenuState(menu({ order: cancelled }))).toBe('annule');
    expect(deriveMenuState(menu({ order: cancelled }), true)).toBe('normal');
    expect(deriveMenuState(menu({ menu_status: 'verrouille', order: cancelled }), true)).toBe('annule');
  });

  it('l’abonnement prime sur le menu', () => {
    expect(deriveMenuState(menu({ subscription: { state: 'expire' } }))).toBe('expire');
    expect(deriveMenuState(menu({ subscription: { state: 'non_commence' } }))).toBe('non_commence');
    expect(deriveMenuState(menu({ subscription: { state: 'suspendu' } }))).toBe('inactif');
    expect(deriveMenuState(menu({ subscription: { state: 'bientot_expire' } }))).toBe('normal');
  });

  it('sans menu publié', () => {
    expect(deriveMenuState(menu({ menu_status: 'aucun_menu', menu: null }))).toBe('aucun_menu');
  });
});

describe('choix du client', () => {
  it('la viande dépend de la formule et du jour', () => {
    expect(requiredCategories(menu())).toEqual(['plat', 'accompagnement', 'viande']);
    expect(requiredCategories(menu({ meat_allowed_today: false }))).toEqual(['plat', 'accompagnement']);
  });

  it('la commande est complète quand toutes les catégories requises sont choisies', () => {
    expect(isComplete(menu(), { plat: 'p1', accompagnement: 'a1' })).toBe(false);
    expect(isComplete(menu(), { plat: 'p1', accompagnement: 'a1', viande: 'v1' })).toBe(true);
    expect(isComplete(menu({ meat_allowed_today: false }), { plat: 'p1', accompagnement: 'a1' })).toBe(true);
  });

  it('détecte une modification par rapport à la commande enregistrée', () => {
    const saved = menu({ order: order() });
    expect(picksChanged(saved, { plat: 'p1', accompagnement: 'a1', viande: 'v1' })).toBe(false);
    expect(picksChanged(saved, { plat: 'p1', accompagnement: 'a1', viande: 'v2' })).toBe(true);
  });
});

describe('compte à rebours', () => {
  it('lit l’heure de Kinshasa (UTC+1) à partir de l’heure du serveur', () => {
    expect(kinshasaClock(Date.parse('2026-10-06T09:00:00Z'))).toEqual({ date: '2026-10-06', seconds: 10 * 3600 });
    expect(kinshasaClock(Date.parse('2026-10-06T23:30:00Z')).date).toBe('2026-10-07');
  });

  it('compte vers l’heure limite, puis vers 20h00', () => {
    const now = Date.parse('2026-10-06T09:00:00Z'); // 10h00 à Kinshasa
    expect(secondsLeft(menu(), 'normal', now, 0)).toBe(3 * 3600);
    expect(secondsLeft(menu({ menu_status: 'en_retard' }), 'en_retard', now, 0)).toBe(10 * 3600);
  });

  it('corrige l’horloge de l’appareil avec l’heure du serveur', () => {
    const deviceNow = Date.parse('2026-10-06T08:00:00Z'); // téléphone en retard d'une heure
    expect(secondsLeft(menu(), 'normal', deviceNow, 3600_000)).toBe(3 * 3600);
  });

  it('ne compte pas pour un autre jour ni sous zéro', () => {
    expect(secondsLeft(menu({ date: '2026-10-05' }), 'normal', Date.parse('2026-10-06T09:00:00Z'), 0)).toBe(0);
    expect(secondsLeft(menu(), 'normal', Date.parse('2026-10-06T14:00:00Z'), 0)).toBe(0);
  });

  it('la veille : le compte à rebours court le jour de la commande, pas le jour du repas', () => {
    // Repas du mardi 6, commandé le lundi 5 jusqu'à 20h : à 09h00 il reste 4 h avant 13h00 et 11 h avant 20h
    const veille = menu({ date: '2026-10-06', menu: { ...menu().menu!, lock_date: '2026-10-05' } });
    const now = Date.parse('2026-10-05T08:00:00Z'); // 09h00 à Kinshasa
    expect(secondsLeft(veille, 'normal', now, 0)).toBe(4 * 3600);
    expect(secondsLeft({ ...veille, menu_status: 'en_retard' }, 'en_retard', now, 0)).toBe(11 * 3600);
    // le jour du repas lui-même, plus rien à compter
    expect(secondsLeft(veille, 'normal', Date.parse('2026-10-06T08:00:00Z'), 0)).toBe(0);
  });

  it('premier jour d’abonnement : pas de commande, repas attribué automatiquement', () => {
    expect(deriveMenuState(menu({ first_day_default: true }))).toBe('premier_jour');
    // après le verrouillage, le repas par défaut est affiché normalement
    expect(deriveMenuState(menu({ first_day_default: true, menu_status: 'verrouille', order: order({ is_default: true }) }))).toBe('defaut');
  });

  it('formate', () => {
    expect(formatCountdown(3 * 3600 + 5 * 60 + 9)).toBe('03:05:09');
    expect(formatHour('13:00:00')).toBe('13h00');
    expect(formatHour('09:05')).toBe('9h05');
    expect(timeToSeconds('20:00')).toBe(72000);
  });
});
