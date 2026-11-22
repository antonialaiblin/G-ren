// Benachrichtigungen aufs Handy (Web Push), ohne Zusatz-Dienste.
// Der Schlüssel dafür wird beim ersten Mal automatisch erzeugt und im Durable Object gespeichert.
// Die Nachricht selbst holt sich das Handy danach bei /api/push/latest ab, darum wird hier nichts verschlüsselt mitgeschickt.

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const enc = (obj) => b64url(new TextEncoder().encode(JSON.stringify(obj)));

/** Erzeugt ein neues Schlüsselpaar. Ergebnis wird gespeichert und später an sendPush übergeben. */
export async function newVapidKeys() {
  const kp = await crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
  return {
    publicKey: b64url(await crypto.subtle.exportKey('raw', kp.publicKey)),
    privateJwk: await crypto.subtle.exportKey('jwk', kp.privateKey),
  };
}

/** Signiertes Kärtchen (JWT), das dem Push-Dienst zeigt, dass die Nachricht von uns kommt. */
export async function vapidJwt(keys, endpoint, subject) {
  const key = await crypto.subtle.importKey('jwk', keys.privateJwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']);
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subject });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, key, new TextEncoder().encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

/** Schickt einen leeren „Weck-Ruf“. Gibt false zurück, wenn das Abo nicht mehr gilt. */
export async function sendPush(keys, endpoint, subject) {
  try {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        authorization: `vapid t=${await vapidJwt(keys, endpoint, subject)}, k=${keys.publicKey}`,
        ttl: '86400',
        urgency: 'normal',
        'content-length': '0',
      },
    });
    return !(res.status === 404 || res.status === 410);
  } catch {
    return true; // Netzwerkfehler: Abo behalten, nächstes Mal klappt es vielleicht
  }
}

/** Nur echte Push-Adressen der bekannten Anbieter annehmen. */
export function pushEndpointOk(endpoint) {
  try {
    const u = new URL(endpoint);
    return u.protocol === 'https:' && endpoint.length <= 1000 && (
      /(^|\.)googleapis\.com$/.test(u.hostname) || /(^|\.)push\.apple\.com$/.test(u.hostname)
      || /(^|\.)mozilla\.com$/.test(u.hostname) || /(^|\.)notify\.windows\.com$/.test(u.hostname));
  } catch { return false; }
}
