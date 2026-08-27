import React, { useEffect, useRef, useState } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import HomeScreen from '../screens/HomeScreen';
import BookScreen from '../screens/BookScreen';
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
import SupportChatScreen from '../screens/SupportChatScreen';
import { DirectChatScreen, InboxScreen } from '../screens/DirectMessagesScreens';
import PublicProfileScreen from '../screens/PublicProfileScreen';
import ConnectionsScreen from '../screens/ConnectionsScreen';
import LeaderboardScreen from '../screens/LeaderboardScreen';
import CompetitionDivisionScreen from '../screens/CompetitionDivisionScreen';
import NotificationTestScreen from '../screens/NotificationTestScreen';
import { useTheme } from '../context/ThemeContext';
import { useNearbyPlayersContext } from '../context/NearbyPlayersContext';
import LeaveMatchDialog from '../components/LeaveMatchDialog';

const Tab = createBottomTabNavigator();
const colors = { ink: '#0E2321', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA' };
const icons = { Home: 'home-outline', Book: 'compass-outline', Play: 'tennisball-outline', Team: 'people-outline', Profile: 'person-outline' };
const BALL_IMAGE = require('../../public/images/ball.png');
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TabBarItem({ focused, label, onPress, play, routeName, theme, badge = 0 }) {
  const focusProgress = useRef(new Animated.Value(focused ? 1 : 0)).current;
  const pressProgress = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(focusProgress, {
      toValue: focused ? 1 : 0,
      duration: 150,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [focusProgress, focused]);

  const animatePress = (value) => {
    Animated.spring(pressProgress, {
      toValue: value,
      speed: 40,
      bounciness: value === 1 ? 2 : 0,
      useNativeDriver: true,
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
          <Ionicons name={icons[routeName]} size={20} color={focused ? theme.activeText : theme.muted} />
        )}
      </Animated.View>
      <Text style={[styles.tabLabel, { color: focused ? (play ? theme.centerActiveLabel : theme.activeLabel) : theme.muted }, focused && styles.tabLabelActive]}>{label}</Text>
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
  const { isDark } = useTheme();
  const { joinedInvite, leave } = useNearbyPlayersContext();
  const [leaveDialogOpen, setLeaveDialogOpen] = useState(false);
  const [leavingMatch, setLeavingMatch] = useState(false);
  const [leaveError, setLeaveError] = useState('');
  const [pendingRoute, setPendingRoute] = useState(null);
  const alwaysHiddenRoutes = new Set(['Pickleball', 'Activities', 'ActivityDetails', 'OpenPlayActivity', 'Privacy', 'LegalDocument', 'AccountDeletion', 'PaymentHistory', 'HelpSupport', 'SupportChat', 'NotificationTest', 'Inbox', 'DirectChat', 'PublicProfile', 'Connections', 'Leaderboard', 'CompetitionDivision']);
  const currentRoute = state.routes[state.index];
  const theme = isDark
    ? { background: '#0E2321', surface: '#17302D', line: '#304743', activeText: colors.ink, activeLabel: colors.ink, centerActiveLabel: colors.surface, muted: '#9FB3AC', active: colors.optic, kitchenLine: colors.optic }
    : { background: '#F3F5EF', surface: colors.surface, line: colors.line, activeText: colors.ink, activeLabel: colors.ink, centerActiveLabel: colors.ink, muted: colors.ink40, active: colors.optic, kitchenLine: colors.teal };
  // Exclude routes that should never show a tab
  const visibleRoutes = state.routes.filter((route) => !alwaysHiddenRoutes.has(route.name));
  const contextualOwner = currentRoute.name === 'Pickleball'
    ? (currentRoute.params?.ownerTab || ({ Ratings: 'Profile', Privacy: 'Profile', 'Find play': 'Play', Compete: 'Book' }[currentRoute.params?.openTab]))
    : currentRoute.name === 'Leaderboard' ? 'Home'
    : ['Privacy', 'HelpSupport', 'SupportChat', 'NotificationTest', 'Connections'].includes(currentRoute.name) ? 'Profile'
    : ['Inbox', 'DirectChat'].includes(currentRoute.name) ? (currentRoute.params?.ownerTab || 'Team')
    : ['Activities', 'ActivityDetails', 'OpenPlayActivity'].includes(currentRoute.name) ? 'Home'
    : null;
  return (
    <View style={[styles.tabOuter, { paddingBottom: Math.max(insets.bottom, 9), backgroundColor: theme.background }]}>
      <View style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {visibleRoutes.map((route) => {
          const routeFocused = currentRoute.key === route.key;
          const focused = routeFocused
            || route.name === contextualOwner;
          const play = route.name === 'Play';
          const label = descriptors[route.key].options.tabBarLabel ?? route.name;
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
          return <TabBarItem key={route.key} focused={focused} label={label} onPress={onPress} play={play} routeName={route.name} theme={theme} badge={route.name === 'Team' ? Number(route.params?.unreadCount || 0) : 0} />;
        })}
      </View>
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
  return (
    <Tab.Navigator
      key={workspaceKey}
      initialRouteName={initialRouteName}
      backBehavior="history"
      tabBar={(props) => <PeakleTabBar {...props} />}
      detachInactiveScreens={false}
      screenOptions={{
        headerShown: false,
        // A lazy screen can miss the first paint on slower devices. Never fade
        // the current scene away while the destination is still mounting.
        animation: 'none',
        freezeOnBlur: false,
        sceneStyle: { backgroundColor: isDark ? '#0E2321' : '#F3F5EF' },
      }}
    >
      {children}
    </Tab.Navigator>
  );
}

function PlayerWorkspace({ isDark }) {
  return (
    <WorkspaceNavigator workspaceKey="player-workspace" initialRouteName="Home" isDark={isDark}>
      <Tab.Screen name="Home" component={HomeScreen} options={{ lazy: false }} />
      <Tab.Screen name="Book" component={BookScreen} options={{ tabBarLabel: 'Explore', lazy: false }} />
      <Tab.Screen name="Play" component={PlayScreen} options={{ lazy: false }} />
      <Tab.Screen name="Team" component={TeamScreen} options={{ tabBarLabel: 'Teams', lazy: false }} />
      <Tab.Screen name="Profile" component={PlayerProfileScreen} options={{ lazy: false }} />
      <Tab.Screen name="Pickleball" component={PickleballHubScreen} />
      <Tab.Screen name="Activities" component={PlayerActivitiesScreen} />
      <Tab.Screen name="ActivityDetails" component={PlayerActivityDetailsScreen} />
      <Tab.Screen name="OpenPlayActivity" component={PlayerOpenPlayRouteScreen} />
      <Tab.Screen name="Privacy" component={PrivacyScreen} />
      <Tab.Screen name="LegalDocument" component={LegalDocumentScreen} />
      <Tab.Screen name="AccountDeletion" component={AccountDeletionScreen} />
      <Tab.Screen name="PaymentHistory" component={PaymentHistoryScreen} />
      <Tab.Screen name="HelpSupport" component={HelpSupportScreen} />
      <Tab.Screen name="SupportChat" component={SupportChatScreen} />
      <Tab.Screen name="NotificationTest" component={NotificationTestScreen} />
      <Tab.Screen name="Inbox" component={InboxScreen} />
      <Tab.Screen name="DirectChat" component={DirectChatScreen} />
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
  tabOuter: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingTop: 5 },
  tabBar: { height: 76, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 25, flexDirection: 'row', backgroundColor: colors.surface, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 11 } }) },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  tabBadge: { position: 'absolute', top: 8, right: 9, minWidth: 18, height: 18, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderRadius: 9, backgroundColor: '#B6472E' },
  tabBadgeText: { color: '#FFFFFF', fontSize: 8, fontWeight: '900' },
  activePill: { position: 'absolute', top: 9, right: 5, bottom: 9, left: 5, borderRadius: 17 },
  tabIcon: { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { marginTop: 1, fontSize: 10, fontWeight: '700', letterSpacing: 0.1 }, tabLabelActive: { fontWeight: '900' },
  kitchenIndicator: { position: 'absolute', top: -1, width: 34, height: 8 },
  kitchenSolid: { height: 2 },
  kitchenDashed: { marginTop: 2, borderTopWidth: 1, borderStyle: 'dashed' },
  playCircle: { width: 54, height: 54, marginTop: -30, borderRadius: 27, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.optic, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 6 } }) },
  playCircleFocused: { borderWidth: 4 },
  playIcon: { width: 24, height: 24, tintColor: colors.ink },
});
