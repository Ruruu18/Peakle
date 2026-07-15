import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import OpenPlayScreen from './OpenPlayScreen';
import { useOpenPlaySession } from '../context/OpenPlaySessionContext';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
let C = LIGHT_C;
function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }
function KitchenLine() { return <View style={styles.kitchen}><View style={styles.solid} /><View style={styles.dashed} /></View>; }
function Header({ eyebrow, title }) { return <><View style={styles.header}><View><Text style={styles.eyebrow}>{eyebrow}</Text><Text style={styles.h1}>{title}</Text></View><View style={styles.modePill}><Icon name="key-outline" size={14} color={C.teal} /><Text style={styles.modeText}>ORGANIZER</Text></View></View><KitchenLine /></>; }
function useOrganizerTheme() { const { isDark } = useTheme(); C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C; styles = isDark ? darkStyles : lightStyles; return isDark; }
function Shell({ children, eyebrow, title }) { const { isDark } = useTheme(); return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}><Header eyebrow={eyebrow} title={title} />{children}</ScrollView></SafeAreaView>; }

function SessionCard({ session, onPress }) {
  const playing = session?.courts.filter((court) => court.match).length || 0;
  if (!session) return <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="calendar-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active open play</Text><Text style={styles.emptyMeta}>Create a session to start checking in players and assigning courts.</Text></View>;
  return <Pressable onPress={onPress} style={({ pressed }) => [styles.sessionCard, pressed && styles.pressed]}><View style={styles.sessionHead}><View><Text style={styles.liveLabel}>● LIVE SESSION</Text><Text style={styles.sessionTitle}>Today’s open play</Text></View><Icon name="chevron-forward" color={C.teal} /></View><View style={styles.stats}><View style={styles.stat}><Text style={styles.statValue}>{session.courts.length}</Text><Text style={styles.statLabel}>COURTS</Text></View><View style={styles.stat}><Text style={styles.statValue}>{playing}</Text><Text style={styles.statLabel}>IN PLAY</Text></View><View style={styles.stat}><Text style={styles.statValue}>{session.queue.length}</Text><Text style={styles.statLabel}>WAITING</Text></View><View style={styles.stat}><Text style={styles.statValue}>{session.completedMatches.length}</Text><Text style={styles.statLabel}>FINISHED</Text></View></View></Pressable>;
}

export function OrganizerOverviewScreen({ navigation }) {
  useOrganizerTheme();
  const { session } = useOpenPlaySession();
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Overview">
    <View style={styles.hero}><View style={styles.heroIcon}><Icon name="grid-outline" size={25} color="#0E2321" /></View><View style={styles.flex}><Text style={styles.heroTitle}>Courts without the clipboard.</Text><Text style={styles.heroMeta}>Run registration, rotations, scorers, and live court monitoring from one workspace.</Text></View></View>
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>TODAY</Text><Text style={styles.h2}>{session ? 'Active session' : 'Your sessions'}</Text></View>{session && <View style={styles.livePill}><View style={styles.liveDot} /><Text style={styles.liveText}>LIVE</Text></View>}</View>
    <SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />
    <Pressable onPress={() => navigation.navigate('Monitor')} style={styles.primaryButton}><Text style={styles.primaryText}>{session ? 'Open court monitor' : 'Create open play'}</Text><Icon name="arrow-forward" color="#0E2321" /></Pressable>
    <View style={styles.quickGrid}><Pressable onPress={() => navigation.navigate('Sessions')} style={styles.quickCard}><Icon name="calendar-outline" color={C.teal} /><Text style={styles.quickTitle}>Sessions</Text><Text style={styles.quickMeta}>Create or resume open play.</Text></Pressable><Pressable onPress={() => navigation.navigate('Players')} style={styles.quickCard}><Icon name="people-outline" color={C.teal} /><Text style={styles.quickTitle}>Players</Text><Text style={styles.quickMeta}>See attendance and queue status.</Text></Pressable></View>
  </Shell>;
}

