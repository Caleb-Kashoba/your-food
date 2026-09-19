import { parsePhoneNumberFromString } from 'libphonenumber-js';

export function normalizePhone(value: string, defaultCountry: 'CD' = 'CD'): string | null {
  const parsed = parsePhoneNumberFromString(value.trim(), defaultCountry);
  return parsed?.isValid() ? parsed.number : null;
}

export function buildWhatsAppUrl(phone: string, message: string): string {
  const normalized = normalizePhone(phone);
  if (!normalized) {
    throw new Error('Le numéro WhatsApp est invalide.');
  }

  return `https://wa.me/${normalized.slice(1)}?text=${encodeURIComponent(message)}`;
}
