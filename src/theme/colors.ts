export const colors = {
  primary: '#EB4F12',
  primaryDark: '#35170E',
  primarySoft: '#FFE5D6',
  primaryPressed: '#C83B08',
  accent: '#2E7D32',
  accentSoft: '#E6F2DF',
  cream: '#FFF7EA',
  sand: '#F5E4CE',
  background: '#FFF8EE',
  surface: '#FFFCF7',
  surfaceStrong: '#FFFFFF',
  text: '#2B160F',
  muted: '#7B675D',
  border: '#ECD7C1',
  divider: '#F1E3D3',
  danger: '#B3261E',
  dangerSoft: '#FDE8E5',
  warning: '#A45A00',
  warningSoft: '#FFF0CF',
  success: '#287A36',
  successSoft: '#E5F3E3',
  info: '#2365A8',
  infoSoft: '#E7F0FA',
  white: '#FFFFFF',
  overlay: 'rgba(53, 23, 14, 0.08)'
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 40
} as const;

export const radii = {
  sm: 10,
  md: 16,
  lg: 24,
  xl: 32,
  round: 999
} as const;

export const shadows = {
  soft: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.07,
    shadowRadius: 14,
    elevation: 2
  },
  raised: {
    shadowColor: colors.primaryDark,
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.12,
    shadowRadius: 20,
    elevation: 5
  }
} as const;
