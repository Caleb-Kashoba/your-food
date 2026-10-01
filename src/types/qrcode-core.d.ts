// Cœur de la bibliothèque « qrcode » (JavaScript pur, sans canvas ni module Node) : sert à dessiner le QR code
// avec des vues natives. Les types fournis couvrent seulement l'entrée principale, d'où cette déclaration.
declare module 'qrcode/lib/core/qrcode' {
  export interface QrModules {
    size: number;
    data: Uint8Array;
    get(row: number, col: number): number;
  }
  export function create(text: string, options?: { errorCorrectionLevel?: 'L' | 'M' | 'Q' | 'H' }): { modules: QrModules };
}
