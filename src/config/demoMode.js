// Set EXPO_PUBLIC_DEMO_MODE=1 to build the self-running investor/app-store
// demo: signs in as a fixed demo player, every screen reads canned data
// instead of Supabase, and the app drives itself through a short highlight
// reel automatically. Leave unset for a normal build.
export const DEMO_MODE = process.env.EXPO_PUBLIC_DEMO_MODE === '1';
