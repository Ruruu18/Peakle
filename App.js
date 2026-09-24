import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer, getPathFromState, useNavigationContainerRef } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import * as SplashScreen from 'expo-splash-screen';
import AppNavigator from './src/navigation/AppNavigator';
import { LocationProvider } from './src/context/LocationContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AuthFlowScreen from './src/screens/AuthFlowScreen';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';
import { OperationsProvider } from './src/context/OperationsContext';
import { NearbyPlayersProvider } from './src/context/NearbyPlayersContext';
import { OrganizerPassProvider } from './src/context/OrganizerPassContext';
import MatchInviteOverlay from './src/components/MatchInviteOverlay';
import SupportBubble from './src/components/SupportBubble';
import ErrorBoundary from './src/components/ErrorBoundary';
import DemoAutopilot from './src/components/DemoAutopilot';
import { DEMO_MODE } from './src/config/demoMode';
import { webNavigationState } from './src/lib/webNavigation';

const Notifications = Platform.OS === 'web' ? null : require('expo-notifications');
const colors = { ink: '#0E2321', optic: '#D6E94A', surface: '#FFFFFF' };
const BALL_IMAGE = require('./public/images/ball_green.png');
const MINIMUM_LAUNCH_MS = Platform.OS === 'web' ? 150 : 2500;
if (Platform.OS !== 'web') SplashScreen.setOptions({ duration: 180, fade: true });
const linking = {
  prefixes: ['peakle://'],
  ...(Platform.OS === 'web' ? { getPathFromState: (state, options) => getPathFromState(webNavigationState(state), options) } : {}),
  config: { screens: {
    ...(Platform.OS === 'web' ? {
      Home: '', Team: 'teams', Profile: 'profile',
      Pickleball: { path: 'compete', alias: ['membership/:paymentMembershipId/payment-result'] },
      Activities: 'activities', ActivityDetails: 'activities/:activityType/:activityId',
      OpenPlayActivity: 'sessions/:sessionId?', Privacy: 'privacy', LegalDocument: 'legal/:documentKey',
      AccountDeletion: 'account-deletion', PaymentHistory: 'payment-history',
      HelpSupport: 'help', SupportChat: 'support', Inbox: 'chats', CommunityChat: 'chats/:eventKind/:eventId', PublicProfile: 'players/:userId',
      Connections: 'connections', Leaderboard: 'leaderboard',
      CompetitionDivision: 'competitions/:competitionId/divisions/:divisionId',
      Book: { path: 'explore', alias: ['booking/:paymentBookingId/payment-result'] },
      Play: { path: 'play', alias: ['open-play/:openPlayCode'] },
    } : { Book: 'booking/:paymentBookingId/payment-result', Play: 'open-play/:openPlayCode' }),
    ...(Platform.OS !== 'web' ? { Inbox: 'messages', DirectChat: 'messages/:conversationId' } : {}),
  } },
};

