import { useEffect, useRef } from 'react';
import { DEMO_MODE } from '../config/demoMode';
import { DEMO_TEAM_ID, DEMO_CONVERSATION_ID } from '../config/demoData';

// Journey order, not a feature checklist: plan a session, get matched, play
// it, see the result, then talk about it — then loop back to Home.
const TOUR = [
  { name: 'Home', dwellMs: 5000 },
  { name: 'Book', dwellMs: 15000 },
  { name: 'Play', params: () => ({ nearbyPlayersToken: Date.now() }), dwellMs: 7000 },
  { name: 'Play', params: () => ({ demoLiveToken: Date.now() }), dwellMs: 14000 },
  { name: 'Leaderboard', dwellMs: 9000 },
  { name: 'Team', params: () => ({ openChatToken: Date.now(), openChatTeamId: DEMO_TEAM_ID }), dwellMs: 9000 },
  { name: 'DirectChat', params: () => ({ conversationId: DEMO_CONVERSATION_ID, ownerTab: 'Team' }), dwellMs: 9000 },
];

export default function DemoAutopilot({ navigationRef }) {
  const stepRef = useRef(0);

  useEffect(() => {
    if (!DEMO_MODE) return undefined;
    let cancelled = false;
    let timer = null;

    const goToStep = () => {
      if (cancelled) return;
      if (!navigationRef.isReady()) {
        timer = setTimeout(goToStep, 300);
        return;
      }
      const step = TOUR[stepRef.current % TOUR.length];
      navigationRef.navigate(step.name, step.params?.());
      stepRef.current += 1;
      timer = setTimeout(goToStep, step.dwellMs);
    };

    timer = setTimeout(goToStep, 800);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [navigationRef]);

  return null;
}
