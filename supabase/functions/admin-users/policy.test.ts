import { describe, expect, it } from 'vitest';

import {
  MOBILE_INVITATION_REDIRECT_URL,
  canInviteRole,
  getInvitationRedirect,
  normalizeCongolesePhone
} from './policy';

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

  it('uses the production Web activation route for email invitations', () => {
    expect(
      getInvitationRedirect('email', 'https://your-food-gilt.vercel.app/auth/activate')
    ).toBe('https://your-food-gilt.vercel.app/auth/activate');
  });

  it('keeps the application deep link for WhatsApp invitations', () => {
    expect(getInvitationRedirect('whatsapp', undefined)).toBe(MOBILE_INVITATION_REDIRECT_URL);
  });

  it.each([
    undefined,
    'http://your-food-gilt.vercel.app/auth/activate',
    'https://localhost/auth/activate',
    'https://your-food-gilt.vercel.app/another-route'
  ])('rejects an unsafe or incorrect Web invitation redirect: %s', (redirectUrl) => {
    expect(() => getInvitationRedirect('email', redirectUrl)).toThrow();
  });
});
