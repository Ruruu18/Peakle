import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import HomeScreen from '../screens/HomeScreen';
import BookScreen from '../screens/BookScreen';
import PlayScreen from '../screens/PlayScreen';
import TeamScreen from '../screens/TeamScreen';
import ProfileScreen from '../screens/ProfileScreen';
import { OrganizerMonitorScreen, OrganizerOverviewScreen, OrganizerPlayersScreen, OrganizerSessionsScreen } from '../screens/OrganizerScreens';
import { useAppMode } from '../context/AppModeContext';
import { useTheme } from '../context/ThemeContext';

const Tab = createBottomTabNavigator();
const colors = { ink: '#0E2321', surface: '#FFFFFF', optic: '#D6E94A', ink40: '#7C8983', line: '#DDE3DA' };
const icons = { Home: 'home-outline', Book: 'calendar-outline', Play: 'tennisball-outline', Team: 'people-outline', Profile: 'person-outline', Overview: 'grid-outline', Sessions: 'calendar-outline', Monitor: 'pulse-outline', Players: 'people-outline' };
const AnimatedPressable = Animated.createAnimatedComponent(Pressable);

function TabBarItem({ focused, label, onPress, play, routeName, theme }) {
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
          <Image source={require('../../public/images/ball.png')} style={styles.playIcon} resizeMode="contain" />
        ) : (
          <Ionicons name={icons[routeName]} size={20} color={focused ? theme.text : theme.muted} />
        )}
      </Animated.View>
      <Text style={[styles.tabLabel, { color: focused ? theme.text : theme.muted }, focused && styles.tabLabelActive]}>{label}</Text>
      {!play ? (
        <Animated.View style={[styles.kitchenIndicator, { opacity: focusProgress }]}>
          <View style={[styles.kitchenSolid, { backgroundColor: colors.optic }]} />
          <View style={[styles.kitchenDashed, { borderColor: colors.optic }]} />
        </Animated.View>
      ) : null}
    </AnimatedPressable>
  );
}

function PeakleTabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const theme = isDark
    ? { background: '#0E2321', surface: '#17302D', line: '#304743', text: '#F3F5EF', muted: '#9FB3AC', active: '#24423D' }
    : { background: '#F3F5EF', surface: colors.surface, line: colors.line, text: colors.ink, muted: colors.ink40, active: '#EEF2EC' };
  return (
    <View style={[styles.tabOuter, { paddingBottom: Math.max(insets.bottom, 9), backgroundColor: theme.background }]}>
      <View style={[styles.tabBar, { backgroundColor: theme.surface, borderColor: theme.line }]}>
        {state.routes.map((route, index) => {
          const focused = state.index === index;
          const play = route.name === 'Play' || route.name === 'Monitor';
          const label = descriptors[route.key].options.tabBarLabel ?? route.name;
          const onPress = () => {
            const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
            if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
          };
          return <TabBarItem key={route.key} focused={focused} label={label} onPress={onPress} play={play} routeName={route.name} theme={theme} />;
        })}
      </View>
    </View>
  );
}

export default function AppNavigator() {
  const { mode } = useAppMode();
  const { isDark } = useTheme();
  return (
    <Tab.Navigator
      key={`${mode}-workspace`}
      tabBar={(props) => <PeakleTabBar {...props} />}
      screenOptions={{
        headerShown: false,
        sceneStyle: { backgroundColor: isDark ? '#0E2321' : '#F3F5EF' },
      }}
    >
      {mode === 'player' ? <>
        <Tab.Screen name="Home" component={HomeScreen} />
        <Tab.Screen name="Book" component={BookScreen} />
        <Tab.Screen name="Play" component={PlayScreen} />
        <Tab.Screen name="Team" component={TeamScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </> : <>
        <Tab.Screen name="Overview" component={OrganizerOverviewScreen} />
        <Tab.Screen name="Sessions" component={OrganizerSessionsScreen} />
        <Tab.Screen name="Monitor" component={OrganizerMonitorScreen} />
        <Tab.Screen name="Players" component={OrganizerPlayersScreen} />
        <Tab.Screen name="Profile" component={ProfileScreen} />
      </>}
    </Tab.Navigator>
  );
}

const styles = StyleSheet.create({
  tabOuter: { backgroundColor: 'transparent', paddingHorizontal: 12, paddingTop: 5 },
  tabBar: { height: 76, paddingHorizontal: 5, borderWidth: 1, borderColor: colors.line, borderRadius: 25, flexDirection: 'row', backgroundColor: colors.surface, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.16, shadowRadius: 24, shadowOffset: { width: 0, height: 10 } }, android: { elevation: 11 } }) },
  tabItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  activePill: { position: 'absolute', top: 9, right: 5, bottom: 9, left: 5, borderRadius: 17 },
  tabIcon: { width: 30, height: 26, alignItems: 'center', justifyContent: 'center' },
  tabLabel: { marginTop: 1, fontSize: 8.5, fontWeight: '700', letterSpacing: 0.1 }, tabLabelActive: { fontWeight: '900' },
  kitchenIndicator: { position: 'absolute', top: -1, width: 34, height: 8 },
  kitchenSolid: { height: 2 },
  kitchenDashed: { marginTop: 2, borderTopWidth: 1, borderStyle: 'dashed' },
  playCircle: { width: 54, height: 54, marginTop: -30, borderRadius: 27, borderWidth: 4, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.optic, ...Platform.select({ ios: { shadowColor: colors.ink, shadowOpacity: 0.14, shadowRadius: 8, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 6 } }) },
  playCircleFocused: { borderWidth: 4 },
  playIcon: { width: 24, height: 24, tintColor: colors.ink },
});
