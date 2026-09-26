import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppIcon from '../components/AppIcon';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { getOrganizerInterest, submitOrganizerInterest } from '../services/organizerInterest';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6', panel: '#0E2321' };
const DARK = { ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37', brickWash: '#402C29', panel: '#102825' };

const FEATURES = [
  { icon: 'pulse-outline', title: 'Live court monitor', detail: 'See every court at a glance: who is playing, the score, and who is up next.' },
  { icon: 'shuffle-outline', title: 'Fair open-play queue', detail: 'Automatic rotations balanced by skill and wait time, so no one sits out too long.' },
  { icon: 'grid-outline', title: 'Courts & schedules', detail: 'Set up courts, opening hours, booking rules and blocked times in one place.' },
  { icon: 'people-outline', title: 'Player roster', detail: 'Check-ins, ratings and attendance history for every regular at your venue.' },
  { icon: 'card-outline', title: 'Payments & memberships', detail: 'Collect session fees and memberships, and track refunds without spreadsheets.' },
  { icon: 'trophy-outline', title: 'Leagues & tournaments', detail: 'Run divisions, brackets and ladders with results that feed player ratings.' },
  { icon: 'megaphone-outline', title: 'Announcements', detail: 'Reach your players instantly with schedule changes, new sessions and events.' },
  { icon: 'stats-chart-outline', title: 'Venue insights', detail: 'Court usage, peak hours and turnout trends to help you plan and grow.' },
];

const CLUB_WARS = [
  { icon: 'shield-outline', text: 'Your club faces other clubs in head-to-head match days.' },
  { icon: 'podium-outline', text: 'Season standings and a club leaderboard for bragging rights.' },
  { icon: 'flag-outline', text: 'Organizers pick lineups and rally members to play for the club.' },
];

const AUDIENCE = ['Court owners', 'Club leaders', 'Open-play hosts', 'Coaches'];

function Icon({ name, size = 20, color }) {
  return <AppIcon name={name} size={size} color={color} />;
}

export default function OrganizerPreviewScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK : LIGHT;
  const { user } = useAuth();
  const scrollRef = useRef(null);
  const [email, setEmail] = useState(user?.email || '');
  const [savedEmail, setSavedEmail] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    getOrganizerInterest()
      .then((row) => { if (active && row?.email) { setSavedEmail(row.email); setEmail(row.email); } })
      .catch(() => {});
    return () => { active = false; };
  }, [user?.id]);

  const goBack = () => (navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Profile'));

  const submit = async () => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const saved = await submitOrganizerInterest(email);
      setSavedEmail(saved.email);
      setEmail(saved.email);
    } catch (e) {
      setError(e.message || 'We couldn’t save your email. Try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={[s.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityRole="button" accessibilityLabel="Go back" hitSlop={8} onPress={goBack} style={s.back}>
          <Icon name="arrow-back" color={C.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={[s.eyebrow, { color: C.ink40 }]}>FOR ORGANIZERS</Text>
          <Text style={[s.h1, { color: C.ink }]}>Become an organizer</Text>
        </View>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={s.flex}>
        <ScrollView ref={scrollRef} contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[s.hero, { backgroundColor: C.panel }]}>
            <View style={[s.heroBadge, { backgroundColor: C.optic }]}><Text style={[s.heroBadgeText, { color: '#0E2321' }]}>AFTER BETA</Text></View>
            <Text style={s.heroTitle}>Run your courts, games and players from one place.</Text>
            <Text style={s.heroBody}>Organizer tools aren’t part of the player beta yet. We’re opening them to a small group of court owners and club leaders first. Leave your email below and we’ll reach out.</Text>
            <View style={s.audienceRow}>
              {AUDIENCE.map((item) => <View key={item} style={s.audienceChip}><Text style={s.audienceText}>{item}</Text></View>)}
            </View>
          </View>

          <Text style={[s.sectionTitle, { color: C.ink }]}>What organizers get</Text>
          <Text style={[s.sectionHelp, { color: C.ink40 }]}>Everything you need to manage a game night, a venue or a whole club.</Text>
          <View style={s.featureGrid}>
            {FEATURES.map((feature) => (
              <View key={feature.title} style={[s.featureCard, { backgroundColor: C.surface, borderColor: C.line }]}>
                <View style={[s.featureIcon, { backgroundColor: C.tealWash }]}><Icon name={feature.icon} size={18} color={C.teal} /></View>
                <Text style={[s.featureTitle, { color: C.ink }]}>{feature.title}</Text>
                <Text style={[s.featureDetail, { color: C.ink40 }]}>{feature.detail}</Text>
              </View>
            ))}
          </View>

          <View style={[s.clubWars, { backgroundColor: C.optic }]}>
            <View style={s.clubWarsHead}>
              <View style={s.clubWarsIcon}><Icon name="flash" size={20} color="#D6E94A" /></View>
              <View style={s.flex}>
                <Text style={s.clubWarsEyebrow}>COMING SOON</Text>
                <Text style={s.clubWarsTitle}>Club Wars</Text>
              </View>
            </View>
            <Text style={s.clubWarsBody}>Turn your club into a team. Club Wars pits clubs against each other across a season, and organizers lead the charge.</Text>
            <View style={s.clubWarsList}>
              {CLUB_WARS.map((item) => (
                <View key={item.text} style={s.clubWarsRow}>
                  <Icon name={item.icon} size={16} color="#0E2321" />
                  <Text style={s.clubWarsRowText}>{item.text}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={[s.signup, { backgroundColor: C.surface, borderColor: C.line }]}>
            <Text style={[s.signupTitle, { color: C.ink }]}>Interested? Let’s talk.</Text>
            <Text style={[s.signupBody, { color: C.ink40 }]}>Drop your email and the Peakle team will contact you about early organizer access.</Text>
            {savedEmail ? (
              <View style={[s.success, { backgroundColor: C.tealWash }]}>
                <Icon name="checkmark-circle" size={20} color={C.teal} />
                <View style={s.flex}>
                  <Text style={[s.successTitle, { color: C.ink }]}>You’re on the list</Text>
                  <Text style={[s.successBody, { color: C.ink70 }]}>We’ll contact you at {savedEmail}.</Text>
                </View>
                <Pressable accessibilityRole="button" onPress={() => setSavedEmail('')} hitSlop={8}><Text style={[s.changeText, { color: C.teal }]}>Change</Text></Pressable>
              </View>
            ) : (
              <>
                <TextInput
                  value={email}
                  onChangeText={(value) => { setEmail(value); if (error) setError(''); }}
                  onFocus={() => setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 250)}
                  onSubmitEditing={submit}
                  placeholder="you@example.com"
                  placeholderTextColor={C.ink40}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  autoCorrect={false}
                  autoComplete="email"
                  textContentType="emailAddress"
                  returnKeyType="send"
                  accessibilityLabel="Email address"
                  style={[s.input, { color: C.ink, backgroundColor: C.paper, borderColor: error ? C.brick : C.line }]}
                />
                {error ? <Text style={[s.errorText, { color: C.brick }]}>{error}</Text> : null}
                <Pressable accessibilityRole="button" disabled={submitting} onPress={submit} style={({ pressed }) => [s.submit, { backgroundColor: C.panel }, (pressed || submitting) && s.submitPressed]}>
                  {submitting ? <ActivityIndicator color="#D6E94A" /> : <><Text style={s.submitText}>Contact me</Text><Icon name="arrow-forward" size={16} color="#D6E94A" /></>}
                </Pressable>
              </>
            )}
            <Text style={[s.fineprint, { color: C.ink40 }]}>We’ll only use this to talk about organizer access.</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  flex: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  back: { width: 32, height: 40, alignItems: 'flex-start', justifyContent: 'center' },
  eyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  h1: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 19, paddingTop: 18, paddingBottom: 48 },
  // Hero
  hero: { padding: 18, borderRadius: 20, borderBottomLeftRadius: 8 },
  heroBadge: { alignSelf: 'flex-start', paddingHorizontal: 7, paddingVertical: 3, borderRadius: 6 },
  heroBadgeText: { fontSize: 7, fontWeight: '900', letterSpacing: .6 },
  heroTitle: { marginTop: 12, color: '#FFFFFF', fontSize: 19, lineHeight: 24, fontWeight: '900' },
  heroBody: { marginTop: 8, color: '#B7C6C1', fontSize: 10, lineHeight: 15 },
  audienceRow: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  audienceChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, borderWidth: 1, borderColor: '#304743' },
  audienceText: { color: '#E5F0ED', fontSize: 8, fontWeight: '800' },
  // Features
  sectionTitle: { marginTop: 24, fontSize: 15, fontWeight: '900' },
  sectionHelp: { marginTop: 4, fontSize: 9, lineHeight: 14 },
  featureGrid: { marginTop: 12, flexDirection: 'row', flexWrap: 'wrap', gap: 9 },
  featureCard: { flexGrow: 1, flexBasis: '46%', minWidth: 140, padding: 12, borderWidth: 1, borderRadius: 15, borderBottomLeftRadius: 7 },
  featureIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 11 },
  featureTitle: { marginTop: 10, fontSize: 11, fontWeight: '900' },
  featureDetail: { marginTop: 4, fontSize: 8.5, lineHeight: 13 },
  // Club Wars
  clubWars: { marginTop: 18, padding: 16, borderRadius: 20, borderBottomRightRadius: 8 },
  clubWarsHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  clubWarsIcon: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: '#0E2321' },
  clubWarsEyebrow: { color: '#1C6B66', fontSize: 7, fontWeight: '900', letterSpacing: .8 },
  clubWarsTitle: { marginTop: 1, color: '#0E2321', fontSize: 20, fontWeight: '900' },
  clubWarsBody: { marginTop: 10, color: '#0E2321', fontSize: 10, lineHeight: 15, fontWeight: '600' },
  clubWarsList: { marginTop: 10, gap: 7 },
  clubWarsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  clubWarsRowText: { flex: 1, color: '#0E2321', fontSize: 9, lineHeight: 14, fontWeight: '700' },
  // Email signup
  signup: { marginTop: 18, padding: 16, borderWidth: 1, borderRadius: 18, borderBottomLeftRadius: 8 },
  signupTitle: { fontSize: 15, fontWeight: '900' },
  signupBody: { marginTop: 4, fontSize: 9, lineHeight: 14 },
  input: { marginTop: 12, minHeight: 46, paddingHorizontal: 13, borderWidth: 1, borderRadius: 13, fontSize: 13, fontWeight: '700' },
  errorText: { marginTop: 6, fontSize: 8.5, fontWeight: '800' },
  submit: { marginTop: 10, minHeight: 46, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 13 },
  submitPressed: { opacity: .75 },
  submitText: { color: '#D6E94A', fontSize: 12, fontWeight: '900' },
  success: { marginTop: 12, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 13 },
  successTitle: { fontSize: 11, fontWeight: '900' },
  successBody: { marginTop: 2, fontSize: 9, lineHeight: 13 },
  changeText: { fontSize: 9, fontWeight: '900' },
  fineprint: { marginTop: 10, fontSize: 7.5, lineHeight: 11 },
});
