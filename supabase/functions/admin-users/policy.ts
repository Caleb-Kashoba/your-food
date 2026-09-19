export type AppRole = 'root' | 'admin' | 'manager' | 'staff';
export type InvitationChannel = 'email' | 'whatsapp';

const roleLevels: Record<AppRole, number> = {
  root: 100,
  admin: 80,
  manager: 50,
  staff: 20
};

export function canInviteRole(callerRole: AppRole, requestedRole: AppRole, hasUsersCreate: boolean): boolean {
  if (callerRole === 'root') return true;
  if (!hasUsersCreate) return false;
  if (requestedRole === 'root' || requestedRole === 'admin') return false;
  return roleLevels[requestedRole] < roleLevels[callerRole];
}

export function normalizeCongolesePhone(value: string | null | undefined): string | null {
  if (!value?.trim()) return null;

  const trimmed = value.trim();
  const digits = trimmed.replace(/[^0-9]/g, '');
  if (!digits) return null;

  let internationalDigits: string;
  if (digits.startsWith('0') && digits.length >= 9 && digits.length <= 10) {
    internationalDigits = `243${digits.slice(1)}`;
  } else if (digits.startsWith('243')) {
    internationalDigits = digits;
  } else if (trimmed.startsWith('+')) {
    internationalDigits = digits;
  } else if (digits.length === 9) {
    internationalDigits = `243${digits}`;
  } else {
    return null;
  }

  return /^\d{8,15}$/.test(internationalDigits) ? `+${internationalDigits}` : null;
}
