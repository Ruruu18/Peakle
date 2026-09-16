"use client";

import { Clock3 } from "lucide-react";
import { type CSSProperties, useEffect, useId, useRef, useState } from "react";
import { pickleballSvg } from "../../../../shared/pickleball";
import type { OpenPlayMatch } from "@/lib/types";
import { ProfileAvatar } from "./portal-ui";
import "./monitor-court.css";

type Point = [number, number];
const project = (x: number, depth: number, height = 0): Point => {
  const distance = 1 - .24 * depth;
  return [240 + (x - .5) * 280 / distance + 44 * (depth - .5), (70 + 99 * depth - height) / distance];
};
const points = (vertices: Point[]) => vertices.map((point) => point.join(",")).join(" ");
const field = (left: number, top: number, right: number, bottom: number) => points([
  project(left, top), project(right, top), project(right, bottom), project(left, bottom),
]);

const ballArtwork = `url("data:image/svg+xml,${encodeURIComponent(pickleballSvg())}")`;

function CourtBall({ singles, active, serverSide, servingPosition }: { singles: boolean; active: boolean; serverSide: number; servingPosition: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let inView = true;
    const update = () => setVisible(inView && !document.hidden);
    const observer = new IntersectionObserver(([entry]) => { inView = entry.isIntersecting; update(); });
    if (ref.current) observer.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => { observer.disconnect(); document.removeEventListener("visibilitychange", update); };
  }, []);

  const route = singles
    ? [[.3, .58], [.7, .58], [.3, .58], [.7, .58]]
    : [[.3, .18], [.7, .89], [.3, .89], [.7, .18]];
  // Each new rally starts beside the current server, including second-server changes.
  const firstStop = singles ? serverSide : serverSide === 0 ? servingPosition * 2 : servingPosition === 0 ? 3 : 1;
  const stops = [...route.slice(firstStop), ...route.slice(0, firstStop)];
  const style: CSSProperties & Record<`--${string}`, string> = { "--ball-artwork": ballArtwork };
  stops.forEach(([x, depth], index) => {
    const [left, top] = project(x, depth);
    style[`--ball-x-${index}`] = `${left / 480 * 100}%`;
    style[`--ball-y-${index}`] = `${top / 250 * 100}%`;
  });

  return <div ref={ref} className="monitor-ball-layer" data-moving={active && visible} style={style} aria-hidden="true">
    <div className="monitor-ball-flight">
      <span className="monitor-ball-shadow" />
      <span className="monitor-ball-lift"><span className="monitor-ball-spin" /></span>
    </div>
  </div>;
}

function CourtArt() {
  const id = useId().replace(/:/g, "");
  const fill = (name: string) => `url(#${id}-${name})`;
  const front = [project(-.055, 1.035), project(1.055, 1.035)];
  const farPost = project(.5, -.055);
  const nearPost = project(.5, 1.055);
  const farTop = project(.5, -.055, 23);
  const nearTop = project(.5, 1.055, 23);
  const middleTop = project(.5, .5, 20);
  const net = `M ${farTop.join(" ")} Q ${middleTop.join(" ")} ${nearTop.join(" ")} L ${nearPost.join(" ")} L ${farPost.join(" ")} Z`;

  return <svg className="monitor-court-art" viewBox="0 0 480 250" preserveAspectRatio="none" aria-hidden="true" focusable="false">
    <defs>
      <linearGradient id={`${id}-light`} x2=".7" y2="1"><stop stopColor="#eff6cf" stopOpacity=".16" /><stop offset="1" stopColor="#04271e" stopOpacity=".2" /></linearGradient>
      <linearGradient id={`${id}-edge`} x2="0" y2="1"><stop stopColor="#458575" /><stop offset="1" stopColor="#123a2d" /></linearGradient>
      <linearGradient id={`${id}-post`}><stop stopColor="#708e7c" /><stop offset=".4" stopColor="#f0f3d6" /><stop offset="1" stopColor="#9ab09b" /></linearGradient>
      <radialGradient id={`${id}-shadow`}><stop stopColor="#03140f" stopOpacity=".65" /><stop offset="1" stopColor="#03140f" stopOpacity="0" /></radialGradient>
      <pattern id={`${id}-grain`} width="5" height="5" patternUnits="userSpaceOnUse"><circle cx="1" cy="1" r=".5" fill="#e7f4d8" opacity=".14" /></pattern>
      <pattern id={`${id}-mesh`} width="4" height="4" patternUnits="userSpaceOnUse"><path d="M0 0H4M0 0V4" stroke="#c7d9b9" strokeOpacity=".55" strokeWidth=".6" /></pattern>
    </defs>
    <ellipse cx="250" cy="229" rx="225" ry="20" fill={fill("shadow")} />
    <polygon points={points([...front, [front[1][0], front[1][1] + 8], [front[0][0], front[0][1] + 8]])} fill={fill("edge")} />
    <polygon points={field(-.055, -.045, 1.055, 1.035)} fill="#376e55" stroke="#8fb995" strokeOpacity=".4" strokeWidth="1" />
    <polygon points={field(0, 0, 1, 1)} fill="#23776c" />
    <polygon points={field(15 / 44, 0, 29 / 44, 1)} fill="#82a681" />
    <polygon points={field(-.055, -.045, 1.055, 1.035)} fill={fill("light")} />
    <polygon points={field(-.055, -.045, 1.055, 1.035)} fill={fill("grain")} />
    <g fill="none" stroke="#eaf2d7" strokeWidth="1.8" strokeLinejoin="round" opacity=".9">
      <polygon points={field(0, 0, 1, 1)} />
      {[15 / 44, 29 / 44].map((x) => <polyline key={x} points={points([project(x, 0), project(x, 1)])} />)}
      <polyline points={points([project(0, .5), project(15 / 44, .5)])} />
      <polyline points={points([project(29 / 44, .5), project(1, .5)])} />
    </g>
    <polygon points={points([farPost, nearPost, project(.55, 1.055), project(.55, -.055)])} fill="#0a3021" opacity=".26" />
    <path d={net} fill="#17372a" fillOpacity=".85" />
    <path d={net} fill={fill("mesh")} />
    <path d={`M ${farTop.join(" ")} Q ${middleTop.join(" ")} ${nearTop.join(" ")}`} fill="none" stroke="#f0f3d6" strokeWidth="3.2" />
    <polyline points={points([farPost, nearPost])} fill="none" stroke="#b2c5a6" strokeWidth="1" />
    {[[farPost, farTop], [nearPost, nearTop]].map(([base, top], index) => <g key={index}>
      <ellipse cx={base[0] + 2} cy={base[1] + 1} rx="7" ry="2.5" fill="#09291d" opacity=".5" />
      <rect x={base[0] - 2.5} y={top[1] - 3} width="5" height={base[1] - top[1] + 5} rx="1.8" fill={fill("post")} />
    </g>)}
  </svg>;
}

