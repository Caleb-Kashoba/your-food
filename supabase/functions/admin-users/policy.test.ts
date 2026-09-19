import { describe, expect, it } from 'vitest';

import { canInviteRole, normalizeCongolesePhone } from './policy';

describe('admin-users invitation policy', () => {
  it('allows a root to invite an admin through the secured backend', () => {
    expect(canInviteRole('root', 'admin', true)).toBe(true);
  });

  it('allows an admin to invite staff', () => {
    expect(canInviteRole('admin', 'staff', true)).toBe(true);
  });

  it('prevents an admin from inviting a root', () => {
    expect(canInviteRole('admin', 'root', true)).toBe(false);
  });

  it('requires users.create outside the root role', () => {
    expect(canInviteRole('admin', 'staff', false)).toBe(false);
  });

  it.each(['0812345678', '243812345678', '+243812345678'])(
    'normalizes %s for WhatsApp',
    (value) => expect(normalizeCongolesePhone(value)).toBe('+243812345678')
  );
});
