/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        primary: '#17684e',
        primaryContainer: '#378166',
        tertiary: '#9b3e3b',
        surface: '#f5fbf5',
        surfaceContainer: '#e9efe9',
        surfaceLow: '#eff5ef',
        outline: '#6d7a72',
      },
      fontFamily: {
        headline: ['Manrope', 'sans-serif'],
        body: ['Work Sans', 'sans-serif'],
      },
      boxShadow: {
        card: '0 12px 28px rgba(23, 104, 78, 0.08)',
      },
      keyframes: {
        reveal: {
          '0%': { opacity: '0', transform: 'translateY(10px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      },
      animation: {
        reveal: 'reveal 0.45s ease-out both',
      },
    },
  },
  plugins: [require('@tailwindcss/forms')],
}
