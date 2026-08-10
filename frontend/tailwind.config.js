/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        // Violet Futuriste Theme
        'purple-primary': '#9D4EDD',
        'purple-dark': '#7B2CBF',
        'purple-light': '#C77DFF',
        'purple-pale': '#E0AAFF',

        // Background colors - Anthracite
        'bg-primary': '#0B0C0F',
        'bg-secondary': '#12131A',
        'bg-tertiary': '#15161F',
        'bg-surface': '#161722',

        // Semantic colors - Froid
        success: {
          DEFAULT: '#10B981',
          light: '#34D399',
          dark: '#047857',
        },
        warning: {
          DEFAULT: '#F59E0B',
          light: '#FBBF24',
          dark: '#D97706',
        },
        error: {
          DEFAULT: '#EF4444',
          light: '#F87171',
          dark: '#DC2626',
        },
        info: {
          DEFAULT: '#06B6D4',
          light: '#22D3EE',
          dark: '#0891B2',
        },

        // Admin Panel Theme - Neutral Dark (shadcn-like)
        admin: {
          bg: {
            DEFAULT: '#09090b',
            secondary: '#111113',
            surface: '#18181b',
            surface2: '#1f1f23'
          },
          border: {
            DEFAULT: '#27272a',
            strong: '#3f3f46'
          },
          text: {
            DEFAULT: '#fafafa',
            muted: '#a1a1aa',
            subtle: '#71717a'
          },
          primary: {
            DEFAULT: '#e4e4e7',
            strong: '#fafafa',
            foreground: '#09090b'
          },
          success: '#22c55e',
          warning: '#f59e0b',
          danger: '#ef4444'
        }
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'sans-serif'],
      },
      fontWeight: {
        extralight: '200',
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
      },
      fontSize: {
        'xs': ['0.75rem', { lineHeight: '1rem', letterSpacing: '0.025em' }],
        'sm': ['0.875rem', { lineHeight: '1.25rem' }],
        'base': ['1rem', { lineHeight: '1.5rem' }],
        'lg': ['1.125rem', { lineHeight: '1.75rem' }],
        'xl': ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem', letterSpacing: '-0.025em' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem', letterSpacing: '-0.025em' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem', letterSpacing: '-0.025em' }],
        '5xl': ['3rem', { lineHeight: '1.2', letterSpacing: '-0.025em' }],
      },
      letterSpacing: {
        tighter: '-0.05em',
        tight: '-0.025em',
        normal: '0',
        wide: '0.025em',
        wider: '0.05em',
        widest: '0.15em',
      },
      spacing: {
        '4.5': '1.125rem',  // 18px
        '5.5': '1.375rem',  // 22px
        '13': '3.25rem',    // 52px
        '15': '3.75rem',    // 60px
        '17': '4.25rem',    // 68px
        '18': '4.5rem',     // 72px
        '19': '4.75rem',    // 76px
        '21': '5.25rem',    // 84px
      },
      animation: {
        'fade-in': 'fade-in 200ms ease-out both',
        'scale-in': 'scale-in 150ms ease-out both',
      },
      keyframes: {
        'fade-in': {
          '0%': {
            opacity: '0',
          },
          '100%': {
            opacity: '1',
          },
        },
        'scale-in': {
          '0%': {
            opacity: '0',
            transform: 'scale(0.98)',
          },
          '100%': {
            opacity: '1',
            transform: 'scale(1)',
          },
        },
      },
      backdropBlur: {
        xs: '2px',
        sm: '4px',
        DEFAULT: '8px',
        md: '12px',
        lg: '16px',
        xl: '24px',
        '2xl': '40px',
        '3xl': '64px',
        '4xl': '80px',
      },
      borderRadius: {
        'none': '0',
        'sm': '4px',
        DEFAULT: '8px',
        'md': '8px',
        'lg': '8px',
        'xl': '12px',
        '2xl': '16px',
        '3xl': '24px',
        '4xl': '32px',
        'full': '9999px',
      },
      boxShadow: {
        'sm': '0 1px 2px rgba(0, 0, 0, 0.1)',
        DEFAULT: '0 1px 3px rgba(0, 0, 0, 0.1)',
        'md': '0 2px 6px rgba(0, 0, 0, 0.1)',
        'lg': '0 4px 12px rgba(0, 0, 0, 0.1)',
        'xl': '0 8px 24px rgba(0, 0, 0, 0.1)',
        '2xl': '0 12px 36px rgba(0, 0, 0, 0.1)',
        'inner': 'inset 0 2px 4px rgba(0, 0, 0, 0.1)',
        'none': 'none',
      },
      transitionTimingFunction: {
        'ease-out-smooth': 'cubic-bezier(0.16, 1, 0.3, 1)',
        'ease-in-out-smooth': 'cubic-bezier(0.65, 0, 0.35, 1)',
        'spring': 'cubic-bezier(0.34, 1.56, 0.64, 1)',
      },
      transitionDuration: {
        '0': '0ms',
        '75': '75ms',
        '100': '100ms',
        '150': '150ms',
        '200': '200ms',
        '300': '300ms',
        '500': '500ms',
        '700': '700ms',
        '1000': '1000ms',
      },
      scale: {
        '98': '0.98',
        '101': '1.01',
        '102': '1.02',
      },
    },
  },
  plugins: [],
}
