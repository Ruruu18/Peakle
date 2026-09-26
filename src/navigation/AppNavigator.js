import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import AppIcon from '../components/AppIcon';
import HomeScreen from '../screens/HomeScreen';
import BookScreen from '../screens/BookScreen';
import ScheduleScreen from '../screens/ScheduleScreen';
import PlayScreen from '../screens/PlayScreen';
import TeamScreen from '../screens/TeamScreen';
import PlayerProfileScreen from '../screens/ProfileScreen';
import PickleballHubScreen from '../screens/PickleballHubScreen';
import PlayerActivitiesScreen from '../screens/PlayerActivitiesScreen';
import PlayerActivityDetailsScreen from '../screens/PlayerActivityDetailsScreen';
import PlayerOpenPlayRouteScreen from '../screens/PlayerOpenPlayRouteScreen';
import PrivacyScreen from '../screens/PrivacyScreen';
import LegalDocumentScreen from '../screens/LegalDocumentScreen';
import AccountDeletionScreen from '../screens/AccountDeletionScreen';
import PaymentHistoryScreen from '../screens/PaymentHistoryScreen';
import HelpSupportScreen from '../screens/HelpSupportScreen';
import OrganizerPreviewScreen from '../screens/OrganizerPreviewScreen';
import SupportChatScreen from '../screens/SupportChatScreen';
import CommunityChatScreen from '../screens/CommunityChatScreen';
import { COURT_BOOKING_ENABLED, DISCOVERY_TAB, HUB_TABS_ENABLED, PRIVATE_MESSAGES_ENABLED } from '../config/features';
import { APP_VERSION_LABEL } from '../config/appInfo';
// Inbox hosts both private messages and community chats (its segments).
const { DirectChatScreen, InboxScreen } = require('../screens/DirectMessagesScreens');
import PublicProfileScreen from '../screens/PublicProfileScreen';
import ConnectionsScreen from '../screens/ConnectionsScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import CompetitionDivisionScreen from '../screens/CompetitionDivisionScreen';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '../context/AuthContext';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import LeaveMatchDialog from '../components/LeaveMatchDialog';
import ProfilePhoto from '../components/ProfilePhoto';
import { ACCOUNT_MENU_NAV, AccountMenuProvider, AccountMenuSheet } from '../components/AccountMenu';
import useDesktopLayout, { DESKTOP_SIDEBAR_WIDTH } from '../hooks/useDesktopLayout';

