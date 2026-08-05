import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import ProfilePhoto from './ProfilePhoto';
import { normalizeProfilePhoto } from '../services/profilePhotos';

const DEFAULT_COLORS = {
  ink: '#0E2321',
  surface: '#FFFFFF',
  optic: '#D6E94A',
  teal: '#1C6B66',
  ink40: '#7C8983',
  line: '#DDE3DA',
  tealWash: '#E5F0ED',
};

export default function ProfilePhotoPicker({ value, name, onChange, onError, colors = DEFAULT_COLORS, dark = false }) {
  const C = { ...DEFAULT_COLORS, ...colors };
  const [picking, setPicking] = useState(false);
  const visibleValue = normalizeProfilePhoto(value);
  const palette = {
    card: dark ? '#17302D' : C.surface,
    primary: dark ? C.optic : C.ink,
    primaryText: dark ? '#0E2321' : '#FFFFFF',
    secondary: dark ? '#203B37' : C.tealWash,
  };

  const choosePhoto = async () => {
    setPicking(true);
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        throw new Error('Allow photo access in your device settings to choose a profile picture.');
      }
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 1,
      });
      if (!result.canceled && result.assets?.[0]?.uri) {
        onChange(result.assets[0].uri);
        onError?.('');
      }
    } catch (error) {
      onError?.(error.message || 'Your photo library could not be opened.');
    } finally {
      setPicking(false);
    }
  };

  return (
    <View style={[styles.card, { borderColor: C.line, backgroundColor: palette.card }]}>
      <View style={styles.topRow}>
        <View style={styles.preview}>
          <ProfilePhoto photo={visibleValue} name={name} size={82} />
          <View style={[styles.cameraBadge, { borderColor: palette.card, backgroundColor: C.optic }]}>
            <Ionicons name="camera" size={15} color="#0E2321" />
          </View>
        </View>
        <View style={styles.copy}>
          <Text style={[styles.title, { color: C.ink }]}>{visibleValue ? 'Profile photo' : 'No photo selected'}</Text>
          <Text style={[styles.detail, { color: C.ink40 }]}>{visibleValue ? 'Choose a new photo or remove the current one.' : 'Add a clear photo so players can recognize you.'}</Text>
        </View>
      </View>
      <View style={styles.actions}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={visibleValue ? 'Choose a different profile photo' : 'Choose a profile photo'}
          disabled={picking}
          onPress={choosePhoto}
          style={({ pressed }) => [styles.chooseButton, { backgroundColor: palette.primary }, (pressed || picking) && styles.pressed]}
        >
          {picking
            ? <ActivityIndicator size="small" color={palette.primaryText} />
            : <Ionicons name="images-outline" size={18} color={palette.primaryText} />}
          <Text style={[styles.chooseText, { color: palette.primaryText }]}>{visibleValue ? 'Change photo' : 'Choose photo'}</Text>
        </Pressable>
        {visibleValue ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Remove profile photo"
            onPress={() => { onChange(''); onError?.(''); }}
            style={({ pressed }) => [styles.removeButton, { borderColor: C.line, backgroundColor: palette.secondary }, pressed && styles.pressed]}
          >
            <Text style={[styles.removeText, { color: C.teal }]}>Remove</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 15, borderWidth: 1, borderRadius: 18 },
  topRow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  preview: { width: 84, height: 84 },
  cameraBadge: { position: 'absolute', right: -1, bottom: -1, width: 30, height: 30, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderRadius: 15 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 14, lineHeight: 18, fontWeight: '900' },
  detail: { marginTop: 4, fontSize: 11, lineHeight: 15 },
  actions: { marginTop: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  chooseButton: { minHeight: 46, paddingHorizontal: 14, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12 },
  chooseText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  removeButton: { minWidth: 96, minHeight: 46, paddingHorizontal: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 12 },
  removeText: { fontSize: 12, lineHeight: 16, fontWeight: '900' },
  pressed: { opacity: .72, transform: [{ scale: .98 }] },
});
