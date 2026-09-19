import type { AppRole } from '@/types/domain';

export type InvitationChannel = 'email' | 'whatsapp';

export function buildInvitationMessage(name: string, role: AppRole, inviteLink: string): string {
  return [
    `Bonjour ${name.trim()},`,
    '',
    `Vous avez été invité à rejoindre Your Food Admin avec le rôle ${role}.`,
    '',
    'Cliquez sur ce lien pour activer votre compte :',
    '',
    inviteLink,
    '',
    'Your Food'
  ].join('\n');
}
