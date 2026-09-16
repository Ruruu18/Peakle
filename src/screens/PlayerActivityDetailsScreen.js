import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ScrollView from '../components/FocusResetScrollView';
import { distanceInKm, formatDistance, useUserLocation } from '../context/LocationContext';
import { useTheme } from '../context/ThemeContext';
import { joinProgram } from '../services/pickleball';
import { getPlayerActivity } from '../services/playerActivities';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA' };
const DARK = { ...LIGHT, ink: '#F3F5EF', paper: '#0E2321', surface: '#17302D', ink70: '#C1CECA', ink40: '#8FA39C', line: '#304743' };

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function PlayerActivityDetailsScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const { userLocation } = useUserLocation();
  const colors = isDark ? DARK : LIGHT;
  const [activity, setActivity] = useState(typeof route?.params?.activity === 'object' ? route.params.activity : null);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const returnTo = route?.params?.returnTo || 'Activities';

  useEffect(() => {
    if (typeof route?.params?.activity === 'object') {
      setActivity(route.params.activity);
      return;
    }
    let active = true;
    setActivity(null);
    setLoading(true);
    setError('');
    getPlayerActivity(route?.params?.activityType, route?.params?.activityId)
      .then((next) => { if (active) setActivity(next); })
      .catch((failure) => { if (active) setError(failure.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [route?.params?.activity, route?.params?.activityType, route?.params?.activityId]);

  if (loading) return <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper, justifyContent: 'center' }]}><ActivityIndicator accessibilityLabel="Loading activity" color={colors.teal} /></SafeAreaView>;

  if (!activity) {
    return <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}><Pressable accessibilityRole="button" accessibilityLabel="Back" onPress={() => navigation.navigate(returnTo)} style={[styles.fallbackBack, { backgroundColor: colors.surface }]}><Icon name="arrow-back" color={colors.ink} /></Pressable><View style={styles.missing}><Text style={[styles.missingTitle, { color: colors.ink }]}>Activity unavailable</Text><Text style={[styles.missingMeta, { color: colors.ink40 }]}>Return and choose the activity again.</Text></View></SafeAreaView>;
  }

  const startsAt = new Date(activity.startsAt);
  const endsAt = activity.endsAt ? new Date(activity.endsAt) : null;
  const date = startsAt.toLocaleDateString('en-PH', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric', timeZone: 'Asia/Manila' });
  const startTime = startsAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' });
  const endTime = endsAt && !Number.isNaN(endsAt.getTime()) ? endsAt.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Manila' }) : null;
  const fee = activity.feeAmount == null ? 'See event divisions' : Number(activity.feeAmount) > 0 ? `₱${Number(activity.feeAmount).toLocaleString('en-PH')}` : 'Free';
  const distance = formatDistance(distanceInKm(userLocation, activity.venue));
  const icon = activity.type === 'competition' ? 'trophy' : 'school';
  const registered = activity.registration && ['registered', 'waitlisted', 'attended'].includes(activity.registration.status);

  const registerForProgram = async () => {
    if (busy || registered) return;
    setBusy(true);
    setError('');
    try {
      const registration = await joinProgram(activity.sourceId);
      setActivity((current) => ({ ...current, registration: registration || { status: 'registered' } }));
    } catch (joinError) {
      setError(joinError.message || 'Registration could not be completed.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: colors.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={colors.paper} />
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.header}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Back to ${returnTo}`} onPress={() => navigation.navigate(returnTo)} style={[styles.back, { backgroundColor: colors.surface, borderColor: colors.line }]}><Icon name="arrow-back" color={colors.ink} /></Pressable>
          <View style={styles.flex}><Text style={[styles.eyebrow, { color: colors.ink40 }]}>ACTIVITY DETAILS</Text><Text style={[styles.headerTitle, { color: colors.ink }]}>{activity.type === 'competition' ? 'Competition' : 'Program'}</Text></View>
        </View>

        <View style={[styles.hero, { backgroundColor: isDark ? colors.surface : LIGHT.ink }]}>
          <View style={styles.typePill}><Icon name={icon} size={13} color={LIGHT.teal} /><Text style={styles.typeText}>{activity.typeLabel.toUpperCase()}</Text></View>
          <Text style={styles.title}>{activity.title}</Text>
          <Text style={styles.venue}>{activity.venue?.name || 'Peakle venue'}</Text>
          <Text style={styles.area}>{activity.venue?.area || distance}</Text>
        </View>

        <View style={[styles.detailCard, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {[
            ['calendar-outline', 'DATE', date],
            ['time-outline', 'TIME', `${startTime}${endTime ? `–${endTime}` : ''}`],
            ['location-outline', 'LOCATION', `${activity.venue?.area || 'Venue details'} · ${distance}`],
            ['wallet-outline', 'PRICE', fee],
            ['people-outline', 'AVAILABILITY', activity.capacity ? `${activity.availability} · capacity ${activity.capacity}` : activity.availability],
            ...(activity.skillDivision ? [['podium-outline', 'SKILL LEVEL', activity.skillDivision.replace('_', ' ')]] : []),
          ].map(([rowIcon, label, value], index) => <View key={label} style={[styles.detailRow, index > 0 && { borderTopWidth: 1, borderColor: colors.line }]}><View style={styles.detailIcon}><Icon name={rowIcon} color={LIGHT.teal} /></View><View style={styles.flex}><Text style={[styles.detailLabel, { color: colors.ink40 }]}>{label}</Text><Text style={[styles.detailValue, { color: colors.ink }]}>{value}</Text></View></View>)}
        </View>

        {activity.description ? <View style={[styles.descriptionCard, { backgroundColor: colors.surface }]}><Text style={[styles.descriptionTitle, { color: colors.ink }]}>About this activity</Text><Text style={[styles.description, { color: colors.ink70 }]}>{activity.description}</Text></View> : null}
        {error ? <View style={styles.error}><Icon name="alert-circle" color={LIGHT.brick} /><Text style={styles.errorText}>{error}</Text></View> : null}

        {activity.type === 'competition'
          ? <Pressable accessibilityRole="button" onPress={() => navigation.navigate('Pickleball', { openTab: 'Compete', ownerTab: returnTo === 'Home' ? 'Home' : 'Book', focusCompetitionId: activity.sourceId })} style={styles.primary}><Text style={styles.primaryText}>View divisions and register</Text><Icon name="arrow-forward" color={LIGHT.ink} /></Pressable>
          : registered
            ? <View style={styles.registered}><Icon name="checkmark-circle" color={LIGHT.teal} /><View style={styles.flex}><Text style={[styles.registeredTitle, { color: colors.ink }]}>You’re registered</Text><Text style={[styles.registeredMeta, { color: colors.ink40 }]}>{activity.registration.status === 'waitlisted' ? 'You are currently on the waitlist.' : 'This activity is saved to your account.'}</Text></View></View>
            : <Pressable accessibilityRole="button" disabled={busy} onPress={registerForProgram} style={[styles.primary, busy && styles.disabled]}>{busy ? <ActivityIndicator color={LIGHT.ink} /> : <><Text style={styles.primaryText}>Register for this activity</Text><Icon name="arrow-forward" color={LIGHT.ink} /></>}</Pressable>}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 },
  content: { paddingHorizontal: 20, paddingTop: 21, paddingBottom: 120 },
  flex: { flex: 1, minWidth: 0 },
  header: { minHeight: 52, flexDirection: 'row', alignItems: 'center', gap: 11 },
  back: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  eyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  headerTitle: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  hero: { marginTop: 18, padding: 18, borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9 },
  typePill: { alignSelf: 'flex-start', minHeight: 28, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: '#E5F0ED' },
  typeText: { color: LIGHT.teal, fontSize: 6, fontWeight: '900', letterSpacing: .5 },
  title: { marginTop: 16, color: '#FFFFFF', fontSize: 25, lineHeight: 30, fontWeight: '900' },
  venue: { marginTop: 9, color: LIGHT.optic, fontSize: 11, fontWeight: '900' },
  area: { marginTop: 4, color: '#B9C8C2', fontSize: 9 },
  detailCard: { marginTop: 13, paddingHorizontal: 13, borderWidth: 1, borderRadius: 19 },
  detailRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center', gap: 10 },
  detailIcon: { width: 39, height: 39, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: '#E5F0ED' },
  detailLabel: { fontSize: 6, fontWeight: '900', letterSpacing: .6 },
  detailValue: { marginTop: 3, fontSize: 10, lineHeight: 14, fontWeight: '800', textTransform: 'capitalize' },
  descriptionCard: { marginTop: 12, padding: 15, borderRadius: 17 },
  descriptionTitle: { fontSize: 11, fontWeight: '900' },
  description: { marginTop: 6, fontSize: 9, lineHeight: 15 },
  primary: { minHeight: 56, marginTop: 14, paddingHorizontal: 17, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15, backgroundColor: LIGHT.optic },
  primaryText: { color: LIGHT.ink, fontSize: 11, fontWeight: '900' },
  registered: { minHeight: 65, marginTop: 14, padding: 13, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 16, backgroundColor: '#E5F0ED' },
  registeredTitle: { fontSize: 11, fontWeight: '900' },
  registeredMeta: { marginTop: 3, fontSize: 8 },
  error: { marginTop: 12, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12, backgroundColor: '#F7EAE6' },
  errorText: { flex: 1, color: LIGHT.brick, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  disabled: { opacity: .45 },
  fallbackBack: { width: 44, height: 44, margin: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  missing: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30 },
  missingTitle: { fontSize: 18, fontWeight: '900' },
  missingMeta: { marginTop: 6, fontSize: 10 },
});
