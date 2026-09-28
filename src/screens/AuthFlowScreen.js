import Modal from '../components/ResponsiveModal';
import { webLayout, webDialog } from '../utils/webLayout';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  BackHandler,
  Easing,
  Image,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  UIManager,
  useWindowDimensions
} from 'react-native';

if (Platform.OS === 'android' && UIManager.setLayoutAnimationEnabledExperimental) {
  UIManager.setLayoutAnimationEnabledExperimental(true);
}
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useAuth } from '../context/AuthContext';
import { recordPlayerEvent } from '../services/playerFunnel';
import { clearAppHandoff, isStandaloneWebApp, readAppHandoff } from '../lib/authLinks';
import ResilientImage from '../components/ResilientImage';
import { LEGAL_DOCUMENTS } from '../content/legalDocuments';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import { COURT_BOOKING_ENABLED } from '../config/features';
import HomeAreaPicker from '../components/HomeAreaPicker';

WebBrowser.maybeCompleteAuthSession();

const C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED' };

// Booking is paused in beta, so only showcase it when the flag turns it on.
const features = [
  { key: 'insights', icon: 'pulse-outline', eyebrow: 'PLAY SMARTER', title: 'Every match teaches you something.', body: 'Keep score court-side, then see the patterns that actually moved the result.', color: C.teal },
  COURT_BOOKING_ENABLED ? { key: 'booking', icon: 'calendar-outline', eyebrow: 'BOOK IN SECONDS', title: 'Your next court is already close.', body: 'Find nearby venues, compare times, and keep every booking in one place.', color: '#486B85' } : null,
  { key: 'social', icon: 'chatbubbles-outline', eyebrow: 'STAY CONNECTED', title: 'Your friends are one tap away.', body: 'Follow players you meet, add friends, and chat to lock in the next game.', color: '#486B85' },
  { key: 'squad', icon: 'people-outline', eyebrow: 'YOUR PEOPLE', title: 'Turn a regular four into a rivalry.', body: 'Build your squad, send challenges, and settle the table with recorded results.', color: C.brick },
].filter(Boolean);

function Icon({ name, size = 20, color = C.ink }) { return <Ionicons name={name} size={size} color={color} />; }

function Wordmark({ light = false, flush = false }) {
  return (
    <View style={[styles.wordmark, !flush && styles.wordmarkOffset]}>
      <View style={[styles.mark, { width: 26, height: 26, borderRadius: 13, borderBottomLeftRadius: 13, borderBottomRightRadius: 13, backgroundColor: C.optic, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }]}>
        <Image source={require('../../public/images/ball.png')} style={{ width: 26, height: 26, position: 'absolute' }} tintColor={C.ink} resizeMode="cover" />
      </View>
      <Text style={[styles.word, light && styles.wordLight, { fontSize: 21 }]}>Peakle</Text>
    </View>
  );
}

function KitchenLine({ dark = false }) {
  return <View style={styles.kitchen}><View style={[styles.solid, dark && styles.solidDark]} /><View style={[styles.dashed, dark && styles.dashedDark]} /></View>;
}

function Progress({ step, total }) {
  return <View style={styles.progress}>{Array.from({ length: total }).map((_, index) => <View key={index} style={[styles.progressItem, index <= step && styles.progressActive]} />)}</View>;
}

