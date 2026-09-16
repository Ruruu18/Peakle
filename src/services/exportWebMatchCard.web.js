export async function exportWebMatchCard(result, action) {
  const canvas = document.createElement('canvas');
  canvas.width = 1080;
  canvas.height = 1350;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Image export is unavailable in this browser.');
  ctx.fillStyle = '#0E2321';
  ctx.fillRect(0, 0, 1080, 1350);
  ctx.fillStyle = '#D6E94A';
  ctx.font = 'bold 48px sans-serif';
  ctx.fillText('PEAKLE', 80, 125);
  ctx.font = '24px sans-serif';
  ctx.fillText(`${result.matchType.toUpperCase()} · ${result.mode.toUpperCase()}`, 80, 190);
  ctx.fillStyle = '#FFFFFF';
  const fitText = (text, y, size = 42) => {
    while (size > 20) {
      ctx.font = `bold ${size}px sans-serif`;
      if (ctx.measureText(text).width <= 920) break;
      size -= 2;
    }
    ctx.fillText(text, 80, y, 920);
  };
  fitText(result.players[0].join(' + '), 350);
  ctx.fillStyle = '#9FB3AC';
  fitText('VS', 425, 26);
  ctx.fillStyle = '#FFFFFF';
  fitText(result.players[1].join(' + '), 500);
  const games = result.gameScores?.length ? result.gameScores : [result.scores];
  games.forEach((score, index) => {
    ctx.fillStyle = '#9FB3AC';
    ctx.font = '24px sans-serif';
    ctx.fillText(`GAME ${index + 1}`, 80, 645 + index * 105);
    ctx.fillStyle = '#D6E94A';
    ctx.font = 'bold 64px sans-serif';
    ctx.fillText(`${score[0]} – ${score[1]}`, 420, 660 + index * 105);
  });
  ctx.fillStyle = '#FFFFFF';
  fitText(result.winner == null ? 'Match recorded' : `${result.players[result.winner].join(' + ')} wins`, 1130, 36);
  ctx.fillStyle = '#9FB3AC';
  fitText(result.court?.name || 'Community match', 1200, 24);
  ctx.font = '24px sans-serif';
  ctx.fillText(new Date(result.endedAtTimestamp || Date.now()).toLocaleDateString(), 80, 1250);
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
