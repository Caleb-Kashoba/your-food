import { describe, expect, it } from 'vitest';

import { buildInvitationMessage } from '@/features/users/invitation';

describe('buildInvitationMessage', () => {
  it('includes the recipient, requested role and secure link', () => {
    const message = buildInvitationMessage('Amina', 'staff', 'https://example.test/invite');

    expect(message).toContain('Bonjour Amina');
    expect(message).toContain('rôle staff');
    expect(message).toContain('https://example.test/invite');
  });
});
