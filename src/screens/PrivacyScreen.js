import React, { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Image, Pressable, ScrollView, Switch, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { useFocusEffect } from '@react-navigation/native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { loadPlayerPickleballHub, updatePickleballPrivacy } from '../services/pickleball';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import PeakleLoadingOverlay from '../components/PeakleLoadingOverlay';

const LIGHT = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6', panel: '#0E2321' };
const DARK = { ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37', brickWash: '#402C29', panel: '#102825' };
const BALL_IMAGE = require('../../public/images/ball.png');

const PROFILE_PRIVACY = [
  { value: 'private', icon: 'lock-closed-outline', title: 'Only me', detail: 'Your ratings and competitive stats stay private, and you are hidden from leaderboards.' },
  { value: 'members', icon: 'people-outline', title: 'My teammates', detail: 'Only teammates see your full stats. Your rating and record still appear on leaderboards.', recommended: true },
  { value: 'public', icon: 'globe-outline', title: 'All Peakle players', detail: 'Any signed-in player can see your ratings and competitive stats.' },
];

function Icon({ name, size = 20, color }) { return <Ionicons name={name} size={size} color={color} />; }

function PrivacyChoice({ option, selected, disabled, onPress, C }) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityState={{ checked: selected, disabled }}
      disabled={disabled}
      onPress={onPress}
      style={[s.privacyChoice, { backgroundColor: selected ? C.tealWash : C.surface, borderColor: selected ? C.teal : C.line }, disabled && s.privacyDisabled]}
    >
      <View style={[s.privacyIcon, { backgroundColor: selected ? C.optic : C.paper }]}>
        <Icon name={option.icon} size={17} color={selected ? '#0E2321' : C.teal} />
      </View>
      <View style={s.flex}>
        <View style={s.privacyTitleRow}>
          <Text style={[s.privacyChoiceTitle, { color: C.ink }]}>{option.title}</Text>
          {option.recommended ? (
            <View style={[s.recommended, { backgroundColor: C.tealWash }]}>
              <Text style={[s.recommendedText, { color: C.teal }]}>RECOMMENDED</Text>
            </View>
          ) : null}
        </View>
        <Text style={[s.privacyChoiceDetail, { color: C.ink40 }]}>{option.detail}</Text>
      </View>
      <Icon name={selected ? 'checkmark-circle' : 'ellipse-outline'} size={21} color={selected ? C.teal : C.ink40} />
    </Pressable>
  );
}

