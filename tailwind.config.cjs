const colors = require('tailwindcss/colors');
module.exports = {
  content: ['./index.html', './src/**/*.{ts,tsx}', './node_modules/@tremor/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        tremor: {
          brand: {
            faint: colors.emerald[50],
            muted: colors.emerald[200],
            subtle: colors.emerald[400],
            DEFAULT: colors.emerald[600],
            emphasis: colors.emerald[700],
            inverted: '#fff',
          },
          background: {
            muted: colors.gray[50],
            subtle: colors.gray[100],
            DEFAULT: '#fff',
            emphasis: colors.gray[700],
          },
          border: { DEFAULT: colors.gray[200] },
          ring: { DEFAULT: colors.gray[200] },
          content: {
            subtle: colors.gray[400],
            DEFAULT: colors.gray[500],
            emphasis: colors.gray[700],
            strong: colors.gray[900],
            inverted: '#fff',
          },
        },
      },
      boxShadow: {
        'tremor-input': '0 1px 2px rgb(0 0 0 / 0.05)',
        'tremor-card': '0 1px 3px rgb(0 0 0 / 0.04)',
        'tremor-dropdown': '0 4px 8px rgb(0 0 0 / 0.06)',
      },
      borderRadius: {
        'tremor-small': '0.375rem',
        'tremor-default': '0.5rem',
        'tremor-full': '9999px',
      },
      fontSize: {
        'tremor-label': ['0.75rem', { lineHeight: '1rem' }],
        'tremor-default': ['0.875rem', { lineHeight: '1.25rem' }],
        'tremor-title': ['1.125rem', { lineHeight: '1.75rem' }],
        'tremor-metric': ['1.875rem', { lineHeight: '2.25rem' }],
      },
    },
  },
  safelist: [
    {
      pattern:
        /^(bg|text|border|ring|stroke|fill)-(emerald|teal|cyan|blue|amber|slate)-(50|100|200|300|400|500|600|700|800|900|950)$/,
      variants: ['hover', 'ui-selected'],
    },
  ],
};
