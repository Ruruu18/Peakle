import { StyleSheet } from 'react-native';
import { createDarkStyleSheet } from '../ThemeContext';

describe('dark theme style conversion', () => {
  it('keeps live scoring method labels readable on the optic active state', () => {
    const lightStyles = StyleSheet.create({
      liveScoringMethodTextActive: { color: '#0E2321', fontWeight: '900' },
    });

    const darkStyles = createDarkStyleSheet(lightStyles);

    expect(StyleSheet.flatten(darkStyles.liveScoringMethodTextActive)).toMatchObject({
      color: '#0E2321',
      fontWeight: '900',
    });
  });
});
