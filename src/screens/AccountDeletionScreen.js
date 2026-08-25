import React, { useState } from 'react';
import { ActivityIndicator, Alert, Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';

const DELETION_URL = (process.env.EXPO_PUBLIC_ACCOUNT_DELETION_URL || 'https://melbfzfuxrviybblipua.supabase.co/functions/v1/legal/account-deletion').trim();

export default function AccountDeletionScreen({ navigation }) {
  const { deleteAccount, user } = useAuth();
  const { isDark } = useTheme();
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const ready = confirmation.trim().toUpperCase() === 'DELETE';
  const C = isDark
    ? { paper: '#102825', surface: '#17302D', ink: '#F3F5EF', muted: '#A7B8B2', line: '#29443F', brick: '#FF9B88', wash: '#402C29' }
    : { paper: '#F3F5EF', surface: '#FFFFFF', ink: '#0E2321', muted: '#66756F', line: '#DDE3DA', brick: '#B6472E', wash: '#F7EAE6' };

  const confirmDeletion = () => {
    if (!ready || busy) return;
    Alert.alert(
      'Permanently delete account?',
      'This cannot be undone. Your Peakle profile and personal app data will be removed.',
      [
        { text: 'Keep account', style: 'cancel' },
        {
          text: 'Delete permanently',
          style: 'destructive',
          onPress: async () => {
            setBusy(true);
            setError('');
            try { await deleteAccount(); }
            catch (reason) { setError(reason.message || 'Account deletion could not be completed.'); setBusy(false); }
          },
        },
      ],
    );
  };

  return (
    <SafeAreaView style={[styles.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={[styles.header, { borderBottomColor: C.line }]}>
        <Pressable accessibilityLabel="Go back" disabled={busy} onPress={() => navigation.goBack()} style={[styles.back, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Ionicons name="arrow-back" size={20} color={C.ink} />
        </Pressable>
        <View style={styles.flex}><Text style={[styles.eyebrow, { color: C.muted }]}>ACCOUNT CONTROL</Text><Text style={[styles.title, { color: C.ink }]}>Delete account</Text></View>
      </View>
      <View style={styles.content}>
        <View style={[styles.warning, { backgroundColor: C.wash }]}>
          <View style={[styles.warningIcon, { backgroundColor: C.surface }]}><Ionicons name="warning" size={22} color={C.brick} /></View>
          <View style={styles.flex}>
            <Text style={[styles.warningTitle, { color: C.brick }]}>Permanent and irreversible</Text>
            <Text style={[styles.warningBody, { color: C.ink }]}>Deleting {user?.email || 'this account'} removes your sign-in, profile, uploaded profile photo, private messages, team chat content, and personal activity records.</Text>
          </View>
        </View>
        <View style={[styles.card, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Text style={[styles.cardTitle, { color: C.ink }]}>Before you continue</Text>
          {[
            'Team ownership is transferred to another team member when possible.',
            'Completed payment or refund records may be retained only where legally required and are disconnected from your profile.',
            'You will be signed out on this device immediately.',
          ].map((item) => <View key={item} style={styles.point}><Ionicons name="checkmark-circle-outline" size={18} color={C.muted} /><Text style={[styles.pointText, { color: C.muted }]}>{item}</Text></View>)}
          <Text style={[styles.label, { color: C.ink }]}>TYPE DELETE TO CONFIRM</Text>
          <TextInput
            accessibilityLabel="Type DELETE to confirm account deletion"
            editable={!busy}
            autoCapitalize="characters"
            autoCorrect={false}
            value={confirmation}
            onChangeText={setConfirmation}
            placeholder="DELETE"
            placeholderTextColor={C.muted}
            style={[styles.input, { color: C.ink, borderColor: ready ? C.brick : C.line, backgroundColor: C.paper }]}
          />
          {error ? <Text style={[styles.error, { color: C.brick }]}>{error}</Text> : null}
          <Pressable accessibilityRole="button" disabled={!ready || busy} onPress={confirmDeletion} style={[styles.deleteButton, { backgroundColor: C.brick }, (!ready || busy) && styles.disabled]}>
            {busy ? <ActivityIndicator color="#FFFFFF" /> : <><Ionicons name="trash-outline" size={18} color="#FFFFFF" /><Text style={styles.deleteText}>Delete my Peakle account</Text></>}
          </Pressable>
        </View>
        <Pressable accessibilityRole="link" onPress={() => Linking.openURL(DELETION_URL)} style={styles.webLink}>
          <Text style={[styles.webLinkText, { color: C.muted }]}>View the account-deletion policy online</Text><Ionicons name="open-outline" size={15} color={C.muted} />
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1 }, flex: { flex: 1 },
  header: { minHeight: 72, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', gap: 12, borderBottomWidth: 1 },
  back: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1 },
  eyebrow: { fontSize: 10, fontWeight: '800', letterSpacing: 1 }, title: { marginTop: 2, fontSize: 23, fontWeight: '900' },
  content: { padding: 18 }, warning: { padding: 16, flexDirection: 'row', gap: 12, borderRadius: 20 },
  warningIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  warningTitle: { fontSize: 15, fontWeight: '900' }, warningBody: { marginTop: 5, fontSize: 12, lineHeight: 19 },
  card: { marginTop: 14, padding: 17, borderWidth: 1, borderRadius: 20 }, cardTitle: { fontSize: 16, fontWeight: '900' },
  point: { marginTop: 13, flexDirection: 'row', alignItems: 'flex-start', gap: 9 }, pointText: { flex: 1, fontSize: 12, lineHeight: 18 },
  label: { marginTop: 22, marginBottom: 8, fontSize: 10, fontWeight: '900', letterSpacing: .8 },
  input: { minHeight: 52, paddingHorizontal: 14, borderWidth: 1.5, borderRadius: 14, fontSize: 15, fontWeight: '900', letterSpacing: 1 },
  error: { marginTop: 10, fontSize: 12, lineHeight: 18, fontWeight: '700' },
  deleteButton: { minHeight: 54, marginTop: 14, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 15 },
  deleteText: { color: '#FFFFFF', fontSize: 13, fontWeight: '900' }, disabled: { opacity: .42 },
  webLink: { minHeight: 48, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 }, webLinkText: { fontSize: 11, fontWeight: '700' },
});
