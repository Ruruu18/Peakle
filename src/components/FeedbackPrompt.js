import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import { DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import {
  hasRecentFeedback, isFeedbackDue, markFeedbackPrompted, optOutOfFeedback, recordFeedbackSession, submitAppFeedback,
} from '../services/appFeedback';

// Give players time to settle in before asking, and never interrupt a chat or a live match.
const SETTLE_MS = 75 * 1000;
const QUIET_ROUTES = new Set(['Play', 'DirectChat', 'CommunityChat', 'SupportChat', 'OpenPlayActivity', 'AccountDeletion']);
const RATING_LABELS = ['', 'Not great', 'Could be better', 'It’s okay', 'Pretty good', 'Love it'];
const MAX_COMMENT = 1000;

export default function FeedbackPrompt({ navigationRef }) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const { user } = useAuth();
  const { incomingInvites } = useNearbyPlayersContext();
  const palette = isDark ? { ...DARK_CONTENT_COLORS, surface: '#17302D' } : LIGHT_CONTENT_COLORS;
  const [due, setDue] = useState(false);
  const [visible, setVisible] = useState(false);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const closeTimer = useRef(null);
  const userId = user?.id;

  // Decide once per session whether this is a good time to ask.
  useEffect(() => {
    if (!userId) return undefined;
    let cancelled = false;
    let timer;
    recordFeedbackSession(userId).then((state) => {
      if (cancelled || !isFeedbackDue(state)) return;
      timer = setTimeout(async () => {
        const alreadyGiven = await hasRecentFeedback(userId).catch(() => true);
        if (!cancelled && !alreadyGiven) setDue(true);
      }, SETTLE_MS);
    });
    return () => { cancelled = true; clearTimeout(timer); };
  }, [userId]);

  // Wait for a calm moment: no pending invite and not on a busy screen.
  useEffect(() => {
    if (!due || visible || incomingInvites.length > 0) return undefined;
    const tryShow = () => {
      const route = navigationRef?.getCurrentRoute?.();
      if (!route || QUIET_ROUTES.has(route.name)) return;
      setDue(false);
      setVisible(true);
      markFeedbackPrompted(userId);
    };
    tryShow();
    return navigationRef?.addListener?.('state', tryShow);
  }, [due, incomingInvites.length, navigationRef, userId, visible]);

  useEffect(() => () => clearTimeout(closeTimer.current), []);

  const close = () => { if (!busy) setVisible(false); };
  const neverAsk = () => { optOutOfFeedback(userId); setVisible(false); };
  const send = async () => {
    if (!rating || busy) return;
    setBusy(true);
    setError('');
    try {
      await submitAppFeedback(userId, { rating, comment });
      setSent(true);
      closeTimer.current = setTimeout(() => setVisible(false), 1800);
    } catch (err) {
      setError(err?.message || 'Couldn’t send your feedback. Try again.');
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;
  const placeholder = rating && rating <= 3 ? 'What should we fix or improve?' : 'Any feature you’d love to see in Peakle?';

  return (
    <Modal visible transparent animationType="slide" onRequestClose={close}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.flex}>
        <Pressable {...webDialog('backdrop')} accessibilityLabel="Close feedback" onPress={close} style={styles.backdrop}>
          <Pressable {...webDialog('surface')}
            accessibilityRole="dialog"
            accessibilityLabel="Share feedback about Peakle"
            testID="feedback-prompt"
            onPress={(event) => event.stopPropagation()}
            style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18), backgroundColor: palette.surface, borderColor: palette.line }]}
          >
            <View {...webDialog('handle')} style={[styles.handle, { backgroundColor: palette.line }]} />
            <Pressable accessibilityRole="button" accessibilityLabel="Close" hitSlop={10} onPress={close} style={styles.closeButton}>
              <Ionicons name="close" size={20} color={palette.ink40} />
            </Pressable>

            {sent ? (
              <View style={styles.thanks}>
                <View style={[styles.icon, { backgroundColor: palette.tealWash }]}>
                  <Ionicons name="checkmark-circle" size={30} color={palette.teal} />
                </View>
                <Text style={[styles.title, { color: palette.ink }]}>Thanks for the feedback!</Text>
                <Text style={[styles.body, { color: palette.ink40 }]}>Every note is read by the team and helps shape what we build next.</Text>
              </View>
            ) : (
              <>
                <Text style={[styles.eyebrow, { color: palette.teal }]}>QUICK FEEDBACK</Text>
                <Text style={[styles.title, { color: palette.ink }]}>How’s Peakle so far?</Text>
                <Text style={[styles.body, { color: palette.ink40 }]}>Takes 10 seconds and helps us make the app better for every player.</Text>

                <View accessibilityRole="radiogroup" style={styles.stars}>
                  {[1, 2, 3, 4, 5].map((value) => (
                    <Pressable
                      key={value}
                      accessibilityRole="radio"
                      accessibilityLabel={`${value} star${value > 1 ? 's' : ''}`}
                      accessibilityState={{ checked: rating === value }}
                      hitSlop={4}
                      onPress={() => setRating(value)}
                      style={({ pressed }) => [styles.star, pressed && styles.pressed]}
                    >
                      <Ionicons name={value <= rating ? 'star' : 'star-outline'} size={36} color={value <= rating ? '#E8B931' : palette.line} />
                    </Pressable>
                  ))}
                </View>
                <Text style={[styles.ratingLabel, { color: rating ? palette.ink70 : palette.ink40 }]}>{rating ? RATING_LABELS[rating] : 'Tap a star to rate'}</Text>

                {rating ? (
                  <View style={styles.commentWrap}>
                    <TextInput
                      value={comment}
                      onChangeText={(text) => setComment(text.slice(0, MAX_COMMENT))}
                      placeholder={placeholder}
                      placeholderTextColor={palette.ink40}
                      multiline
                      maxLength={MAX_COMMENT}
                      accessibilityLabel="Feedback or feature suggestion (optional)"
                      style={[styles.input, { color: palette.ink, backgroundColor: palette.paper, borderColor: palette.line }]}
                    />
                    <Text style={[styles.counter, { color: palette.ink40 }]}>Optional · {comment.length}/{MAX_COMMENT}</Text>
                  </View>
                ) : null}

                {error ? (
                  <View accessibilityRole="alert" style={[styles.error, { backgroundColor: palette.brickWash }]}>
                    <Ionicons name="alert-circle-outline" size={17} color={palette.error} />
                    <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
                  </View>
                ) : null}

                <View style={styles.actions}>
                  <Pressable accessibilityRole="button" disabled={busy} onPress={close} style={({ pressed }) => [styles.secondaryButton, { borderColor: palette.line }, pressed && styles.pressed]}>
                    <Text style={[styles.secondaryText, { color: palette.teal }]}>Not now</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={busy ? 'Sending feedback' : 'Send feedback'}
                    disabled={!rating || busy}
                    onPress={send}
                    style={({ pressed }) => [styles.primaryButton, pressed && styles.pressed, (!rating || busy) && styles.disabled]}
                  >
                    {busy ? <ActivityIndicator size="small" color={LIGHT_CONTENT_COLORS.ink} /> : null}
                    <Text style={styles.primaryText}>{busy ? 'Sending…' : 'Send feedback'}</Text>
                  </Pressable>
                </View>
                <Pressable accessibilityRole="button" onPress={neverAsk} hitSlop={8} style={styles.optOut}>
                  <Text style={[styles.optOutText, { color: palette.ink40 }]}>Don’t ask me again</Text>
                </Pressable>
              </>
            )}
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  backdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.62)' },
  sheet: { width: '100%', maxWidth: 420, paddingTop: 10, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderRadius: 26, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  handle: { width: 42, height: 4, marginBottom: 14, borderRadius: 2 },
  closeButton: { position: 'absolute', top: 14, right: 14, padding: 4 },
  icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  eyebrow: { marginTop: 6, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 3, fontSize: 22, lineHeight: 28, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' },
  body: { maxWidth: 320, marginTop: 6, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  stars: { marginTop: 18, flexDirection: 'row', gap: 6 },
  star: { padding: 2 },
  ratingLabel: { marginTop: 6, minHeight: 18, fontSize: 13, fontWeight: '700' },
  commentWrap: { width: '100%', marginTop: 14 },
  input: { width: '100%', minHeight: 92, maxHeight: 160, paddingHorizontal: 13, paddingTop: 11, paddingBottom: 11, borderWidth: 1, borderRadius: 14, fontSize: 14, lineHeight: 20, textAlignVertical: 'top' },
  counter: { marginTop: 5, alignSelf: 'flex-end', fontSize: 11, fontWeight: '600' },
  error: { width: '100%', minHeight: 44, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  actions: { width: '100%', marginTop: 16, flexDirection: 'row', gap: 10 },
  secondaryButton: { flex: 1, minHeight: 50, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14 },
  secondaryText: { fontSize: 14, fontWeight: '800' },
  primaryButton: { flex: 1.4, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14, backgroundColor: LIGHT_CONTENT_COLORS.optic },
  primaryText: { color: LIGHT_CONTENT_COLORS.ink, fontSize: 14, fontWeight: '900' },
  optOut: { marginTop: 12, paddingVertical: 4 },
  optOutText: { fontSize: 12, fontWeight: '600', textDecorationLine: 'underline' },
  thanks: { alignItems: 'center', paddingTop: 8, paddingBottom: 12 },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.5 },
});
