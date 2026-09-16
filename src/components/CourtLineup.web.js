import React, { useId } from 'react';
import ResilientImage from './ResilientImage';
import { normalizeProfilePhoto } from '../services/profilePhotos';
import { useTheme } from '../context/ThemeContext';
import './CourtLineup.css';

const normalizedName = (name) => name?.trim().toLocaleLowerCase() || '';

// One perspective projection keeps the markings, net, and player feet on the same plane.
const project = (x, depth, elevation = 0) => {
  const distance = 1 - .3 * depth;
  return [240 + (x - .5) * 266 / distance, (74 + 122 * depth - elevation) / distance];
};
const polygon = (points) => points.map((point) => project(...point).join(',')).join(' ');
const field = (start, end) => polygon([[0, start], [1, start], [1, end], [0, end]]);

function CourtSurface({ color }) {
  const id = useId().replace(/:/g, '');
  const fill = (name) => `url(#${id}-${name})`;
  const farLeft = project(-.065, -.055);
  const farRight = project(1.065, -.055);
  const nearLeft = project(-.065, 1.055);
  const nearRight = project(1.065, 1.055);
  const netLeft = project(-.045, .5);
  const netRight = project(1.045, .5);
  const netTop = project(0, .5, 24)[1];
  const netBottom = netLeft[1];
  const netPath = `M ${netLeft[0]} ${netTop} Q 240 ${netTop + 7} ${netRight[0]} ${netTop} L ${netRight[0]} ${netBottom} Q 240 ${netBottom + 3} ${netLeft[0]} ${netBottom} Z`;
  const kitchenStart = 15 / 44;
  const kitchenEnd = 29 / 44;

  return (
    <svg className="lineup-court-art" viewBox="0 0 480 320" preserveAspectRatio="none" aria-hidden="true" focusable="false">
      <defs>
        <linearGradient id={`${id}-surface`} x1="0" y1="0" x2=".8" y2="1">
          <stop stopColor="#ffffff" stopOpacity=".14" />
          <stop offset=".45" stopColor="#ffffff" stopOpacity="0" />
          <stop offset="1" stopColor="#041d1a" stopOpacity=".23" />
        </linearGradient>
        <linearGradient id={`${id}-edge`} x2="0" y2="1">
          <stop stopColor="#377a6b" />
          <stop offset="1" stopColor="#102c28" />
        </linearGradient>
        <linearGradient id={`${id}-post`}>
          <stop stopColor="#91aaa1" />
          <stop offset=".4" stopColor="#f2f7ed" />
          <stop offset="1" stopColor="#728d83" />
        </linearGradient>
        <radialGradient id={`${id}-shadow`}>
          <stop stopColor="#020d0b" stopOpacity=".6" />
          <stop offset="1" stopColor="#020d0b" stopOpacity="0" />
        </radialGradient>
        <pattern id={`${id}-grain`} width="6" height="6" patternUnits="userSpaceOnUse">
          <circle cx="1" cy="1" r=".55" fill="#e7f4d8" opacity=".12" />
          <circle cx="4" cy="3" r=".45" fill="#062722" opacity=".16" />
        </pattern>
        <pattern id={`${id}-mesh`} width="5" height="5" patternUnits="userSpaceOnUse">
          <path d="M 0 0 H 5 M 0 0 V 5" fill="none" stroke="#b9cdc0" strokeOpacity=".5" strokeWidth=".7" />
        </pattern>
      </defs>

      <ellipse cx="244" cy="288" rx="232" ry="31" fill={fill('shadow')} />
      <polygon points={[farLeft, farRight, nearRight.map((v, i) => i ? v + 10 : v), nearLeft.map((v, i) => i ? v + 10 : v)].map((p) => p.join(',')).join(' ')} fill="#102f28" />
      <polygon points={[nearLeft, nearRight, [nearRight[0], nearRight[1] + 10], [nearLeft[0], nearLeft[1] + 10]].map((p) => p.join(',')).join(' ')} fill={fill('edge')} />
      <polygon points={[farLeft, farRight, nearRight, nearLeft].map((p) => p.join(',')).join(' ')} fill="#296455" stroke="#91bea0" strokeOpacity=".35" strokeWidth="1" strokeLinejoin="round" />
      <polygon points={field(0, 1)} fill={color || '#24766d'} />
      <polygon points={field(kitchenStart, kitchenEnd)} fill="#90b18a" fillOpacity=".63" />
      <polygon points={[farLeft, farRight, nearRight, nearLeft].map((p) => p.join(',')).join(' ')} fill={fill('surface')} />
      <polygon points={[farLeft, farRight, nearRight, nearLeft].map((p) => p.join(',')).join(' ')} fill={fill('grain')} />

      <g fill="none" stroke="#f0f5db" strokeWidth="2.1" strokeLinejoin="round" opacity=".9">
        <polygon points={field(0, 1)} />
        {[kitchenStart, kitchenEnd].map((depth) => <polyline key={depth} points={polygon([[0, depth], [1, depth]])} />)}
        <polyline points={polygon([[.5, 0], [.5, kitchenStart]])} />
        <polyline points={polygon([[.5, kitchenEnd], [.5, 1]])} />
      </g>

      <polygon points={polygon([[-.045, .5], [1.045, .5], [1.025, .57], [-.065, .57]])} fill="#071f19" opacity=".22" />
      <path d={netPath} fill="#102d27" fillOpacity=".8" />
      <path d={netPath} fill={fill('mesh')} />
      <path d={`M ${netLeft[0]} ${netTop} Q 240 ${netTop + 7} ${netRight[0]} ${netTop}`} fill="none" stroke="#f6f5dd" strokeWidth="3.8" />
      <path d={`M ${netLeft[0]} ${netBottom} Q 240 ${netBottom + 3} ${netRight[0]} ${netBottom}`} fill="none" stroke="#95ada0" strokeWidth="1.2" />
      {[netLeft, netRight].map(([x, y], index) => (
        <g key={index}>
          <ellipse cx={x} cy={y + 2} rx="9" ry="3" fill="#0a241d" opacity=".4" />
          <rect x={x - 3} y={netTop - 5} width="6" height={y - netTop + 7} rx="2" fill={fill('post')} />
          <ellipse cx={x} cy={netTop - 5} rx="3" ry="1.4" fill="#f5f5dc" />
        </g>
      ))}
    </svg>
  );
}

