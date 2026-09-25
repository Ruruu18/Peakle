import Constants from 'expo-constants';

// Single source for the version players see. Bump "version" in app.json;
// clear RELEASE_STAGE when the beta ends.
export const APP_VERSION = Constants.expoConfig?.version || '1.0.0';
export const RELEASE_STAGE = 'Beta';
export const APP_VERSION_LABEL = `Peakle ${APP_VERSION}${RELEASE_STAGE ? ` · ${RELEASE_STAGE}` : ''}`;
