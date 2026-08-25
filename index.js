import { registerRootComponent } from 'expo';
import './src/services/notificationActions';
import { initErrorReporting, wrapRootComponent } from './src/services/errorReporting';
import App from './App';

initErrorReporting();

registerRootComponent(wrapRootComponent(App));
