const NAMED: Record<string, string> = {
  Space: 'Espacio',
  ShiftLeft: 'Shift',
  ShiftRight: 'Shift',
  ControlLeft: 'Ctrl',
  ControlRight: 'Ctrl',
  AltLeft: 'Alt',
  AltRight: 'Alt',
  Escape: 'Esc',
  Enter: 'Intro',
  Tab: 'Tab',
  CapsLock: 'Bloq Mayús',
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Mouse0: 'Clic izq.',
  Mouse1: 'Clic central',
  Mouse2: 'Clic der.',
};

/** Nombre legible de un código de tecla o botón ("KeyE" -> "E"). */
export function codeLabel(code: string): string {
  if (NAMED[code]) return NAMED[code];
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  return code;
}
