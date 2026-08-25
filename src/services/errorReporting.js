import * as Sentry from '@sentry/react-native';

const dsn = process.env.EXPO_PUBLIC_SENTRY_DSN;

export function initErrorReporting() {
  if (!dsn) return;
  Sentry.init({
    dsn,
    tracesSampleRate: 0.2,
    enableAutoSessionTracking: true,
    sendDefaultPii: false,
    environment: __DEV__ ? 'development' : 'production',
  });
}

export function captureError(error, context) {
  if (!dsn) {
    console.error(error, context);
    return;
  }
  Sentry.captureException(error, context ? { extra: context } : undefined);
}

export function wrapRootComponent(component) {
  return dsn ? Sentry.wrap(component) : component;
}
