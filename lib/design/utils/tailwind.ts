/**
 * Tailwind CSS class to inline style conversion.
 * Extracted from Otter Cards tailwind-to-styles.ts.
 *
 * Pure utility -- zero external dependencies.  Covers the most common
 * Tailwind v3 utility classes used in card/component design.
 */

// ---------------------------------------------------------------------------
// Lookup tables
// ---------------------------------------------------------------------------

/** Tailwind color palette (name -> hex) */
const colorMap: Record<string, string> = {
  'white': '#ffffff',
  'black': '#000000',
  'transparent': 'transparent',

  'gray-50': '#f9fafb', 'gray-100': '#f3f4f6', 'gray-200': '#e5e7eb',
  'gray-300': '#d1d5db', 'gray-400': '#9ca3af', 'gray-500': '#6b7280',
  'gray-600': '#4b5563', 'gray-700': '#374151', 'gray-800': '#1f2937',
  'gray-900': '#111827',

  'red-50': '#fef2f2', 'red-100': '#fee2e2', 'red-200': '#fecaca',
  'red-300': '#fca5a5', 'red-400': '#f87171', 'red-500': '#ef4444',
  'red-600': '#dc2626', 'red-700': '#b91c1c', 'red-800': '#991b1b',
  'red-900': '#7f1d1d',

  'blue-50': '#eff6ff', 'blue-100': '#dbeafe', 'blue-200': '#bfdbfe',
  'blue-300': '#93c5fd', 'blue-400': '#60a5fa', 'blue-500': '#3b82f6',
  'blue-600': '#2563eb', 'blue-700': '#1d4ed8', 'blue-800': '#1e40af',
  'blue-900': '#1e3a8a',

  'green-50': '#f0fdf4', 'green-100': '#dcfce7', 'green-200': '#bbf7d0',
  'green-300': '#86efac', 'green-400': '#4ade80', 'green-500': '#22c55e',
  'green-600': '#16a34a', 'green-700': '#15803d', 'green-800': '#166534',
  'green-900': '#14532d',

  'yellow-50': '#fefce8', 'yellow-100': '#fef9c3', 'yellow-200': '#fef08a',
  'yellow-300': '#fde047', 'yellow-400': '#facc15', 'yellow-500': '#eab308',
  'yellow-600': '#ca8a04', 'yellow-700': '#a16207', 'yellow-800': '#854d0e',
  'yellow-900': '#713f12',

  'purple-50': '#faf5ff', 'purple-100': '#f3e8ff', 'purple-200': '#e9d5ff',
  'purple-300': '#d8b4fe', 'purple-400': '#c084fc', 'purple-500': '#a855f7',
  'purple-600': '#9333ea', 'purple-700': '#7c3aed', 'purple-800': '#6b21a8',
  'purple-900': '#581c87',

  'pink-50': '#fdf2f8', 'pink-100': '#fce7f3', 'pink-200': '#fbcfe8',
  'pink-300': '#f9a8d4', 'pink-400': '#f472b6', 'pink-500': '#ec4899',
  'pink-600': '#db2777', 'pink-700': '#be185d', 'pink-800': '#9d174d',
  'pink-900': '#831843',

  'orange-50': '#fff7ed', 'orange-100': '#ffedd5', 'orange-200': '#fed7aa',
  'orange-300': '#fdba74', 'orange-400': '#fb923c', 'orange-500': '#f97316',
  'orange-600': '#ea580c', 'orange-700': '#c2410c', 'orange-800': '#9a3412',
  'orange-900': '#7c2d12',
};

/** Tailwind spacing scale (key -> CSS value) */
const spacingScale: Record<string, string> = {
  '0': '0px', 'px': '1px', '0.5': '0.125rem', '1': '0.25rem',
  '1.5': '0.375rem', '2': '0.5rem', '2.5': '0.625rem', '3': '0.75rem',
  '3.5': '0.875rem', '4': '1rem', '5': '1.25rem', '6': '1.5rem',
  '7': '1.75rem', '8': '2rem', '9': '2.25rem', '10': '2.5rem',
  '11': '2.75rem', '12': '3rem', '14': '3.5rem', '16': '4rem',
  '20': '5rem', '24': '6rem', '28': '7rem', '32': '8rem',
  '36': '9rem', '40': '10rem', '44': '11rem', '48': '12rem',
  '52': '13rem', '56': '14rem', '60': '15rem', '64': '16rem',
  '72': '18rem', '80': '20rem', '96': '24rem',
};

