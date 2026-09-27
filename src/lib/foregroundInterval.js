import { AppState, Platform } from 'react-native';

export function isAppInForeground() {
  if (Platform.OS === 'web') return typeof document === 'undefined' || document.visibilityState !== 'hidden';
  return AppState.currentState === 'active';
}

function onReturnToForeground(callback) {
  if (Platform.OS === 'web') {
    if (typeof document === 'undefined') return () => {};
    const listener = () => { if (document.visibilityState === 'visible') callback(); };
    document.addEventListener('visibilitychange', listener);
    return () => document.removeEventListener('visibilitychange', listener);
  }
  const subscription = AppState.addEventListener('change', (state) => { if (state === 'active') callback(); });
  return () => subscription.remove();
}

// setInterval for polling the server. Ticks are skipped while the app is in
// the background or the browser tab is hidden, which saves mobile data and
// battery, and one catch-up tick runs on return if any were skipped.
// Returns a function that stops it.
export function setForegroundInterval(callback, intervalMs) {
  let missed = false;
  const timer = setInterval(() => {
    if (isAppInForeground()) callback();
    else missed = true;
  }, intervalMs);
  const stopListening = onReturnToForeground(() => {
    if (!missed) return;
    missed = false;
    callback();
  });
  return () => {
    clearInterval(timer);
    stopListening();
  };
}
