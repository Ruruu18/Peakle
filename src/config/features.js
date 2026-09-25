import { Platform } from 'react-native';

// The removable browser beta uses the same player identity and data as native.
// Feature boundaries affect this client only, never the shared database.
export const PRIVATE_MESSAGES_ENABLED = true;
export const NATIVE_VOICE_SCORING_ENABLED = Platform.OS !== 'web';

// Court booking is paused for the public beta: no court operators are onboarded
// yet, so players score matches at any court and organizers drive events. The
// booking screens, services and data stay intact; set EXPO_PUBLIC_COURT_BOOKING=1
// to restore them on every platform.
export const COURT_BOOKING_ENABLED = process.env.EXPO_PUBLIC_COURT_BOOKING === '1';

// The tab that owns event discovery: Explore while booking runs, Schedule otherwise.
export const DISCOVERY_TAB = COURT_BOOKING_ENABLED ? 'Book' : 'Schedule';
