import { Platform, useWindowDimensions } from 'react-native';

export const DESKTOP_BREAKPOINT = 1024;
export const DESKTOP_SIDEBAR_WIDTH = 224;
export const DESKTOP_CONTENT_WIDTH = 1040;

export default function useDesktopLayout() {
  const { width } = useWindowDimensions();
  return Platform.OS === 'web' && width >= DESKTOP_BREAKPOINT;
}
