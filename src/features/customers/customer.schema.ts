import { z } from 'zod';

import { normalizePhone } from '@/lib/phone';

const optionalText = z.string().trim().transform((value) => value || null);

export const customerSchema = z.object({
  firstName: z.string().trim().min(1, 'Le prénom est obligatoire.'),
  lastName: z.string().trim().min(1, 'Le nom est obligatoire.'),
  phone: z.string().trim().refine((value) => normalizePhone(value) !== null, 'Numéro de téléphone invalide.'),
  whatsapp: z
    .string()
    .trim()
    .refine((value) => value === '' || normalizePhone(value) !== null, 'Numéro WhatsApp invalide.'),
  residence: optionalText,
  building: optionalText,
  room: optionalText,
  zoneId: z.string().nullable(),
  addressDetails: optionalText,
  foodPreferences: optionalText,
  allergies: optionalText,
  foodsToAvoid: optionalText,
  notes: optionalText,
  status: z.enum(['active', 'inactive', 'former_customer'])
});

export type CustomerFormValues = z.input<typeof customerSchema>;
export type CustomerPayload = z.output<typeof customerSchema>;
