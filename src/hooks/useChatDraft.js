import AsyncStorage from '@react-native-async-storage/async-storage';
import { useEffect, useRef, useState } from 'react';

const DRAFT_PREFIX = 'peakle:chat-draft:';

// An unsent chat message that survives a refresh or app restart, per chat.
// Include the signed-in player in the key so drafts never show on another
// account. A null key keeps plain state. paused skips saving, for example
// while the input holds a sent message being edited.
export function useChatDraft(key, { paused = false } = {}) {
  const [draft, setDraft] = useState('');
  // Saving waits until this chat's stored draft has loaded, so switching chats
  // never writes the previous chat's text under the new key.
  const loadedKeyRef = useRef(null);

  useEffect(() => {
    loadedKeyRef.current = null;
    setDraft('');
    if (!key) return undefined;
    let active = true;
    AsyncStorage.getItem(DRAFT_PREFIX + key)
      .catch(() => null)
      .then((saved) => {
        if (!active) return;
        loadedKeyRef.current = key;
        if (saved) setDraft((current) => current || saved);
      });
    return () => { active = false; };
  }, [key]);

  useEffect(() => {
    if (!key || paused || loadedKeyRef.current !== key) return;
    const storageKey = DRAFT_PREFIX + key;
    (draft.trim() ? AsyncStorage.setItem(storageKey, draft) : AsyncStorage.removeItem(storageKey)).catch(() => {});
  }, [draft, key, paused]);

  return [draft, setDraft];
}
