import { useEffect, useState } from 'react';
import { Platform, useWindowDimensions } from 'react-native';
import { DESKTOP_BREAKPOINT, DESKTOP_CONTENT_WIDTH, DESKTOP_SIDEBAR_WIDTH } from './useDesktopLayout';

// Screens measure their available content width, excluding the desktop sidebar.
// The viewport breakpoint itself lives in useDesktopLayout.
export default function useResponsiveWidth() {
  const { width: windowWidth } = useWindowDimensions();
  const contentWidth = (width) => width >= DESKTOP_BREAKPOINT
    ? Math.min(DESKTOP_CONTENT_WIDTH, width - DESKTOP_SIDEBAR_WIDTH)
    : Math.min(560, width);
  const [shellWidth, setShellWidth] = useState(() => contentWidth(windowWidth));

  useEffect(() => {
    if (Platform.OS !== 'web' || typeof document === 'undefined') return undefined;
    const shell = document.querySelector('.beta-shell');
    if (!shell) return undefined;
    const update = () => setShellWidth(contentWidth(shell.getBoundingClientRect().width));
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
