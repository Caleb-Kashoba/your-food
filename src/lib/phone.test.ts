import { describe, expect, it } from 'vitest';

import { normalizePhone } from '@/lib/phone';

describe('normalizePhone', () => {
  it.each(['0812345678', '243812345678', '+243812345678'])(
    'normalizes %s to the same Congolese E.164 number',
    (value) => expect(normalizePhone(value)).toBe('+243812345678')
  );
});
