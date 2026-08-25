const SUPPORT_EMAIL = 'support@peakle.app';

type Section = { title: string; body: string; list?: string[]; action?: string };

const documents: Record<string, { title: string; eyebrow: string; lead: string; sections: Section[] }> = {
  privacy: {
    title: 'Privacy Policy',
    eyebrow: 'Your data & choices',
    lead: 'Effective August 20, 2026. This policy explains how Peakle accesses, collects, uses, shares, protects, retains, and deletes personal data under the Philippine Data Privacy Act of 2012 and other applicable law.',
    sections: [
      { title: '1. Data we collect', body: 'Peakle collects account information (name, email, authentication provider, profile image, and push token); player details (home area, rating, and play preferences); content and activity (bookings, payments, teams, messages, uploaded media, match scores, reports, blocks, and settings); and limited technical data (app version, device type, crash data, performance traces, and security events).' },
      { title: '2. Location information', body: 'With permission, Peakle uses approximate or precise foreground location to sort nearby courts, teams, and players and to turn coordinates into a general area label. Nearby Player visibility is optional, works while the app is active, and shows other players approximate distance—not exact coordinates. You may use manual area search and withdraw location permission in Android settings.' },
      { title: '3. Photos, video, microphone, and notifications', body: 'The system photo picker opens only when you choose media to upload. A match card is saved only when you choose Save. When you activate shouted-score recognition, the selected Android speech service processes microphone audio into text; Peakle does not intentionally store the raw recording. Push permission and a device token are used only for Peakle notifications.' },
      { title: '4. How data is used', body: 'Data is used to create and secure accounts; provide bookings, payments, teams, chat, scoring, profiles, matching, and notifications; prevent fraud and abuse; diagnose reliability problems; respond to requests; and meet legal obligations.' },
      { title: '5. Service providers and sharing', body: 'Peakle uses Supabase for authentication, database, storage, and server functions; Expo and Firebase for push delivery; Sentry for limited crash and performance diagnostics; Google for optional sign-in, speech recognition, and map services; and PayMongo plus the applicable venue for requested payments, bookings, memberships, and refunds. Data is shared with other players only through features you choose. Peakle does not sell personal data.' },
      { title: '6. Retention and deletion', body: 'Account, profile, private-message, team-chat, presence, push-token, and user-owned media records are removed when account deletion completes. Crash and performance diagnostics are retained for no longer than 90 days and support correspondence for up to 24 months. Payment, refund, fraud-prevention, dispute, and tax records may be retained only as required by applicable law or an active dispute, with account identity removed or minimized where possible.' },
      { title: '7. Security and international processing', body: 'Peakle uses organizational and technical safeguards, encrypted network connections, access controls, and row-level database security. Providers may process data outside the Philippines under their contractual and data-protection safeguards. No online service can guarantee absolute security.' },
      { title: '8. Your rights and controls', body: 'Subject to applicable law, you may request access, correction, deletion, restriction, objection, portability, or withdrawal of consent. Device permissions can be changed in Android settings. You can permanently delete your account from Peakle under Profile → Settings → Delete account.' },
      { title: '9. Contact', body: `Peakle is responsible for this policy. Send privacy questions or rights requests to ${SUPPORT_EMAIL}. You may also contact the Philippine National Privacy Commission.` },
    ],
  },
  'account-deletion': {
    title: 'Delete your account',
    eyebrow: 'Account control',
    lead: 'Peakle lets every user permanently delete their account and associated personal data.',
    sections: [
      { title: 'Delete inside the app', body: 'Open Peakle and sign in, then open Profile → Settings → Delete account. Type DELETE and confirm Delete permanently. The app signs you out when deletion completes.' },
      { title: 'If you cannot access the app', body: 'Email Peakle support from the address registered to your account with “Account deletion request” in the subject. Support may verify account ownership before completing the request.', action: `mailto:${SUPPORT_EMAIL}?subject=Account%20deletion%20request` },
      { title: 'What is deleted', body: '', list: ['Your authentication account and profile', 'Private messages and team-chat content associated with your account', 'Presence, matching, push-token, preference, report, and block records', 'User-owned profile and chat media'] },
      { title: 'Limited records that may remain', body: 'Payment, refund, fraud-prevention, dispute, and tax records may be retained only where required by law or an active dispute. Peakle removes or minimizes the deleted account identity wherever possible. Shared teams are transferred to another member when possible; a team with no other member is removed.' },
    ],
  },
  terms: {
    title: 'Terms of Service',
    eyebrow: 'Peakle legal',
    lead: 'Effective August 20, 2026. These terms govern access to and use of Peakle, including accounts, bookings, payments, teams, messages, scoring, and other player services.',
    sections: [
      { title: '1. Your account', body: 'Provide accurate information, protect your credentials, and promptly report unauthorized access. You are responsible for activity performed through your account unless you notify Peakle without unreasonable delay.' },
      { title: '2. Bookings, venues, and payments', body: 'Availability, prices, operating hours, venue rules, cancellation terms, and booking acceptance are controlled by the applicable venue. Review every booking and payment before confirming. Refund eligibility follows the policy shown for that booking.' },
      { title: '3. Fair use and community safety', body: 'Do not impersonate others, submit fraudulent information, harass users, violate privacy, interfere with security, or use Peakle unlawfully. Chat is limited to users who confirm they are at least 18 and is subject to reporting, blocking, filtering, and proportionate moderation.' },
      { title: '4. Your content', body: 'You retain ownership of content you submit and grant Peakle a limited license to host, process, display, and share it only as required to provide the features you select. You are responsible for ensuring content is lawful and respects others’ rights.' },
      { title: '5. Availability, termination, and responsibility', body: 'Peakle is provided on an as-available basis. Sports activities involve physical risks. Peakle may restrict access to protect users, venues, the service, or the public. You may stop using Peakle and permanently delete your account at any time.' },
      { title: '6. Governing law and contact', body: `These terms are governed by the laws of the Republic of the Philippines without limiting mandatory consumer protections. Questions may be sent to ${SUPPORT_EMAIL}.` },
    ],
  },
};

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]!));
}

