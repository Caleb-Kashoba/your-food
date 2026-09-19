import { describe, expect, it } from 'vitest';

import { parseAuthLink } from '@/features/auth/auth-link';

describe('parseAuthLink', () => {
  it('extracts an implicit Supabase session from a mobile deep link', () => {
    expect(parseAuthLink('yourfoodadmin://auth/activate#access_token=access&refresh_token=refresh&type=invite')).toEqual({
      kind: 'session',
      accessToken: 'access',
      refreshToken: 'refresh'
    });
  });

  it('supports a PKCE authorization code', () => {
    expect(parseAuthLink('yourfoodadmin://auth/activate?code=authorization-code')).toEqual({
      kind: 'code',
      code: 'authorization-code'
    });
  });

  it('returns an actionable result for an expired invite', () => {
    expect(
      parseAuthLink(
        'yourfoodadmin://auth/activate?error=access_denied&error_code=otp_expired&error_description=Email%20link%20is%20invalid%20or%20has%20expired'
      )
    ).toEqual({
      kind: 'error',
      code: 'otp_expired',
      message: 'Email link is invalid or has expired'
    });
  });

  it('does not treat a regular app link as an Auth callback', () => {
    expect(parseAuthLink('yourfoodadmin://customers/123')).toEqual({ kind: 'none' });
  });
});
