import React, { useState } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import * as ImagePicker from 'expo-image-picker';
import ResilientImage from './ResilientImage';

const DEFAULT_COLORS = {
  ink: '#0E2321',
  surface: '#FFFFFF',
  optic: '#D6E94A',
  teal: '#1C6B66',
  ink40: '#7C8983',
  line: '#DDE3DA',
  tealWash: '#E5F0ED',
};

export default function OrganizerImagePicker({
  value,
  onChange,
  onError,
  title = 'Cover photo',
  detail = 'Choose a clear image that players will recognize.',
  emptyIcon = 'image-outline',
  aspect = [16, 9],
  colors = DEFAULT_COLORS,
  compact = false,
}) {
  const C = { ...DEFAULT_COLORS, ...colors };
  const [picking, setPicking] = useState(false);
  const dark = String(C.ink).toLowerCase() === '#f3f5ef';
  const cardColor = dark ? '#17302D' : C.surface;
  const actionColor = dark ? C.optic : C.ink;
  const actionTextColor = dark ? '#0E2321' : '#FFFFFF';

  const chooseImage = async () => {
    setPicking(true);
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect,
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
    <View style={[styles.card, compact && styles.cardCompact, { borderColor: C.line, backgroundColor: cardColor }]}>
      <ResilientImage
        uri={value || null}
        accessibilityLabel={value ? title : undefined}
        fallback={<Ionicons name={emptyIcon} size={compact ? 24 : 30} color={C.teal} />}
        fallbackColor={C.tealWash}
        style={[styles.preview, compact && styles.previewCompact]}
      />
      <View style={styles.copy}>
        <Text style={[styles.title, { color: C.ink }]}>{title}</Text>
        <Text style={[styles.detail, { color: C.ink40 }]}>{value ? 'Image selected. You can replace or remove it.' : detail}</Text>
        <View style={styles.actions}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={value ? `Change ${title.toLowerCase()}` : `Choose ${title.toLowerCase()}`}
            disabled={picking}
            onPress={chooseImage}
            style={({ pressed }) => [styles.choose, { backgroundColor: actionColor }, (pressed || picking) && styles.pressed]}
          >
            {picking ? <ActivityIndicator size="small" color={actionTextColor} /> : <Ionicons name="images-outline" size={16} color={actionTextColor} />}
            <Text style={[styles.chooseText, { color: actionTextColor }]}>{value ? 'Change' : 'Choose photo'}</Text>
          </Pressable>
          {value ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Remove ${title.toLowerCase()}`}
              onPress={() => { onChange(''); onError?.(''); }}
              style={({ pressed }) => [styles.remove, { borderColor: C.line, backgroundColor: C.tealWash }, pressed && styles.pressed]}
            >
              <Ionicons name="trash-outline" size={16} color={C.teal} />
            </Pressable>
          ) : null}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: { padding: 11, flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderRadius: 16 },
  cardCompact: { padding: 9 },
  preview: { width: 112, height: 78, borderRadius: 12 },
  previewCompact: { width: 76, height: 62, borderRadius: 10 },
  copy: { flex: 1, minWidth: 0 },
  title: { fontSize: 11, lineHeight: 15, fontWeight: '900' },
  detail: { marginTop: 3, fontSize: 8, lineHeight: 12 },
  actions: { marginTop: 9, flexDirection: 'row', alignItems: 'center', gap: 6 },
  choose: { minHeight: 38, paddingHorizontal: 11, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 10 },
  chooseText: { fontSize: 9, fontWeight: '900' },
  remove: { width: 40, height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderRadius: 10 },
  pressed: { opacity: .72, transform: [{ scale: .98 }] },
});