const NotificationTestScreen = Platform.OS === 'web' ? null : require('../screens/NotificationTestScreen').default;
const { BrowserNavigationLayout, BrowserScene } = Platform.OS === 'web' ? require('../web/BrowserNavigation') : {};
const Tab = createBottomTabNavigator();
const colors = { ink: '#0E2321', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA' };
const icons = { Home: 'home-outline', Book: 'compass-outline', Schedule: 'calendar-outline', Play: 'tennisball-outline', Team: 'people-outline', Profile: 'person-outline', Leaderboard: 'podium-outline', Activities: 'calendar-outline', Inbox: 'chatbubbles-outline', HelpSupport: 'help-circle-outline' };
const BALL_IMAGE = require('../../public/images/ball.png');
const BRAND_BALL_IMAGE = require('../../public/images/ball_green.png');
// On desktop the Profile route is split into sidebar sections that map to its tabs.
const PROFILE_SECTIONS = [
  { tab: 'Overview', label: 'Profile', icon: 'person-outline' },
  { tab: 'Matches', label: 'Matches', icon: 'stats-chart-outline' },
  { tab: 'Settings', label: 'Settings', icon: 'settings-outline' },
];
const SETTINGS_ROUTES = new Set(['Privacy', 'LegalDocument', 'AccountDeletion', 'PaymentHistory']);
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TabBarItem({ focused, label, onPress, play, routeName, theme, badge = 0 }) {
  const focusProgress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const pressProgress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(focusProgress, {
      toValue: focused ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  }, [focusProgress, focused]);

  const animatePress = (value) => {
    Animated.spring(pressProgress, {
      toValue: value,
      speed: 40,
      bounciness: value === 1 ? 2 : 0,
      useNativeDriver: Platform.OS !== 'web',
    }).start();
  };

  return (
    <AnimatedPressable
      accessibilityLabel={`${label} tab`}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      onPress={onPress}
      onPressIn={() => animatePress(0.92)}
      onPressOut={() => animatePress(1)}
      style={[styles.tabItem, { transform: [{ scale: pressProgress }] }]}
    >
      {!play ? (
        <Animated.View
          pointerEvents="none"
          style={[
            styles.activePill,
            { backgroundColor: theme.active },
            {
              opacity: focusProgress,
              transform: [{ scale: focusProgress.interpolate({ inputRange: [0, 1], outputRange: [0.82, 1] }) }],
            },
          ]}
        />
      ) : null}
      <Animated.View
        shouldRasterizeIOS={play}
        renderToHardwareTextureAndroid={play}
        style={[
          styles.tabIcon,
          play && styles.playCircle,
          play && { borderColor: theme.surface },
          play && focused && styles.playCircleFocused,
          {
            transform: play ? undefined : [
              { translateY: focusProgress.interpolate({ inputRange: [0, 1], outputRange: [0, -0.5] }) },
              { scale: focusProgress.interpolate({ inputRange: [0, 1], outputRange: [1, 1.04] }) },
            ],
          },
        ]}
      >
        {play ? (
          <Image source={BALL_IMAGE} defaultSource={BALL_IMAGE} fadeDuration={0} style={styles.playIcon} resizeMode="contain" />
        ) : (
          <AppIcon name={icons[routeName]} size={20} color={focused ? theme.activeText : theme.muted} />
        )}
      </Animated.View>
      <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.85} style={[styles.tabLabel, { color: focused ? (play ? theme.centerActiveLabel : theme.activeLabel) : theme.muted }, focused && styles.tabLabelActive]}>{label}</Text>
      {badge > 0 ? <View style={styles.tabBadge}><Text style={styles.tabBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}
      {!play ? (
        <Animated.View style={[styles.kitchenIndicator, { opacity: focusProgress }]}>
          <View style={[styles.kitchenSolid, { backgroundColor: theme.kitchenLine }]} />
          <View style={[styles.kitchenDashed, { borderColor: theme.kitchenLine }]} />
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
}

function PeakleTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const desktop = useDesktopLayout();
  const { isDark } = useTheme();
  const { signOut, user } = useAuth();
  const { joinedInvite, leave } = useNearbyPlayersContext();
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leavingMatch, setLeavingMatch] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [pendingRoute, setPendingRoute] = useState(null);
  const alwaysHiddenRoutes = new Set([COURT_BOOKING_ENABLED ? 'Schedule' : 'Book', 'Pickleball', 'Activities', 'ActivityDetails', 'OpenPlayActivity', 'Privacy', 'LegalDocument', 'AccountDeletion', 'PaymentHistory', 'HelpSupport', 'SupportChat', 'CommunityChat', 'NotificationTest', 'Inbox', 'DirectChat', 'PublicProfile', 'Connections', 'Leaderboard', 'CompetitionDivision', 'OrganizerPreview']);
  const currentRoute = state.routes[state.index];
  // A team chat opened from Chats lives on the Team route but belongs to Chats.
  const chatOwner = currentRoute.name === 'Team' ? currentRoute.params?.chatOwner : undefined;
  const theme = isDark
    ? { background: '#0E2321', surface: '#17302D', line: '#304743', activeText: colors.ink, activeLabel: colors.ink, centerActiveLabel: colors.surface, muted: '#9FB3AC', active: colors.optic, kitchenLine: colors.optic }
    : { background: '#F3F5EF', surface: colors.surface, line: colors.line, activeText: colors.ink, activeLabel: colors.ink, centerActiveLabel: colors.ink, muted: colors.ink40, active: colors.optic, kitchenLine: colors.teal };
  // Exclude routes that should never show a tab
  // Schedule already lists public activities, so it replaces the Activities link.
  const desktopRoutes = COURT_BOOKING_ENABLED
    ? ['Home', 'Book', 'Play', 'Team', 'Leaderboard', 'Activities', 'Inbox', 'Profile', 'HelpSupport']
    : ['Home', 'Schedule', 'Play', 'Team', 'Leaderboard', 'Inbox', 'Profile', 'HelpSupport'];
  const desktopLabels = { Leaderboard: 'Leaderboard', Activities: 'Activities', Inbox: ACCOUNT_MENU_NAV ? 'Chats' : 'Messages', HelpSupport: 'Help & support' };
  const mobileRoutes = ACCOUNT_MENU_NAV ? ['Home', DISCOVERY_TAB, 'Play', 'Team', 'Inbox'] : null;
  const visibleRoutes = desktop || mobileRoutes
    ? (desktop ? desktopRoutes : mobileRoutes).map((name) => state.routes.find((route) => route.name === name)).filter(Boolean)
    : state.routes.filter((route) => !alwaysHiddenRoutes.has(route.name));
  const chatUnread = Number(state.routes.find((route) => route.name === 'Team')?.params?.unreadCount || 0);
  const activeProfileSection = currentRoute.name === 'Profile' ? (currentRoute.params?.openTab || 'Overview')
    : SETTINGS_ROUTES.has(currentRoute.name) ? 'Settings'
    : null;
  const legacyMobileOwner = currentRoute.name === 'Pickleball'
    ? (currentRoute.params?.ownerTab || ({ Ratings: 'Profile', Privacy: 'Profile', 'Find play': 'Play', Compete: DISCOVERY_TAB }[currentRoute.params?.openTab]))
    : currentRoute.name === 'Leaderboard' ? 'Home'
    : ['Privacy', 'HelpSupport', 'SupportChat', 'NotificationTest', 'Connections', 'OrganizerPreview'].includes(currentRoute.name) ? 'Profile'
    : ['Inbox', 'DirectChat', 'CommunityChat'].includes(currentRoute.name) ? (currentRoute.params?.ownerTab || 'Team')
    : ['Activities', 'ActivityDetails', 'OpenPlayActivity'].includes(currentRoute.name) ? (currentRoute.params?.returnTo === 'Schedule' ? 'Schedule' : 'Home')
    : null;
  // Account screens have no tab once Profile moves behind the avatar; chats all belong to Chats.
  const mobileOwner = !ACCOUNT_MENU_NAV ? legacyMobileOwner
    : ['Inbox', 'DirectChat', 'CommunityChat'].includes(currentRoute.name) ? 'Inbox'
    : legacyMobileOwner === 'Profile' ? null
    : legacyMobileOwner;
  const contextualOwner = chatOwner || (desktop ? ({
    ...(COURT_BOOKING_ENABLED ? { ActivityDetails: 'Activities', OpenPlayActivity: 'Activities' } : {}),
    Privacy: 'Profile', LegalDocument: 'Profile', AccountDeletion: 'Profile',
    PaymentHistory: 'Profile', PublicProfile: 'Profile', Connections: 'Profile', OrganizerPreview: 'Profile',
    SupportChat: 'HelpSupport', CommunityChat: 'Inbox', CompetitionDivision: DISCOVERY_TAB,
  }[currentRoute.name] || mobileOwner) : mobileOwner);
  const guardedNavigate = (name, params) => {
    if (currentRoute.name === 'Play' && joinedInvite) {
      if (leaveDialogOpen) return;
      setPendingRoute({ name, params });
      setLeaveError('');
      setLeaveDialogOpen(true);
      return;
    }
    navigation.navigate(name, params);
  };
  return (
    <View dataSet={Platform.OS === 'web' ? { playerNavigation: desktop ? 'sidebar' : 'bottom' } : undefined} style={[styles.tabOuter, { paddingBottom: Math.max(insets.bottom, 9), backgroundColor: theme.background }, desktop && [styles.sidebar, { backgroundColor: theme.surface, borderColor: theme.line }]]}>
      {desktop ? <View dataSet={{ sidebarPart: 'brand' }} style={styles.sidebarBrand}><Image source={isDark ? BALL_IMAGE : BRAND_BALL_IMAGE} style={[styles.sidebarLogo, isDark && { tintColor: colors.optic }]} /><Text accessibilityRole="header" style={[styles.sidebarWordmark, { color: isDark ? '#F3F5EF' : colors.ink }]}>Peakle</Text><Text style={styles.sidebarBeta}>BETA</Text></View> : null}
      <View accessibilityRole={desktop ? 'navigation' : undefined} accessibilityLabel={desktop ? 'Main navigation' : undefined} style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.line }, desktop && styles.sidebarLinks]}>
        {visibleRoutes.map((route) => {
          const routeFocused = currentRoute.key === route.key && !chatOwner;
          const focused = routeFocused
            || (route.name === contextualOwner && (Boolean(chatOwner) || !(desktop && desktopRoutes.includes(currentRoute.name))));
          const play = route.name === 'Play';
          const label = desktopLabels[route.name] ?? descriptors[route.key].options.tabBarLabel ?? route.name;
          const onPress = () => {
            if (currentRoute.name === 'Play' && route.name !== 'Play' && joinedInvite) {
              if (leaveDialogOpen) return;
              setPendingRoute({ name: route.name, params: route.params });
              setLeaveError('');
              setLeaveDialogOpen(true);
              return;
            }
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!routeFocused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          const badge = route.name === (ACCOUNT_MENU_NAV ? 'Inbox' : 'Team') ? chatUnread : 0;
          if (desktop && route.name === 'Profile') return PROFILE_SECTIONS.map((section) => {
            const sectionFocused = activeProfileSection ? activeProfileSection === section.tab : focused && section.tab === 'Overview';
            const onSectionPress = () => {
              if (sectionFocused && routeFocused) return;
              if (currentRoute.name === 'Play' && joinedInvite) {
                if (leaveDialogOpen) return;
                setPendingRoute({ name: 'Profile', params: { openTab: section.tab, openTabToken: Date.now() } });
                setLeaveError('');
                setLeaveDialogOpen(true);
                return;
              }
              navigation.navigate('Profile', { openTab: section.tab, openTabToken: Date.now() });
            };
            return <Pressable key={`${route.key}-${section.tab}`} accessibilityRole="button" accessibilityLabel={`${section.label} tab`} accessibilityState={{ selected: sectionFocused }} onPress={onSectionPress} style={({ hovered, pressed }) => [styles.sidebarLink, { backgroundColor: sectionFocused ? theme.active : hovered || pressed ? theme.background : 'transparent' }]}><AppIcon name={section.icon} size={21} color={sectionFocused ? colors.ink : theme.muted} /><Text style={[styles.sidebarLabel, { color: sectionFocused ? colors.ink : isDark ? '#F3F5EF' : colors.ink }]}>{section.label}</Text></Pressable>;
          });
          if (desktop) return <Pressable key={route.key} accessibilityRole="button" accessibilityLabel={`${label} tab`} accessibilityState={{ selected: focused }} onPress={onPress} style={({ hovered, pressed }) => [styles.sidebarLink, { backgroundColor: focused ? theme.active : hovered || pressed ? theme.background : 'transparent' }]}>{route.name === 'Play' ? <Image source={BALL_IMAGE} style={{ width: 21, height: 21, tintColor: focused ? colors.ink : theme.muted }} resizeMode="contain" /> : <AppIcon name={icons[route.name]} size={21} color={focused ? colors.ink : theme.muted} />}<Text style={[styles.sidebarLabel, { color: focused ? colors.ink : isDark ? '#F3F5EF' : colors.ink }]}>{label}</Text>{badge > 0 ? <View style={styles.sidebarBadge}><Text style={styles.tabBadgeText}>{badge > 99 ? '99+' : badge}</Text></View> : null}</Pressable>;
          return <TabBarItem key={route.key} focused={focused} label={label} onPress={onPress} play={play} routeName={route.name} theme={theme} badge={badge} />;
        })}
      </View>
      {desktop ? <View dataSet={{ sidebarPart: 'footer' }} style={[styles.sidebarFooter, { borderColor: theme.line }]}><Pressable accessibilityRole="button" accessibilityLabel="Open your profile" onPress={() => guardedNavigate('Profile', { openTab: 'Overview', openTabToken: Date.now() })} style={({ hovered, pressed }) => [styles.sidebarLink, styles.sidebarAccount, (hovered || pressed) && { backgroundColor: theme.background }]}><ProfilePhoto photo={user?.picture || user?.avatar} name={user?.name} size={30} /><Text numberOfLines={1} style={[styles.sidebarLabel, { color: isDark ? '#F3F5EF' : colors.ink }]}>{user?.name?.trim() || 'Your profile'}</Text></Pressable><Pressable accessibilityRole="button" accessibilityLabel="Log out" onPress={() => signOut()} style={({ hovered, pressed }) => [styles.sidebarLink, styles.sidebarLogOut, (hovered || pressed) && { backgroundColor: theme.background }]}><AppIcon name="log-out-outline" size={21} color="#B6472E" /><Text style={[styles.sidebarLabel, { color: '#B6472E' }]}>Log out</Text></Pressable><Text selectable style={[styles.sidebarVersion, { color: isDark ? '#8FA39C' : '#7C8983' }]}>{APP_VERSION_LABEL}</Text></View> : null}
      {ACCOUNT_MENU_NAV ? <AccountMenuSheet onNavigate={guardedNavigate} onSignOut={() => signOut()} /> : null}
      <LeaveMatchDialog
        visible={leaveDialogOpen}
        hostName={joinedInvite?.sender?.display_name}
        busy={leavingMatch}
        error={leaveError}
        onCancel={() => {
          if (leavingMatch) return;
          setLeaveDialogOpen(false);
          setLeaveError('');
          setPendingRoute(null);
        }}
        onConfirm={async () => {
          if (!joinedInvite?.id || leavingMatch) return;
          setLeavingMatch(true);
          setLeaveError('');
          const left = await leave(joinedInvite.id);
          setLeavingMatch(false);
          if (!left) {
            setLeaveError('Couldn’t leave the match. Check your connection and try again.');
            return;
          }
          setLeaveDialogOpen(false);
          if (pendingRoute) navigation.navigate(pendingRoute.name, pendingRoute.params);
          setPendingRoute(null);
        }}
      />
    </View>
  );
}

