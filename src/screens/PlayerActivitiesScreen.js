import { webLayout } from '../utils/webLayout';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, RefreshControl, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useFocusEffect } from '@react-navigation/native';
import ScrollView from '../components/FocusResetScrollView';
import { useAuth } from '../context/AuthContext';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useTheme } from '../context/ThemeContext';
import { peekCachedData, readCachedData, withTimeout, writeCachedData } from '../lib/asyncData';
import { playerActivitiesCacheKey } from '../lib/cacheKeys';
import { listDiscoverablePlayerActivities } from '../services/playerActivities';
import PeakleLoadingOverlay from '../components/PeakleLoadingOverlay';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
const DARK = { ...LIGHT, ink: '#F3F5EF', paper: '#0E2321', surface: '#17302D', ink70: '#C1CECA', ink40: '#8FA39C', line: '#304743' };

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function ActivityRow({ activity, userLocation, colors, onPress }) {
  const startsAt = new Date(activity.startsAt);
  const date = startsAt.toLocaleDateString('en-PH', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'Asia/Manila' });
  const time = startsAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const distance = formatDistance(distanceInKm(userLocation, activity.venue));
  const icon = activity.type === 'open_play' ? 'people' : activity.type === 'competition' ? 'trophy' : 'school';
  const fee = activity.feeAmount == null ? null : Number(activity.feeAmount) > 0 ? `₱${Number(activity.feeAmount).toLocaleString('en-PH')}` : 'Free';
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${activity.typeLabel}, ${activity.title}`} onPress={onPress} style={({ pressed }) => [styles.activityCard, { backgroundColor: colors.surface, borderColor: colors.line }, pressed && styles.pressed]}>
      <View style={styles.activityHead}>
        <View style={styles.typePill}><Icon name={icon} size={13} color={LIGHT.teal} /><Text style={styles.typeText}>{activity.typeLabel.toUpperCase()}</Text></View>
        <View style={styles.availability}><Text style={styles.availabilityText}>{activity.availability}</Text></View>
      </View>
      <Text style={[styles.activityTitle, { color: colors.ink }]}>{activity.title}</Text>
      <Text style={styles.venueText}>{activity.venue?.name || 'Peakle venue'}{activity.venue?.area ? ` · ${activity.venue.area}` : ''}</Text>
      <View style={styles.metaRow}><Icon name="calendar-outline" size={15} color={colors.ink40} /><Text style={[styles.metaText, { color: colors.ink70 }]}>{date} · {time}</Text></View>
      <View style={[styles.activityFoot, { borderColor: colors.line }]}>
        <Text style={[styles.distance, { color: colors.ink40 }]}>{distance}</Text>
        {fee ? <Text style={[styles.fee, { color: colors.ink }]}>{fee}</Text> : null}
      </View>
    </Pressable>
  );
}

export default function PlayerActivitiesScreen({ navigation }) {
  const { user } = useAuth();
  const { userLocation } = useUserLocation();
  const { isDark } = useTheme();
  const colors = isDark ? DARK : LIGHT;
  const cacheKey = playerActivitiesCacheKey(user?.id || 'guest');
  const [activities, setActivities] = useState(() => peekCachedData(cacheKey) || []);
  const [loading, setLoading] = useState(() => peekCachedData(cacheKey) === null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState('all');
  const [error, setError] = useState('');

  const load = useCallback(async ({ refresh = false } = {}) => {
    if (refresh) setRefreshing(true);
    if (!activities.length) setLoading(true);
    setError('');
    try {
      const rows = await withTimeout(listDiscoverablePlayerActivities(), 12000, 'Activities took too long to refresh.');
      setActivities(rows);
      writeCachedData(cacheKey, rows);
    } catch (loadError) {
      setError(`${loadError.message || 'Activities could not be loaded.'}${activities.length ? ' Showing saved activities.' : ''}`);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [activities.length, cacheKey]);

  useFocusEffect(useCallback(() => {
    let active = true;
    readCachedData(cacheKey).then((cached) => {
      if (!active) return;
      if (cached !== null) {
        setActivities(cached);
        setLoading(false);
      }
      load();
    });
    return () => { active = false; };
  }, [cacheKey, load]));

  const visible = useMemo(() => activities
    .filter((activity) => filter === 'all' || activity.type === filter)
    .sort((a, b) => {
      const distanceA = distanceInKm(userLocation, a.venue) ?? Number.MAX_VALUE;
      const distanceB = distanceInKm(userLocation, b.venue) ?? Number.MAX_VALUE;
      return distanceA - distanceB || new Date(a.startsAt) - new Date(b.startsAt);
    }), [activities, filter, userLocation]);

  const openActivity = (activity) => {
    if (activity.type === 'open_play') {
      navigation.navigate('OpenPlayActivity', { token: Date.now(), sessionId: activity.sourceId, direct: true, returnTo: 'Activities' });
      return;
    }
    navigation.navigate('ActivityDetails', { activity, returnTo: 'Activities' });
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => load({ refresh: true })} tintColor={LIGHT.teal} />}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Back to Home" onPress={() => navigation.navigate('Home')} style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="arrow-back" color={colors.ink} /></Pressable>
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: colors.ink40 }]}>DISCOVER</Text><Text style={[styles.h1, { color: colors.ink }]}>Public activities</Text></View>
        </View>
        {filter === 'all' || filter === 'open_play' ? (
          <Pressable accessibilityRole="button" accessibilityLabel="Enter a play code" onPress={() => navigation.navigate('OpenPlayActivity', { token: Date.now(), sessionId: null, direct: false, returnTo: 'Activities' })} style={styles.codeCard}>
            <View style={styles.codeIcon}><Icon name="key-outline" color={LIGHT.ink} /></View>
            <View style={styles.flex}><Text style={styles.codeTitle}>Have a play code?</Text><Text style={styles.codeMeta}>Enter a private six-character session code.</Text></View>
            <Icon name="arrow-forward" color={LIGHT.ink} />
          </Pressable>
        ) : null}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
          {[['all', 'All'], ['open_play', 'Open play'], ['competition', 'Competitions'], ['program', 'Programs']].map(([value, label]) => {
            const selected = filter === value;
            const count = value === 'all' ? activities.length : activities.filter((activity) => activity.type === value).length;
            return <Pressable key={value} accessibilityRole="button" accessibilityState={{ selected }} onPress={() => setFilter(value)} style={[styles.filter, { backgroundColor: selected ? LIGHT.teal : colors.surface, borderColor: selected ? LIGHT.teal : colors.line }]}><Text style={[styles.filterText, { color: selected ? LIGHT.surface : colors.ink40 }]}>{label}</Text><Text style={[styles.filterCount, { color: selected ? LIGHT.surface : colors.ink40, backgroundColor: selected ? 'rgba(255,255,255,.16)' : colors.paper }]}>{count}</Text></Pressable>;
          })}
        </ScrollView>
        {error ? <View style={styles.error}><Icon name="alert-circle-outline" color={LIGHT.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}
        {visible.length
            ? <View {...webLayout('court-grid')}>{visible.map((activity) => <ActivityRow key={activity.id} activity={activity} userLocation={userLocation} colors={colors} onPress={() => openActivity(activity)} />)}</View>
            : <View style={[styles.empty, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="compass-outline" size={29} color={colors.ink40} /><Text style={[styles.emptyTitle, { color: colors.ink }]}>Nothing in this view yet</Text><Text style={[styles.emptyMeta, { color: colors.ink40 }]}>New public activities from verified venues will appear here.</Text></View>}
      </ScrollView>
      <PeakleLoadingOverlay visible={loading && !activities.length} status="FINDING PUBLIC ACTIVITIES" />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 65 },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  eyebrow: { fontSize: 10, lineHeight: 15, fontWeight: '700', letterSpacing: 1.05 },
  h1: { marginTop: 2, fontSize: 29, lineHeight: 37, fontWeight: '700', letterSpacing: -0.8 },
  codeCard: { minHeight: 76, marginTop: 18, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 18, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: LIGHT.optic },
  codeIcon: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: 'rgba(255,255,255,.5)' },
  codeTitle: { color: LIGHT.ink, fontSize: 14, fontWeight: '900' },
  codeMeta: { marginTop: 3, color: LIGHT.ink70, fontSize: 12 },
  filters: { paddingVertical: 17, gap: 7 },
  filter: { minHeight: 40, paddingLeft: 12, paddingRight: 6, flexDirection: 'row', alignItems: 'center', gap: 7, borderWidth: 1, borderRadius: 20 },
  filterText: { fontSize: 12, fontWeight: '800' },
  filterCount: { minWidth: 25, height: 25, lineHeight: 25, paddingHorizontal: 6, textAlign: 'center', textAlignVertical: 'center', borderRadius: 13, overflow: 'hidden', fontSize: 11, fontWeight: '900' },
  activityCard: { marginBottom: 10, padding: 14, borderWidth: 1, borderRadius: 19, borderBottomLeftRadius: 8, borderBottomRightRadius: 8 },
  activityHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  typePill: { minHeight: 27, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' },
  typeText: { color: LIGHT.teal, fontSize: 9, fontWeight: '900', letterSpacing: .45 },
  availability: { minHeight: 26, paddingHorizontal: 8, justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT.optic },
  availabilityText: { color: LIGHT.ink, fontSize: 9, fontWeight: '900' },
  activityTitle: { marginTop: 12, fontSize: 17, fontWeight: '900' },
  venueText: { marginTop: 4, color: LIGHT.teal, fontSize: 11, fontWeight: '800' },
  metaRow: { marginTop: 11, flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 12 },
  activityFoot: { marginTop: 11, paddingTop: 10, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', borderTopWidth: 1 },
  distance: { fontSize: 11, fontWeight: '800' },
  fee: { fontSize: 11, fontWeight: '900' },
  error: { marginBottom: 10, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' },
  errorText: { flex: 1, color: LIGHT.brick, fontSize: 10, lineHeight: 15, fontWeight: '800' },
  loading: { minHeight: 220, alignItems: 'center', justifyContent: 'center' },
  loadingText: { marginTop: 9, fontSize: 12, fontWeight: '800' },
  empty: { minHeight: 210, padding: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderStyle: 'dashed', borderRadius: 19 },
  emptyTitle: { marginTop: 9, fontSize: 15, fontWeight: '800' },
  emptyMeta: { maxWidth: 270, marginTop: 5, textAlign: 'center', fontSize: 11, lineHeight: 16 },
  pressed: { opacity: .78, transform: [{ scale: .99 }] },
});
