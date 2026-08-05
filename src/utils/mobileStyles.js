import { StyleSheet } from 'react-native';

/**
 * Keep compact labels compact while preventing mock-up-sized text from making
 * real phone screens difficult to scan.
 */
function readableType(style) {
  if (!style || typeof style !== 'object' || typeof style.fontSize !== 'number') return style;

  const originalSize = style.fontSize;
  const fontSize = originalSize <= 6.5 ? 10 : originalSize <= 8.5 ? 11 : originalSize <= 11 ? 13 : originalSize;
  if (fontSize === originalSize) return style;

  const next = { ...style, fontSize };
  if (typeof style.lineHeight === 'number') next.lineHeight = Math.max(style.lineHeight, Math.ceil(fontSize * 1.4));
  return next;
}

/** Create a StyleSheet with phone-readable typography without changing layout tokens. */
export function createMobileStyleSheet(definitions) {
  return StyleSheet.create(Object.fromEntries(
    Object.entries(definitions).map(([name, style]) => [name, readableType(style)]),
  ));
}