// On-court overlay announcing who scored, mirroring the player app's rally
// announcement (AnimatedOpenPlayCourt in PlayerOpenPlayScreen.js). Shared by
// the Open Play court board and the competition monitor's next-match panel.
export function PointAnnouncementOverlay({ announcement, onComplete }: { announcement: NonNullable<OpenPlayMatch["last_point"]>; onComplete?: () => void }) {
  return <div className="monitor-court-announcement" role="status" aria-live="assertive" onAnimationEnd={(event) => {
    if (event.target === event.currentTarget) onComplete?.();
  }}>
    <strong>{announcement.player}</strong>
    <span className="monitor-court-announcement-team">{announcement.team}</span>
    <small className="monitor-court-announcement-action">{announcement.action}</small>
    <b className="monitor-court-announcement-score">{announcement.score}</b>
    <span className="monitor-court-announcement-note">{announcement.note}</span>
  </div>;
}

export function MonitorCourt({ match, format, elapsed }: { match?: OpenPlayMatch; format?: string | null; elapsed?: string }) {
  const [completedAnnouncement, setCompletedAnnouncement] = useState<string | null>(null);
  const announcementKey = match?.last_point ? `${match.id}:${match.last_point.id}` : null;
  const announcing = announcementKey !== null && announcementKey !== completedAnnouncement;
  const perSide = format === "singles" ? 1 : 2;
  const serverSide = match?.server_side === 1 ? 1 : 0;
  const servingPosition = perSide === 2 && match?.serving_position === 1 ? 1 : 0;
  const rallyKey = `${match?.id}:${match?.last_point?.id || ""}:${match?.home_score || 0}:${match?.away_score || 0}:${serverSide}:${servingPosition}`;
  const lineup = [...(match?.open_play_match_players || [])].sort((a, b) => a.side - b.side || a.position - b.position);

  return <div className={`monitor-court-board${match ? " has-match" : " is-empty"}`}>
    {match ? <div className="monitor-court-scores" aria-label={`Home ${Number(match.home_score || 0)}, away ${Number(match.away_score || 0)}`}>
      <div><span className="monitor-team-dot" /><small>HOME</small><strong>{Number(match.home_score || 0)}</strong></div>
      <span className="monitor-court-clock">{elapsed ? <><Clock3 size={12} /><time aria-label="Match time">{elapsed}</time></> : "VS"}</span>
      <div><strong>{Number(match.away_score || 0)}</strong><small>AWAY</small><span className="monitor-team-dot away" /></div>
    </div> : <div className="monitor-court-available"><span><i />Court available</span><small>Waiting for the next match</small></div>}
    <div className="monitor-court-scene" role="group" aria-label={match ? `${format === "singles" ? "Singles" : "Doubles"} court lineup` : "Empty court"}>
      <CourtArt />
      {match && <CourtBall key={rallyKey} singles={perSide === 1} serverSide={serverSide} servingPosition={servingPosition} active={!announcing && (match.status === "playing" || match.status === "live")} />}
      {match && [0, 1].flatMap((side) => Array.from({ length: perSide }, (_, index) => {
        const player = lineup.filter((entry) => entry.side === side)[index];
        const name = player?.open_play_players?.profiles?.display_name || player?.open_play_players?.guest_name || "Awaiting player";
        const serving = Boolean(player) && side === serverSide && player.position === servingPosition;
        const [x, y] = project(side ? .79 : .21, perSide === 1 ? .58 : index ? .89 : .18);
        return <div key={`${side}-${index}`} className={`monitor-court-player side-${side}${serving ? " is-serving" : ""}`} style={{ left: `${x / 480 * 100}%`, top: `${y / 250 * 100}%` }} role="img" aria-label={`${side ? "Away" : "Home"}: ${name}${serving ? ", serving" : ""}`}>
          <ProfileAvatar name={name} photo={player?.open_play_players?.profiles?.avatar_url} />
          <span className="monitor-court-player-name" title={name}>{name}</span>
          <i />
        </div>;
      }))}
      {announcing && match?.last_point && <PointAnnouncementOverlay key={announcementKey} announcement={match.last_point} onComplete={() => setCompletedAnnouncement(announcementKey)} />}
    </div>
  </div>;
}