function LaunchScreen({ edition = 'player', fromEdition = null, overlay = false, status = 'GETTING THE COURT READY' }) {
  const bounce = useRef(new Animated.Value(0)).current;
  const screenOpacity = useRef(new Animated.Value(overlay ? 0 : 1)).current;
  const initialEdition = useRef(fromEdition).current;
  const editionProgress = useRef(new Animated.Value(initialEdition && initialEdition !== edition ? 0 : 1)).current;
  const statusProgress = useRef(new Animated.Value(overlay ? 0 : 1)).current;

  useEffect(() => {
    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(bounce, { toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0, duration: 310, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0.32, duration: 170, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.timing(bounce, { toValue: 0, duration: 140, easing: Easing.in(Easing.quad), useNativeDriver: Platform.OS !== 'web' }),
        Animated.delay(100),
      ]),
    );
    animation.start();
    return () => animation.stop();
  }, [bounce]);

  useEffect(() => {
    if (!overlay) return undefined;
    const overlayAnimation = Animated.sequence([
      Animated.timing(screenOpacity, {
        toValue: 1,
        duration: 140,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.delay(500),
      Animated.timing(screenOpacity, {
        toValue: 0,
        duration: 180,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
    ]);
    overlayAnimation.start();
    return () => overlayAnimation.stop();
  }, [overlay, screenOpacity]);

  useEffect(() => {
    const copyAnimation = Animated.parallel([
      Animated.timing(editionProgress, {
        toValue: 1,
        duration: 420,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: Platform.OS !== 'web',
      }),
      Animated.sequence([
        Animated.delay(70),
        Animated.timing(statusProgress, {
          toValue: 1,
          duration: 360,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: Platform.OS !== 'web',
        }),
      ]),
    ]);
    copyAnimation.start();
    return () => copyAnimation.stop();
  }, [editionProgress, statusProgress]);

  const heightStyle = {
    transform: [{ translateY: bounce.interpolate({ inputRange: [0, 1], outputRange: [0, -64] }) }],
  };
  const shadowStyle = {
    opacity: bounce.interpolate({ inputRange: [0, 1], outputRange: [0.32, 0.1] }),
    transform: [{ scaleX: bounce.interpolate({ inputRange: [0, 1], outputRange: [1, 0.4] }) }],
  };
  const trailStyle = {
    opacity: bounce.interpolate({ inputRange: [0, 0.08, 0.75, 1], outputRange: [0, 0.8, 0.55, 0.15] }),
  };
  const incomingEditionStyle = {
    opacity: editionProgress,
    transform: [
      { translateY: editionProgress.interpolate({ inputRange: [0, 1], outputRange: [7, 0] }) },
      { scale: editionProgress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
    ],
  };
  const outgoingEditionStyle = {
    opacity: editionProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 0] }),
    transform: [{ translateY: editionProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -7] }) }],
  };
  const statusStyle = {
    opacity: statusProgress,
    transform: [{ translateY: statusProgress.interpolate({ inputRange: [0, 1], outputRange: [5, 0] }) }],
  };
  const editionTextStyle = () => styles.launchPlayerPro;
  const editionLabel = (value) => value === 'player' ? 'PRO' : '';

  return (
    <Animated.View accessibilityLabel="Peakle is starting" accessibilityViewIsModal={overlay} style={[styles.launchScreen, overlay && styles.launchScreenOverlay, { opacity: screenOpacity }]}>
      <View style={styles.launchBallStage}>
        <Animated.View style={[styles.launchBallShadow, shadowStyle]} />
        <Animated.View pointerEvents="none" style={[styles.launchMotionTrails, trailStyle]}>
          <View style={styles.launchMotionLineShort} />
          <View style={styles.launchMotionLineTall} />
        </Animated.View>
        <Animated.Image accessibilityIgnoresInvertColors accessible={false} source={BALL_IMAGE} style={[styles.launchBall, heightStyle]} resizeMode="contain" />
      </View>
      <View style={styles.launchBrand}>
        <Text style={styles.launchName}>Peakle</Text>
        {edition ? <View style={styles.launchEditionSlot}>
          {initialEdition && initialEdition !== edition ? <Animated.Text style={[styles.launchEditionText, editionTextStyle(initialEdition), outgoingEditionStyle]}>{editionLabel(initialEdition)}</Animated.Text> : null}
          <Animated.Text style={[styles.launchEditionText, editionTextStyle(edition), incomingEditionStyle]}>{editionLabel(edition)}</Animated.Text>
        </View> : null}
      </View>
      <Animated.Text style={[styles.launchStatus, statusStyle]}>{status}</Animated.Text>
    </Animated.View>
  );
}

