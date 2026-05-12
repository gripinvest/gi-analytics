/** @type {import('tailwindcss').Config} */
// Theme is mapped onto the --gi-* CSS variables defined in app/globals.css,
// which mirror grip-code/design-tokens.tokens.json. Change tokens there, not here.

const scale = (name) =>
  Object.fromEntries(
    [0, 50, 100, 200, 300, 400, 500, 550, 600, 700, 800, 900]
      .filter((s) => !(name !== "neutral" && (s === 0 || s === 550)))
      .map((s) => [s, `var(--gi-${name}-${s})`])
  );

module.exports = {
  content: ["./app/**/*.{js,jsx,ts,tsx}", "./components/**/*.{js,jsx,ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: scale("navy"),
        teal: scale("teal"),
        success: scale("success"),
        error: scale("error"),
        warning: scale("warning"),
        neutral: scale("neutral"),
        // semantic aliases — prefer these in components
        surface: "var(--gi-bg-surface)",
        page: "var(--gi-bg-page)",
        muted: "var(--gi-bg-muted)",
        subtle: "var(--gi-bg-subtle)",
        "tint-navy": "var(--gi-bg-tint-navy)",
        "tint-teal": "var(--gi-bg-tint-teal)",
        heading: "var(--gi-text-heading)",
        subheading: "var(--gi-text-subheading)",
        body: "var(--gi-text-body)",
        secondary: "var(--gi-text-secondary)",
        tertiary: "var(--gi-text-tertiary)",
        link: "var(--gi-text-link)",
        "on-primary": "var(--gi-text-on-primary)",
        "on-accent": "var(--gi-text-on-accent)",
        "border-default": "var(--gi-border-default)",
        "border-strong": "var(--gi-border-strong)",
        "border-accessible": "var(--gi-border-accessible)",
        action: {
          DEFAULT: "var(--gi-action-primary)",
          hover: "var(--gi-action-primary-hover)",
          pressed: "var(--gi-action-primary-pressed)",
          accent: "var(--gi-action-accent)",
          "accent-hover": "var(--gi-action-accent-hover)",
          "disabled-bg": "var(--gi-action-disabled-bg)",
          "disabled-text": "var(--gi-action-disabled-text)",
        },
        status: {
          success: "var(--gi-status-success)",
          "success-bg": "var(--gi-status-success-bg)",
          error: "var(--gi-status-error)",
          "error-bg": "var(--gi-status-error-bg)",
          warning: "var(--gi-status-warning)",
          "warning-bg": "var(--gi-status-warning-bg)",
          info: "var(--gi-status-info)",
          "info-bg": "var(--gi-status-info-bg)",
        },
      },
      fontFamily: {
        sans: "var(--gi-font-sans)",
        mono: "var(--gi-font-mono)",
      },
      borderRadius: {
        none: "var(--gi-radius-none)",
        xs: "var(--gi-radius-xs)",
        "2xs": "var(--gi-radius-2xs)",
        sm: "var(--gi-radius-sm)",
        md: "var(--gi-radius-md)",
        lg: "var(--gi-radius-lg)",
        xl: "var(--gi-radius-xl)",
        "2xl": "var(--gi-radius-2xl)",
        full: "var(--gi-radius-full)",
      },
      boxShadow: {
        xs: "var(--gi-shadow-xs)",
        sm: "var(--gi-shadow-sm)",
        md: "var(--gi-shadow-md)",
        lg: "var(--gi-shadow-lg)",
        nav: "var(--gi-shadow-nav)",
        none: "none",
      },
      ringColor: { DEFAULT: "var(--gi-focus-ring)" },
      // brand space scale (px), available as p-gi-7 etc. when the 4px scale doesn't fit
      spacing: {
        "gi-1": "2px", "gi-2": "4px", "gi-3": "6px", "gi-4": "8px", "gi-5": "10px",
        "gi-6": "12px", "gi-7": "20px", "gi-8": "24px", "gi-9": "32px", "gi-10": "36px",
        "gi-11": "40px", "gi-12": "56px",
      },
    },
  },
  plugins: [],
};