/** Tailwind font-size scale (key -> { fontSize, lineHeight }) */
const fontSizeMap: Record<string, { fontSize: string; lineHeight: string }> = {
  'xs':  { fontSize: '0.75rem',  lineHeight: '1rem' },
  'sm':  { fontSize: '0.875rem', lineHeight: '1.25rem' },
  'base': { fontSize: '1rem',    lineHeight: '1.5rem' },
  'lg':  { fontSize: '1.125rem', lineHeight: '1.75rem' },
  'xl':  { fontSize: '1.25rem',  lineHeight: '1.75rem' },
  '2xl': { fontSize: '1.5rem',   lineHeight: '2rem' },
  '3xl': { fontSize: '1.875rem', lineHeight: '2.25rem' },
  '4xl': { fontSize: '2.25rem',  lineHeight: '2.5rem' },
  '5xl': { fontSize: '3rem',     lineHeight: '1' },
  '6xl': { fontSize: '3.75rem',  lineHeight: '1' },
  '7xl': { fontSize: '4.5rem',   lineHeight: '1' },
  '8xl': { fontSize: '6rem',     lineHeight: '1' },
  '9xl': { fontSize: '8rem',     lineHeight: '1' },
};

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * A plain CSS properties object (avoids React dependency).
 * Keys are camelCase CSS property names; values are strings or numbers.
 */
export type CSSProperties = Record<string, string | number>;

// ---------------------------------------------------------------------------
// Core conversion
// ---------------------------------------------------------------------------

/**
 * Convert a space-separated Tailwind class string into an inline style object.
 *
 * Covers: width/height, min/max sizing, display, position, flexbox, grid,
 * gap, padding, margin, text alignment/size, font weight, background color,
 * text color, border, border-radius, box-shadow, opacity, overflow,
 * transform, transition, z-index, cursor, and gradient stops.
 */
