/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./app/**/*.{js,jsx,ts,tsx}', './src/**/*.{js,jsx,ts,tsx}'],
  presets: [require('nativewind/preset')],
  theme: {
    extend: {
      colors: {
        brand: {
          50: '#eff6ff',
          100: '#dbeafe',
          600: '#2563eb',
          700: '#1d4ed8',
        },
        ink: '#172033',
        muted: '#667085',
        canvas: '#f7f8fa',
        surface: '#ffffff',
        border: '#d9dee8',
        danger: '#b42318',
        dangerSurface: '#fef3f2',
        warning: '#b54708',
        warningSurface: '#fffaeb',
        successSurface: '#ecfdf3',
      },
      spacing: {
        0.5: '2px',
        1.5: '6px',
        2.5: '10px',
        4.5: '18px',
        5.5: '22px',
        7.5: '30px',
      },
      fontSize: {
        xs: ['12px', { lineHeight: '16px' }],
        sm: ['14px', { lineHeight: '20px' }],
        base: ['16px', { lineHeight: '24px' }],
        lg: ['18px', { lineHeight: '26px' }],
        xl: ['22px', { lineHeight: '30px' }],
        '2xl': ['28px', { lineHeight: '36px' }],
      },
    },
  },
  plugins: [],
};