export function OrganizerSessionsScreen({ navigation }) {
  useOrganizerTheme();
  const { session, resetSession } = useOpenPlaySession();
  const startNew = () => { resetSession(); navigation.navigate('Monitor'); };
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Sessions">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>OPEN PLAY</Text><Text style={styles.h2}>Session control</Text></View></View>
    <SessionCard session={session} onPress={() => navigation.navigate('Monitor')} />
    {session ? <Pressable onPress={() => navigation.navigate('Monitor')} style={styles.primaryButton}><Text style={styles.primaryText}>Resume session</Text><Icon name="play" color="#0E2321" /></Pressable> : <Pressable onPress={startNew} style={styles.primaryButton}><Text style={styles.primaryText}>Set up open play</Text><Icon name="add" color="#0E2321" /></Pressable>}
    <Text style={styles.sectionLabel}>HOW IT WORKS</Text><View style={styles.stepsCard}>{[['1', 'Check in players'], ['2', 'Assign the next four'], ['3', 'Monitor every court']].map(([number, label], index) => <View key={number} style={[styles.step, index > 0 && styles.rowBorder]}><View style={styles.stepNumber}><Text style={styles.stepNumberText}>{number}</Text></View><Text style={styles.stepText}>{label}</Text><Icon name="checkmark-circle-outline" color={C.teal} /></View>)}</View>
  </Shell>;
}

export function OrganizerPlayersScreen() {
  useOrganizerTheme();
  const { session } = useOpenPlaySession();
  const players = session?.players || [];
  const statusLabel = (status) => status === 'playing' ? 'ON COURT' : status === 'done' ? 'DONE' : 'WAITING';
  return <Shell eyebrow="ORGANIZER WORKSPACE" title="Players">
    <View style={styles.sectionHead}><View><Text style={styles.eyebrow}>CURRENT SESSION</Text><Text style={styles.h2}>{players.length ? `${players.length} registered` : 'Registration'}</Text></View></View>
    {!players.length ? <View style={styles.emptyCard}><View style={styles.emptyIcon}><Icon name="people-outline" color={C.teal} /></View><Text style={styles.emptyTitle}>No active registration</Text><Text style={styles.emptyMeta}>Players appear here after an open play session is created.</Text></View> : <View style={styles.playersCard}>{players.map((player, index) => <View key={player.id} style={[styles.playerRow, index > 0 && styles.rowBorder]}><View style={styles.avatar}><Text style={styles.avatarText}>{player.name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2)}</Text></View><View style={styles.flex}><Text style={styles.playerName}>{player.name}</Text><Text style={styles.playerMeta}>{player.gamesPlayed} {player.gamesPlayed === 1 ? 'game' : 'games'} played</Text></View><View style={[styles.status, player.status === 'playing' && styles.statusPlaying, player.status === 'done' && styles.statusDone]}><Text style={[styles.statusText, player.status === 'playing' && styles.statusTextPlaying, player.status === 'done' && styles.statusTextDone]}>{statusLabel(player.status)}</Text></View></View>)}</View>}
  </Shell>;
}

