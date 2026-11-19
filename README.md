# Gören 🎁

Die Wichtel-Website der Gören (Milli, Lilly, Emma, Leo, Toni):

- **ein Link für die ganze Gruppe**: jede tippt auf ihren Namen
- **Anmelden und Registrieren mit Name und Passwort**, wie in der Zentrale; danach wählt man einmal, wer man ist
- im Brief steht, wen man beschenkt, und die **Größe** dieser Person (plus Budget und Bescherung, falls eingetragen)
- niemand zieht sich selbst, und die Zuteilung liegt nur auf dem Server, auch die Organisatorin sieht sie nicht
- nach dem Öffnen trägt jede ihre **Wünsche zu Farben, Schnitt und Sonstigem** ein; die sieht nur, wer sie gezogen hat
- zeigt, wer schon nachgeschaut hat
- nach 5 falschen Passwörtern ist der Name 10 Minuten gesperrt
- lässt sich wie eine App auf den Home-Bildschirm legen

Läuft kostenlos auf Cloudflare Workers (Free-Plan). Die Auslosung und die Accounts (Passwörter nur verschlüsselt) liegen in einem Durable Object,
nicht in diesem Repository.

## Einrichten (einmalig)

1. Auf <https://dash.cloudflare.com> anmelden (dasselbe Konto wie für die Putzplan-Zentrale).
2. **Workers & Pages → Create → Import a repository** wählen und dieses Repository auswählen.
3. Als Projektnamen `goeren` lassen (muss zu `wrangler.toml` passen) und **Deploy** klicken.
4. Die Adresse `https://goeren.<dein-name>.workers.dev` öffnen und in die WhatsApp-Gruppe schicken.

Ausgelost wird automatisch beim ersten Aufruf. Danach wird jede Änderung in diesem Repository automatisch veröffentlicht.

## Für alle in der Gruppe

1. Link öffnen und auf **Registrieren** tippen.
2. Benutzername und Passwort ausdenken (gern mit Merkhilfe).
3. Deinen Namen wählen und den Umschlag öffnen. Nicht verraten!

Wer vorher schon mit einer PIN nachgeschaut hat: einfach **Anmelden** mit deinem Namen und der alten PIN als Passwort.

## Anpassen

Namen, Größen, Budget und Bescherung stehen in `src/config.js`.

- Größe, Budget oder Bescherung ändern: einfach anpassen, die Auslosung bleibt gleich.
- **Passwort vergessen**: in `RESET` die Person eintragen, z. B. `{ Lilly: 1 }` (beim nächsten Mal `2`). Ihr Account wird gelöscht,
  sie registriert sich neu und wählt wieder ihren Namen. Auslosung und Wünsche bleiben.
- **Neu auslosen** (z. B. wenn jemand dazukommt): `ROUND` ändern, etwa auf `'2026-b'`.
  Dann wird neu gezogen, Wünsche und „hat geschaut“ starten neu. Die Accounts bleiben. Kommt jemand dazu oder fällt weg, wird ebenfalls neu gezogen.

## Entwicklung

```sh
npm install
npm test          # prüft, dass niemand sich selbst zieht
npx wrangler dev  # lokal starten
```
