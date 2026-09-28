import './silenceLibraryWarnings';
import { registerRootComponent } from 'expo';
import './services/notificationActions';
import { initErrorReporting, wrapRootComponent } from './services/errorReporting';
import App from '../App';

initErrorReporting();
registerRootComponent(wrapRootComponent(App));