export function OrganizerMonitorScreen({ navigation }) {
  const isDark = useOrganizerTheme();
  return <SafeAreaView style={styles.safe}><StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} /><OpenPlayScreen onExit={() => navigation.navigate('Sessions')} /></SafeAreaView>;
}

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: C.paper }, content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 44 }, flex: { flex: 1 }, pressed: { opacity: .78, transform: [{ scale: .99 }] }, header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, eyebrow: { color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 1 }, h1: { color: C.ink, fontSize: 29, lineHeight: 35, fontWeight: '900' }, h2: { marginTop: 2, color: C.ink, fontSize: 21, fontWeight: '900' }, kitchen: { height: 7, marginTop: 16, marginBottom: 20 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, modePill: { minHeight: 32, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 16, backgroundColor: '#E5F0ED' }, modeText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  hero: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.optic }, heroIcon: { width: 49, height: 49, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.48)' }, heroTitle: { color: C.ink, fontSize: 14, fontWeight: '900' }, heroMeta: { marginTop: 4, color: C.ink70, fontSize: 9, lineHeight: 14 }, sectionHead: { marginTop: 24, marginBottom: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, livePill: { minHeight: 27, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' }, liveDot: { width: 7, height: 7, borderRadius: 4, backgroundColor: C.optic }, liveText: { color: C.teal, fontSize: 7, fontWeight: '900' },
  emptyCard: { minHeight: 170, padding: 18, alignItems: 'center', justifyContent: 'center', borderRadius: 19, borderWidth: 1, borderStyle: 'dashed', borderColor: C.teal, backgroundColor: C.surface }, emptyIcon: { width: 48, height: 48, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: '#E5F0ED' }, emptyTitle: { marginTop: 10, color: C.ink, fontSize: 13, fontWeight: '900' }, emptyMeta: { maxWidth: 255, marginTop: 4, color: C.ink40, textAlign: 'center', fontSize: 9, lineHeight: 14 }, sessionCard: { padding: 15, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, sessionHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, liveLabel: { color: C.teal, fontSize: 7, fontWeight: '900', letterSpacing: .6 }, sessionTitle: { marginTop: 3, color: C.ink, fontSize: 14, fontWeight: '900' }, stats: { marginTop: 14, paddingTop: 12, flexDirection: 'row', borderTopWidth: 1, borderColor: C.line }, stat: { flex: 1, alignItems: 'center' }, statValue: { color: C.ink, fontSize: 20, fontWeight: '900' }, statLabel: { marginTop: 2, color: C.ink40, fontSize: 6, fontWeight: '900' },
  primaryButton: { minHeight: 56, marginTop: 13, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 15, backgroundColor: C.optic }, primaryText: { color: C.ink, fontSize: 11, fontWeight: '900' }, secondaryButton: { minHeight: 48, marginTop: 9, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 13, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, secondaryText: { color: C.teal, fontSize: 9, fontWeight: '900' }, quickGrid: { marginTop: 12, flexDirection: 'row', gap: 9 }, quickCard: { flex: 1, minHeight: 115, padding: 13, borderRadius: 16, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, quickTitle: { marginTop: 10, color: C.ink, fontSize: 11, fontWeight: '900' }, quickMeta: { marginTop: 4, color: C.ink40, fontSize: 8, lineHeight: 12 }, sectionLabel: { marginTop: 23, marginBottom: 9, color: C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: .8 }, stepsCard: { paddingHorizontal: 13, borderRadius: 17, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, step: { minHeight: 59, flexDirection: 'row', alignItems: 'center', gap: 10 }, stepNumber: { width: 31, height: 31, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, stepNumberText: { color: C.ink, fontSize: 10, fontWeight: '900' }, stepText: { flex: 1, color: C.ink, fontSize: 10, fontWeight: '800' }, rowBorder: { borderTopWidth: 1, borderColor: C.line },
  playersCard: { paddingHorizontal: 12, borderRadius: 18, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface }, playerRow: { minHeight: 67, flexDirection: 'row', alignItems: 'center', gap: 9 }, avatar: { width: 39, height: 39, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, avatarText: { color: C.surface, fontSize: 9, fontWeight: '900' }, playerName: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerMeta: { marginTop: 3, color: C.ink40, fontSize: 8 }, status: { minHeight: 25, paddingHorizontal: 7, justifyContent: 'center', borderRadius: 13, backgroundColor: C.paper }, statusPlaying: { backgroundColor: C.optic }, statusDone: { backgroundColor: '#F7EAE6' }, statusText: { color: C.ink40, fontSize: 6, fontWeight: '900' }, statusTextPlaying: { color: C.ink }, statusTextDone: { color: C.brick },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
