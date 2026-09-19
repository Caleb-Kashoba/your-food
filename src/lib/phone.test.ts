import { describe, expect, it } from 'vitest';

import { buildWhatsAppAppUrl, normalizePhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it.each(['0812345678', '243812345678', '+243812345678'])(
    'normalizes %s to the same Congolese E.164 number',
    (value) => expect(normalizePhone(value)).toBe('+243812345678')
  );
});

describe('buildWhatsAppAppUrl', () => {
  it('uses the WhatsApp application scheme and an international phone number', () => {
    expect(buildWhatsAppAppUrl('0812345678', 'Bonjour & bienvenue')).toBe(
      'whatsapp://send?phone=243812345678&text=Bonjour%20%26%20bienvenue'
    );
  });
});
