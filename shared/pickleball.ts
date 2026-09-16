// Shared vector artwork for native scoring, the player beta, and court monitors.
// Elliptical holes at the rim follow the sphere; inset rims expose the dark shell.
export function pickleballSvg(prefix = 'pickleball'): string {
  const holes = [
    [32, 17, 5, 3.1, -25], [53, 13, 5.3, 2.5, 4], [73, 23, 4.3, 3.4, 40],
    [17, 36, 3, 5.4, -15], [40, 36, 6.1, 5.7, -18], [65, 43, 6.1, 5.9, 20],
    [84, 48, 2.8, 5.6, 5], [25, 61, 4.6, 5.7, -24], [49, 64, 6.1, 5.7, 8],
    [72, 70, 4.7, 4.2, -35], [40, 84, 5, 2.5, 16], [61, 85, 4.8, 2.3, -18],
  ];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100" viewBox="0 0 100 100">
    <defs>
      <radialGradient id="${prefix}-shell" cx="30%" cy="23%" r="78%">
        <stop stop-color="#f7ffae"/><stop offset=".3" stop-color="#e3f459"/>
        <stop offset=".64" stop-color="#bedc2d"/><stop offset=".87" stop-color="#88ae16"/>
        <stop offset="1" stop-color="#4f7513"/>
      </radialGradient>
      <linearGradient id="${prefix}-hole" x1="0" y1="0" x2=".7" y2="1">
        <stop stop-color="#263f10"/><stop offset=".48" stop-color="#4c6c16"/>
        <stop offset="1" stop-color="#819d24"/>
      </linearGradient>
      <radialGradient id="${prefix}-shine" cx="32%" cy="20%" r="65%">
        <stop stop-color="#fff" stop-opacity=".5"/><stop offset=".55" stop-color="#fff" stop-opacity="0"/>
      </radialGradient>
    </defs>
    <circle cx="50" cy="50" r="47" fill="url(#${prefix}-shell)" stroke="#e5f58b" stroke-opacity=".6" stroke-width="1"/>
    <path d="M12 33C25 4 65-1 85 25" fill="none" stroke="#fbffc7" stroke-opacity=".6" stroke-width="1.2" stroke-linecap="round"/>
    <path d="M19 78C39 94 66 95 85 73" fill="none" stroke="#dcf75d" stroke-opacity=".23" stroke-width="1.5"/>
    ${holes.map(([x, y, rx, ry, rotation]) => `<g transform="rotate(${rotation} ${x} ${y})">
      <ellipse cx="${x}" cy="${y + .9}" rx="${rx + .9}" ry="${ry + 1}" fill="#eaff84" fill-opacity=".63"/>
      <ellipse cx="${x}" cy="${y}" rx="${rx}" ry="${ry}" fill="url(#${prefix}-hole)" stroke="#77941c" stroke-width=".75"/>
      <path d="M${x - rx * .72} ${y - ry * .45}Q${x} ${y - ry * 1.05} ${x + rx * .72} ${y - ry * .45}" fill="none" stroke="#304b12" stroke-opacity=".65" stroke-width=".9"/>
    </g>`).join('')}
    <circle cx="50" cy="50" r="46.5" fill="url(#${prefix}-shine)"/>
  </svg>`;
}