function renderPage(key: string, baseUrl: string) {
  const document = documents[key];
  const sections = document.sections.map((section) => `<section><h2>${escapeHtml(section.title)}</h2>${section.body ? `<p>${escapeHtml(section.body)}</p>` : ''}${section.list ? `<ul>${section.list.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : ''}${section.action ? `<a class="action" href="${escapeHtml(section.action)}">Email ${SUPPORT_EMAIL}</a>` : ''}</section>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(document.title)} · Peakle</title><meta name="description" content="Official Peakle ${escapeHtml(document.title)}"><style>
  :root{color-scheme:light}*{box-sizing:border-box}body{margin:0;background:#f3f5ef;color:#0e2321;font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;line-height:1.65}.shell{width:min(860px,calc(100% - 32px));margin:auto;padding:32px 0 64px}.brand{display:inline-flex;align-items:center;gap:10px;color:#0e2321;text-decoration:none;font-size:20px;font-weight:900}.mark{width:24px;height:24px;border-radius:50%;background:#d6e94a;border:2px solid #0e2321}.hero{margin:32px 0 20px;padding:clamp(26px,6vw,58px);border-radius:28px;background:#0e2321;color:#f3f5ef}.eyebrow{text-transform:uppercase;letter-spacing:.16em;color:#d6e94a;font-size:12px;font-weight:900}.hero h1{margin:.25em 0;font-size:clamp(36px,8vw,62px);line-height:1}.lead{max-width:700px;color:#dce5df;font-size:17px}section{margin:14px 0;padding:24px;border:1px solid #dce3da;border-radius:20px;background:#fff}h2{margin:0 0 8px;font-size:19px}p,ul{margin:0;color:#53635d}li+li{margin-top:7px}.action{display:inline-block;margin-top:16px;padding:11px 16px;border-radius:12px;background:#1c6b66;color:white;text-decoration:none;font-weight:800}.links{display:flex;flex-wrap:wrap;gap:14px;margin-top:24px}.links a{color:#1c6b66;font-weight:800}.footer{margin-top:28px;color:#66756f;font-size:13px}@media(max-width:520px){.shell{width:min(100% - 22px,860px)}section{padding:19px}.hero{border-radius:22px}}
  </style></head><body><main class="shell"><a class="brand" href="${baseUrl}/privacy"><span class="mark"></span>Peakle</a><header class="hero"><div class="eyebrow">${escapeHtml(document.eyebrow)}</div><h1>${escapeHtml(document.title)}</h1><p class="lead">${escapeHtml(document.lead)}</p></header>${sections}<nav class="links" aria-label="Legal pages"><a href="${baseUrl}/privacy">Privacy Policy</a><a href="${baseUrl}/account-deletion">Account deletion</a><a href="${baseUrl}/terms">Terms of Service</a></nav><p class="footer">Peakle · Philippines · Official public policy for the Peakle mobile application.</p></main></body></html>`;
}

Deno.serve((request) => {
  const url = new URL(request.url);
  const baseUrl = `${url.origin}/functions/v1/legal`;
  const key = url.pathname.split('/').filter(Boolean).at(-1) || 'privacy';
  if (key === 'legal') return Response.redirect(`${baseUrl}/privacy`, 302);
  if (!documents[key]) return new Response('Not found', { status: 404 });
  return new Response(renderPage(key, baseUrl), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300, s-maxage=3600',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
    },
  });
});
