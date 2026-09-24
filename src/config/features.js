import { Platform } from 'react-native';

// The removable browser beta uses the same player identity and data as native.
// Feature boundaries affect this client only, never the shared database.
export const PRIVATE_MESSAGES_ENABLED = true;
export const NATIVE_VOICE_SCORING_ENABLED = Platform.OS !== 'web';
