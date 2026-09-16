import React from 'react';

// Hosted checkout pages can refuse framing. Keep Peakle open so the existing
// signed-webhook/realtime checks, rather than a return URL, confirm payment.
export function WebView({ source }) {
  const url = source?.uri;
  const secure = typeof url === 'string' && url.startsWith('https://');
  return <section style={{ flex: 1, padding: 28, display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', textAlign: 'center', color: '#0E2321', background: '#F3F5EF' }}>
    <h2>Continue to secure checkout</h2>
    <p style={{ maxWidth: 360, lineHeight: 1.6 }}>Complete payment in the new tab, then return here. Peakle will confirm the payment automatically.</p>
    {secure ? <a href={url} target="_blank" rel="noopener noreferrer" style={{ background: '#D6E94A', color: '#0E2321', padding: '16px 24px', borderRadius: 14, textDecoration: 'none', fontWeight: 700 }}>Open secure checkout</a> : <p role="alert">Checkout could not be opened. Close this screen and try again.</p>}
  </section>;
}