function LegalDocumentModal({ documentKey, onClose, requireAgreement = false, onAgree }) {
  const insets = useSafeAreaInsets();
  const document = LEGAL_DOCUMENTS[documentKey] || LEGAL_DOCUMENTS.terms;
  const [hasReachedEnd, setHasReachedEnd] = useState(false);
  const scrollHeights = useRef({ view: 0, content: 0 });

  useEffect(() => {
    setHasReachedEnd(false);
  }, [documentKey, requireAgreement]);

  const trackReadingProgress = ({ nativeEvent }) => {
    const { contentOffset, contentSize, layoutMeasurement } = nativeEvent;
    if (layoutMeasurement.height + contentOffset.y >= contentSize.height - 24) setHasReachedEnd(true);
  };

  // On tall screens the whole document can fit without scrolling, so no scroll
  // event ever fires. Treat a document that fits as already read.
  const checkFitsWithoutScrolling = (next) => {
    scrollHeights.current = { ...scrollHeights.current, ...next };
    const { view, content } = scrollHeights.current;
    if (view > 0 && content > 0 && content <= view + 24) setHasReachedEnd(true);
  };

  return (
    <Modal visible={Boolean(documentKey)} transparent animationType="slide" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.legalModalBackdrop}>
        <View {...webDialog('surface')} style={styles.legalModalSheet}>
          <View style={styles.legalModalHeader}>
            <View style={styles.legalModalHeading}>
              <Text style={styles.legalModalEyebrow}>{document.eyebrow}</Text>
              <Text style={styles.legalModalTitle}>{document.title}</Text>
              <Text style={styles.legalModalDate}>{document.effectiveDate}</Text>
            </View>
            <Pressable accessibilityRole="button" accessibilityLabel={`Close ${document.title}`} onPress={onClose} style={({ pressed }) => [styles.legalModalClose, pressed && styles.pressed]}>
              <Icon name="close" size={23} color={C.ink} />
            </Pressable>
          </View>
          <View style={styles.legalModalRule} />
          <ScrollView style={styles.legalModalScroll} contentContainerStyle={styles.legalModalContent} showsVerticalScrollIndicator={false} onScroll={trackReadingProgress} scrollEventThrottle={16} onLayout={({ nativeEvent }) => checkFitsWithoutScrolling({ view: nativeEvent.layout.height })} onContentSizeChange={(_, height) => checkFitsWithoutScrolling({ content: height })}>
            <Text style={styles.legalModalIntroduction}>{document.introduction}</Text>
            {document.sections.map((section) => (
              <View key={section.title} style={styles.legalModalSection}>
                <Text style={styles.legalModalSectionTitle}>{section.title}</Text>
                <Text style={styles.legalModalBody}>{section.body}</Text>
              </View>
            ))}
          </ScrollView>
          <View style={[styles.legalModalFooter, { paddingBottom: Math.max(insets.bottom, 16) }]}>
            {requireAgreement && !hasReachedEnd ? <Text style={styles.legalModalInstruction}>Scroll to the end before agreeing.</Text> : null}
            <Pressable accessibilityRole="button" disabled={requireAgreement && !hasReachedEnd} onPress={requireAgreement ? onAgree : onClose} style={({ pressed }) => [styles.legalModalDone, requireAgreement && !hasReachedEnd && styles.legalModalDoneDisabled, pressed && styles.pressed]}>
              <Text style={styles.legalModalDoneText}>{requireAgreement ? hasReachedEnd ? 'Agree and continue' : 'Continue reading' : 'Done'}</Text>
              <Icon name={requireAgreement ? 'arrow-forward' : 'checkmark'} size={18} color={C.ink} />
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function FeaturePreview({ item }) {
  const [activeStep, setActiveStep] = useState(0);
  const slideAnim = useRef(new Animated.Value(0)).current;

  const CREW = [
    { id: '1', seed: 'Alex', color: C.optic },
    { id: '2', seed: 'Jordan', color: '#F6B65D' },
    { id: '3', seed: 'Taylor', color: '#9ACBE3' }
  ];

  useEffect(() => {
    if (item.key === 'insights') {
      const interval = setInterval(() => {
        setActiveStep(prev => (prev + 1) % 3);
      }, 1200);
      return () => clearInterval(interval);
    }
    if (item.key === 'squad') {
      let step = 0;
      const interval = setInterval(() => {
        step++;
        Animated.timing(slideAnim, {
          toValue: step,
          duration: 500,
          useNativeDriver: false,
        }).start();
      }, 2500);
      return () => clearInterval(interval);
    }
  }, [item.key, slideAnim]);

  const getAvatarStyle = (i) => {
    const inputRange = [];
    const translateX = [];
    const scale = [];
    const opacity = [];
    const crownOpacity = [];

    for (let k = 0; k < 100; k++) {
      inputRange.push(k);
      const pos = (((i - 1 - k) % 3) + 3) % 3;
      if (pos === 0) {
        translateX.push(0); scale.push(1); opacity.push(1); crownOpacity.push(1);
      } else if (pos === 1) {
        translateX.push(58); scale.push(0.774); opacity.push(1); crownOpacity.push(0);
      } else {
        translateX.push(-58); scale.push(0.774); opacity.push(1); crownOpacity.push(0);
      }
      
      if (pos === 2 && k < 99) {
        inputRange.push(k + 0.5);
        translateX.push(0);
        scale.push(0.5);
        opacity.push(0);
        crownOpacity.push(0);
      }
    }
    
    return {
      style: {
        transform: [
          { translateX: slideAnim.interpolate({ inputRange, outputRange: translateX }) },
          { scale: slideAnim.interpolate({ inputRange, outputRange: scale }) }
        ],
        opacity: slideAnim.interpolate({ inputRange, outputRange: opacity }),
        position: 'absolute'
      },
      crownOpacity: slideAnim.interpolate({ inputRange, outputRange: crownOpacity })
    };
  };

  return (
    <View style={[styles.featureCard, { backgroundColor: item.color }]}> 
      <View style={styles.cardOrb} />
      <View style={styles.cardCourtLine} />
      {item.key === 'insights' ? <>
        <View style={styles.featureCardTop}><View style={styles.featureIcon}><Icon name="pulse-outline" size={23} /></View><Text style={styles.previewKicker}>MATCH INTELLIGENCE</Text></View>
        <Text style={styles.cardTitle}>From scoreline to game plan.</Text>
        <View style={styles.insightPipeline}>
          {[['create-outline', 'Record'], ['scan-outline', 'Reveal'], ['trending-up-outline', 'Improve']].map(([icon, label], step) => <React.Fragment key={label}><View style={styles.pipelineStep}><View style={[styles.pipelineIcon, step === activeStep && styles.pipelineIconActive]}><Icon name={icon} size={16} color={step === activeStep ? C.ink : C.surface} /></View><Text style={styles.pipelineLabel}>{label}</Text></View>{step < 2 ? <View style={styles.pipelineLine}><Icon name="chevron-forward" size={12} color="rgba(255,255,255,.42)" /></View> : null}</React.Fragment>)}
        </View>
        <Text style={styles.previewFooter}>Clear takeaways after every match you record.</Text>
      </> : null}
      {item.key === 'booking' ? <>
        <View style={styles.bookingHeader}><View><Text style={styles.previewKicker}>COURT DISCOVERY</Text><Text style={styles.bookingTitle}>Find your next court.</Text></View><View style={styles.mapPin}><Icon name="location" size={20} color={C.ink} /></View></View>
        <View style={styles.bookingPanel}>
          <View style={styles.bookingPanelTop}><View style={styles.venueMark}><Icon name="business-outline" size={16} color={C.surface} /></View><View style={styles.venueCopy}><Text style={styles.venueTitle}>Courts near you</Text><Text style={styles.venueMeta}>Compare place, time, and fit</Text></View></View>
          <View style={styles.slotRow}>{['SEARCH', 'CHOOSE', 'BOOK'].map((label, slot) => <View key={label} style={[styles.slot, slot === 1 && styles.slotActive]}><Text style={[styles.slotNumber, slot === 1 && styles.slotNumberActive]}>0{slot + 1}</Text><Text style={[styles.slotLabel, slot === 1 && styles.slotLabelActive]}>{label}</Text></View>)}</View>
        </View>
      </> : null}
      {item.key === 'social' ? <>
        <View style={styles.featureCardTop}><Text style={styles.previewKicker}>FRIENDS & CHATS</Text><View style={styles.teamCount}><Icon name="person-add" size={12} color={C.optic} /><Text style={styles.teamCountText}>FOLLOWING</Text></View></View>
        <View style={styles.chatPanel}>
          <View style={styles.chatRow}><View style={[styles.chatAvatar, { backgroundColor: '#F6B65D' }]}><Text style={styles.playerInitials}>JC</Text></View><View style={styles.chatBubble}><Text style={styles.chatText}>Doubles at 6? I found a court.</Text></View></View>
          <View style={[styles.chatRow, styles.chatRowMine]}><View style={[styles.chatBubble, styles.chatBubbleMine]}><Text style={[styles.chatText, styles.chatTextMine]}>I'm in. Bringing Alex 🎾</Text></View></View>
        </View>
        <View style={styles.teamActions}><Text style={styles.teamAction}>FOLLOW PLAYERS</Text><View style={styles.teamActionDot} /><Text style={styles.teamAction}>ADD FRIENDS</Text><View style={styles.teamActionDot} /><Text style={styles.teamAction}>CHAT & PLAN</Text></View>
      </> : null}
      {item.key === 'squad' ? <>
        <View style={styles.featureCardTop}><Text style={styles.previewKicker}>TEAMS & RIVALRIES</Text><View style={styles.teamCount}><Icon name="people" size={13} color={C.optic} /><Text style={styles.teamCountText}>YOUR CREW</Text></View></View>
        <View style={styles.peopleVisual}>
          <View style={styles.connectionLine} />
          {CREW.map((member, i) => {
            const animStyles = getAvatarStyle(i);
            return (
              <Animated.View key={member.id} style={[styles.playerAvatar, styles.playerAvatarCenter, { backgroundColor: member.color, padding: 0 }, animStyles.style]}>
                <View style={{ flex: 1, width: '100%', height: '100%', borderRadius: 31, overflow: 'hidden' }}>
                  <ResilientImage
                    uri={`https://api.dicebear.com/9.x/notionists/png?seed=${member.seed}&backgroundColor=transparent&scale=170&translateY=12`}
                    fallback={<Icon name="person" size={25} color={C.surface} />}
                    fallbackColor={member.color}
                    showLoadingIndicator={false}
                    style={{ width: '100%', height: '100%' }}
                  />
                </View>
                <Animated.View style={[styles.playerCrown, { opacity: animStyles.crownOpacity }]}>
                  <Icon name="flash" size={9} color={C.ink} />
                </Animated.View>
              </Animated.View>
            );
          })}
        </View>
        <Text style={styles.teamTitle}>Your game has a home.</Text>
        <View style={styles.teamActions}><Text style={styles.teamAction}>BUILD A SQUAD</Text><View style={styles.teamActionDot} /><Text style={styles.teamAction}>SEND CHALLENGES</Text><View style={styles.teamActionDot} /><Text style={styles.teamAction}>TRACK RESULTS</Text></View>
      </> : null}
    </View>
  );
}

function Field({ label, icon, error, dark = false, onFocus, onBlur, secureTextEntry = false, ...props }) {
  const [focused, setFocused] = useState(false);
  const [passwordVisible, setPasswordVisible] = useState(false);
  return (
    <View style={styles.fieldWrap}>
      <Text style={[styles.label, dark && styles.labelDark]}>{label}</Text>
      <View style={[styles.field, dark && styles.fieldDark, error && styles.fieldError]}>
        <Icon name={icon} size={18} color={error ? C.brick : focused ? C.optic : dark ? '#8FA39C' : C.ink40} />
        <TextInput
          {...props}
          secureTextEntry={secureTextEntry && !passwordVisible}
          onFocus={(event) => { setFocused(true); onFocus?.(event); }}
          onBlur={(event) => { setFocused(false); onBlur?.(event); }}
          placeholderTextColor={dark ? '#71847D' : C.ink40}
          style={[styles.input, dark && styles.inputDark]}
        />
        {secureTextEntry ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={passwordVisible ? 'Hide password' : 'Show password'}
            accessibilityState={{ expanded: passwordVisible }}
            hitSlop={10}
            onPress={() => setPasswordVisible((visible) => !visible)}
            style={({ pressed }) => [styles.passwordToggle, pressed && styles.passwordTogglePressed]}
          >
            <Icon
              name={passwordVisible ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color={dark ? '#B8C6C1' : C.ink40}
            />
          </Pressable>
        ) : null}
      </View>
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

function LastUsedBadge() {
  return <View accessibilityElementsHidden importantForAccessibility="no-hide-descendants" style={[styles.lastUsedBadge, { pointerEvents: 'none' }]}><Text style={styles.lastUsedBadgeText}>Last used</Text></View>;
}

// Home Screen web app on iOS: Google sign-in runs in Safari, then this app
// picks up the parked sign-in by itself when the player switches back.
const HANDOFF_POLL_MS = 2000;
const HANDOFF_TIMEOUT_MS = 10 * 60 * 1000;

function SafariHandoffModal({ handoffId, onClose }) {
  const { finishSafariGoogleSignIn, startSafariGoogleSignIn } = useAuth();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let checking = false;
    const startedAt = Date.now();
    const check = async () => {
      if (!active || checking || document.visibilityState === 'hidden') return;
      if (Date.now() - startedAt > HANDOFF_TIMEOUT_MS) {
        setError('This sign-in expired. Tap Open Safari again to retry.');
        return;
      }
      checking = true;
      try {
        if (await finishSafariGoogleSignIn(handoffId) && active) onClose();
      } catch (failure) {
        if (active) setError(failure.message || 'Google sign-in could not be completed.');
      } finally {
        checking = false;
      }
    };
    const timer = setInterval(check, HANDOFF_POLL_MS);
    document.addEventListener('visibilitychange', check);
    window.addEventListener('focus', check);
    void check();
    return () => {
      active = false;
      clearInterval(timer);
      document.removeEventListener('visibilitychange', check);
      window.removeEventListener('focus', check);
    };
  }, [handoffId]);
  return (
    <Modal transparent animationType="fade" visible onRequestClose={onClose}>
      <View style={styles.handoffBackdrop}>
        <View style={styles.handoffCard}>
          <Text style={styles.authEyebrow}>CONTINUE IN SAFARI</Text>
          <Text style={styles.handoffTitle}>Choose your Google account in Safari</Text>
          <Text style={styles.authSubtitle}>When Safari says you're signed in, come back here. Peakle finishes signing you in automatically.</Text>
          {error ? <Text style={styles.googleError}>{error}</Text> : <ActivityIndicator color={C.optic} style={styles.handoffSpinner} />}
          <View style={styles.handoffActions}>
            <Pressable accessibilityRole="button" onPress={() => { setError(''); startSafariGoogleSignIn(handoffId); }} style={styles.forgot}><Text style={styles.authLink}>Open Safari again</Text></Pressable>
            <Pressable accessibilityRole="button" onPress={onClose} style={styles.forgot}><Text style={styles.authLink}>Cancel</Text></Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function GoogleButton({ label, onSuccess, onExpoGoSignIn, onError, onBeforeStart, dark = false, simple = false, lastUsed = false, disabled = false }) {
  const { rememberSignInMethod, startSafariGoogleSignIn } = useAuth();
  const [busy, setBusy] = useState(false);
  const [handoffId, setHandoffId] = useState(() => (Platform.OS === 'web' && isStandaloneWebApp() ? readAppHandoff() : null));
  const isExpoGo = Platform.OS === 'web' || Constants.executionEnvironment === ExecutionEnvironment.StoreClient;
  const iosClientId = process.env.EXPO_PUBLIC_GOOGLE_IOS_CLIENT_ID;
  const androidClientId = process.env.EXPO_PUBLIC_GOOGLE_ANDROID_CLIENT_ID;
  const webClientId = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID;
  const configured = Boolean(Platform.select({ ios: iosClientId, android: androidClientId, default: webClientId }));
  const [request, response, promptAsync] = Google.useAuthRequest({
    iosClientId: iosClientId || 'google-ios-client-id-not-configured',
    androidClientId: androidClientId || 'google-android-client-id-not-configured',
    webClientId: webClientId || 'google-web-client-id-not-configured',
    selectAccount: true,
  });

  useEffect(() => {
    if (!response) return;
    if (response.type !== 'success') { setBusy(false); return; }
    const accessToken = response.authentication?.accessToken || response.params?.access_token;
    const idToken = response.authentication?.idToken || response.params?.id_token;
    if (!accessToken) { setBusy(false); onError('Google did not return an access token.'); return; }
    fetch('https://openidconnect.googleapis.com/v1/userinfo', { headers: { Authorization: `Bearer ${accessToken}` } })
      .then((result) => {
        if (!result.ok) throw new Error('Unable to read your Google profile.');
        return result.json();
      })
      .then(async (googleUser) => {
        if (!idToken) throw new Error('Google did not return an ID token. Check the OAuth client configuration.');
        await onSuccess({ name: googleUser.name, email: googleUser.email, picture: googleUser.picture, provider: 'google', idToken, accessToken });
      })
      .catch((error) => onError(error.message || 'Google sign-in could not be completed.'))
      .finally(() => setBusy(false));
  }, [response]);

  const start = async () => {
    if (disabled || busy) return;
    const canStart = await onBeforeStart?.();
    if (canStart === false) return;
    await rememberSignInMethod('google');
    onError('');
    if (Platform.OS === 'web' && isStandaloneWebApp()) {
      setHandoffId(startSafariGoogleSignIn());
      return;
    }
    if (isExpoGo) {
      setBusy(true);
      try { await onExpoGoSignIn(); }
      catch (error) { onError(error.message || 'Google sign-in could not be completed.'); }
      finally { setBusy(false); }
      return;
    }
    if (!configured) { onError('Add your Google OAuth client ID to enable Google sign-in.'); return; }
    setBusy(true);
    try { await promptAsync(); } catch (_) { setBusy(false); onError('Google sign-in could not be opened.'); }
  };

  return (
    <View style={[styles.googleButtonWrap, simple && styles.methodButtonWrap]}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${label}${lastUsed ? ', last used' : ''}`} disabled={busy || (!isExpoGo && !request) || disabled} onPress={start} style={({ pressed }) => [styles.googleButton, dark && styles.googleButtonDark, simple && styles.methodButton, disabled && styles.disabledButton, pressed && styles.pressed]}>
        <Image source={require('../../public/images/google-g.png')} style={styles.googleMark} resizeMode="contain" />
        <Text style={[styles.googleText, dark && styles.googleTextDark, simple && styles.methodButtonText]}>{busy ? 'Connecting to Google…' : label}</Text>
        {simple ? <View style={styles.methodIconSpacer} /> : null}
      </Pressable>
      {lastUsed ? <LastUsedBadge /> : null}
      {handoffId ? <SafariHandoffModal handoffId={handoffId} onClose={() => { clearAppHandoff(); setHandoffId(null); }} /> : null}
    </View>
  );
}

function SignInOptions({ onEmail, onCreate, onForgot }) {
  const { signInWithGoogle, signInWithGoogleOAuth, lastSignInMethod, rememberSignInMethod } = useAuth();
  const [googleError, setGoogleError] = useState('');
  const [legalDocument, setLegalDocument] = useState(null);

  const chooseEmail = () => {
    void rememberSignInMethod('email');
    onEmail();
  };

  return (
    <SafeAreaView style={styles.signInSafe}>
      <StatusBar style="dark" backgroundColor={C.surface} />
      <ScrollView contentContainerStyle={styles.signInContent} keyboardShouldPersistTaps="handled">
        <View style={styles.signInMain}>
          <View style={styles.signInTop}>
            <Pressable accessibilityRole="button" accessibilityLabel="Forgot password?" onPress={onForgot} style={({ pressed }) => [styles.signInHelp, pressed && styles.pressed]}>
              <Icon name="help-circle-outline" size={24} color="#71717A" />
            </Pressable>
          </View>
          <View style={styles.signInHeading}>
            <Text accessibilityRole="header" style={styles.signInTitle}>Log in to Peakle</Text>
            <Text style={styles.signInSubtitle}>{COURT_BOOKING_ENABLED ? 'Book courts, find your squad, and keep your game in one place.' : 'Score matches, find your squad, and keep your game in one place.'}</Text>
          </View>
          <View style={styles.signInMethods}>
            <GoogleButton simple label="Continue with Google" lastUsed={lastSignInMethod === 'google'} onError={setGoogleError} onExpoGoSignIn={signInWithGoogleOAuth} onSuccess={signInWithGoogle} />
            <View style={styles.methodButtonWrap}>
              <Pressable accessibilityRole="button" accessibilityLabel={`Use email${lastSignInMethod === 'email' ? ', last used' : ''}`} onPress={chooseEmail} style={({ pressed }) => [styles.methodButton, pressed && styles.pressed]}>
                <Icon name="person-outline" size={20} color="#17171B" />
                <Text style={styles.methodButtonText}>Use email</Text>
                <View style={styles.methodIconSpacer} />
              </Pressable>
              {lastSignInMethod === 'email' ? <LastUsedBadge /> : null}
            </View>
          </View>
          {googleError ? <Text accessibilityRole="alert" style={styles.signInError}>{googleError}</Text> : null}
        </View>
        <View style={styles.signInFooter}>
          <Text style={styles.signInLegal}>
            By continuing, you agree to our{' '}
            <Text accessibilityRole="link" onPress={() => setLegalDocument('terms')} style={styles.signInLegalLink}>Terms of Service</Text>
            {' '}and acknowledge our{' '}
            <Text accessibilityRole="link" onPress={() => setLegalDocument('privacy')} style={styles.signInLegalLink}>Privacy Policy</Text>.
          </Text>
          <View style={styles.signInSignup}>
            <Text style={styles.signInSignupText}>Don’t have an account?</Text>
            <Pressable accessibilityRole="button" onPress={onCreate} style={({ pressed }) => [styles.signInSignupButton, pressed && styles.pressed]}><Text style={styles.signInSignupLink}>Sign up</Text></Pressable>
          </View>
        </View>
      </ScrollView>
      <LegalDocumentModal documentKey={legalDocument} onClose={() => setLegalDocument(null)} />
    </SafeAreaView>
  );
}

function Welcome({ onLogin, onCreate }) {
  return (
    <View style={styles.welcome}>
      <StatusBar style="light" backgroundColor={C.ink} />
      <View style={styles.welcomeTop}>
        <Wordmark light />
        <Text style={styles.welcomeEyebrow}>YOUR GAME, WITH RECEIPTS.</Text>
        <Text style={styles.welcomeTitle}>Play better.{`\n`}<Text style={styles.welcomeTitleAccent}>Know why.</Text></Text>
        <Text style={styles.welcomeBody}>{COURT_BOOKING_ENABLED ? 'Book the court, run the score, and turn every match into your next advantage.' : 'Run the score, rally your friends, and turn every match into your next advantage.'}</Text>
      </View>

      <View style={styles.heroWrap}>
        <View style={styles.courtArt}>
          <Image source={require('../../public/images/ball.png')} style={[styles.heroGlow, {  opacity: 0.15, backgroundColor: 'transparent' }]} tintColor={C.optic} />
          <View style={styles.courtBounds}>
            <View style={styles.courtVertical} />
            <View style={styles.courtHorizontal} />
            <View style={[styles.courtHorizontal, styles.courtHorizontalTwo]} />
          </View>

          <View style={styles.featurePanel}>
            <Text style={styles.featurePanelEyebrow}>EVERYTHING YOUR GAME NEEDS</Text>
            {[
              ['pulse-outline', 'Score every match', 'Fast, court-side scoring.'],
              ['analytics-outline', 'Understand your game', 'See the patterns behind results.'],
              COURT_BOOKING_ENABLED ? ['calendar-outline', 'Book your next court', 'Find a place and pick a time.'] : ['chatbubbles-outline', 'Friends & chats', 'Follow players and plan games together.'],
            ].map(([icon, title, body], index) => (
              <View key={title} style={[styles.welcomeFeature, index > 0 && styles.welcomeFeatureBorder]}>
                <View style={styles.welcomeFeatureIcon}><Icon name={icon} size={18} color={C.ink} /></View>
                <View style={styles.welcomeFeatureCopy}><Text style={styles.welcomeFeatureTitle}>{title}</Text><Text style={styles.welcomeFeatureBody}>{body}</Text></View>
              </View>
            ))}
          </View>
        </View>
      </View>

      <View style={styles.welcomeBottom}>
        <Pressable onPress={onCreate} style={({ pressed }) => [styles.accentButton, pressed && styles.pressed]}><Text style={styles.accentText}>Create your account</Text><Icon name="arrow-forward" /></Pressable>
        <Pressable onPress={onLogin} style={({ pressed }) => [styles.loginLink, pressed && styles.pressed]}><Text style={styles.loginPrompt}>Already have an account? <Text style={styles.loginText}>Log in</Text></Text></Pressable>
      </View>
    </View>
  );
}

function AccountForm({ kind, onBack, onAlternate, onNewAccount, onForgot, onNeedsVerification }) {
  const { signIn, signUp, rememberPendingVerification, signInWithGoogle, signInWithGoogleOAuth, lastSignInMethod, rememberSignInMethod, rememberedEmail } = useAuth();
  const [name, setName] = useState('');
  const [email, setEmail] = useState(kind === 'login' ? rememberedEmail : '');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(kind === 'login' && Boolean(rememberedEmail));
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [legalDocument, setLegalDocument] = useState(null);
  const [legalReviewRequired, setLegalReviewRequired] = useState(false);
  const pendingConsentDecision = useRef(null);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [googleError, setGoogleError] = useState('');
  const create = kind === 'create';
  useEffect(() => { if (create) recordPlayerEvent('signup_started'); }, [create]);

  const requestRegistrationConsent = ({ waitForDecision = false } = {}) => {
    setLegalReviewRequired(true);
    setLegalDocument('terms');
    if (!waitForDecision) return false;
    return new Promise((resolve) => {
      pendingConsentDecision.current?.(false);
      pendingConsentDecision.current = resolve;
    });
  };

  const closeLegalDocument = () => {
    pendingConsentDecision.current?.(false);
    pendingConsentDecision.current = null;
    setLegalDocument(null);
    setLegalReviewRequired(false);
  };

  const agreeToRegistrationTerms = () => {
    const resolveDecision = pendingConsentDecision.current;
    pendingConsentDecision.current = null;
    setAcceptedTerms(true);
    setLegalDocument(null);
    setLegalReviewRequired(false);
    if (resolveDecision) setTimeout(() => resolveDecision(true), 0);
  };

  const submit = async () => {
    if (!create) void rememberSignInMethod('email');
    setErrors({});
    if (create && name.trim().length < 2) { setErrors({ name: 'Tell us what to call you.' }); return; }
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) { setErrors({ email: 'Enter a valid email address.' }); return; }
    if (password.length < 6) { setErrors({ password: 'Use at least 6 characters.' }); return; }
    if (create && password !== confirmPassword) { setErrors({ confirmPassword: 'The passwords do not match.' }); return; }
    if (create && !acceptedTerms) {
      const agreed = await requestRegistrationConsent({ waitForDecision: true });
      if (!agreed) return;
    }
    const normalizedEmail = email.trim().toLowerCase();
    setBusy(true);
    try {
      if (create) {
        const result = await signUp({ name: name.trim(), email: normalizedEmail, password });
        recordPlayerEvent('signup_completed');
        onNewAccount({ name: name.trim(), email: normalizedEmail, needsEmailConfirmation: result.needsEmailConfirmation });
      } else {
        await signIn({ email: normalizedEmail, password, rememberMe });
      }
    } catch (error) {
      if (!create && (error.code === 'email_not_confirmed' || /email not confirmed/i.test(error.message || ''))) {
        await rememberPendingVerification(normalizedEmail);
        onNeedsVerification(normalizedEmail);
      } else {
        setErrors({ form: error.message || 'Unable to continue.' });
      }
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.authSafe}>
      <StatusBar style="light" backgroundColor={C.ink} />
      
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView style={styles.formScroll} keyboardShouldPersistTaps="handled" contentContainerStyle={styles.formContent} removeClippedSubviews>
          <View style={styles.formTop}>
            {onBack ? <Pressable accessibilityLabel="Back" onPress={onBack} style={[styles.back, styles.backDark]}><Icon name="arrow-back" color={C.surface} /></Pressable> : <View style={styles.backSpacer} />}
            <Wordmark light flush />
          </View>
          <View style={styles.formHeading}><Text style={styles.authEyebrow}>{create ? 'NEW PLAYER' : 'WELCOME BACK'}</Text><Text style={styles.authH1}>{create ? 'Start your record.' : 'Back on court.'}</Text><Text style={styles.authSubtitle}>{create ? 'A better read on your game starts with one match.' : 'Your courts, squad, and match history are waiting.'}</Text></View>
          <View style={styles.authDivider} />
          {create && <Field dark label="YOUR NAME" icon="person-outline" value={name} onChangeText={setName} placeholder="Julian Cruz" autoCapitalize="words" autoComplete="name" textContentType="name" error={errors.name} />}
          <Field dark label="EMAIL" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} autoComplete="email" textContentType="emailAddress" error={errors.email} />
          <Field dark label="PASSWORD" icon="lock-closed-outline" value={password} onChangeText={setPassword} placeholder={create ? 'At least 6 characters' : 'Password'} secureTextEntry autoComplete={create ? 'new-password' : 'current-password'} textContentType={create ? 'newPassword' : 'password'} importantForAutofill="yes" error={errors.password} />
          {create && <Field dark label="CONFIRM PASSWORD" icon="shield-checkmark-outline" value={confirmPassword} onChangeText={setConfirmPassword} placeholder="Enter it again" secureTextEntry autoComplete="new-password" textContentType="newPassword" importantForAutofill="yes" error={errors.confirmPassword} />}
          {!create ? <View style={styles.loginOptions}>
            <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: rememberMe }} onPress={() => setRememberMe((value) => !value)} style={({ pressed }) => [styles.checkboxRow, pressed && styles.pressed]}>
              <View style={[styles.checkbox, rememberMe && styles.checkboxChecked]}>{rememberMe ? <Icon name="checkmark" size={14} color={C.ink} /> : null}</View>
              <Text style={styles.checkboxLabel}>Remember me</Text>
            </Pressable>
            <Pressable onPress={onForgot} style={styles.forgot}><Text style={styles.authLink}>Forgot password?</Text></Pressable>
          </View> : null}
          {errors.form ? <Text style={styles.googleError}>{errors.form}</Text> : null}
          <View style={styles.authMethodWrap}>
            <Pressable accessibilityRole="button" accessibilityLabel={create ? 'Continue' : `Log in${lastSignInMethod === 'email' ? ', last used' : ''}`} disabled={busy} onPress={submit} style={({ pressed }) => [styles.primary, styles.authPrimary, (pressed || busy) && styles.pressed]}><Text style={styles.authPrimaryText}>{busy ? 'One moment…' : create ? 'Continue' : 'Log in'}</Text><Icon name="arrow-forward" color={C.ink} /></Pressable>
            {!create && lastSignInMethod === 'email' ? <LastUsedBadge /> : null}
          </View>
          <View style={styles.orRow}><View style={[styles.orLine, styles.orLineDark]} /><Text style={[styles.orText, styles.orTextDark]}>OR</Text><View style={[styles.orLine, styles.orLineDark]} /></View>
          <GoogleButton dark onBeforeStart={() => create && !acceptedTerms ? requestRegistrationConsent({ waitForDecision: true }) : true} lastUsed={!create && lastSignInMethod === 'google'} label={create ? 'Sign up with Google' : 'Sign in with Google'} onError={setGoogleError} onExpoGoSignIn={signInWithGoogleOAuth} onSuccess={async (googleUser) => { setGoogleError(''); await signInWithGoogle(googleUser); }} />
          {googleError ? <Text style={styles.googleError}>{googleError}</Text> : null}
          <View style={styles.switchRow}><Text style={styles.switchCopyDark}>{create ? 'Already have an account?' : 'New to Peakle?'}</Text><Pressable onPress={onAlternate}><Text style={styles.switchLinkDark}>{create ? 'Log in' : 'Create account'}</Text></Pressable></View>
        </ScrollView>
      </KeyboardAvoidingView>
      <LegalDocumentModal documentKey={legalDocument} requireAgreement={legalReviewRequired} onAgree={agreeToRegistrationTerms} onClose={closeLegalDocument} />
    </SafeAreaView>
  );
}

function VerifyEmail({ email, onLogin, onUseDifferentEmail }) {
  const { resendSignupConfirmation, signInWithGoogle, signInWithGoogleOAuth, authLinkError } = useAuth();
  const [cooldown, setCooldown] = useState(60);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [googleError, setGoogleError] = useState('');

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = setTimeout(() => setCooldown((seconds) => Math.max(0, seconds - 1)), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const resend = async () => {
    if (busy || cooldown > 0) return;
    setBusy(true); setMessage(''); setError('');
    try {
      await resendSignupConfirmation(email);
      setMessage('If this address is eligible, a fresh verification link is on its way.');
      setCooldown(60);
    } catch (reason) {
      setError(reason.message || 'Unable to resend the verification email. Try again shortly.');
    } finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.authSafe}>
      <StatusBar style="light" backgroundColor={C.ink} />
      <ScrollView contentContainerStyle={styles.recoveryContent}>
        <View style={styles.formTop}><View style={styles.recoveryBrandSpacer} /><Wordmark light flush /></View>
        <View style={styles.recoveryIcon}><Icon name="mail-open-outline" size={25} color={C.ink} /></View>
        <Text style={styles.authEyebrow}>VERIFY YOUR ACCOUNT</Text>
        <Text style={styles.authH1}>Check your inbox.</Text>
        <Text style={styles.authSubtitle}>Check <Text style={styles.verificationEmail}>{email}</Text> for a secure verification link. Open it on this device to continue setting up Peakle.</Text>
        <View style={styles.verificationNote}><Icon name="shield-checkmark-outline" size={18} color={C.optic} /><Text style={styles.verificationNoteText}>Peakle stays locked until the email address is verified. The app will continue automatically after the link opens.</Text></View>
        {message ? <Text accessibilityRole="alert" style={styles.verificationSuccess}>{message}</Text> : null}
        {error || authLinkError ? <Text accessibilityRole="alert" style={styles.googleError}>{error || authLinkError}</Text> : null}
        <Pressable disabled={busy || cooldown > 0} onPress={resend} style={({ pressed }) => [styles.primary, styles.authPrimary, styles.verificationPrimary, (pressed || busy || cooldown > 0) && styles.disabledButton]}><Text style={styles.authPrimaryText}>{busy ? 'Sending…' : cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend verification email'}</Text><Icon name="refresh-outline" color={C.ink} /></Pressable>
        <View style={styles.orRow}><View style={[styles.orLine, styles.orLineDark]} /><Text style={[styles.orText, styles.orTextDark]}>ALREADY USE GOOGLE?</Text><View style={[styles.orLine, styles.orLineDark]} /></View>
        <Text style={styles.verificationGoogleHint}>If you originally joined with Google, continue with Google instead. Google accounts do not need a separate Peakle verification email.</Text>
        <GoogleButton dark label="Continue with Google" onError={setGoogleError} onExpoGoSignIn={signInWithGoogleOAuth} onSuccess={async (googleUser) => { setGoogleError(''); await signInWithGoogle(googleUser); }} />
        {googleError ? <Text accessibilityRole="alert" style={styles.googleError}>{googleError}</Text> : null}
        <Pressable onPress={onLogin} style={({ pressed }) => [styles.verificationSecondary, pressed && styles.pressed]}><Text style={styles.switchLinkDark}>Back to log in</Text></Pressable>
        <Pressable onPress={onUseDifferentEmail} style={({ pressed }) => [styles.verificationSecondary, pressed && styles.pressed]}><Text style={styles.authLink}>Use a different email</Text></Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function ForgotPassword({ onBack, onLogin }) {
  const { requestPasswordReset } = useAuth();
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const submit = async () => {
    const normalizedEmail = email.trim().toLowerCase();
    setError('');
    if (!/^\S+@\S+\.\S+$/.test(normalizedEmail)) { setError('Enter a valid email address.'); return; }
    setBusy(true);
    try { await requestPasswordReset(normalizedEmail); setSent(true); }
    catch (reason) { setError(reason.message || 'Unable to send the reset email.'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.authSafe}>
      <StatusBar style="light" backgroundColor={C.ink} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.recoveryContent}>
          <View style={styles.formTop}><Pressable accessibilityLabel="Back" onPress={onBack} style={[styles.back, styles.backDark]}><Icon name="arrow-back" color={C.surface} /></Pressable><Wordmark light flush /></View>
          <View style={styles.recoveryIcon}><Icon name={sent ? 'mail-open-outline' : 'key-outline'} size={25} color={C.ink} /></View>
          <Text style={styles.authEyebrow}>{sent ? 'CHECK YOUR INBOX' : 'ACCOUNT RECOVERY'}</Text>
          <Text style={styles.authH1}>{sent ? 'Reset link sent.' : 'Find your way back.'}</Text>
          <Text style={styles.authSubtitle}>{sent ? `If an account exists for ${email.trim()}, you’ll receive a secure password-reset link shortly.` : 'Enter the email attached to your Peakle account and we’ll send you a secure reset link.'}</Text>
          {!sent ? <>
            <View style={styles.authDivider} />
            <Field dark label="EMAIL" icon="mail-outline" value={email} onChangeText={setEmail} placeholder="you@example.com" keyboardType="email-address" autoCapitalize="none" autoCorrect={false} error={error} />
            <Pressable disabled={busy} onPress={submit} style={({ pressed }) => [styles.primary, styles.authPrimary, (pressed || busy) && styles.pressed]}><Text style={styles.authPrimaryText}>{busy ? 'Sending…' : 'Send reset link'}</Text><Icon name="arrow-forward" color={C.ink} /></Pressable>
          </> : <Pressable onPress={onLogin} style={({ pressed }) => [styles.primary, styles.authPrimary, styles.recoveryButton, pressed && styles.pressed]}><Text style={styles.authPrimaryText}>Back to log in</Text><Icon name="arrow-forward" color={C.ink} /></Pressable>}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

function ResetPassword() {
  const { updatePassword, authLinkError } = useAuth();
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setError('');
    if (password.length < 8) { setError('Use at least 8 characters.'); return; }
    if (password !== confirmation) { setError('The passwords do not match.'); return; }
    setBusy(true);
    try { await updatePassword(password); }
    catch (reason) { setError(reason.message || 'Unable to update your password. Request a new reset link.'); }
    finally { setBusy(false); }
  };

  return (
    <SafeAreaView style={styles.authSafe}>
      <StatusBar style="light" backgroundColor={C.ink} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.recoveryContent}>
          <View style={styles.formTop}><View style={styles.recoveryBrandSpacer} /><Wordmark light flush /></View>
          <View style={styles.recoveryIcon}><Icon name="shield-checkmark-outline" size={25} color={C.ink} /></View>
          <Text style={styles.authEyebrow}>SECURE YOUR ACCOUNT</Text>
          <Text style={styles.authH1}>Choose a new password.</Text>
          <Text style={styles.authSubtitle}>Make it at least 8 characters and different from passwords you use elsewhere.</Text>
          <View style={styles.authDivider} />
          <Field dark label="NEW PASSWORD" icon="lock-closed-outline" value={password} onChangeText={setPassword} placeholder="At least 8 characters" secureTextEntry />
          <Field dark label="CONFIRM PASSWORD" icon="shield-checkmark-outline" value={confirmation} onChangeText={setConfirmation} placeholder="Enter it again" secureTextEntry error={error || authLinkError} />
          <Pressable disabled={busy || Boolean(authLinkError)} onPress={submit} style={({ pressed }) => [styles.primary, styles.authPrimary, (pressed || busy || authLinkError) && styles.pressed]}><Text style={styles.authPrimaryText}>{busy ? 'Updating…' : 'Update password'}</Text><Icon name="arrow-forward" color={C.ink} /></Pressable>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

// Route the Android hardware back button to the same handler as the on-screen arrow.
function useHardwareBack(handler) {
  const handlerRef = useRef(handler);
  handlerRef.current = handler;
  useEffect(() => {
    if (Platform.OS !== 'android') return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => handlerRef.current());
    return () => subscription.remove();
  }, []);
}

function DeviceIntro({ onComplete, initialIndex = 0 }) {
  const { width, height } = useWindowDimensions();
  const compact = height < 700 || width < 360;
  const [index, setIndex] = useState(initialIndex);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const item = features[index];
  const translate = useRef(new Animated.Value(0)).current;
  useEffect(() => { translate.setValue(12); Animated.spring(translate, { toValue: 0, useNativeDriver: Platform.OS !== 'web', tension: 80, friction: 10 }).start(); }, [index, translate]);
  const finish = async () => {
    if (busy) return;
    setBusy(true); setError('');
    try { await onComplete(); }
    catch (_) { setError('Peakle could not continue. Please try again.'); }
    finally { setBusy(false); }
  };
  const advance = () => index < features.length - 1 ? setIndex(index + 1) : finish();
  const goBack = () => {
    if (busy || index === 0) return false;
    setError(''); setIndex(index - 1);
    return true;
  };
  useHardwareBack(goBack);
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" backgroundColor={C.paper} />
      <View style={styles.onboardContent}>
        <View style={styles.onboardGlow} />
        <View style={styles.onboardTop}>{index > 0 ? <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={goBack} style={styles.back}><Icon name="arrow-back" /></Pressable> : <Wordmark />}<Text style={styles.stepText}>{String(index + 1).padStart(2, '0')} · THE GOOD STUFF</Text></View><Progress step={index} total={features.length} />
        <ScrollView style={styles.onboardScroll} contentContainerStyle={styles.onboardScrollContent} showsVerticalScrollIndicator={false}>
          <Animated.View style={[styles.featureArea, { transform: [{ translateY: translate }], opacity: translate.interpolate({ inputRange: [0, 12], outputRange: [1, .35] }) }]}> 
            <View style={styles.helloRow}><View style={styles.helloDot}><Icon name="sparkles" size={11} color={C.teal} /></View><Text style={styles.hello}>Welcome to Peakle.</Text></View>
            <Text style={styles.featureEyebrow}>{item.eyebrow}</Text><Text style={[styles.featureTitle, compact && styles.featureTitleCompact]}>{item.title}</Text><Text style={styles.featureBody}>{item.body}</Text>
            <FeaturePreview item={item} />
          </Animated.View>
        </ScrollView>
        <View>
          {error ? <Text accessibilityRole="alert" style={styles.onboardingError}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={advance} style={({ pressed }) => [styles.primary, styles.onboardPrimary, (pressed || busy) && styles.pressed]}><Text style={styles.onboardPrimaryText}>{busy ? 'Saving…' : index === features.length - 1 ? 'Continue to Peakle' : 'Next feature'}</Text><View style={styles.primaryArrow}><Icon name="arrow-forward" color={C.surface} size={18} /></View></Pressable>
          <Pressable disabled={busy} onPress={finish} style={styles.skip}><Text style={styles.skipText}>Skip overview</Text></Pressable>
        </View>
      </View>
    </SafeAreaView>
  );
}

function Personalize({ profile, onBack }) {
  const { completeOnboarding } = useAuth();
  const [stage, setStage] = useState('name');
  const [name, setName] = useState(profile.name || '');
  // The photo is optional and editable from Profile, so first-run setup keeps
  // only what other players and game suggestions need: a name and home area.
  const avatar = profile.picture || '';
  const [preference, setPreference] = useState(profile.preference || 'Doubles');
  const [location, setLocation] = useState(profile.location || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const continueFromName = () => {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) { setError('Display name must be between 2 and 80 characters.'); return; }
    setName(cleanName); setError(''); setStage('game');
  };
  const goBack = () => {
    if (busy) return true;
    setError('');
    if (stage === 'game') setStage('name');
    else if (onBack) onBack();
    else return false;
    return true;
  };
  useHardwareBack(goBack);
  const finish = async () => {
    const cleanName = name.trim();
    if (cleanName.length < 2 || cleanName.length > 80) { setError('Display name must be between 2 and 80 characters.'); return; }
    if (!location.trim()) { setError('Add your home area.'); return; }
    setBusy(true); setError('');
    try { await completeOnboarding({ ...profile, name: cleanName, avatar, preference, location: location.trim() }); recordPlayerEvent('onboarding_completed'); }
    catch (reason) { setError(reason.message || 'Your profile could not be saved.'); }
    finally { setBusy(false); }
  };
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="dark" backgroundColor={C.paper} />
      <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={styles.personalContent}>
        <View style={styles.formTop}>{onBack || stage !== 'name' ? <Pressable accessibilityRole="button" accessibilityLabel="Back" disabled={busy} onPress={goBack} style={styles.back}><Icon name="arrow-back" /></Pressable> : <View style={styles.backSpacer} />}<Text style={styles.stepText}>{stage === 'name' ? 'YOUR NAME' : 'YOUR GAME'}</Text></View>
        <Progress step={stage === 'name' ? 0 : 1} total={2} />

        {stage === 'name' ? <>
          <View style={styles.personalHead}><Text style={styles.eyebrow}>LET’S MEET</Text><Text style={styles.h1}>What should we call you?</Text><Text style={styles.subtitle}>This is the name other players will see on games, teams, and match results.</Text></View>
          <View style={styles.nameSpotlight}><View style={styles.nameIcon}><Icon name="person-outline" size={24} color={C.teal} /></View><Field label="DISPLAY NAME" icon="create-outline" value={name} onChangeText={(value) => { setName(value); setError(''); }} placeholder="Your name" autoCapitalize="words" autoFocus returnKeyType="next" onSubmitEditing={continueFromName} /></View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable onPress={continueFromName} style={({ pressed }) => [styles.accentButton, styles.stageButton, pressed && styles.pressed]}><Text style={styles.accentText}>Continue</Text><Icon name="arrow-forward" /></Pressable>
        </> : null}


        {stage === 'game' ? <>
          <View style={styles.personalHead}><Text style={styles.eyebrow}>LAST STEP</Text><Text style={styles.h1}>Find your kind of game.</Text><Text style={styles.subtitle}>Two quick details help Peakle recommend nearby games and players. You can add a photo later from your profile.</Text></View>
          <Text style={[styles.label, styles.sectionLabel]}>I PLAY MOSTLY</Text><View style={styles.choiceRow}>{['Doubles', 'Singles', 'Both'].map((value) => <Pressable key={value} onPress={() => setPreference(value)} style={[styles.choice, preference === value && styles.optionActive]}><Icon name={value === 'Doubles' ? 'people-outline' : value === 'Singles' ? 'person-outline' : 'swap-horizontal-outline'} color={preference === value ? C.ink : C.ink40} /><Text style={[styles.choiceText, preference === value && styles.optionActiveText]}>{value}</Text></Pressable>)}</View>
          <HomeAreaPicker value={location} onChange={setLocation} forceLight />
          <View style={styles.permissionNote}><View style={styles.noteIcon}><Icon name="notifications-outline" size={18} color={C.teal} /></View><Text style={styles.noteText}><Text style={styles.noteStrong}>You’re in control.</Text> We’ll ask before using location or sending match reminders.</Text></View>
          {error ? <Text style={styles.error}>{error}</Text> : null}
          <Pressable disabled={busy} onPress={finish} style={({ pressed }) => [styles.accentButton, (pressed || busy) && styles.pressed]}><Text style={styles.accentText}>{busy ? 'Setting up…' : 'Enter Peakle'}</Text><Icon name="arrow-forward" /></Pressable>
        </> : null}
      </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

export default function AuthFlowScreen({ initialScreen = 'welcome' }) {
  const { user, pendingVerificationEmail, clearPendingVerification } = useAuth();
  const [screen, setScreen] = useState(() => ['welcome', 'login'].includes(initialScreen) && pendingVerificationEmail ? 'verify-email' : initialScreen);
  const [verificationEmail, setVerificationEmail] = useState(pendingVerificationEmail || '');
  const [profile, setProfile] = useState(() => initialScreen === 'complete-profile' ? { name: user?.name || '', email: user?.email, picture: user?.picture, location: user?.location, skill: user?.skill, preference: user?.preference } : null);

  const [introIndex, setIntroIndex] = useState(0);
  const fade = useRef(new Animated.Value(1)).current;
  const goTo = (next) => {
    Animated.timing(fade, { toValue: 0, duration: 140, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start(() => {
      setScreen(next);
      fade.setValue(0);
      Animated.timing(fade, { toValue: 1, duration: 240, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }).start();
    });
  };

  let content;
  if (screen === 'reset-password') content = <ResetPassword />;
  else if (screen === 'new-user-overview') content = <DeviceIntro initialIndex={introIndex} onComplete={() => goTo('complete-profile')} />;
  else if (user && !user.onboardingCompleted) content = <Personalize profile={profile || { name: user.name || '', email: user.email, picture: user.picture, location: user.location, skill: user.skill, preference: user.preference }} onBack={() => { setIntroIndex(features.length - 1); goTo('new-user-overview'); }} />;
  else if (screen === 'welcome') content = <Welcome onLogin={() => goTo('login')} onCreate={() => goTo('create')} />;
  else if (screen === 'login') content = <AccountForm kind="login" onBack={() => goTo('welcome')} onAlternate={() => goTo('create')} onForgot={() => goTo('forgot-password')} onNeedsVerification={(email) => { setVerificationEmail(email); goTo('verify-email'); }} />;
  else if (screen === 'forgot-password') content = <ForgotPassword onBack={() => goTo('login')} onLogin={() => goTo('login')} />;
  else if (screen === 'verify-email') content = <VerifyEmail email={verificationEmail || pendingVerificationEmail} onLogin={() => goTo('login')} onUseDifferentEmail={async () => { await clearPendingVerification(); setVerificationEmail(''); setProfile(null); goTo('create'); }} />;
  else if (screen === 'create') content = <AccountForm kind="create" onBack={() => goTo('login')} onAlternate={() => goTo('login')} onNewAccount={(value) => { setProfile({ name: value.name, email: value.email }); if (value.needsEmailConfirmation) { setVerificationEmail(value.email); goTo('verify-email'); } else { goTo('personalize'); } }} />;
  else content = <Personalize profile={profile || { name: user?.name || '', email: user?.email, picture: user?.picture, location: user?.location, skill: user?.skill, preference: user?.preference }} onBack={screen === 'complete-profile' ? undefined : () => goTo('create')} />;

  return (
    <Animated.View {...webLayout('auth')} style={{ flex: 1, opacity: fade, transform: [{ translateY: fade.interpolate({ inputRange: [0, 1], outputRange: [8, 0] }) }] }}>
      {content}
    </Animated.View>
  );
}

const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .12, shadowRadius: 20, shadowOffset: { width: 0, height: 8 } }, android: { elevation: 5 } });
const styles = createMobileStyleSheet({
  flex: { flex: 1 }, safe: { flex: 1, backgroundColor: C.paper }, authSafe: { flex: 1, backgroundColor: C.ink }, pressed: { opacity: .78, transform: [{ scale: .99 }] },
  lastUsedBadge: { position: 'absolute', top: -9, right: 20, paddingHorizontal: 7, paddingVertical: 2, borderRadius: 5, backgroundColor: '#3185A3' },
  lastUsedBadgeText: { color: C.surface, fontSize: 12, lineHeight: 16, fontWeight: '600' },
  authMethodWrap: { position: 'relative', overflow: 'visible' },
  wordmark: { flexDirection: 'row', alignItems: 'center', gap: 9 }, wordmarkOffset: { marginTop: 8 }, mark: { width: 28, height: 32, borderRadius: 11, borderBottomLeftRadius: 5, borderBottomRightRadius: 5, backgroundColor: C.ink, overflow: 'hidden' }, markLight: { backgroundColor: C.surface }, markBall: { position: 'absolute', right: 4, top: 4, width: 8, height: 8, borderRadius: 4, backgroundColor: C.optic }, markLine: { position: 'absolute', left: 0, right: 0, bottom: 8, height: 2, backgroundColor: C.optic }, markLineLight: { backgroundColor: C.ink }, word: { color: C.ink, fontSize: 23, fontWeight: '900', letterSpacing: -.8 }, wordLight: { color: C.surface },
  welcome: { flex: 1, backgroundColor: C.ink }, welcomeTop: { paddingHorizontal: 24, paddingTop: Platform.OS === 'ios' ? 62 : 44 }, welcomeEyebrow: { marginTop: 30, color: '#8FA39C', fontSize: 9, fontWeight: '900', letterSpacing: 1.45 }, welcomeTitle: { marginTop: 8, color: C.surface, fontSize: 49, lineHeight: 49, fontWeight: '900', letterSpacing: -2.2 }, welcomeTitleAccent: { color: C.optic }, welcomeBody: { maxWidth: 340, marginTop: 13, color: '#B8C6C1', fontSize: 14, lineHeight: 20 },
  heroWrap: { flex: 1, minHeight: 238, paddingHorizontal: 24, paddingTop: 20, paddingBottom: 12 }, courtArt: { flex: 1, minHeight: 226, borderWidth: 1, borderColor: '#35504B', borderRadius: 24, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, backgroundColor: '#173A36', overflow: 'hidden' }, heroGlow: { position: 'absolute', right: -38, top: -56, width: 190, height: 190, borderRadius: 95, backgroundColor: 'rgba(214,233,74,.08)' }, courtBounds: { position: 'absolute', left: 27, right: 27, top: 19, bottom: 57, borderWidth: 1, borderTopWidth: 0, borderColor: 'rgba(255,255,255,.16)' }, courtVertical: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(255,255,255,.14)' }, courtHorizontal: { position: 'absolute', left: 0, right: 0, top: '35%', height: 1, backgroundColor: 'rgba(255,255,255,.14)' }, courtHorizontalTwo: { top: '65%' }, ball: { position: 'absolute', right: 32, top: 27, width: 38, height: 38, borderRadius: 19, backgroundColor: C.optic, ...shadow }, ballDot: { position: 'absolute', width: 3, height: 3, left: 10, top: 9, borderRadius: 2, backgroundColor: 'rgba(14,35,33,.32)' }, ballDotTwo: { left: 24, top: 15 }, ballDotThree: { left: 17, top: 27 },
  featurePanel: { position: 'absolute', left: 18, right: 18, top: 22, bottom: 22, paddingHorizontal: 15, paddingTop: 13, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', borderRadius: 18, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, backgroundColor: '#0A1F1C' }, featurePanelEyebrow: { marginBottom: 4, color: '#758A82', fontSize: 7, fontWeight: '900', letterSpacing: 1 }, welcomeFeature: { flex: 1, minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 11 }, welcomeFeatureBorder: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: '#314943' }, welcomeFeatureIcon: { width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, welcomeFeatureIconMuted: { backgroundColor: '#29443E' }, welcomeFeatureCopy: { flex: 1 }, welcomeFeatureTitle: { color: C.surface, fontSize: 11, fontWeight: '900' }, welcomeFeatureBody: { marginTop: 2, color: '#91A39D', fontSize: 8, lineHeight: 11 },
  welcomeBottom: { paddingHorizontal: 24, paddingTop: 2, paddingBottom: Platform.OS === 'ios' ? 30 : 22 }, accentButton: { minHeight: 56, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.optic }, accentText: { color: C.ink, fontSize: 14, fontWeight: '900' }, loginLink: { minHeight: 42, alignItems: 'center', justifyContent: 'center' }, loginPrompt: { color: '#8FA39C', fontSize: 11, fontWeight: '600' }, loginText: { color: C.surface, fontWeight: '900' },
  formScroll: { flex: 1, overflow: 'hidden' }, formContent: { flexGrow: 1, justifyContent: 'flex-start', paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32 }, formTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, back: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface, alignItems: 'center', justifyContent: 'center' }, backDark: { borderColor: '#2E4C46', backgroundColor: '#14332F' }, formHeading: { marginTop: 34 }, eyebrow: { color: C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, authEyebrow: { color: C.optic, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, h1: { marginTop: 7, color: C.ink, fontSize: 35, lineHeight: 40, fontWeight: '900', letterSpacing: -1.2 }, authH1: { marginTop: 7, color: C.surface, fontSize: 35, lineHeight: 40, fontWeight: '900', letterSpacing: -1.2 }, subtitle: { marginTop: 10, color: C.ink70, fontSize: 13, lineHeight: 20 }, authSubtitle: { maxWidth: 340, marginTop: 10, color: '#B8C6C1', fontSize: 13, lineHeight: 20 }, authDivider: { height: 1, marginVertical: 24, backgroundColor: '#35504B' }, kitchen: { height: 8, marginVertical: 27 }, solid: { height: 2, backgroundColor: C.ink }, dashed: { marginTop: 4, borderTopWidth: 1, borderStyle: 'dashed', borderColor: C.ink40 }, solidDark: { backgroundColor: 'rgba(255,255,255,.32)' }, dashedDark: { borderColor: 'rgba(255,255,255,.22)' }, fieldWrap: { marginBottom: 17 }, label: { marginBottom: 7, color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, labelDark: { color: '#8FA39C' }, field: { minHeight: 55, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, fieldDark: { borderColor: '#2E4C46', backgroundColor: '#14332F' }, fieldError: { borderColor: C.brick }, input: { flex: 1, color: C.ink, fontSize: 14, paddingVertical: 0, outlineStyle: 'none' }, inputDark: { color: C.surface }, error: { marginTop: 5, color: C.brick, fontSize: 9 }, loginOptions: { marginTop: -5, marginBottom: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, forgot: { minHeight: 32, justifyContent: 'center' }, checkboxRow: { minHeight: 32, flexDirection: 'row', alignItems: 'center', gap: 8 }, checkbox: { width: 20, height: 20, borderRadius: 6, borderWidth: 1, borderColor: '#60746D', alignItems: 'center', justifyContent: 'center', backgroundColor: '#14332F' }, checkboxChecked: { borderColor: C.optic, backgroundColor: C.optic }, checkboxLabel: { color: '#B8C6C1', fontSize: 11, fontWeight: '700' }, consentRow: { padding: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 10, borderWidth: 1, borderColor: '#2E4C46', borderRadius: 13, backgroundColor: '#14332F' }, consentRowError: { borderColor: C.brick }, consentText: { flex: 1, color: '#9DAFA9', fontSize: 9, lineHeight: 14 }, consentLink: { color: C.surface, fontWeight: '900' }, consentError: { marginTop: 5, color: C.brick, fontSize: 9, lineHeight: 13 }, link: { color: C.teal, fontSize: 11, fontWeight: '800' }, authLink: { color: C.optic, fontSize: 11, fontWeight: '800' }, primary: { minHeight: 56, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.ink }, authPrimary: { backgroundColor: C.optic }, accountSubmit: { marginTop: 16 }, primaryText: { color: C.surface, fontSize: 14, fontWeight: '900' }, authPrimaryText: { color: C.ink, fontSize: 14, fontWeight: '900' }, switchRow: { marginTop: 21, flexDirection: 'row', justifyContent: 'center', gap: 5 }, switchCopy: { color: C.ink40, fontSize: 11 }, switchCopyDark: { color: '#8FA39C', fontSize: 11 }, switchLink: { color: C.teal, fontSize: 11, fontWeight: '900' }, switchLinkDark: { color: C.surface, fontSize: 11, fontWeight: '900' },
  handoffBackdrop: { flex: 1, padding: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(5,18,16,.72)' }, handoffCard: { width: '100%', maxWidth: 400, padding: 22, borderRadius: 22, backgroundColor: C.ink }, handoffTitle: { marginTop: 7, color: C.surface, fontSize: 26, lineHeight: 31, fontWeight: '900', letterSpacing: -0.6 }, handoffSpinner: { marginTop: 18 }, handoffActions: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  googleButtonWrap: { position: 'relative', minHeight: 55, overflow: 'visible' }, googleButton: { minHeight: 55, paddingHorizontal: Platform.OS === 'ios' ? 16 : 12, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: '#747775', borderRadius: 14, backgroundColor: '#FFFFFF', overflow: 'hidden' }, googleButtonDark: { borderColor: '#2E4C46', backgroundColor: '#14332F' }, googleMark: { width: 20, height: 20 }, googleText: { flex: 1, color: '#1F1F1F', fontSize: 14, fontWeight: '600' }, googleTextDark: { color: C.surface }, googleError: { marginTop: 7, color: C.brick, fontSize: 9, lineHeight: 13, textAlign: 'center' }, orRow: { marginVertical: 18, flexDirection: 'row', alignItems: 'center', gap: 9 }, orLine: { flex: 1, height: 1, backgroundColor: C.line }, orLineDark: { backgroundColor: '#2E4C46' }, orText: { color: C.ink40, fontSize: 7, fontWeight: '900', letterSpacing: .7 }, orTextDark: { color: '#8FA39C' },
  legalConsentRow: { marginTop: 15, paddingHorizontal: 2, flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  legalCheckboxError: { borderColor: C.brick },
  legalConsentText: { flex: 1, color: '#9DAFA9', fontSize: 9, lineHeight: 14 },
  legalConsentRequired: { color: C.optic, fontSize: 8, fontWeight: '900', letterSpacing: .8 },
  legalConsentLink: { color: C.surface, fontWeight: '900' },
  legalConsentError: { marginTop: 6, marginLeft: 32, color: C.brick, fontSize: 9, lineHeight: 13 },
  progress: { height: 4, marginTop: 19, flexDirection: 'row', gap: 6 }, progressItem: { flex: 1, borderRadius: 2, backgroundColor: C.line }, progressActive: { backgroundColor: C.ink }, onboardContent: { flex: 1, width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 24, overflow: 'hidden' }, onboardGlow: { position: 'absolute', width: 260, height: 260, borderRadius: 130, right: -150, top: 95, backgroundColor: 'rgba(214,233,74,.15)' }, onboardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, stepText: { color: C.ink40, fontSize: 8, fontWeight: '900', letterSpacing: 1 }, featureArea: { flexShrink: 0 }, helloRow: { flexDirection: 'row', alignItems: 'center', gap: 8 }, helloDot: { width: 24, height: 24, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash }, hello: { color: C.ink40, fontSize: 12, fontWeight: '700' }, featureEyebrow: { marginTop: 22, color: C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1.2 }, featureTitle: { maxWidth: 350, marginTop: 8, color: C.ink, fontSize: 34, lineHeight: 38, fontWeight: '900', letterSpacing: -1 }, featureTitleCompact: { fontSize: 28, lineHeight: 32 }, featureBody: { maxWidth: 335, marginTop: 11, color: C.ink70, fontSize: 13, lineHeight: 19 }, featureCard: { minHeight: 252, flexShrink: 0, marginTop: 22, padding: 18, borderRadius: 26, borderBottomLeftRadius: 10, borderBottomRightRadius: 10, overflow: 'hidden', ...shadow }, cardOrb: { position: 'absolute', width: 170, height: 170, borderRadius: 85, right: -76, top: -68, backgroundColor: 'rgba(255,255,255,.07)' }, cardCourtLine: { position: 'absolute', width: 150, height: 210, right: -48, bottom: -85, borderWidth: 1, borderColor: 'rgba(255,255,255,.08)', transform: [{ rotate: '18deg' }] }, featureCardTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, featureIcon: { width: 46, height: 46, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic, ...shadow }, previewKicker: { color: 'rgba(255,255,255,.7)', fontSize: 7, fontWeight: '900', letterSpacing: 1.1 }, cardTitle: { maxWidth: 280, marginTop: 20, color: C.surface, fontSize: 23, lineHeight: 27, fontWeight: '900', letterSpacing: -.6 }, insightPipeline: { marginTop: 23, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }, pipelineStep: { alignItems: 'center', gap: 7 }, pipelineIcon: { width: 42, height: 42, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(255,255,255,.18)', backgroundColor: 'rgba(14,35,33,.14)' }, pipelineIconActive: { borderColor: C.optic, backgroundColor: C.optic }, pipelineLabel: { color: C.surface, fontSize: 8, fontWeight: '800' }, pipelineLine: { flex: 1, height: 1, marginHorizontal: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.16)' }, previewFooter: { marginTop: 17, color: 'rgba(255,255,255,.66)', fontSize: 8, textAlign: 'center' }, bookingHeader: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }, bookingTitle: { marginTop: 8, color: C.surface, fontSize: 23, fontWeight: '900', letterSpacing: -.6 }, mapPin: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, bookingPanel: { marginTop: 23, padding: 14, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', borderRadius: 18, backgroundColor: 'rgba(14,35,33,.18)' }, bookingPanelTop: { flexDirection: 'row', alignItems: 'center' }, venueMark: { width: 36, height: 36, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,.13)' }, venueCopy: { flex: 1, marginLeft: 10 }, venueTitle: { color: C.surface, fontSize: 11, fontWeight: '900' }, venueMeta: { marginTop: 3, color: 'rgba(255,255,255,.58)', fontSize: 8 }, slotRow: { marginTop: 15, flexDirection: 'row', gap: 7 }, slot: { flex: 1, height: 53, padding: 8, justifyContent: 'space-between', borderRadius: 11, backgroundColor: 'rgba(255,255,255,.1)' }, slotActive: { backgroundColor: C.optic }, slotNumber: { color: 'rgba(255,255,255,.5)', fontSize: 8, fontWeight: '900' }, slotNumberActive: { color: C.ink40 }, slotLabel: { color: C.surface, fontSize: 7, fontWeight: '900' }, slotLabelActive: { color: C.ink }, chatPanel: { marginTop: 18, padding: 12, gap: 9, borderWidth: 1, borderColor: 'rgba(255,255,255,.16)', borderRadius: 18, backgroundColor: 'rgba(14,35,33,.18)' }, chatRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 }, chatRowMine: { justifyContent: 'flex-end' }, chatAvatar: { width: 30, height: 30, borderRadius: 15, alignItems: 'center', justifyContent: 'center' }, chatBubble: { maxWidth: '78%', paddingHorizontal: 11, paddingVertical: 8, borderRadius: 14, borderBottomLeftRadius: 4, backgroundColor: 'rgba(255,255,255,.14)' }, chatBubbleMine: { borderBottomLeftRadius: 14, borderBottomRightRadius: 4, backgroundColor: C.optic }, chatText: { color: C.surface, fontSize: 10, fontWeight: '700' }, chatTextMine: { color: C.ink }, teamCount: { height: 27, paddingHorizontal: 9, flexDirection: 'row', alignItems: 'center', gap: 5, borderRadius: 14, backgroundColor: 'rgba(14,35,33,.2)' }, teamCountText: { color: C.surface, fontSize: 7, fontWeight: '900' }, peopleVisual: { height: 70, marginTop: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'center' }, connectionLine: { position: 'absolute', left: '25%', right: '25%', height: 1, backgroundColor: 'rgba(255,255,255,.25)' }, playerAvatar: { width: 48, height: 48, marginHorizontal: -3, borderRadius: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: C.brick }, playerAvatarCenter: { width: 62, height: 62, borderRadius: 31, zIndex: 2 }, playerInitials: { color: C.ink, fontSize: 11, fontWeight: '900' }, playerCrown: { position: 'absolute', right: -1, top: -1, width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, teamTitle: { color: C.surface, fontSize: 22, fontWeight: '900', textAlign: 'center', letterSpacing: -.5 }, teamActions: { marginTop: 14, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 6 }, teamAction: { color: 'rgba(255,255,255,.64)', fontSize: 6, fontWeight: '900', letterSpacing: .45 }, teamActionDot: { width: 3, height: 3, borderRadius: 2, backgroundColor: C.optic }, onboardPrimary: { minHeight: 60, paddingLeft: 20, paddingRight: 8, borderRadius: 20, borderBottomLeftRadius: 8, borderBottomRightRadius: 8, backgroundColor: C.ink }, onboardPrimaryText: { color: C.surface, fontSize: 14, fontWeight: '900' }, primaryArrow: { width: 44, height: 44, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: C.teal }, skip: { minHeight: 38, alignItems: 'center', justifyContent: 'center' }, skipText: { color: C.ink40, fontSize: 10, fontWeight: '800' }, onboardingError: { marginBottom: 10, color: C.brick, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  personalContent: { flexGrow: 1, width: '100%', maxWidth: 560, alignSelf: 'center', padding: 22, paddingBottom: 34 }, personalHead: { marginTop: 38, marginBottom: 28 }, nameSpotlight: { marginBottom: 4, padding: 18, paddingBottom: 2, borderWidth: 1, borderColor: C.line, borderRadius: 20, backgroundColor: C.surface }, nameIcon: { width: 48, height: 48, marginBottom: 17, alignItems: 'center', justifyContent: 'center', borderRadius: 15, backgroundColor: C.tealWash }, stageButton: { marginTop: 14 }, optionGrid: { flexDirection: 'row', gap: 7 }, skillOption: { minHeight: 49, flex: 1, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 12, backgroundColor: C.surface }, optionActive: { borderColor: C.ink, backgroundColor: C.optic }, optionValue: { color: C.ink40, fontSize: 13, fontWeight: '900' }, optionActiveText: { color: C.ink }, help: { marginTop: 8, color: C.ink40, fontSize: 8, lineHeight: 12 }, sectionLabel: { marginTop: 24 }, choiceRow: { flexDirection: 'row', gap: 8, marginBottom: 22 }, choice: { minHeight: 59, flex: 1, gap: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: C.line, borderRadius: 14, backgroundColor: C.surface }, choiceText: { color: C.ink40, fontSize: 9, fontWeight: '800' }, permissionNote: { marginBottom: 20, padding: 12, flexDirection: 'row', alignItems: 'center', gap: 10, borderRadius: 14, backgroundColor: C.tealWash }, noteIcon: { width: 35, height: 35, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface }, noteText: { flex: 1, color: C.ink70, fontSize: 9, lineHeight: 14 }, noteStrong: { color: C.ink, fontWeight: '900' },
  avatarPicker: { marginBottom: 24, flexDirection: 'row', flexWrap: 'wrap', gap: 10 }, avatarChoice: { width: '30%', minHeight: 76, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.line, borderRadius: 16, backgroundColor: C.surface }, avatarChoiceActive: { borderColor: C.ink, backgroundColor: C.optic }, avatarCheck: { position: 'absolute', right: 6, bottom: 6, width: 19, height: 19, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: C.ink },
  backSpacer: { width: 43, height: 43 },
  recoveryContent: { flexGrow: 1, paddingHorizontal: 22, paddingTop: 18, paddingBottom: 32 }, recoveryIcon: { width: 52, height: 52, marginTop: 64, marginBottom: 22, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: C.optic }, recoveryButton: { marginTop: 30 }, recoveryBrandSpacer: { width: 43, height: 43 },
  verificationEmail: { color: C.surface, fontWeight: '900' },
  verificationNote: { marginTop: 28, padding: 15, flexDirection: 'row', alignItems: 'flex-start', gap: 11, borderWidth: 1, borderColor: '#2E4C46', borderRadius: 14, backgroundColor: '#14332F' },
  verificationNoteText: { flex: 1, color: '#B8C6C1', fontSize: 10, lineHeight: 16 },
  verificationSuccess: { marginTop: 18, color: C.optic, fontSize: 10, lineHeight: 14, textAlign: 'center' },
  verificationGoogleHint: { marginTop: -6, marginBottom: 14, color: '#B8C6C1', fontSize: 10, lineHeight: 16, textAlign: 'center' },
  verificationPrimary: { marginTop: 28 },
  verificationSecondary: { minHeight: 42, alignItems: 'center', justifyContent: 'center' },
  disabledButton: { opacity: .55 },
  passwordToggle: { width: 30, height: 30, marginRight: -5, alignItems: 'center', justifyContent: 'center', borderRadius: 15 },
  passwordTogglePressed: { backgroundColor: 'rgba(184,198,193,.12)' },
  onboardScroll: { flex: 1 },
  onboardScrollContent: { flexGrow: 1, justifyContent: 'center', paddingVertical: 16 },
  legalModalBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(5,18,16,.62)' },
  legalModalSheet: { height: '91%', borderTopLeftRadius: 28, borderTopRightRadius: 28, backgroundColor: C.paper, overflow: 'hidden' },
  legalModalHeader: { paddingHorizontal: 22, paddingTop: 20, paddingBottom: 17, flexDirection: 'row', alignItems: 'flex-start', gap: 16 },
  legalModalHeading: { flex: 1 },
  legalModalEyebrow: { color: C.teal, fontSize: 8, fontWeight: '900', letterSpacing: 1.2 },
  legalModalTitle: { marginTop: 5, color: C.ink, fontSize: 28, lineHeight: 32, fontWeight: '900', letterSpacing: -.8 },
  legalModalDate: { marginTop: 5, color: C.ink40, fontSize: 9, fontWeight: '700' },
  legalModalClose: { width: 42, height: 42, borderRadius: 21, borderWidth: 1, borderColor: C.line, alignItems: 'center', justifyContent: 'center', backgroundColor: C.surface },
  legalModalRule: { height: 1, marginHorizontal: 22, backgroundColor: C.line },
  legalModalScroll: { flex: 1 },
  legalModalContent: { paddingHorizontal: 22, paddingTop: 21, paddingBottom: 28 },
  legalModalIntroduction: { padding: 16, borderRadius: 16, borderBottomLeftRadius: 7, borderBottomRightRadius: 7, color: C.ink, backgroundColor: C.optic, fontSize: 12, lineHeight: 19, fontWeight: '700' },
  legalModalSection: { marginTop: 24 },
  legalModalSectionTitle: { color: C.ink, fontSize: 14, lineHeight: 19, fontWeight: '900' },
  legalModalBody: { marginTop: 7, color: C.ink70, fontSize: 11, lineHeight: 18 },
  legalModalFooter: { flexShrink: 0, paddingHorizontal: 22, paddingTop: 12, borderTopWidth: 1, borderTopColor: C.line, backgroundColor: C.surface },
  legalModalInstruction: { marginBottom: 8, color: C.ink40, fontSize: 9, lineHeight: 13, textAlign: 'center', fontWeight: '700' },
  legalModalDone: { minHeight: 52, paddingHorizontal: 18, borderRadius: 15, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', backgroundColor: C.optic },
  legalModalDoneDisabled: { opacity: .45, backgroundColor: C.line },
  legalModalDoneText: { color: C.ink, fontSize: 13, fontWeight: '900' },
  // Location picker
});
