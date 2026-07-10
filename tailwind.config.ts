import type { Config } from 'tailwindcss'

const config: Config = {
  content: ['./app/**/*.{ts,tsx}', './components/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eef8ff',
          100: '#dff2ff',
          500: '#1985c2',
          700: '#0c5f8f',
          950: '#071722',
        },
      },
    },
  },
  plugins: [],
}

export default config
