/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      fontFamily: {
        display: ['"Orbitron"', '"Rajdhani"', 'system-ui', 'sans-serif'],
        mono: ['"JetBrains Mono"', '"Fira Code"', 'ui-monospace', 'monospace'],
        body: ['"Inter"', 'system-ui', 'sans-serif'],
      },
      colors: {
        // Cyberpunk palette
        bg: {
          900: '#05050a',
          800: '#0a0a14',
          700: '#0f0f1e',
          600: '#161628',
          500: '#1d1d35',
        },
        neon: {
          cyan: '#00f0ff',
          magenta: '#ff2bd6',
          lime: '#00ff88',
          amber: '#ffb800',
          violet: '#7c3aed',
        },
        ink: {
          50: '#f4f4ff',
          100: '#e0e0ff',
          200: '#b0b0d4',
          300: '#8080a8',
          400: '#5a5a7a',
          500: '#3a3a55',
        },
      },
      boxShadow: {
        'neon-cyan': '0 0 8px rgba(0,240,255,0.6), 0 0 16px rgba(0,240,255,0.4), 0 0 32px rgba(0,240,255,0.2)',
        'neon-magenta': '0 0 8px rgba(255,43,214,0.6), 0 0 16px rgba(255,43,214,0.4), 0 0 32px rgba(255,43,214,0.2)',
        'neon-lime': '0 0 8px rgba(0,255,136,0.6), 0 0 16px rgba(0,255,136,0.4)',
        'neon-amber': '0 0 8px rgba(255,184,0,0.6), 0 0 16px rgba(255,184,0,0.4)',
        'panel': 'inset 0 0 0 1px rgba(0,240,255,0.15), 0 0 30px rgba(0,240,255,0.05)',
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
