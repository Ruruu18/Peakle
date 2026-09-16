import { useCallback, useEffect, useRef, useState } from 'react';
import { saveUnfinishedMatch } from '../services/database';

export default function useMatchDraft({ enabled, userId, match, state }) {
  const [status, setStatus] = useState(enabled ? 'saving' : null);
  const savedId = useRef(match.savedMatchId || null);
  const latest = useRef(null);
  const pending = useRef(Promise.resolve());
  const timer = useRef(null);
  const stopped = useRef(false);
  const mounted = useRef(true);
  const lastSaved = useRef('');
  const snapshot = JSON.stringify({ ...match, ...state, reason: 'unfinished' });

  const save = useCallback(() => {
    const draft = latest.current;
    if (!draft || !enabled || !userId || lastSaved.current === draft.snapshot) return pending.current;
    pending.current = pending.current.catch(() => null).then(async () => {
      if (lastSaved.current === draft.snapshot) return savedId.current;
      try {
        const saved = await saveUnfinishedMatch(userId, { ...draft.value, savedMatchId: savedId.current });
        savedId.current = saved.savedMatchId;
        if (saved.savedMatchId) lastSaved.current = draft.snapshot;
        if (mounted.current && latest.current === draft) setStatus(saved.savedMatchId ? 'saved' : 'local');
        return savedId.current;
      } catch {
        if (mounted.current && latest.current === draft) setStatus(draft.localSaved ? 'local' : 'failed');
        return savedId.current;
      }
    });
    return pending.current;
  }, [enabled, userId]);

  useEffect(() => {
    if (!enabled || !userId || stopped.current) return;
    const value = { ...JSON.parse(snapshot), draftSavedAt: Date.now(), savedMatchId: savedId.current };
    latest.current = { snapshot, value, localSaved: false };
    try {
      localStorage.setItem(`@peakle/unfinished-match/${userId}`, JSON.stringify(value));
      latest.current.localSaved = true;
    }
    catch { /* The server save remains available if browser storage is full. */ }
    setStatus('saving');
    clearTimeout(timer.current);
    timer.current = setTimeout(save, 600);
    return () => clearTimeout(timer.current);
  }, [enabled, save, snapshot, userId]);

  useEffect(() => {
    mounted.current = true;
    const reconnect = () => { if (!stopped.current) void save(); };
    const leave = (event) => {
      if (enabled && !stopped.current && latest.current?.snapshot !== lastSaved.current) {
        event.preventDefault();
        event.returnValue = '';
      }
    };
    window.addEventListener('online', reconnect);
    window.addEventListener('beforeunload', leave);
    return () => {
      mounted.current = false;
      clearTimeout(timer.current);
      window.removeEventListener('online', reconnect);
      window.removeEventListener('beforeunload', leave);
    };
  }, [enabled, save]);

  const settle = useCallback(async () => {
    stopped.current = true;
    clearTimeout(timer.current);
    await save();
    return savedId.current;
  }, [save]);
  return { status: status === 'saved' && lastSaved.current !== snapshot ? 'saving' : status, settle };
}
