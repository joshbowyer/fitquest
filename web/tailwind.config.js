/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Safelist dynamic color classes that are built via template literals
  // (e.g. `text-neon-${m.color}`) so the JIT always generates them.
  // Includes the full set of opacity modifiers used throughout the
  // app so dynamic-class usages like `border-neon-cyan/30` don't fall
  // back to a default border (which can look "white" against the
  // charcoal panel background).
  safelist: [
    {
      pattern:
        /^(text|border|bg|neon-text)-neon-(red|orange|cyan|magenta|lime|amber|goldenrod|periwinkle|violet)(\/(5|10|15|20|30|40|50|60|70|80|90))?$/,
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Orbitron"', '"Rajdhani"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      // Color tokens are defined as CSS custom properties holding the
      // space-separated R G B channels. The actual color values live
      // in :root (dark) and .light in src/index.css. Tailwind's
      // `<alpha-value>` placeholder lets the existing `bg-bg-900/70`,
      // `border-neon-cyan/30`, etc. opacity modifiers continue to work
      // unchanged — Tailwind substitutes the value at build time, so
      // the generated CSS is `rgb(var(--bg-900) / 0.7)`.
      //
      // Tradeoff vs hardcoded hex: requires the channels to be set in
      // :root and any theme overrides (light/dark/system) — see
      // src/index.css. The payoff is no component rewrites to theme
      // the app: changing the variables restyles every Tailwind
      // `bg-*`, `text-*`, `border-*` class that points at one of these
      // tokens.
      colors: {
        // "Optimistic in a dingy techworld" — charcoal base, neon accents
        // pop against it. Solarpunk ↔ neon-hellscape, aim for the middle.
        bg: {
          900: 'rgb(var(--bg-900) / <alpha-value>)', // main page bg (charcoal)
          800: 'rgb(var(--bg-800) / <alpha-value>)', // panel bg
          700: 'rgb(var(--bg-700) / <alpha-value>)', // raised
          600: 'rgb(var(--bg-600) / <alpha-value>)',
          500: 'rgb(var(--bg-500) / <alpha-value>)',
        },
        neon: {
          red: 'rgb(var(--neon-red) / <alpha-value>)',
          orange: 'rgb(var(--neon-orange) / <alpha-value>)',
          cyan: 'rgb(var(--neon-cyan) / <alpha-value>)',
          magenta: 'rgb(var(--neon-magenta) / <alpha-value>)',
          lime: 'rgb(var(--neon-lime) / <alpha-value>)',
          amber: 'rgb(var(--neon-amber) / <alpha-value>)',
          goldenrod: 'rgb(var(--neon-goldenrod) / <alpha-value>)',
          // Matches WORLD_COLOR_HEX.periwinkle in web/src/lib/quest.ts
          // (and .neon-text-periwinkle in web/src/index.css). The old
          // #8b9eff read as washed-out gray on dark backgrounds.
          periwinkle: 'rgb(var(--neon-periwinkle) / <alpha-value>)',
          violet: 'rgb(var(--neon-violet) / <alpha-value>)',
        },
        ink: {
          50: 'rgb(var(--ink-50) / <alpha-value>)',
          100: 'rgb(var(--ink-100) / <alpha-value>)',
          200: 'rgb(var(--ink-200) / <alpha-value>)',
          300: 'rgb(var(--ink-300) / <alpha-value>)',
          400: 'rgb(var(--ink-400) / <alpha-value>)',
          500: 'rgb(var(--ink-500) / <alpha-value>)',
        },
      },
      // Box-shadow glows for the neon palette reference the same
      // channel variables. We build the rgba() values inline so the
      // glow color tracks the theme.
      boxShadow: {
        'neon-cyan':    '0 0 8px rgb(var(--neon-cyan) / 0.55), 0 0 16px rgb(var(--neon-cyan) / 0.35), 0 0 32px rgb(var(--neon-cyan) / 0.18)',
        'neon-red':     '0 0 8px rgb(var(--neon-red) / 0.55), 0 0 16px rgb(var(--neon-red) / 0.35), 0 0 32px rgb(var(--neon-red) / 0.18)',
        'neon-orange':  '0 0 8px rgb(var(--neon-orange) / 0.55), 0 0 16px rgb(var(--neon-orange) / 0.35), 0 0 32px rgb(var(--neon-orange) / 0.18)',
        'neon-magenta': '0 0 8px rgb(var(--neon-magenta) / 0.55), 0 0 16px rgb(var(--neon-magenta) / 0.35), 0 0 32px rgb(var(--neon-magenta) / 0.18)',
        'neon-lime':    '0 0 8px rgb(var(--neon-lime) / 0.55), 0 0 16px rgb(var(--neon-lime) / 0.35)',
        'neon-amber':   '0 0 8px rgb(var(--neon-amber) / 0.55), 0 0 16px rgb(var(--neon-amber) / 0.35)',
        'neon-violet':  '0 0 8px rgb(var(--neon-violet) / 0.55), 0 0 16px rgb(var(--neon-violet) / 0.35)',
        'panel':        'inset 0 0 0 1px rgb(var(--neon-cyan) / 0.12), 0 0 30px rgb(var(--neon-cyan) / 0.04)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'scan': 'scan 6s linear infinite',
        'flicker': 'flicker 4s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'neon-charge': 'neon-charge 1.2s ease-in-out infinite',
        // Used by the hearts display in the top bar when the user
        // is at or below 3 hearts. Soft red flash, ~0.8s period.
        'heart-warn': 'heart-warn 0.8s ease-in-out infinite',
      },
      keyframes: {
        scan: {
          '0%': { transform: 'translateY(-100%)' },
          '100%': { transform: 'translateY(100%)' },
        },
        flicker: {
          '0%, 19%, 21%, 23%, 25%, 54%, 56%, 100%': { opacity: '1' },
          '20%, 24%, 55%': { opacity: '0.4' },
        },
        glow: {
          '0%': { textShadow: '0 0 4px currentColor, 0 0 8px currentColor' },
          '100%': { textShadow: '0 0 8px currentColor, 0 0 20px currentColor, 0 0 40px currentColor' },
        },
        'neon-charge': {
          '0%, 100%': {
            boxShadow: '0 0 4px currentColor, 0 0 8px currentColor',
            borderColor: 'currentColor',
          },
          '50%': {
            boxShadow: '0 0 16px currentColor, 0 0 32px currentColor, 0 0 56px currentColor',
            borderColor: 'currentColor',
          },
        },
        'heart-warn': {
          '0%, 100%': {
            opacity: '1',
            textShadow: '0 0 2px #ff5c5c, 0 0 4px #ff5c5c',
          },
          '50%': {
            opacity: '0.5',
            textShadow: '0 0 8px #ff3030, 0 0 16px #ff3030',
          },
        },
      },
    },
  },
  plugins: [],
};