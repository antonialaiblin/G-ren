// Hilfsfunktionen für Accounts (Name + Passwort), wie in der Zentrale.

/** Passwort-Hash mit Salz (PBKDF2), damit Passwörter nie im Klartext gespeichert werden. */
export async function pwHash(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return btoa(String.fromCharCode(...new Uint8Array(bits)));
}

/** Zufälliger Schlüssel für Salz und Anmelde-Sitzungen (48 Zeichen). */
export const newToken = () =>
  [...crypto.getRandomValues(new Uint8Array(24))].map((b) => b.toString(16).padStart(2, '0')).join('');

export async function hashPw(password) {
  const salt = newToken();
  return { salt, hash: await pwHash(password, salt) };
}

export const pwOk = (p) => typeof p === 'string' && p.length >= 4 && p.length <= 100;

/** Benutzername aufräumen: Leerzeichen kürzen, max. 30 Zeichen. */
export const cleanUsername = (u) => (typeof u === 'string' ? u.trim().replace(/\s+/g, ' ').slice(0, 30) : '');
