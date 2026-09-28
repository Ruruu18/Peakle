const W = 1080;
const H = 1920;
const PAD = 78;
const INK = '#0E2321';
const OPTIC = '#D6E94A';
const TEAL = '#1C6B66';
const BRICK = '#B6472E';
const MUTED = '#8EA19B';
const SOFT = '#ABC0B9';
const LABEL = '#82968F';
const FONT = '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif';
const BALL_URL = '/images/ball.png';

function formatDuration(totalSeconds = 0) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function loadImage(src) {
  return new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => resolve(null);
    image.src = src;
  });
}

// Mirrors the native MatchStoryCard at 3x (360x640 -> 1080x1920).
export async function exportWebMatchCard(result, action) {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  if (document.fonts?.ready) await document.fonts.ready;

  const games = result.gameScores?.length ? result.gameScores : [result.scores];
  const multiGame = games.length > 1;
  const headline = multiGame ? result.games : games[0];
  const totalPoints = games.reduce((total, game) => total + game[0] + game[1], 0);
  const winnerName = result.winner == null ? null : result.players[result.winner].filter(Boolean).join(' & ');
  const playedAt = new Date(result.endedAtTimestamp || Date.now());
  const dateLabel = playedAt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const timeLabel = playedAt.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const formatLabel = `${result.matchType === 'singles' ? 'SINGLES' : 'DOUBLES'} · ${result.mode === 'ranked' ? 'RANKED' : 'CASUAL'}`;

  const font = (weight, size) => { ctx.font = `${weight} ${size}px ${FONT}`; };
  const spaced = (text, x, y, spacing, align = 'left') => {
    if ('letterSpacing' in ctx) {
      ctx.letterSpacing = `${spacing}px`;
      ctx.textAlign = align;
      ctx.fillText(text, x, y);
      ctx.letterSpacing = '0px';
      return;
    }
    ctx.textAlign = align;
    ctx.fillText(text, x, y);
  };
  const ellipsize = (text, maxWidth) => {
    if (ctx.measureText(text).width <= maxWidth) return text;
    let next = text;
    while (next.length > 1 && ctx.measureText(`${next}…`).width > maxWidth) next = next.slice(0, -1);
    return `${next.trimEnd()}…`;
  };
  const wrap = (text, maxWidth, maxLines) => {
    const words = text.split(/\s+/);
    const lines = [];
    let line = '';
    words.forEach((word) => {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) line = candidate;
      else { lines.push(line); line = word; }
    });
    if (line) lines.push(line);
    if (lines.length > maxLines) {
      const kept = lines.slice(0, maxLines);
      kept[maxLines - 1] = ellipsize(lines.slice(maxLines - 1).join(' '), maxWidth);
      return kept;
    }
    return lines;
  };

  // Background and glows.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, W, H);
  const glow = (x, y, radius, color) => {
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, color);
    gradient.addColorStop(1, 'rgba(14,35,33,0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  };
  glow(930, 120, 620, 'rgba(214,233,74,0.16)');
  glow(150, 1830, 700, 'rgba(28,107,102,0.55)');
  ctx.textBaseline = 'alphabetic';

  // Brand row.
  const ball = await loadImage(BALL_URL);
  const brandY = 102;
  if (ball) {
    const off = document.createElement('canvas');
    off.width = 66; off.height = 66;
    const octx = off.getContext('2d');
    octx.drawImage(ball, 0, 0, 66, 66);
    octx.globalCompositeOperation = 'source-in';
    octx.fillStyle = OPTIC;
    octx.fillRect(0, 0, 66, 66);
    ctx.drawImage(off, PAD, brandY - 33, 66, 66);
  } else {
    ctx.fillStyle = OPTIC;
    ctx.beginPath(); ctx.arc(PAD + 33, brandY, 33, 0, Math.PI * 2); ctx.fill();
  }
  ctx.fillStyle = '#FFFFFF';
  font(900, 39);
  spaced('PEAKLE', PAD + 90, brandY + 14, 9);

  font(900, 30);
  const pillTextWidth = ctx.measureText('FINAL').width + 4 * 4.5;
  const pillW = pillTextWidth + 33 * 2 + 36;
  const pillX = W - PAD - pillW;
  roundRect(ctx, pillX, brandY - 39, pillW, 78, 39);
  ctx.fillStyle = 'rgba(255,255,255,0.06)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.18)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = OPTIC;
  ctx.beginPath(); ctx.arc(pillX + 33 + 9, brandY, 9, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  spaced('FINAL', pillX + 33 + 36, brandY + 11, 4.5);

  // Hero.
  let y = 296;
  ctx.fillStyle = OPTIC;
  font(900, 33);
  spaced(formatLabel, PAD, y, 6);
  y += 103;
  ctx.fillStyle = SOFT;
  font(600, 54);
  ctx.textAlign = 'left';
  ctx.fillText(winnerName ? 'Victory for' : 'Match ends', PAD, y);
  let nameSize = 90;
  let nameLines;
  do {
    font(900, nameSize);
    nameLines = wrap(winnerName || 'Level', W - PAD * 2, 2);
    const fits = nameLines.every((line) => ctx.measureText(line).width <= W - PAD * 2);
    if (fits && (nameLines.length === 1 || nameSize <= 66)) break;
    nameSize -= 4;
  } while (nameSize > 54);
  ctx.fillStyle = '#FFFFFF';
  nameLines.forEach((line) => { y += nameSize * 1.2; ctx.fillText(line, PAD, y); });

  // Big score.
  y += 36 + 180;
  font(900, 180);
  const leftWidth = Math.max(174, ctx.measureText(String(headline[0])).width);
  ctx.fillStyle = result.winner === 0 ? OPTIC : MUTED;
  ctx.fillText(String(headline[0]), PAD, y);
  font(900, 27);
  const chipLabel = multiGame ? 'GAMES' : 'POINTS';
  const chipW = ctx.measureText(chipLabel).width + 27 * 0.15 * chipLabel.length + 60;
  const chipX = PAD + leftWidth + 42;
  roundRect(ctx, chipX, y - 90 - 36, chipW, 72, 24);
  ctx.fillStyle = 'rgba(255,255,255,0.08)'; ctx.fill();
  ctx.fillStyle = SOFT;
  spaced(chipLabel, chipX + 30, y - 90 + 10, 4.5);
  font(900, 180);
  ctx.fillStyle = result.winner === 1 ? OPTIC : MUTED;
  ctx.fillText(String(headline[1]), chipX + chipW + 42, y);

  // Bottom-up layout: footer, stats, scoreboard.
  const footerTop = H - 90 - 150;
  const statsH = 177;
  const statsTop = footerTop - 48 - statsH;
  const teamRows = [0, 1].map((team) => result.players[team].filter(Boolean));
  const rowHeights = teamRows.map((names) => Math.max(186, 60 + names.length * 57));
  const boardH = 96 + rowHeights[0] + rowHeights[1];
  const boardTop = statsTop - 42 - boardH;
  const boardX = PAD;
  const boardW = W - PAD * 2;
  const colW = 102;
  const scoresRight = boardX + boardW - 42;

  roundRect(ctx, boardX, boardTop, boardW, boardH, 54);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.13)'; ctx.lineWidth = 3; ctx.stroke();
  ctx.fillStyle = LABEL;
  font(900, 27);
  spaced('TEAM', boardX + 42, boardTop + 58, 3);
  games.forEach((_, index) => spaced(`G${index + 1}`, scoresRight - (games.length - index - 0.5) * colW, boardTop + 58, 3, 'center'));
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(boardX, boardTop + 96, boardW, 3);

  let rowTop = boardTop + 96;
  [0, 1].forEach((team) => {
    const rowH = rowHeights[team];
    const mid = rowTop + rowH / 2;
    if (team === 1) { ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.fillRect(boardX, rowTop, boardW, 3); }
    roundRect(ctx, boardX + 42, mid - 48, 96, 96, 30);
    ctx.fillStyle = team === 0 ? TEAL : BRICK; ctx.fill();
    ctx.fillStyle = '#FFFFFF';
    font(900, 33);
    ctx.textAlign = 'center';
    ctx.fillText(`T${team + 1}`, boardX + 90, mid + 12);

    const won = result.winner === team;
    const nameX = boardX + 42 + 96 + 33;
    const nameMax = scoresRight - games.length * colW - (won ? 126 : 18) - nameX;
    font(800, 42);
    ctx.textAlign = 'left';
    ctx.fillStyle = won ? '#FFFFFF' : '#C9D6D1';
    const names = teamRows[team];
    names.forEach((name, index) => {
      const lineY = mid - ((names.length - 1) * 57) / 2 + index * 57 + 15;
      ctx.fillText(ellipsize(name, nameMax), nameX, lineY);
    });
    if (won) {
      const tagRight = scoresRight - games.length * colW - 12;
      roundRect(ctx, tagRight - 96, mid - 24, 96, 48, 12);
      ctx.fillStyle = OPTIC; ctx.fill();
      ctx.fillStyle = INK;
      font(900, 24);
      spaced('WIN', tagRight - 48, mid + 9, 2.4, 'center');
    }
    games.forEach((game, index) => {
      const gameWon = game[team] > game[1 - team];
      ctx.fillStyle = gameWon ? '#FFFFFF' : MUTED;
      font(gameWon ? 900 : 800, 60);
      ctx.textAlign = 'center';
      ctx.fillText(String(game[team]), scoresRight - (games.length - index - 0.5) * colW, mid + 21);
    });
    rowTop += rowH;
  });

  roundRect(ctx, PAD, statsTop, W - PAD * 2, statsH, 48);
  ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.fill();
  const statW = (W - PAD * 2) / 3;
  ctx.fillStyle = 'rgba(255,255,255,0.1)';
  ctx.fillRect(PAD + statW, statsTop, 3, statsH);
  ctx.fillRect(PAD + statW * 2, statsTop, 3, statsH);
  [[formatDuration(result.elapsed), 'DURATION'], [String(totalPoints), 'POINTS'], [String(games.length), games.length === 1 ? 'GAME' : 'GAMES']].forEach(([value, label], index) => {
    const cx = PAD + statW * (index + 0.5);
    ctx.fillStyle = '#FFFFFF';
    font(900, 54);
    ctx.textAlign = 'center';
    ctx.fillText(value, cx, statsTop + 86);
    ctx.fillStyle = LABEL;
    font(900, 27);
    spaced(label, cx, statsTop + 132, 3.6, 'center');
  });

  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.fillRect(PAD, footerTop, W - PAD * 2, 3);
  ctx.fillStyle = OPTIC;
  ctx.beginPath(); ctx.arc(PAD + 15, footerTop + 76, 12, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = '#FFFFFF';
  font(800, 39);
  ctx.textAlign = 'left';
  ctx.fillText(ellipsize(result.court?.name || 'Community match', W - PAD * 2 - 48), PAD + 48, footerTop + 90);
  ctx.fillStyle = SOFT;
  font(700, 33);
  ctx.fillText(`${dateLabel} · ${timeLabel}`, PAD, footerTop + 145);

  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  if (!blob) throw new Error('The match image could not be created.');
  const file = new File([blob], 'peakle-match.png', { type: 'image/png' });
  if (action !== 'save' && navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ title: 'My Peakle match', files: [file] }); return; }
    catch (error) { if (error.name === 'AbortError') return; }
  }
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = file.name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
