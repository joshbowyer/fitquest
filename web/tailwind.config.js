/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  // Safelist dynamic color classes that are built via template literals
  // (e.g. `text-neon-${m.color}`) so the JIT always generates them,
  // including opacity modifiers (/5, /15, /60, /80).
  safelist: [
    {
      pattern:
        /^(text|border|bg|neon-text)-neon-(red|orange|cyan|magenta|lime|amber|goldenrod|periwinkle|violet)(\/(5|15|60|80))?$/,
    },
  ],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Orbitron"', '"Rajdhani"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // "Optimistic in a dingy techworld" — charcoal base, neon accents
        // pop against it. Solarpunk ↔ neon-hellscape, aim for the middle.
        bg: {
          900: '#2c2f3a', // main page bg (charcoal)
          800: '#363944', // panel bg
          700: '#424553', // raised
          600: '#4f5263',
          500: '#5c5f70',
        },
        neon: {
          red: '#dc2626',
          orange: '#ff8c00',
          cyan: '#14d6e8',
          magenta: '#f55cc4',
          lime: '#56e88e',
          amber: '#ffaa3a',
          goldenrod: '#daa520',
          periwinkle: '#8b9eff',
          violet: '#9a6cf2',
        },
        ink: {
          50: '#fafafd',
          100: '#f5f5fa',
          200: '#d0d0db',
          300: '#a8a8b8',
          400: '#787888',
          500: '#585868',
        },
      },
      boxShadow: {
        'neon-cyan': '0 0 8px rgba(20,214,232,0.55), 0 0 16px rgba(20,214,232,0.35), 0 0 32px rgba(20,214,232,0.18)',
        'neon-red': '0 0 8px rgba(220,38,38,0.55), 0 0 16px rgba(220,38,38,0.35), 0 0 32px rgba(220,38,38,0.18)',
        'neon-orange': '0 0 8px rgba(255,140,0,0.55), 0 0 16px rgba(255,140,0,0.35), 0 0 32px rgba(255,140,0,0.18)',
        'neon-magenta': '0 0 8px rgba(245,92,196,0.55), 0 0 16px rgba(245,92,196,0.35), 0 0 32px rgba(245,92,196,0.18)',
        'neon-lime': '0 0 8px rgba(86,232,142,0.55), 0 0 16px rgba(86,232,142,0.35)',
        'neon-amber': '0 0 8px rgba(255,170,58,0.55), 0 0 16px rgba(255,170,58,0.35)',
        'neon-violet': '0 0 8px rgba(154,108,242,0.55), 0 0 16px rgba(154,108,242,0.35)',
        'panel': 'inset 0 0 0 1px rgba(20,214,232,0.12), 0 0 30px rgba(20,214,232,0.04)',
      },
      animation: {
        'pulse-slow': 'pulse 3s ease-in-out infinite',
        'scan': 'scan 6s linear infinite',
        'flicker': 'flicker 4s linear infinite',
        'glow': 'glow 2s ease-in-out infinite alternate',
        'neon-charge': 'neon-charge 1.2s ease-in-out infinite',
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
      },
    },
  },
  plugins: [],
};
