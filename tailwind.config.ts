import type { Config } from 'tailwindcss';

export default {
  content: [
    './src/**/*.{ts,tsx,html}',
  ],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef6ff',
          100: '#d8eaff',
          500: '#2563eb',
          600: '#1d4ed8',
          700: '#1e40af',
        },
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'Segoe UI',
          'Roboto',
          'Helvetica',
          'Arial',
          'sans-serif',
        ],
      },
    },
  },
  plugins: [],
} satisfies Config;