export default function PrivacyScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK : LIGHT;

  const [profile, setProfile] = useState(null);
  const [settings, setSettings] = useState(null);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [localError, setLocalError] = useState('');
  const [loadError, setLoadError] = useState('');

  const load = useCallback(async () => {
    setLoadError('');
    try {
      const data = await loadPlayerPickleballHub();
      if (data?.profile) {
        setProfile(data.profile);
        setSettings({
          profileVisibility: data.profile.profile_visibility,
          availabilityVisibility: data.profile.availability_visibility,
          matchingEnabled: data.profile.matching_enabled,
        });
      }
    } catch (e) {
      setLoadError(e.message);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  useEffect(() => {
    if (profile) {
      setSettings({
        profileVisibility: profile.profile_visibility,
        availabilityVisibility: profile.availability_visibility,
        matchingEnabled: profile.matching_enabled,
      });
    }
  }, [profile]);

  const change = async (patch) => {
    if (saving) return;
    const previous = settings;
    const next = { ...settings, ...patch };
    setSettings(next);
    setSaving(true);
    setMessage('');
    setLocalError('');
    try {
      await updatePickleballPrivacy(next);
      setMessage('Saved automatically');
    } catch (error) {
      setSettings(previous);
      setLocalError(error.message || 'Your privacy change could not be saved.');
    } finally {
      setSaving(false);
    }
  };

  const profileLabel = settings
    ? PROFILE_PRIVACY.find((item) => item.value === settings.profileVisibility)?.title
    : '—';

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />

      {/* Header */}
      <View style={[s.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[s.back, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Icon name="arrow-back" color={C.ink} />
        </Pressable>
        <View style={s.flex}>
          <Text style={[s.eyebrow, { color: C.ink40 }]}>YOUR PROFILE</Text>
          <Text style={[s.h1, { color: C.ink }]}>Privacy & matching</Text>
        </View>
        <View style={[s.ball, { backgroundColor: C.optic }]}>
          <Image source={BALL_IMAGE} style={s.ballImage} resizeMode="contain" />
        </View>
      </View>

      <ScrollView contentContainerStyle={s.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">

        {/* Load error */}
        {loadError ? (
          <View style={[s.errorBanner, { backgroundColor: C.brickWash }]}>
            <Icon name="alert-circle" color={C.brick} />
            <Text style={[s.errorText, { color: C.brick }]}>{loadError}</Text>
          </View>
        ) : null}

        {!settings ? null : (
          <>
            {/* Glance summary */}
            <View style={[s.privacySummary, { backgroundColor: C.panel }]}>
              <View style={[s.privacyShield, { backgroundColor: C.optic }]}>
                <Icon name="shield-checkmark" color="#0E2321" />
              </View>
              <View style={s.flex}>
                <Text style={s.infoTitle}>Your privacy at a glance</Text>
                <Text style={s.infoMeta}>Competitive profile: {profileLabel}{'\n'}Player matching: {settings.matchingEnabled ? 'On' : 'Off'}</Text>
              </View>
            </View>

            {/* Allow player matching toggle */}
            <View style={[s.card, { backgroundColor: C.surface, borderColor: C.line }]}>
              <View style={s.matchingRow}>
                <View style={[s.privacyIcon, { backgroundColor: settings.matchingEnabled ? C.tealWash : C.paper }]}>
                  <Icon name="search-outline" color={settings.matchingEnabled ? C.teal : C.ink40} />
                </View>
                <View style={s.flex}>
                  <View style={s.privacyTitleRow}>
                    <Text style={[s.privacyChoiceTitle, { color: C.ink }]}>Allow player matching</Text>
                    <View style={[s.matchingState, { backgroundColor: settings.matchingEnabled ? C.tealWash : C.paper }]}>
                      <Text style={[s.matchingStateText, { color: settings.matchingEnabled ? C.teal : C.ink40 }]}>{settings.matchingEnabled ? 'ON' : 'OFF'}</Text>
                    </View>
                  </View>
                  <Text style={[s.privacyChoiceDetail, { color: C.ink40 }]}>
                    {settings.matchingEnabled
                      ? 'You can publish and accept partner, opponent, and substitute requests.'
                      : 'You are hidden from matching. Any open request is closed for your safety.'}
                  </Text>
                </View>
                <Switch
                  accessibilityLabel="Allow player matching"
                  disabled={saving}
                  value={settings.matchingEnabled}
                  onValueChange={(value) => change({ matchingEnabled: value })}
                  trackColor={{ false: C.line, true: C.teal }}
                  thumbColor={settings.matchingEnabled ? C.optic : C.ink40}
                />
              </View>
            </View>

            {/* Who can see my competitive profile */}
            <Text style={[s.privacySectionTitle, { color: C.ink }]}>Who can see my competitive profile?</Text>
            <Text style={[s.privacySectionHelp, { color: C.ink40 }]}>This includes your singles and doubles ratings and verified performance.</Text>
            <View accessibilityRole="radiogroup" style={s.privacyChoices}>
              {PROFILE_PRIVACY.map((option) => (
                <PrivacyChoice
                  key={option.value}
                  option={option}
                  selected={settings.profileVisibility === option.value}
                  disabled={saving}
                  onPress={() => change({ profileVisibility: option.value })}
                  C={C}
                />
              ))}
            </View>

            {/* Save state */}
            <View style={s.privacySaveState}>
              {saving
                ? <ActivityIndicator size="small" color={C.teal} />
                : <Icon name={localError ? 'alert-circle' : 'checkmark-circle'} size={17} color={localError ? C.brick : C.teal} />}
              <Text style={[s.privacySaveText, { color: localError ? C.brick : C.ink40 }]}>
                {saving ? 'Saving your privacy choice…' : localError || message || 'Changes save automatically'}
              </Text>
            </View>
          </>
        )}
      </ScrollView>
      <PeakleLoadingOverlay visible={!settings && !loadError} status="LOADING PRIVACY SETTINGS" />
    </SafeAreaView>
  );
}

const s = createMobileStyleSheet({
  safe: { flex: 1 },
  header: { paddingHorizontal: 19, paddingTop: 12, paddingBottom: 14, flexDirection: 'row', alignItems: 'center', gap: 10, borderBottomWidth: 1 },
  back: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1 },
  ball: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  ballImage: { width: 27, height: 27 },
  eyebrow: { fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  h1: { marginTop: 2, fontSize: 24, fontWeight: '900' },
  flex: { flex: 1 },
  content: { paddingHorizontal: 19, paddingTop: 18, paddingBottom: 48 },
  loader: { marginTop: 80 },
  errorBanner: { marginBottom: 14, padding: 11, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 12 },
  errorText: { flex: 1, fontSize: 8, lineHeight: 12, fontWeight: '800' },
  // Summary panel
  privacySummary: { padding: 15, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 18 },
  privacyShield: { width: 43, height: 43, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  infoTitle: { color: '#FFFFFF', fontSize: 11, fontWeight: '900' },
  infoMeta: { marginTop: 3, color: '#B7C6C1', fontSize: 8, lineHeight: 13 },
  // Matching toggle card
  card: { marginTop: 12, marginBottom: 9, padding: 13, borderWidth: 1, borderRadius: 17, borderBottomLeftRadius: 8 },
  matchingRow: { minHeight: 80, flexDirection: 'row', alignItems: 'center', gap: 10 },
  privacyIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  privacyTitleRow: { flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 6 },
  privacyChoiceTitle: { flexShrink: 1, fontSize: 11, fontWeight: '900' },
  privacyChoiceDetail: { marginTop: 4, fontSize: 8, lineHeight: 13 },
  matchingState: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  matchingStateText: { fontSize: 6, fontWeight: '900', letterSpacing: .5 },
  // Who can see section
  privacySectionTitle: { marginTop: 22, fontSize: 14, fontWeight: '900' },
  privacySectionHelp: { marginTop: 4, fontSize: 9, lineHeight: 14 },
  privacyChoices: { marginTop: 10, gap: 7 },
  privacyChoice: { minHeight: 75, paddingHorizontal: 11, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 15 },
  privacyDisabled: { opacity: .42 },
  recommended: { paddingHorizontal: 6, paddingVertical: 3, borderRadius: 6 },
  recommendedText: { fontSize: 5.5, fontWeight: '900', letterSpacing: .45 },
  // Save state
  privacySaveState: { minHeight: 42, marginTop: 12, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
  privacySaveText: { fontSize: 8, fontWeight: '800' },
});
