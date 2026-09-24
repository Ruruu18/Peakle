import { Platform } from 'react-native';

// Explicit styling hooks keep browser layouts out of native stylesheets.
export const webLayout = (name) => Platform.OS === 'web' ? { dataSet: { desktopLayout: name } } : {};
export const webDialog = (kind) => Platform.OS === 'web' ? { dataSet: { webDialog: kind } } : {};
