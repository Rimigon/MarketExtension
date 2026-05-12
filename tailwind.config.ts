import type { Config } from 'tailwindcss';

export default {
  content: ['./src/**/*.{ts,tsx,html}'],
  theme: {
    // Receipt aesthetic: every corner is sharp. We override Tailwind's
    // borderRadius scale rather than scrub every component's class list.
    borderRadius: {
      none: '0',
      DEFAULT: '0',
      sm: '0',
      md: '0',
      lg: '0',
      xl: '0',
      '2xl': '0',
      '3xl': '0',
      full: '0',
    },
    // No drop shadows. Depth comes from 1px borders and inversion.
    boxShadow: {
      none: 'none',
      sm: 'none',
      DEFAULT: 'none',
      md: 'none',
      lg: 'none',
      xl: 'none',
      '2xl': 'none',
      inner: 'none',
    },
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d8eaff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
        // Signal red — the only colour the receipt aesthetic raises its voice
        // for: price drops, alerts, destructive actions.
        signal: {
          DEFAULT: '#E63946',
          dim: '#b8202c',
        },
      },
      fontFamily: {
        sans: [
          'Manrope',
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Helvetica Neue',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
        mono: [
          'JetBrains Mono',
          'ui-monospace',
          'SFMono-Regular',
          'Menlo',
          'Consolas',
          'monospace',
        ],
      },
      letterSpacing: {
        receipt: '0.02em',
      },
    },
  },
  plugins: [],
} satisfies Config;
