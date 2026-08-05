import React, { useCallback, useEffect, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import PlayerOpenPlayScreen from './PlayerOpenPlayScreen';
import { useTheme } from '../context/ThemeContext';
import { getOpenPlaySession } from '../services/openPlayRegistration';
import PeakleLoadingOverlay from '../components/PeakleLoadingOverlay';

export default function PlayerOpenPlayRouteScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const returnTo = route?.params?.returnTo || 'Home';
  const direct = Boolean(route?.params?.direct);
  const sessionId = route?.params?.sessionId || null;
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(direct);
  const [error, setError] = useState('');
  const leave = () => navigation.navigate(returnTo);
  const loadDirectSession = useCallback(async () => {
    if (!direct || !sessionId) {
      setSession(null);
      setLoading(false);
      setError('');
      return;
    }
    setSession(null);
    setLoading(true);
    setError('');
    try {
      const resolved = await getOpenPlaySession({ sessionId });
      if (!resolved?.id) throw new Error('This open-play session is no longer available.');
      setSession(resolved);
    } catch (loadError) {
      setSession(null);
      setError(loadError.message || 'This open-play session could not be opened.');
    } finally {
      setLoading(false);
    }
  }, [direct, sessionId]);
  useEffect(() => { loadDirectSession(); }, [loadDirectSession, route?.params?.token]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: isDark ? '#0E2321' : '#F3F5EF' }}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={isDark ? '#0E2321' : '#F3F5EF'} />
      {direct && session?.id !== sessionId && !loading ? <View style={{ flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: isDark ? '#F3F5EF' : '#0E2321', fontSize: 18, fontWeight: '900', textAlign: 'center' }}>Activity unavailable</Text><Text style={{ marginTop: 7, color: isDark ? '#8FA39C' : '#7C8983', fontSize: 10, lineHeight: 15, textAlign: 'center' }}>{error}</Text><Pressable accessibilityRole="button" onPress={loadDirectSession} style={{ minHeight: 48, marginTop: 18, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: '#D6E94A' }}><Text style={{ color: '#0E2321', fontSize: 10, fontWeight: '900' }}>Try again</Text></Pressable><Pressable accessibilityRole="button" onPress={leave} style={{ minHeight: 44, marginTop: 5, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#1C6B66', fontSize: 10, fontWeight: '900' }}>Back</Text></Pressable></View> : direct && session?.id === sessionId || !direct ? <PlayerOpenPlayScreen
        key={`${direct ? 'direct' : 'finder'}:${route?.params?.token || sessionId || 'default'}`}
        initialSession={direct ? session : null}
        initialCode={route?.params?.code || ''}
        initialSessionId={direct ? null : sessionId}
        navigationToken={direct ? null : route?.params?.token || null}
        onBack={leave}
        onDetailBack={direct ? leave : null}
      /> : null}
      <PeakleLoadingOverlay visible={direct && loading} status="OPENING ACTIVITY DETAILS" />
    </SafeAreaView>
  );
}
