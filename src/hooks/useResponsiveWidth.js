import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';

// On web the app renders inside `.beta-shell`, a phone-width column
// (max-width: 560px) centered in the browser window. RN's useWindowDimensions
// still reports the full browser window width, which is much wider than the
// shell, so breakpoint checks like `width >= 840` fire incorrectly and blow up
// the layout. This measures the shell itself on web and falls back to the
// native window width everywhere else.
export default function useResponsiveWidth() {
  const { width: windowWidth } = useWindowDimensions();
  const [shellWidth, setShellWidth] = useState(windowWidth);

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const shell = document.querySelector('.beta-shell');
    if (!shell) return undefined;
    const update = () => setShellWidth(shell.getBoundingClientRect().width);
    update();
    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', update);
      return () => window.removeEventListener('resize', update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(shell);
    return () => observer.disconnect();
  }, [windowWidth]);

  return Platform.OS === 'web' ? shellWidth : windowWidth;
}