function Root() {
  const { user, hydrated: authHydrated, passwordRecovery } = useAuth();
  const { isDark } = useTheme();
  const navigationRef = useNavigationContainerRef();
  const [minimumLaunchElapsed, setMinimumLaunchElapsed] = useState(false);
  const hasFinishedLaunch = useRef(false);
  const handledNotificationResponse = useRef(null);
  const pendingJoinedMatch = useRef(null);
  const startupReady = authHydrated && minimumLaunchElapsed;
  if (startupReady) hasFinishedLaunch.current = true;
  const appBackground = isDark ? colors.ink : '#F3F5EF';
  const navigationTheme = isDark ? {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, primary: colors.optic, background: colors.ink, card: '#17302D', text: '#F3F5EF', border: '#304743' },
  } : {
    ...DefaultTheme,
    colors: { ...DefaultTheme.colors, primary: '#1C6B66', background: appBackground, card: appBackground, text: colors.ink, border: '#DDE3DA' },
  };

  useEffect(() => {
    const timer = setTimeout(() => setMinimumLaunchElapsed(true), MINIMUM_LAUNCH_MS);
    return () => clearTimeout(timer);
  }, []);

  const openAcceptedMatch = (invite) => {
    const params = { joinedMatchToken: `${invite?.id || 'match'}-${Date.now()}`, joinedInviteId: invite?.id || null };
    if (navigationRef.isReady()) navigationRef.navigate('Play', params);
    else pendingJoinedMatch.current = params;
  };

  useEffect(() => {
    if (!user?.id || Platform.OS === 'web') return undefined;
    const timers = new Set();
    const openResponse = (response) => {
      if (response?.actionIdentifier !== Notifications.DEFAULT_ACTION_IDENTIFIER) return;
      const responseId = response?.notification?.request?.identifier;
      const data = response?.notification?.request?.content?.data || {};
      const opensConversation = Boolean(data.conversationId);
      const opensFollowNotification = ['follow_request', 'follow_accepted'].includes(data.notificationKind)
        || Boolean(data.requesterId);
      if ((!opensConversation && !opensFollowNotification) || responseId === handledNotificationResponse.current) return;
      handledNotificationResponse.current = responseId;
      const open = () => {
        if (!navigationRef.isReady()) {
          const timer = setTimeout(open, 180);
          timers.add(timer);
          return;
        }
        if (opensConversation) {
          navigationRef.navigate('DirectChat', {
            conversationId: data.conversationId,
            player: data.playerId ? { id: data.playerId } : undefined,
            ownerTab: 'Team',
          });
        } else {
          navigationRef.navigate('Profile', { openNotificationsToken: Date.now() });
        }
        Notifications.clearLastNotificationResponseAsync().catch(() => {});
      };
      open();
    };
    Notifications.getLastNotificationResponseAsync().then(openResponse).catch(() => {});
    const subscription = Notifications.addNotificationResponseReceivedListener(openResponse);
    return () => {
      subscription.remove();
      timers.forEach(clearTimeout);
    };
  }, [navigationRef, user?.id]);

  useEffect(() => {
    if (!pendingJoinedMatch.current || !navigationRef.isReady()) return;
    const params = pendingJoinedMatch.current;
    pendingJoinedMatch.current = null;
    navigationRef.navigate('Play', params);
  });

  if (!hasFinishedLaunch.current) return <LaunchScreen edition={null} />;
  if (passwordRecovery) return <AuthFlowScreen key="password-recovery" initialScreen="reset-password" />;
  if (!user) return <AuthFlowScreen key="login" initialScreen="login" />;
  if (!user.onboardingCompleted) return <AuthFlowScreen key={`new-user-setup-${user.id}`} initialScreen="new-user-overview" />;
  return <View key={`player-session-${user.id}`} style={[styles.appShell, { backgroundColor: appBackground }]}><NavigationContainer ref={navigationRef} theme={navigationTheme} linking={linking}><AppNavigator /></NavigationContainer><MatchInviteOverlay onAccepted={openAcceptedMatch} />{Platform.OS !== 'web' ? <SupportBubble navigationRef={navigationRef} /> : null}{DEMO_MODE && Platform.OS !== 'web' ? <DemoAutopilot navigationRef={navigationRef} /> : null}</View>;
}

export default function App() {
  return (
    <ErrorBoundary>
      <SafeAreaProvider>
        <AuthProvider>
          <OrganizerPassProvider>
            <OperationsProvider>
              <LocationProvider>
                <NearbyPlayersProvider>
                  <ThemeProvider>
                    <Root />
                  </ThemeProvider>
                </NearbyPlayersProvider>
              </LocationProvider>
            </OperationsProvider>
          </OrganizerPassProvider>
        </AuthProvider>
      </SafeAreaProvider>
    </ErrorBoundary>
  );
}

const styles = StyleSheet.create({
  appShell: { flex: 1 },
  launchScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  launchScreenOverlay: { ...StyleSheet.absoluteFillObject, zIndex: 1000 },
  launchBallStage: { width: 112, height: 112, alignItems: 'center', justifyContent: 'flex-end' },
  launchBall: { position: 'absolute', bottom: 13, width: 68, height: 68 },
  launchBallShadow: { width: 48, height: 9, marginBottom: 7, borderRadius: 24, backgroundColor: '#000000' },
  launchMotionTrails: { position: 'absolute', bottom: 31, flexDirection: 'row', alignItems: 'flex-end', gap: 12 },
  launchMotionLineShort: { width: 3, height: 11, borderRadius: 2, backgroundColor: colors.optic },
  launchMotionLineTall: { width: 3, height: 19, borderRadius: 2, backgroundColor: colors.optic },
  launchBrand: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 7 },
  launchName: { color: colors.surface, fontSize: 24, fontWeight: '900', letterSpacing: -0.8 },
  launchEditionSlot: { width: 29, height: 16, justifyContent: 'center' },
  launchEditionText: { position: 'absolute', left: 0 },
  launchPlayerPro: { color: '#DDE4E8', fontSize: 10, fontWeight: '900', letterSpacing: 1.2, textShadowColor: 'rgba(255,255,255,.9)', textShadowOffset: { width: 0, height: 0 }, textShadowRadius: 6 },
  launchStatus: { marginTop: 9, color: colors.optic, fontSize: 8, fontWeight: '900', letterSpacing: 1.4 },
});
