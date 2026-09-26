import { Platform } from 'react-native';

function withAlpha(color, opacity) {
  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(color);
  if (hex) {
    const digits = hex[1].length === 3 ? hex[1].replace(/./g, '$&$&') : hex[1];
    const [r, g, b] = [0, 2, 4].map((index) => parseInt(digits.slice(index, index + 2), 16));
    return `rgba(${r},${g},${b},${opacity})`;
  }
  const rgb = /^rgba?\(([^,]+),([^,]+),([^,)]+)/.exec(color.replace(/\s/g, ''));
  return rgb ? `rgba(${rgb[1]},${rgb[2]},${rgb[3]},${opacity})` : color;
}

/**
 * Drop shadow that uses `boxShadow` on web (react-native-web deprecates the
 * shadow* props) and the native shadow props everywhere else.
 */
export function dropShadow({ color = '#000000', opacity = 1, radius = 0, x = 0, y = 0 }) {
  if (Platform.OS === 'web') return { boxShadow: `${x}px ${y}px ${radius}px ${withAlpha(color, opacity)}` };
  return { shadowColor: color, shadowOpacity: opacity, shadowRadius: radius, shadowOffset: { width: x, height: y } };
}

/** Removes a shadow inherited from another style. */
export const noShadow = Platform.OS === 'web' ? { boxShadow: 'none' } : { shadowOpacity: 0 };
