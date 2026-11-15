# Gören 🎁

Die Wichtel-Website der Gören (Milli, Lilly, Emma, Leo, Toni):

- **ein Link für die ganze Gruppe**: jede tippt auf ihren Namen
- beim ersten Mal legt man eine **4-stellige PIN** fest, danach kann nur man selbst den eigenen Brief wieder öffnen
- im Brief steht, wen man beschenkt, und die **Größe** dieser Person (plus Budget und Bescherung, falls eingetragen)
- niemand zieht sich selbst, und die Zuteilung liegt nur auf dem Server, auch die Organisatorin sieht sie nicht
- zeigt, wer schon nachgeschaut hat
- nach 5 falschen PINs ist der Name 10 Minuten gesperrt
- lässt sich wie eine App auf den Home-Bildschirm legen

Läuft kostenlos auf Cloudflare Workers (Free-Plan). Die Auslosung und die PINs liegen in einem Durable Object,
nicht in diesem Repository.

## Einrichten (einmalig)

1. Auf <https://dash.cloudflare.com> anmelden (dasselbe Konto wie für die Putzplan-Zentrale).
2. **Workers & Pages → Create → Import a repository** wählen und dieses Repository auswählen.
3. Als Projektnamen `goeren` lassen (muss zu `wrangler.toml` passen) und **Deploy** klicken.
4. Die Adresse `https://goeren.<dein-name>.workers.dev` öffnen und in die WhatsApp-Gruppe schicken.

Ausgelost wird automatisch beim ersten Aufruf. Danach wird jede Änderung in diesem Repository automatisch veröffentlicht.

## Für alle in der Gruppe

1. Link öffnen und auf deinen Namen tippen.
2. Eine 4-stellige PIN ausdenken und merken.
3. Umschlag öffnen. Nicht verraten!

## Anpassen

Namen, Größen, Budget und Bescherung stehen in `src/config.js`.

- Größe, Budget oder Bescherung ändern: einfach anpassen, die Auslosung bleibt gleich.
- **Neu auslosen** (z. B. wenn jemand die PIN vergessen hat oder jemand dazukommt): `ROUND` ändern, etwa auf `'2026-b'`.
  Dann wird neu gezogen und alle PINs werden zurückgesetzt. Kommt jemand dazu oder fällt weg, wird ebenfalls neu gezogen.

## Entwicklung

```sh
npm install
npm test          # prüft, dass niemand sich selbst zieht
npx wrangler dev  # lokal starten
```
