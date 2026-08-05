import React from 'react';
import { Image, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const BALL_IMAGE = require('../../public/images/ball.png');

const LIGHT_C = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED',
};

export default function WorkspaceSwitchModal({ nextMode, onCancel, onConfirm }) {
  const { isDark } = useTheme();
  const C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  const styles = isDark ? darkStyles : lightStyles;
  const organizer = nextMode === 'organizer';

  return <Modal visible={Boolean(nextMode)} transparent animationType="fade" onRequestClose={onCancel}>
    <Pressable accessibilityLabel="Cancel workspace change" onPress={onCancel} style={styles.backdrop}>
      <Pressable accessibilityRole="alert" onPress={(event) => event.stopPropagation()} style={styles.dialog}>
        <View style={styles.dialogIcon}>{organizer ? <Ionicons name="key-outline" size={27} color="#0E2321" /> : <Image source={BALL_IMAGE} style={{ width: 27, height: 27, tintColor: '#0E2321' }} resizeMode="contain" />}</View>
        <Text style={styles.eyebrow}>CHANGE APP MODE</Text>
        <Text style={styles.title}>Switch to {organizer ? 'Organizer' : 'Player'}?</Text>
        <Text style={styles.body}>{organizer ? 'You’ll enter the organizer workspace for sessions, courts, queues, and player monitoring.' : 'You’ll return to your personal bookings, matches, teams, and player statistics.'}</Text>
        <View style={styles.note}><Ionicons name="information-circle-outline" size={17} color={C.teal} /><Text style={styles.noteText}>{organizer ? 'You can still participate as a player in your own session.' : 'Any active organizer session will keep running and can be resumed later.'}</Text></View>
        <View style={styles.actions}><Pressable onPress={onCancel} style={styles.cancelButton}><Text style={styles.cancelText}>Stay here</Text></Pressable><Pressable onPress={onConfirm} style={styles.confirmButton}><Text style={styles.confirmText}>Switch workspace</Text></Pressable></View>
      </Pressable>
    </Pressable>
  </Modal>;
}

const shadow = Platform.select({ ios: { shadowColor: '#0E2321', shadowOpacity: .08, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } }, android: { elevation: 3 } });
const lightStyles = createMobileStyleSheet({
  backdrop: { flex: 1, padding: 24, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(14,35,33,.58)' },
  dialog: { width: '100%', maxWidth: 370, padding: 20, borderRadius: 23, backgroundColor: LIGHT_C.paper, ...shadow },
  dialogIcon: { width: 54, height: 54, marginBottom: 14, borderRadius: 17, alignItems: 'center', justifyContent: 'center', backgroundColor: LIGHT_C.optic },
  eyebrow: { color: LIGHT_C.teal, fontSize: 8, fontWeight: '900', letterSpacing: .9 },
  title: { marginTop: 4, color: LIGHT_C.ink, fontSize: 22, lineHeight: 28, fontWeight: '900' },
  body: { marginTop: 7, color: LIGHT_C.ink70, fontSize: 10, lineHeight: 16 },
  note: { minHeight: 56, marginTop: 14, padding: 10, flexDirection: 'row', alignItems: 'center', gap: 7, borderRadius: 13, backgroundColor: LIGHT_C.tealWash },
  noteText: { flex: 1, color: LIGHT_C.ink70, fontSize: 8, lineHeight: 12 },
  actions: { marginTop: 16, flexDirection: 'row', gap: 9 },
  cancelButton: { minHeight: 48, flex: 1, alignItems: 'center', justifyContent: 'center', borderRadius: 13, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  cancelText: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '900' },
  confirmButton: { minHeight: 48, flex: 1.35, alignItems: 'center', justifyContent: 'center', borderRadius: 13, backgroundColor: LIGHT_C.optic },
  confirmText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
});
const darkStyles = {
  ...createDarkStyleSheet(lightStyles),
  confirmButton: { ...lightStyles.confirmButton, backgroundColor: LIGHT_C.optic },
  confirmText: { ...lightStyles.confirmText, color: '#0E2321' },
};