export default function CourtLineup({ players, matchType, court, onSwap, currentUserName, currentUserAvatar, registeredPlayers = [] }) {
  const { isDark } = useTheme();
  const visiblePlayers = matchType === 'singles' ? 1 : 2;
  const currentUserKey = normalizedName(currentUserName);
  const playerCount = players.reduce((count, team) => count + team.slice(0, visiblePlayers).filter((name) => name.trim()).length, 0);
  const avatarFor = (name) => {
    const key = normalizedName(name);
    if (!key) return null;
    if ((key === currentUserKey || key === 'you') && currentUserAvatar) return currentUserAvatar;
    return registeredPlayers.find((player) => normalizedName(player.name) === key)?.avatar || null;
  };

  return (
    <section className={`lineup-court${isDark ? ' lineup-court-dark' : ''}${visiblePlayers === 1 ? ' lineup-court-singles' : ''}`} aria-label={`${matchType === 'singles' ? 'Singles' : 'Doubles'} court lineup, ${playerCount} of ${visiblePlayers * 2} players`}>
      <div className="lineup-court-header">
        <div className="lineup-court-venue" title={court?.name || 'Pickle court'}>
          <svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 18s6-6.4 6-11a6 6 0 0 0-12 0c0 4.6 6 11 6 11Z" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="10" cy="7" r="2" fill="currentColor" /></svg>
          <span>{court?.name || 'Pickle court'}</span>
        </div>
        <span className="lineup-court-format">{matchType === 'singles' ? 'Singles' : 'Doubles'}</span>
      </div>
      <div className="lineup-court-scene">
        <CourtSurface color={court?.color} />
        {[0, 1].map((team) => (
          <div className="lineup-court-team" role="group" aria-label={`Team ${team + 1}`} key={team}>
            {players[team].slice(0, visiblePlayers).map((name, index) => {
              const occupied = Boolean(name.trim());
              const label = name.trim() || `Open spot ${index + 1}`;
              const position = visiblePlayers === 1 ? .5 : index ? .78 : .22;
              const depth = team ? (visiblePlayers === 1 ? .99 : .84) : .2;
              const [x, y] = project(position, depth);
              const initials = name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase();
              return (
                <div className={`lineup-court-player${occupied ? ' is-occupied' : ''}`} key={index} style={{ left: `${x / 480 * 100}%`, top: `${y / 320 * 100}%` }} role="img" aria-label={`Team ${team + 1}, ${label}`}>
                  <span className="lineup-court-player-shadow" aria-hidden="true" />
                  <div className="lineup-court-marker">
                    <ResilientImage uri={normalizeProfilePhoto(avatarFor(name))} fallback={occupied ? <span className="lineup-court-initials">{initials}</span> : <svg className="lineup-court-vacancy" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="8" r="3.5" /><path d="M5 20v-1a7 7 0 0 1 14 0v1Z" /></svg>} fallbackColor="#133d33" showLoadingIndicator={false} style={{ width: '100%', height: '100%', borderRadius: 50 }} />
                  </div>
                  <span className="lineup-court-name" title={label}>{label}</span>
                  <span className="lineup-court-pin" aria-hidden="true" />
                </div>
              );
            })}
          </div>
        ))}
        {onSwap && <button type="button" className="lineup-court-swap" aria-label="Swap teams on court" onClick={onSwap}>
          <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 19V5m-4 4 4-4 4 4m4-4v14m-4-4 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span>Swap</span>
        </button>}
      </div>
    </section>
  );
}
