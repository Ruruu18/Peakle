import { Platform } from 'react-native';

// The removable browser beta uses the same player identity and data as native.
// Feature boundaries affect this client only, never the shared database.
export const PRIVATE_MESSAGES_ENABLED = true;
// Spoken score commands use the device recognizer on iOS/Android and the Web
// Speech API in browsers that have it (Chrome, Edge, Safari; not Firefox).
export const VOICE_COMMAND_SCORING_ENABLED = Platform.OS !== 'web'
  || (typeof window !== 'undefined' && Boolean(window.SpeechRecognition || window.webkitSpeechRecognition));

// Court booking is paused for the public beta: no court operators are onboarded
// yet, so players score matches at any court and organizers drive events. The
// booking screens, services and data stay intact; set EXPO_PUBLIC_COURT_BOOKING=1
// to restore them on every platform.
export const COURT_BOOKING_ENABLED = process.env.EXPO_PUBLIC_COURT_BOOKING === '1';

// The tab that owns event discovery: Explore while booking runs, Schedule otherwise.
export const DISCOVERY_TAB = COURT_BOOKING_ENABLED ? 'Book' : 'Schedule';

// Organizer tools are not in this beta: players host open games themselves.
// Venue-run open play, competitions and programs stay hidden from discovery;
// set EXPO_PUBLIC_ORGANIZER_EVENTS=1 to list them again.
export const ORGANIZER_EVENTS_ENABLED = process.env.EXPO_PUBLIC_ORGANIZER_EVENTS === '1';

// The ratings hub hides its tab row in the beta. "Find a play" in Play still
// opens the hub's Find play list, and team challenges open from a team's page.
// Set EXPO_PUBLIC_HUB_TABS=1 to bring back the Ratings/Find play/Compete tabs.
export const HUB_TABS_ENABLED = process.env.EXPO_PUBLIC_HUB_TABS === '1';
