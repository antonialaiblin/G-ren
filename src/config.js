// Wer mitmacht und welche Größe sie hat.
// Die Größe sieht nur die Person, die diese Freundin gezogen hat.
export const PEOPLE = [
  { name: 'Milli', size: 'S' },
  { name: 'Lilly', size: 'M' },
  { name: 'Emma', size: 'S' },
  { name: 'Leo', size: 'M' },
  { name: 'Toni', size: 'M' },
];

// Optional, wird allen im Brief angezeigt. Leer lassen ('') zum Ausblenden.
export const BUDGET = '';
export const BESCHERUNG = '';

// Runde ändern (z. B. '2026-b'), um komplett neu auszulosen.
// Dann werden auch alle PINs zurückgesetzt.
export const ROUND = '2026';

// Wer die Accounts verwalten und Passwörter zurücksetzen darf (unter „Übersicht“).
export const ADMIN = 'Toni';

// Notfall, falls die Admin selbst nicht mehr reinkommt: Hier die Person eintragen und die Zahl um 1 erhöhen,
// z. B. { Lilly: 1 }. Dann ist ihr Account gelöscht und sie kann sich neu registrieren.
// Ihre Auslosung und ihre Wünsche bleiben erhalten. Beim nächsten Mal: { Lilly: 2 }.
export const RESET = {};
