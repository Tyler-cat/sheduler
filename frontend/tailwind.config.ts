import type { Config } from 'tailwindcss';

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'media',
  theme: {
    extend: {
      colors: {
        brand: {
          DEFAULT: '#38bdf8',
          muted: '#0f172a',
          surface: '#1e293b'
        }
      }
    }
  },
  plugins: []
};

export default config;
