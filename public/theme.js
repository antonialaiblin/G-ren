// Hell / Dunkel / Automatisch (nach Sonnenauf- und -untergang in Berlin).
// Wird ganz oben im <head> geladen, damit die Seite nicht kurz hell aufblitzt.
(function () {
  const LAT = 52.52, LNG = 13.405; // Berlin
  const rad = Math.PI / 180;

  // Sonnenauf- und -untergang für ein Datum (Näherung, auf wenige Minuten genau)
  function sunTimes(date) {
    const noon = new Date(date); noon.setHours(12, 0, 0, 0);   // Mittag des Tages
    const jd = noon.getTime() / 86400000 + 2440587.5;
    const jStar = Math.ceil(jd - 2451545 + 0.0008) - LNG / 360;
    const M = (357.5291 + 0.98560028 * jStar) % 360;
    const C = 1.9148 * Math.sin(M * rad) + 0.02 * Math.sin(2 * M * rad) + 0.0003 * Math.sin(3 * M * rad);
    const lam = (M + C + 180 + 102.9372) % 360;
    const jTransit = 2451545 + jStar + 0.0053 * Math.sin(M * rad) - 0.0069 * Math.sin(2 * lam * rad);
    const decl = Math.asin(Math.sin(lam * rad) * Math.sin(23.44 * rad));
    const cosW = (Math.sin(-0.833 * rad) - Math.sin(LAT * rad) * Math.sin(decl)) / (Math.cos(LAT * rad) * Math.cos(decl));
    const w = Math.acos(Math.max(-1, Math.min(1, cosW))) / rad;
    const toDate = (j) => new Date((j - 2440587.5) * 86400000);
    return { rise: toDate(jTransit - w / 360), set: toDate(jTransit + w / 360) };
  }

  function getChoice() {
    try { return localStorage.getItem('goeren-theme') || 'auto'; } catch { return 'auto'; }
  }

  function apply() {
    const choice = getChoice();
    let dark = choice === 'dark';
    if (choice === 'auto') {
      const now = new Date();
      const { rise, set } = sunTimes(now);
      dark = now < rise || now >= set;
    }
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? '#151816' : '#2f6f5e';
  }

  window.goerenTheme = {
    sunTimes, getChoice, apply,
    set(choice) {
      try { localStorage.setItem('goeren-theme', choice); } catch {}
      apply();
    },
  };
  apply();
  setInterval(apply, 60_000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) apply(); });
})();
