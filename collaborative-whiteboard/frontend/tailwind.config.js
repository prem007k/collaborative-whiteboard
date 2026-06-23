/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,jsx}'],
  theme: {
    extend: {
      colors: {
        ink: {
          950: '#0b0f14',
          900: '#11161d',
          800: '#1a212b',
          700: '#242d3a',
          600: '#3a4658',
        },
        accent: {
          DEFAULT: '#5b8def',
          dim: '#3f6fd1',
        },
      },
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};