function WorkspaceNavigator({ children, initialRouteName, isDark, workspaceKey }) {
  const desktop = useDesktopLayout();
  return (
    <AccountMenuProvider>
    <Tab.Navigator
      key={workspaceKey}
      initialRouteName={initialRouteName}
      backBehavior="history"
      tabBar={(props) => <PeakleTabBar {...props} />}
      detachInactiveScreens={Platform.OS === 'web'}
      layout={Platform.OS === 'web' ? (props) => <BrowserNavigationLayout {...props} /> : undefined}
      screenLayout={Platform.OS === 'web' ? (props) => <BrowserScene {...props} /> : undefined}
      screenOptions={{
        headerShown: false,
        tabBarPosition: desktop ? 'left' : 'bottom',
        // A lazy screen can miss the first paint on slower devices. Never fade
        // the current scene away while the destination is still mounting.
        animation: 'none',
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: isDark ? '#0E2321' : '#F3F5EF' },
      }}
    >
      {children}
    </Tab.Navigator>
    </AccountMenuProvider>
  );
}

function PlayerWorkspace({ isDark }) {
  return (
    <WorkspaceNavigator workspaceKey="player-workspace" initialRouteName="Home" isDark={isDark}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ lazy: false }} />
      {/* Booking stays registered while paused so its screens and links keep working behind the flag. */}
      <Tab.Screen name="Book" component={BookScreen} options={{ tabBarLabel: 'Explore', lazy: !COURT_BOOKING_ENABLED }} />
      <Tab.Screen name="Schedule" component={ScheduleScreen} options={{ tabBarLabel: 'Schedule', lazy: false }} />
      <Tab.Screen name="Play" component={PlayScreen} options={{ lazy: false }} />
      <Tab.Screen name="Team" component={TeamScreen} options={{ tabBarLabel: 'Teams', lazy: false }} />
      <Tab.Screen name="Profile" component={PlayerProfileScreen} options={{ lazy: false }} />
      <Tab.Screen name="Pickleball" component={PickleballHubScreen} initialParams={Platform.OS === 'web' ? { openTab: HUB_TABS_ENABLED ? 'Compete' : 'Ratings' } : undefined} />
      <Tab.Screen name="Activities" component={PlayerActivitiesScreen} />
      <Tab.Screen name="ActivityDetails" component={PlayerActivityDetailsScreen} />
      <Tab.Screen name="OpenPlayActivity" component={PlayerOpenPlayRouteScreen} />
      <Tab.Screen name="Privacy" component={PrivacyScreen} />
      <Tab.Screen name="LegalDocument" component={LegalDocumentScreen} />
      <Tab.Screen name="AccountDeletion" component={AccountDeletionScreen} />
      <Tab.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <Tab.Screen name="HelpSupport" component={HelpSupportScreen} />
      <Tab.Screen name="OrganizerPreview" component={OrganizerPreviewScreen} />
      <Tab.Screen name="SupportChat" component={SupportChatScreen} />
      <Tab.Screen name="CommunityChat" component={CommunityChatScreen} />
      {Platform.OS !== 'web' ? <Tab.Screen name="NotificationTest" component={NotificationTestScreen} /> : null}
      <Tab.Screen name="Inbox" component={InboxScreen} options={ACCOUNT_MENU_NAV ? { tabBarLabel: 'Chats', lazy: false } : undefined} />
      {PRIVATE_MESSAGES_ENABLED ? <Tab.Screen name="DirectChat" component={DirectChatScreen} /> : null}
      <Tab.Screen name="PublicProfile" component={PublicProfileScreen} />
      <Tab.Screen name="Connections" component={ConnectionsScreen} />
      <Tab.Screen name="Leaderboard" component={LeaderboardScreen} />
      <Tab.Screen name="CompetitionDivision" component={CompetitionDivisionScreen} />
    </WorkspaceNavigator>
  );
}

