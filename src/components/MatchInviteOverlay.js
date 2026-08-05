import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import ProfilePhoto from './ProfilePhoto';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import { INVITE_WINDOW_MS } from '../services/nearbyPlayers';

function secondsRemaining(invite) {
  if (!invite?.created_at) return 0;
  return Math.max(0, Math.ceil((new Date(invite.created_at).getTime() + INVITE_WINDOW_MS - Date.now()) / 1000));
}

export default function MatchInviteOverlay({ onAccepted }) {
  const insets = useSafeAreaInsets();
  const { incomingInvites, respond } = useNearbyPlayersContext();
  const invite = incomingInvites[0] || null;
  const [remaining, setRemaining] = useState(() => secondsRemaining(invite));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setRemaining(secondsRemaining(invite));
    if (!invite) return undefined;
    const timer = setInterval(() => setRemaining(secondsRemaining(invite)), 1000);
    return () => clearInterval(timer);
  }, [invite?.id, invite?.created_at]);

  const senderName = invite?.sender?.display_name || 'A nearby player';
  const detail = useMemo(() => {
    const payload = invite?.match_payload || {};
    const format = payload.matchType === 'singles' ? 'Singles' : 'Doubles';
    const mode = payload.mode === 'ranked' ? 'Ranked' : 'Casual';
    return `${format} · ${mode}${payload.court?.name ? ` · ${payload.court.name}` : ''}`;
  }, [invite?.match_payload]);

  if (!invite || remaining <= 0) return null;

  const answer = async (accept) => {
    if (busy) return;
    setBusy(true);
    try {
      const succeeded = await respond(invite.id, accept);
      if (accept && succeeded) onAccepted?.(invite);
    }
    finally { setBusy(false); }
  };

  return (
    <View pointerEvents="box-none" style={styles.layer}>
      <View accessibilityRole="alert" style={[styles.card, { top: Math.max(insets.top, 12) + 8 }]}>
        <View style={styles.timerRail}><View style={[styles.timerFill, { width: `${Math.max(0, Math.min(100, remaining / 60 * 100))}%` }]} /></View>
        <View style={styles.heading}>
          <ProfilePhoto photo={invite.sender?.avatar_url} name={senderName} size={46} />
          <View style={styles.copy}>
            <Text style={styles.eyebrow}>MATCH INVITATION · {remaining}s</Text>
            <Text numberOfLines={1} style={styles.title}>{senderName} wants to play</Text>
            <Text numberOfLines={1} style={styles.detail}>{detail}</Text>
          </View>
          <View style={styles.liveDot} />
        </View>
        <View style={styles.actions}>
          <Pressable disabled={busy} accessibilityLabel={`Decline invitation from ${senderName}`} onPress={() => answer(false)} style={({ pressed }) => [styles.decline, pressed && styles.pressed]}>
            <Ionicons name="close" size={18} color="#B6472E" /><Text style={styles.declineText}>Decline</Text>
          </Pressable>
          <Pressable disabled={busy} accessibilityLabel={`Accept invitation from ${senderName}`} onPress={() => answer(true)} style={({ pressed }) => [styles.accept, pressed && styles.pressed]}>
            <Ionicons name={busy ? 'hourglass-outline' : 'checkmark'} size={18} color="#0E2321" /><Text style={styles.acceptText}>{busy ? 'Joining…' : 'Accept'}</Text>
          </Pressable>
        </View>
      </View>
    </View>
  );
}

const styles = createMobileStyleSheet({
  layer: { ...StyleSheet.absoluteFillObject, zIndex: 1000, elevation: 1000 },
  card: { position: 'absolute', left: 14, right: 14, overflow: 'hidden', padding: 14, borderWidth: 1, borderColor: '#304743', borderRadius: 22, backgroundColor: '#0E2321', shadowColor: '#07110F', shadowOpacity: .3, shadowRadius: 18, shadowOffset: { width: 0, height: 9 }, elevation: 18 },
  timerRail: { position: 'absolute', top: 0, left: 0, right: 0, height: 4, backgroundColor: '#304743' },
  timerFill: { height: 4, backgroundColor: '#D6E94A' },
  heading: { flexDirection: 'row', alignItems: 'center', gap: 11 },
  copy: { flex: 1 },
  eyebrow: { color: '#D6E94A', fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  title: { marginTop: 3, color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  detail: { marginTop: 3, color: '#9FB3AC', fontSize: 9, fontWeight: '700' },
  liveDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#D6E94A' },
  actions: { marginTop: 12, flexDirection: 'row', gap: 8 },
  decline: { minHeight: 42, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderWidth: 1, borderColor: '#4B625D', borderRadius: 12 },
  declineText: { color: '#F3F5EF', fontSize: 10, fontWeight: '900' },
  accept: { minHeight: 42, flex: 1.4, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, borderRadius: 12, backgroundColor: '#D6E94A' },
  acceptText: { color: '#0E2321', fontSize: 10, fontWeight: '900' },
  pressed: { opacity: .72 },
});
