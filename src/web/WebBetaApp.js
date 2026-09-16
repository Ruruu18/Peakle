import React, { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Ionicons from '@expo/vector-icons/Ionicons';
import App from '../../App';
import { closeWebAlert, getAlert, subscribeAlerts } from './alerts';

function WebAlert() {
  const alert = useSyncExternalStore(subscribeAlerts, getAlert, () => null);
  const dialog = useRef(null);
  useEffect(() => {
    if (alert && dialog.current && !dialog.current.open) dialog.current.showModal();
  }, [alert]);
  if (!alert) return null;
  const dismiss = (event) => {
    event.preventDefault();
    const cancel = alert.buttons.findIndex((button) => button.style === 'cancel');
    if (cancel !== -1) closeWebAlert(alert.id, cancel);
    else if (alert.options?.cancelable) closeWebAlert(alert.id);
  };
  return <dialog key={alert.id} ref={dialog} className="beta-dialog" aria-labelledby="beta-dialog-title" aria-describedby="beta-dialog-message" onCancel={dismiss}>
    <h2 id="beta-dialog-title">{alert.title}</h2>
    {alert.message ? <p id="beta-dialog-message">{alert.message}</p> : null}
    <div className="beta-dialog-actions">{alert.buttons.map((button, index) => <button key={index} type="button" className={button.style || 'default'} onClick={() => closeWebAlert(alert.id, index)}>{button.text || 'OK'}</button>)}</div>
  </dialog>;
}

export default function WebBetaApp() {
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return <div className="beta-shell">
    <header className={`beta-banner${online ? '' : ' beta-banner-offline'}`}>
      <span className="beta-label">PEAKLE BETA</span>
      {online ? (
        <span className="beta-store-row" role="note">
          <Ionicons name="logo-apple" size={13} color="#f3f5ef" />
          <Ionicons name="logo-android" size={13} color="#f3f5ef" />
          Coming soon
        </span>
      ) : (
        <span role="status">Offline · reconnect to sync your scores</span>
      )}
    </header>
    <main className="beta-app" aria-label="Peakle player app"><App /></main>
    <WebAlert />
  </div>;
}