export default function AppNavigator() {
  const { isDark } = useTheme();
  return <PlayerWorkspace isDark={isDark} />;
}

const styles = StyleSheet.create({
  sidebar: { width: DESKTOP_SIDEBAR_WIDTH, height: '100%', paddingHorizontal: 16, paddingTop: 28, borderRightWidth: 1 },
  sidebarBrand: { flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 10, marginBottom: 34 },
  // PP Mori ships 200/400/600 only; heavier weights make the browser fake a smeared bold.
  sidebarLogo: { width: 28, height: 28 },
  sidebarWordmark: { fontSize: 24, lineHeight: 28, fontWeight: '600', letterSpacing: -0.9 },
  sidebarBeta: { alignSelf: 'center', marginLeft: 1, marginTop: 2, color: '#0E2321', backgroundColor: colors.optic, fontSize: 8, lineHeight: 10, fontWeight: '600', letterSpacing: 1, paddingHorizontal: 6, paddingVertical: 3, borderRadius: 5, overflow: 'hidden' },
  sidebarLinks: { height: 'auto', borderWidth: 0, borderRadius: 0, paddingHorizontal: 0, flexDirection: 'column', gap: 6 },
  sidebarLink: { minHeight: 48, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, borderRadius: 12 },
  sidebarLabel: { flex: 1, fontSize: 13, fontWeight: '700' },
  sidebarBadge: { minWidth: 19, paddingHorizontal: 5, paddingVertical: 3, borderRadius: 10, backgroundColor: '#B6472E' },
  sidebarFooter: { marginTop: 'auto', paddingTop: 22, paddingBottom: 16, borderTopWidth: 1 },
  sidebarLogOut: { marginBottom: 14 },
  sidebarVersion: { marginTop: -6, paddingHorizontal: 12, fontSize: 11, fontWeight: '600' },
  sidebarAccount: { marginBottom: 4, gap: 10 },
  tabOuter: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingTop: 5 },
  tabBar: { height: 76, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 25, flexDirection: 'row', backgroundColor: colors.surface, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 11 } }) },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBadge: { position: 'absolute', top: 8, right: 9, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#B6472E' },
  tabBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  activePill: { position: 'absolute', top: 9, right: 2, bottom: 9, left: 2, borderRadius: 17 },
  tabIcon: { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { maxWidth: '100%', marginTop: 1, paddingHorizontal: 6, fontSize: 10, fontWeight: '700', letterSpacing: 0, textAlign: 'center' }, tabLabelActive: { fontWeight: '800' },
  kitchenIndicator: { position: 'absolute', top: -1, width: 34, height: 8 },
  kitchenSolid: { height: 2 },
  kitchenDashed: { marginTop: 2, borderTopWidth: 1, borderStyle: 'dashed' },
  playCircle: { width: 54, height: 54, marginTop: -30, borderRadius: 27, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.optic, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 6 } }) },
  playCircleFocused: { borderWidth: 4 },
  playIcon: { width: 24, height: 24, tintColor: colors.ink },
});
