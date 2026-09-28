import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';
import { SCHEDULE_ACTIVITY_TYPES } from '../config/scheduleTypes';
import { dayKey, formatDayLabel, formatTime, getScheduledGamePreview, skillLevelLabel } from '../services/schedule';
import { recordPlayerEvent } from '../services/playerFunnel';

const C = { ink: '#0E2321', panel: '#14332F', line: '#2E4C46', optic: '#D6E94A', surface: '#FFFFFF', muted: '#B8C6C1', faint: '#8FA39C' };

export function sharedGameCode(pathname) {
  return String(pathname || '').match(/^\/games\/([a-z0-9]{10})\/?$/i)?.[1]?.toLowerCase() || null;
}

// What a signed-out visitor sees on a shared /games/<code> link: enough to
// decide (what, when, where, who is hosting, spots left) before creating an
// account. The link is kept, so after sign-up they land on this activity.
export default function SharedGamePreview({ code, onSignUp, onLogIn }) {
  const [preview, setPreview] = useState(undefined);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    recordPlayerEvent('invite_opened');
    let active = true;
    getScheduledGamePreview(code)
      .then((value) => { if (active) setPreview(value); })
      .catch(() => { if (active) { setFailed(true); setPreview(null); } });
    return () => { active = false; };
  }, [code]);

  const kind = SCHEDULE_ACTIVITY_TYPES[preview?.activityKind] || SCHEDULE_ACTIVITY_TYPES.game;
  const spotsLeft = preview ? Math.max(0, preview.capacity - preview.going) : 0;
  const closed = preview && preview.status !== 'scheduled';
  const format = preview?.activityKind === 'game'
    ? `${preview.matchType === 'singles' ? 'Singles' : 'Doubles'} · ${preview.mode === 'ranked' ? 'Ranked' : 'Casual'}`
    : kind?.name;

  return (
    <SafeAreaView style={styles.safe}>
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.brand}>Peakle</Text>
        {preview === undefined ? <View style={styles.loading}><ActivityIndicator color={C.optic} /><Text style={styles.muted}>Opening your invitation…</Text></View> : null}
        {preview === null ? <View style={styles.card}>
          <Text style={styles.eyebrow}>INVITATION</Text>
          <Text style={styles.title}>{failed ? 'This invitation could not load' : 'This invitation link isn’t valid'}</Text>
          <Text style={styles.muted}>{failed ? 'Check your connection and reload the page. You can also sign in and ask the host to send the link again.' : 'Ask the host to send the link again, or sign in to find other games near you.'}</Text>
        </View> : null}
        {preview ? <View style={styles.card}>
          <Text style={styles.eyebrow}>{preview.hostFirstName ? `${preview.hostFirstName.toUpperCase()} INVITED YOU` : 'YOU’RE INVITED'}</Text>
          <Text style={styles.title}>{preview.title}</Text>
          {closed ? <Text style={styles.closed}>{preview.status === 'cancelled' ? 'This activity was cancelled.' : 'This activity has already happened.'}</Text> : null}
          <View style={styles.facts}>
            <Fact icon="calendar-outline" text={`${formatDayLabel(dayKey(preview.startsAt), { weekday: 'long', month: 'long', day: 'numeric' })} · ${formatTime(preview.startsAt)} – ${formatTime(preview.endsAt)}`} />
            <Fact icon="location-outline" text={[preview.courtLabel, preview.courtArea].filter(Boolean).join(' · ')} />
            <Fact icon={kind?.icon || 'tennisball-outline'} text={format} />
            <Fact icon="stats-chart-outline" text={skillLevelLabel(preview.skillLevel)} />
            {preview.courtCost ? <Fact icon="cash-outline" text={`Court cost: ${preview.courtCost}`} /> : null}
            <Fact icon="people-outline" text={spotsLeft ? `${preview.going} going · ${spotsLeft} ${spotsLeft === 1 ? 'spot' : 'spots'} left` : `${preview.going} going · full, join the waitlist`} />
          </View>
        </View> : null}
        {preview !== undefined ? <>
          <Pressable accessibilityRole="button" onPress={onSignUp} style={({ pressed }) => [styles.primary, pressed && styles.pressed]}><Text style={styles.primaryText}>{preview && !closed ? 'Sign up to join' : 'Create a free account'}</Text><AppIcon name="arrow-forward" size={18} color={C.ink} /></Pressable>
          <Pressable accessibilityRole="button" onPress={onLogIn} style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}><Text style={styles.secondaryText}>I already have an account</Text></Pressable>
          {preview && !closed ? <Text style={styles.note}>It takes about a minute. You’ll come straight back here to confirm your spot. Nothing is booked until you say you’re going.</Text> : null}
        </> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

function Fact({ icon, text }) {
  if (!text) return null;
  return <View style={styles.fact}><AppIcon name={icon} size={17} color={C.optic} /><Text style={styles.factText}>{text}</Text></View>;
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.ink },
  content: { flexGrow: 1, width: '100%', maxWidth: 520, alignSelf: 'center', paddingHorizontal: 22, paddingTop: 28, paddingBottom: 32 },
  brand: { color: C.surface, fontSize: 22, fontWeight: '900', letterSpacing: -0.6, marginBottom: 28 },
  loading: { alignItems: 'center', gap: 12, paddingVertical: 60 },
  card: { padding: 20, borderRadius: 20, borderWidth: 1, borderColor: C.line, backgroundColor: C.panel, marginBottom: 22 },
  eyebrow: { color: C.optic, fontSize: 10, fontWeight: '900', letterSpacing: 1.3 },
  title: { marginTop: 8, color: C.surface, fontSize: 28, lineHeight: 33, fontWeight: '900', letterSpacing: -0.8 },
  closed: { marginTop: 10, color: '#FF9A80', fontSize: 13, fontWeight: '800' },
  facts: { marginTop: 18, gap: 12 },
  fact: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  factText: { flex: 1, color: C.surface, fontSize: 14, lineHeight: 20, fontWeight: '600' },
  muted: { marginTop: 10, color: C.muted, fontSize: 13, lineHeight: 19 },
  primary: { minHeight: 56, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.optic },
  primaryText: { color: C.ink, fontSize: 15, fontWeight: '900' },
  secondary: { minHeight: 48, marginTop: 8, alignItems: 'center', justifyContent: 'center' },
  secondaryText: { color: C.surface, fontSize: 13, fontWeight: '800' },
  note: { marginTop: 14, color: C.faint, fontSize: 12, lineHeight: 18, textAlign: 'center' },
  pressed: { opacity: 0.8 },
});