export function tailwindToStyles(className: string): CSSProperties {
  const classes = className.split(' ').filter(Boolean);
  const styles: CSSProperties = {};

  for (const cls of classes) {
    // --- Width / Height ---
    if (cls === 'w-full') { styles.width = '100%'; }
    else if (cls === 'h-full') { styles.height = '100%'; }
    else if (cls === 'w-screen') { styles.width = '100vw'; }
    else if (cls === 'h-screen') { styles.height = '100vh'; }
    else if (cls.startsWith('w-') && spacingScale[cls.substring(2)]) {
      styles.width = spacingScale[cls.substring(2)];
    }
    else if (cls.startsWith('h-') && spacingScale[cls.substring(2)]) {
      styles.height = spacingScale[cls.substring(2)];
    }

    // --- Min/Max ---
    else if (cls === 'min-w-full') { styles.minWidth = '100%'; }
    else if (cls === 'min-h-full') { styles.minHeight = '100%'; }
    else if (cls === 'min-h-screen') { styles.minHeight = '100vh'; }
    else if (cls === 'max-w-full') { styles.maxWidth = '100%'; }
    else if (cls === 'max-h-full') { styles.maxHeight = '100%'; }

    // --- Display ---
    else if (cls === 'block') { styles.display = 'block'; }
    else if (cls === 'inline-block') { styles.display = 'inline-block'; }
    else if (cls === 'inline') { styles.display = 'inline'; }
    else if (cls === 'flex') { styles.display = 'flex'; }
    else if (cls === 'inline-flex') { styles.display = 'inline-flex'; }
    else if (cls === 'grid') { styles.display = 'grid'; }
    else if (cls === 'hidden') { styles.display = 'none'; }

    // --- Position ---
    else if (cls === 'relative') { styles.position = 'relative'; }
    else if (cls === 'absolute') { styles.position = 'absolute'; }
    else if (cls === 'fixed') { styles.position = 'fixed'; }
    else if (cls === 'sticky') { styles.position = 'sticky'; }

    // --- Flexbox ---
    else if (cls === 'flex-row') { styles.flexDirection = 'row'; }
    else if (cls === 'flex-col') { styles.flexDirection = 'column'; }
    else if (cls === 'flex-wrap') { styles.flexWrap = 'wrap'; }
    else if (cls === 'flex-nowrap') { styles.flexWrap = 'nowrap'; }
    else if (cls === 'items-start') { styles.alignItems = 'flex-start'; }
    else if (cls === 'items-center') { styles.alignItems = 'center'; }
    else if (cls === 'items-end') { styles.alignItems = 'flex-end'; }
    else if (cls === 'items-stretch') { styles.alignItems = 'stretch'; }
    else if (cls === 'justify-start') { styles.justifyContent = 'flex-start'; }
    else if (cls === 'justify-center') { styles.justifyContent = 'center'; }
    else if (cls === 'justify-end') { styles.justifyContent = 'flex-end'; }
    else if (cls === 'justify-between') { styles.justifyContent = 'space-between'; }
    else if (cls === 'justify-around') { styles.justifyContent = 'space-around'; }
    else if (cls === 'justify-evenly') { styles.justifyContent = 'space-evenly'; }
    else if (cls === 'flex-1') { styles.flex = '1 1 0%'; }
    else if (cls === 'flex-auto') { styles.flex = '1 1 auto'; }
    else if (cls === 'flex-initial') { styles.flex = '0 1 auto'; }
    else if (cls === 'flex-none') { styles.flex = 'none'; }

    // --- Gap ---
    else if (cls.startsWith('gap-') && spacingScale[cls.substring(4)]) {
      styles.gap = spacingScale[cls.substring(4)];
    }

    // --- Padding ---
    else if (cls.startsWith('p-') && spacingScale[cls.substring(2)]) {
      styles.padding = spacingScale[cls.substring(2)];
    }
    else if (cls.startsWith('px-') && spacingScale[cls.substring(3)]) {
      styles.paddingLeft = spacingScale[cls.substring(3)];
      styles.paddingRight = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('py-') && spacingScale[cls.substring(3)]) {
      styles.paddingTop = spacingScale[cls.substring(3)];
      styles.paddingBottom = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('pt-') && spacingScale[cls.substring(3)]) {
      styles.paddingTop = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('pr-') && spacingScale[cls.substring(3)]) {
      styles.paddingRight = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('pb-') && spacingScale[cls.substring(3)]) {
      styles.paddingBottom = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('pl-') && spacingScale[cls.substring(3)]) {
      styles.paddingLeft = spacingScale[cls.substring(3)];
    }

    // --- Margin ---
    else if (cls.startsWith('m-') && spacingScale[cls.substring(2)]) {
      styles.margin = spacingScale[cls.substring(2)];
    }
    else if (cls === 'mx-auto') {
      styles.marginLeft = 'auto';
      styles.marginRight = 'auto';
    }
    else if (cls.startsWith('mx-') && spacingScale[cls.substring(3)]) {
      styles.marginLeft = spacingScale[cls.substring(3)];
      styles.marginRight = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('my-') && spacingScale[cls.substring(3)]) {
      styles.marginTop = spacingScale[cls.substring(3)];
      styles.marginBottom = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('mt-') && spacingScale[cls.substring(3)]) {
      styles.marginTop = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('mr-') && spacingScale[cls.substring(3)]) {
      styles.marginRight = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('mb-') && spacingScale[cls.substring(3)]) {
      styles.marginBottom = spacingScale[cls.substring(3)];
    }
    else if (cls.startsWith('ml-') && spacingScale[cls.substring(3)]) {
      styles.marginLeft = spacingScale[cls.substring(3)];
    }

    // --- Text alignment / size ---
    else if (cls === 'text-left') { styles.textAlign = 'left'; }
    else if (cls === 'text-center') { styles.textAlign = 'center'; }
    else if (cls === 'text-right') { styles.textAlign = 'right'; }
    else if (cls === 'text-justify') { styles.textAlign = 'justify'; }
    else if (fontSizeMap[cls.replace('text-', '')]) {
      const size = fontSizeMap[cls.replace('text-', '')];
      styles.fontSize = size.fontSize;
      styles.lineHeight = size.lineHeight;
    }

    // --- Font weight ---
    else if (cls === 'font-thin') { styles.fontWeight = '100'; }
    else if (cls === 'font-extralight') { styles.fontWeight = '200'; }
    else if (cls === 'font-light') { styles.fontWeight = '300'; }
    else if (cls === 'font-normal') { styles.fontWeight = '400'; }
    else if (cls === 'font-medium') { styles.fontWeight = '500'; }
    else if (cls === 'font-semibold') { styles.fontWeight = '600'; }
    else if (cls === 'font-bold') { styles.fontWeight = '700'; }
    else if (cls === 'font-extrabold') { styles.fontWeight = '800'; }
    else if (cls === 'font-black') { styles.fontWeight = '900'; }

    // --- Background color ---
    else if (cls.startsWith('bg-') && cls !== 'bg-clip-text') {
      const colorKey = cls.substring(3);
      if (colorMap[colorKey]) {
        styles.backgroundColor = colorMap[colorKey];
      } else if (colorKey === 'gradient-to-r') {
        styles.backgroundImage = 'linear-gradient(to right, var(--tw-gradient-stops))';
      } else if (colorKey === 'gradient-to-br') {
        styles.backgroundImage = 'linear-gradient(to bottom right, var(--tw-gradient-stops))';
      }
    }

    // --- Text color ---
    else if (cls.startsWith('text-') && !cls.startsWith('text-opacity-')) {
      const colorKey = cls.substring(5);
      if (colorMap[colorKey]) {
        styles.color = colorMap[colorKey];
      }
    }

    // --- Border width ---
    else if (cls === 'border') { styles.borderWidth = '1px'; }
    else if (cls === 'border-0') { styles.borderWidth = '0px'; }
    else if (cls === 'border-2') { styles.borderWidth = '2px'; }
    else if (cls === 'border-4') { styles.borderWidth = '4px'; }
    else if (cls === 'border-8') { styles.borderWidth = '8px'; }
    else if (cls === 'border-t') { styles.borderTopWidth = '1px'; }
    else if (cls === 'border-r') { styles.borderRightWidth = '1px'; }
    else if (cls === 'border-b') { styles.borderBottomWidth = '1px'; }
    else if (cls === 'border-l') { styles.borderLeftWidth = '1px'; }

    // --- Border color ---
    else if (cls.startsWith('border-') && colorMap[cls.substring(7)]) {
      styles.borderColor = colorMap[cls.substring(7)];
    }

    // --- Border radius ---
    else if (cls === 'rounded-none') { styles.borderRadius = '0px'; }
    else if (cls === 'rounded-sm') { styles.borderRadius = '0.125rem'; }
    else if (cls === 'rounded') { styles.borderRadius = '0.25rem'; }
    else if (cls === 'rounded-md') { styles.borderRadius = '0.375rem'; }
    else if (cls === 'rounded-lg') { styles.borderRadius = '0.5rem'; }
    else if (cls === 'rounded-xl') { styles.borderRadius = '0.75rem'; }
    else if (cls === 'rounded-2xl') { styles.borderRadius = '1rem'; }
    else if (cls === 'rounded-3xl') { styles.borderRadius = '1.5rem'; }
    else if (cls === 'rounded-full') { styles.borderRadius = '9999px'; }

    // --- Box shadow ---
    else if (cls === 'shadow-sm') { styles.boxShadow = '0 1px 2px 0 rgb(0 0 0 / 0.05)'; }
    else if (cls === 'shadow') { styles.boxShadow = '0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1)'; }
    else if (cls === 'shadow-md') { styles.boxShadow = '0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1)'; }
    else if (cls === 'shadow-lg') { styles.boxShadow = '0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1)'; }
    else if (cls === 'shadow-xl') { styles.boxShadow = '0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1)'; }
    else if (cls === 'shadow-2xl') { styles.boxShadow = '0 25px 50px -12px rgb(0 0 0 / 0.25)'; }
    else if (cls === 'shadow-none') { styles.boxShadow = '0 0 #0000'; }

    // --- Opacity ---
    else if (cls.startsWith('opacity-')) {
      const opacity = parseInt(cls.substring(8), 10);
      if (!isNaN(opacity)) {
        styles.opacity = opacity / 100;
      }
    }

    // --- Overflow ---
    else if (cls === 'overflow-auto') { styles.overflow = 'auto'; }
    else if (cls === 'overflow-hidden') { styles.overflow = 'hidden'; }
    else if (cls === 'overflow-clip') { styles.overflow = 'clip'; }
    else if (cls === 'overflow-visible') { styles.overflow = 'visible'; }
    else if (cls === 'overflow-scroll') { styles.overflow = 'scroll'; }

    // --- Transform ---
    else if (cls === 'scale-95') { styles.transform = 'scale(0.95)'; }
    else if (cls === 'scale-100') { styles.transform = 'scale(1)'; }
    else if (cls === 'scale-105') { styles.transform = 'scale(1.05)'; }
    else if (cls === 'scale-110') { styles.transform = 'scale(1.1)'; }

    // --- Transition ---
    else if (cls === 'transition') {
      styles.transitionProperty = 'color, background-color, border-color, text-decoration-color, fill, stroke, opacity, box-shadow, transform, filter, backdrop-filter';
      styles.transitionTimingFunction = 'cubic-bezier(0.4, 0, 0.2, 1)';
      styles.transitionDuration = '150ms';
    }
    else if (cls === 'transition-all') {
      styles.transitionProperty = 'all';
      styles.transitionTimingFunction = 'cubic-bezier(0.4, 0, 0.2, 1)';
      styles.transitionDuration = '150ms';
    }
    else if (cls === 'transition-transform') {
      styles.transitionProperty = 'transform';
      styles.transitionTimingFunction = 'cubic-bezier(0.4, 0, 0.2, 1)';
      styles.transitionDuration = '150ms';
    }
    else if (cls === 'duration-75') { styles.transitionDuration = '75ms'; }
    else if (cls === 'duration-100') { styles.transitionDuration = '100ms'; }
    else if (cls === 'duration-150') { styles.transitionDuration = '150ms'; }
    else if (cls === 'duration-200') { styles.transitionDuration = '200ms'; }
    else if (cls === 'duration-300') { styles.transitionDuration = '300ms'; }
    else if (cls === 'duration-500') { styles.transitionDuration = '500ms'; }
    else if (cls === 'duration-700') { styles.transitionDuration = '700ms'; }
    else if (cls === 'duration-1000') { styles.transitionDuration = '1000ms'; }

    // --- Z-Index ---
    else if (cls === 'z-0') { styles.zIndex = 0; }
    else if (cls === 'z-10') { styles.zIndex = 10; }
    else if (cls === 'z-20') { styles.zIndex = 20; }
    else if (cls === 'z-30') { styles.zIndex = 30; }
    else if (cls === 'z-40') { styles.zIndex = 40; }
    else if (cls === 'z-50') { styles.zIndex = 50; }
    else if (cls === 'z-auto') { styles.zIndex = 'auto'; }

    // --- Cursor ---
    else if (cls === 'cursor-auto') { styles.cursor = 'auto'; }
    else if (cls === 'cursor-default') { styles.cursor = 'default'; }
    else if (cls === 'cursor-pointer') { styles.cursor = 'pointer'; }
    else if (cls === 'cursor-wait') { styles.cursor = 'wait'; }
    else if (cls === 'cursor-text') { styles.cursor = 'text'; }
    else if (cls === 'cursor-move') { styles.cursor = 'move'; }
    else if (cls === 'cursor-help') { styles.cursor = 'help'; }
    else if (cls === 'cursor-not-allowed') { styles.cursor = 'not-allowed'; }

    // --- Gradient stops (CSS custom properties) ---
    else if (cls.startsWith('from-') && colorMap[cls.substring(5)]) {
      styles.backgroundImage = styles.backgroundImage || 'linear-gradient(to right, var(--tw-gradient-stops))';
      styles['--tw-gradient-from'] = colorMap[cls.substring(5)];
      styles['--tw-gradient-stops'] = 'var(--tw-gradient-from), var(--tw-gradient-to)';
    }
    else if (cls.startsWith('via-') && colorMap[cls.substring(4)]) {
      styles['--tw-gradient-via'] = colorMap[cls.substring(4)];
      styles['--tw-gradient-stops'] = 'var(--tw-gradient-from), var(--tw-gradient-via), var(--tw-gradient-to)';
    }
    else if (cls.startsWith('to-') && colorMap[cls.substring(3)]) {
      styles['--tw-gradient-to'] = colorMap[cls.substring(3)];
    }
  }

  return styles;
}

/**
 * Convert all `class="..."` attributes in an HTML string to inline `style="..."`
 * attributes using the Tailwind-to-style mappings.
 *
 * Unrecognised classes are silently dropped (they produce no style output).
 */
export function convertTailwindHTML(html: string): string {
  return html.replace(/class="([^"]*)"/g, (_match, classes: string) => {
    const styles = tailwindToStyles(classes);
    const styleString = Object.entries(styles)
      .map(([key, value]) => {
        const kebabKey = key.replace(/([A-Z])/g, '-$1').toLowerCase();
        return `${kebabKey}: ${value}`;
      })
      .join('; ');

    return styleString ? `style="${styleString}"` : '';
  });
}
