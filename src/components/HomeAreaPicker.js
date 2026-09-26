import React, { useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { formatLocation, parseLocation } from '../data/phLocations';
import { locationErrorMessage } from '../context/LocationContext';
import { detectHomeAreaLabel } from '../utils/devicePosition';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';
import LocationSearchSheet from './LocationSearchSheet';

const LIGHT_C = { ink: '#0E2321', surface: '#FFFFFF', teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED' };
let C = LIGHT_C;

/** Profile "home area" field (City · Region · Country) used by onboarding and Edit profile. */
export default function HomeAreaPicker({ value, onChange, forceLight = false }) {
  const { isDark } = useTheme();
  const dark = isDark && !forceLight;
  C = dark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = dark ? darkStyles : lightStyles;

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const parsed = useMemo(() => parseLocation(value), [value]);

  const openSheet = () => { setError(''); setOpen(true); };

  const useGps = async () => {
    setBusy(true);
    setError('');
    try {
      onChange(await detectHomeAreaLabel());
      return true;
    } catch (nextError) {
      setError(locationErrorMessage(nextError));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const pick = (choice) => {
    onChange(typeof choice === 'string' ? choice : formatLocation(choice));
    return true;
  };

  return (
    <>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Change home area, currently ${value || 'not set'}`}
        onPress={openSheet}
        style={({ pressed }) => [styles.trigger, pressed && styles.triggerPressed]}
      >
        <View style={styles.triggerIcon}>
          <Ionicons name="location" size={17} color={C.teal} />
        </View>
        <View style={styles.flex}>
          <Text style={styles.eyebrow}>HOME AREA</Text>
          {parsed ? (
            <>
              <Text numberOfLines={1} style={styles.city}>{parsed.city}</Text>
              {parsed.region ? <Text numberOfLines={1} style={styles.meta}>{parsed.region}{parsed.country ? ` · ${parsed.country}` : ''}</Text> : null}
            </>
          ) : (
            <Text style={styles.placeholder}>Tap to set your location</Text>
          )}
        </View>
        <Ionicons name="chevron-forward" size={16} color={C.teal} />
      </Pressable>

      <LocationSearchSheet
        visible={open}
        onClose={() => setOpen(false)}
        currentLabel={value}
        busy={busy}
        error={error}
        onUseGps={useGps}
        onPick={pick}
        forceLight={forceLight}
      />
    </>
  );
}

const lightStyles = createMobileStyleSheet({
  flex: { flex: 1 },
  trigger: { minHeight: 64, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 14, borderWidth: 1, borderColor: C.line, backgroundColor: C.surface },
  triggerPressed: { opacity: 0.76, transform: [{ scale: 0.985 }] },
  triggerIcon: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: C.tealWash },
  eyebrow: { color: C.ink40, fontSize: 7.5, fontWeight: '900', letterSpacing: .7 },
  city: { marginTop: 1, color: C.ink, fontSize: 14, fontWeight: '800' },
  meta: { marginTop: 1, color: C.ink40, fontSize: 9 },
  placeholder: { marginTop: 2, color: C.ink40, fontSize: 12 },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
