import '@expo/metro-runtime';
import { registerRootComponent } from 'expo';
import { Alert } from 'react-native';
import { showWebAlert } from './web/alerts';
import WebBetaApp from './web/WebBetaApp';
import { initErrorReporting, wrapRootComponent } from './services/errorReporting';
import './web/beta.css';

// React Native Web's Alert is a no-op. Preserve the existing app's confirmation
// callbacks (finish match, undo, sign out, etc.) with an accessible web dialog.
Alert.alert = showWebAlert;

// Expo's web template only emits the deprecated Apple-only meta tag. Add the
// standard one too so Chrome/Android stop warning and installed-PWA display
// mode is respected on both platforms; keep the Apple tag for Safari.
if (typeof document !== 'undefined' && !document.querySelector('meta[name="mobile-web-app-capable"]')) {
  const meta = document.createElement('meta');
  meta.name = 'mobile-web-app-capable';
  meta.content = 'yes';
  document.head.appendChild(meta);
}
initErrorReporting();
registerRootComponent(wrapRootComponent(WebBetaApp));
