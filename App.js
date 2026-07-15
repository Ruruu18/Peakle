import React from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import { DarkTheme, DefaultTheme, NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import AppNavigator from './src/navigation/AppNavigator';
import { LocationProvider } from './src/context/LocationContext';
import { AppModeProvider } from './src/context/AppModeContext';
import { OpenPlaySessionProvider } from './src/context/OpenPlaySessionContext';
import { AuthProvider, useAuth } from './src/context/AuthContext';
import AuthFlowScreen from './src/screens/AuthFlowScreen';
import { ThemeProvider, useTheme } from './src/context/ThemeContext';

const colors = { ink: '#0E2321', optic: '#D6E94A', surface: '#FFFFFF' };

function LaunchScreen() {
  return (
    <View style={styles.launchScreen} accessibilityLabel="Peakle is starting">
      <View style={styles.launchMark}><Text style={styles.launchLetter}>P</Text></View>
      <Text style={styles.launchName}>Peakle</Text>
      <ActivityIndicator color={colors.optic} style={styles.launchSpinner} />
    </View>
  );
}

function Root() {
  const { user, hydrated: authHydrated, passwordRecovery } = useAuth();
  const { isDark } = useTheme();
  const navigationTheme = isDark ? {
    ...DarkTheme,
    colors: { ...DarkTheme.colors, primary: colors.optic, background: colors.ink, card: '#17302D', text: '#F3F5EF', border: '#304743' },
  } : DefaultTheme;

  if (!authHydrated) return <LaunchScreen />;
  if (passwordRecovery) return <AuthFlowScreen key="password-recovery" initialScreen="reset-password" />;
  if (!user) return <AuthFlowScreen key="login" initialScreen="login" />;
  if (!user.onboardingCompleted) return <AuthFlowScreen key={`new-user-setup-${user.id}`} initialScreen="new-user-overview" />;
  return <NavigationContainer theme={navigationTheme}><AppNavigator /></NavigationContainer>;
}

export default function App() {
  return (
    <SafeAreaProvider>
      <AuthProvider>
        <LocationProvider>
          <ThemeProvider>
            <AppModeProvider>
              <OpenPlaySessionProvider>
                <Root />
              </OpenPlaySessionProvider>
            </AppModeProvider>
          </ThemeProvider>
        </LocationProvider>
      </AuthProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  launchScreen: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.ink },
  launchMark: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center', backgroundColor: colors.optic },
  launchLetter: { color: colors.ink, fontSize: 24, fontWeight: '900' },
  launchName: { marginTop: 12, color: colors.surface, fontSize: 22, fontWeight: '900', letterSpacing: -0.7 },
  launchSpinner: { marginTop: 24 },
});
