export function ThemeScript() {
  // This script runs before React hydration to prevent FOUC
  const script = `
    (function() {
      var STORAGE_KEY = "polymarket-theme";
      var DEFAULT_THEME = "dark";

      try {
        var stored = localStorage.getItem(STORAGE_KEY);
        var theme = (stored === "light" || stored === "dark") ? stored : DEFAULT_THEME;

        if (theme === "dark") {
          document.documentElement.classList.add("dark");
        }
      } catch (e) {
        // localStorage might not be available, default to dark
        document.documentElement.classList.add("dark");
      }
    })();
  `;

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
