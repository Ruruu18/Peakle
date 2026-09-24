import Modal from './ResponsiveModal';
import { webDialog } from '../utils/webLayout';
import React from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Ionicons from '@expo/vector-icons/Ionicons';
import { DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

export default function LeaveMatchDialog({ visible, hostName, busy = false, error = '', onCancel, onConfirm }) {
  const insets = useSafeAreaInsets();
  const { isDark } = useTheme();
  const palette = isDark
    ? { ...DARK_CONTENT_COLORS, paper: '#0E2321', surface: '#17302D', destructiveFill: '#C24A38' }
    : { ...LIGHT_CONTENT_COLORS, destructiveFill: LIGHT_CONTENT_COLORS.error };
  const hostLabel = hostName ? `${hostName}’s` : 'the host’s';

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={() => { if (!busy) onCancel(); }}>
      <Pressable {...webDialog('backdrop')} accessibilityLabel="Close leave match dialog" disabled={busy} onPress={onCancel} style={styles.backdrop}>
        <Pressable {...webDialog('surface')}
          accessibilityRole="dialog"
          accessibilityLabel="Leave this match?"
          testID="leave-match-dialog"
          onPress={(event) => event.stopPropagation()}
          style={[styles.sheet, { paddingBottom: Math.max(insets.bottom, 18), backgroundColor: palette.surface, borderColor: palette.line }]}
        >
          <View {...webDialog('handle')} style={[styles.handle, { backgroundColor: palette.line }]} />
          <View style={[styles.icon, { backgroundColor: palette.brickWash }]}>
            <Ionicons name="exit-outline" size={26} color={palette.error} />
          </View>
          <Text style={[styles.eyebrow, { color: palette.error }]}>MATCH LINEUP</Text>
          <Text style={[styles.title, { color: palette.ink }]}>Leave this match?</Text>
          <Text style={[styles.body, { color: palette.ink40 }]}>You’ll be removed from {hostLabel} lineup and they’ll be able to invite someone else.</Text>

          <View style={[styles.note, { backgroundColor: palette.paper, borderColor: palette.line }]}>
            <Ionicons name="information-circle-outline" size={19} color={palette.teal} />
            <Text style={[styles.noteText, { color: palette.ink70 }]}>You can’t rejoin unless the host sends you a new invite.</Text>
          </View>

          {error ? (
            <View accessibilityRole="alert" style={[styles.error, { backgroundColor: palette.brickWash }]}>
              <Ionicons name="alert-circle-outline" size={17} color={palette.error} />
              <Text style={[styles.errorText, { color: palette.error }]}>{error}</Text>
            </View>
          ) : null}

          <View style={styles.actions}>
            <Pressable
              accessibilityRole="button"
              disabled={busy}
              onPress={onCancel}
              style={({ pressed }) => [styles.stayButton, { borderColor: palette.line }, pressed && !busy && styles.pressed, busy && styles.disabled]}
            >
              <Text style={[styles.stayText, { color: palette.teal }]}>Stay in match</Text>
            </Pressable>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Leaving match' : 'Leave match'}
              disabled={busy}
              onPress={onConfirm}
              style={({ pressed }) => [styles.leaveButton, { backgroundColor: palette.destructiveFill }, pressed && !busy && styles.pressed, busy && styles.disabled]}
            >
              {busy ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="exit-outline" size={18} color="#FFFFFF" />}
              <Text style={styles.leaveText}>{busy ? 'Leaving…' : 'Leave match'}</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, paddingHorizontal: 16, paddingTop: 16, alignItems: 'center', justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.72)' },
  sheet: { width: '100%', maxWidth: 420, paddingTop: 10, paddingHorizontal: 20, alignItems: 'center', borderWidth: 1, borderRadius: 26, borderBottomLeftRadius: 12, borderBottomRightRadius: 12 },
  handle: { width: 42, height: 4, marginBottom: 18, borderRadius: 2 },
  icon: { width: 56, height: 56, alignItems: 'center', justifyContent: 'center', borderRadius: 18 },
  eyebrow: { marginTop: 14, fontSize: 11, lineHeight: 15, fontWeight: '900', letterSpacing: 1.1 },
  title: { marginTop: 3, fontSize: 24, lineHeight: 30, fontWeight: '900', letterSpacing: -0.5, textAlign: 'center' },
  body: { maxWidth: 330, marginTop: 7, fontSize: 14, lineHeight: 20, textAlign: 'center' },
  note: { width: '100%', minHeight: 58, marginTop: 18, paddingHorizontal: 13, flexDirection: 'row', alignItems: 'center', gap: 9, borderWidth: 1, borderRadius: 14 },
  noteText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '600' },
  error: { width: '100%', minHeight: 48, marginTop: 10, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 13 },
  errorText: { flex: 1, fontSize: 12, lineHeight: 17, fontWeight: '700' },
  actions: { width: '100%', marginTop: 18, flexDirection: 'row', gap: 10 },
  stayButton: { flex: 1, minHeight: 52, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 14 },
  stayText: { fontSize: 14, fontWeight: '800' },
  leaveButton: { flex: 1, minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 14 },
  leaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '900' },
  pressed: { opacity: 0.8, transform: [{ scale: 0.985 }] },
  disabled: { opacity: 0.58 },
});
