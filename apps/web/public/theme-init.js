// Applies the saved or system theme before React loads, so dark mode never flashes light.
// A file rather than an inline script: the CSP allows scripts from 'self' only.
// Keep in sync with src/theme/theme.ts (THEME_STORAGE_KEY).
(function () {
  var pref = null;
  try {
    pref = window.localStorage.getItem('ccq.theme');
  } catch (e) {
    // storage blocked: follow the system
  }
  var dark =
    pref === 'dark' ||
    (pref !== 'light' &&
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
})();
