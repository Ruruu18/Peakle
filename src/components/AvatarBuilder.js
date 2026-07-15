import React, { useEffect, useMemo, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import Svg, { Path } from 'react-native-svg';
import loreleiFeatures from '../assets/loreleiFeatures.json';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';

const LIGHT_C = { ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED' };
let C = LIGHT_C;

const DEFAULT_AVATAR = { hair: 1, eyes: 1, brows: 1, mouth: 2, glasses: 0, head: 1, nose: 1 };
const PRESETS = [
  { hair: 1, eyes: 1, brows: 1, mouth: 2, glasses: 0, head: 1, nose: 1 },
  { hair: 5, eyes: 4, brows: 3, mouth: 4, glasses: 0, head: 2, nose: 2 },
  { hair: 9, eyes: 7, brows: 5, mouth: 6, glasses: 0, head: 3, nose: 3 },
  { hair: 13, eyes: 9, brows: 7, mouth: 8, glasses: 1, head: 4, nose: 4 },
  { hair: 17, eyes: 11, brows: 9, mouth: 10, glasses: 0, head: 1, nose: 5 },
  { hair: 21, eyes: 13, brows: 11, mouth: 12, glasses: 2, head: 2, nose: 6 },
  { hair: 25, eyes: 15, brows: 13, mouth: 14, glasses: 0, head: 3, nose: 1 },
  { hair: 29, eyes: 17, brows: 2, mouth: 16, glasses: 3, head: 4, nose: 2 },
  { hair: 33, eyes: 19, brows: 4, mouth: 18, glasses: 0, head: 1, nose: 3 },
  { hair: 37, eyes: 21, brows: 6, mouth: 3, glasses: 0, head: 2, nose: 4 },
  { hair: 42, eyes: 23, brows: 8, mouth: 7, glasses: 4, head: 3, nose: 5 },
  { hair: 48, eyes: 24, brows: 12, mouth: 11, glasses: 0, head: 4, nose: 6 },
];

const CATEGORIES = [
  { id: 'faces', label: 'Faces', icon: 'happy-outline', values: PRESETS },
  { id: 'hair', label: 'Hair', icon: 'cut-outline', values: [1, 5, 9, 13, 17, 21, 25, 29, 33, 37, 42, 48] },
  { id: 'eyes', label: 'Eyes', icon: 'eye-outline', values: [1, 4, 7, 9, 11, 13, 15, 17, 19, 21, 23, 24] },
  { id: 'brows', label: 'Brows', icon: 'remove-outline', values: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13] },
  { id: 'mouth', label: 'Smile', icon: 'happy-outline', values: [1, 2, 3, 4, 6, 8, 10, 12, 14, 16, 18] },
  { id: 'glasses', label: 'Glasses', icon: 'glasses-outline', values: [0, 1, 2, 3, 4, 5] },
  { id: 'head', label: 'Face', icon: 'person-outline', values: [1, 2, 3, 4] },
];

const variant = (value) => `variant${String(value).padStart(2, '0')}`;

export function avatarUrl(config, preview = false) {
  const params = [
    'seed=peakle-player',
    `size=${preview ? 160 : 320}`,
    'hairColor=0e2321',
    'eyebrowsColor=0e2321',
    'eyesColor=0e2321',
    'mouthColor=0e2321',
    'noseColor=0e2321',
    'glassesColor=0e2321',
    `hairVariant=${variant(config.hair)}`,
    `eyesVariant=${variant(config.eyes)}`,
    `eyebrowsVariant=${variant(config.brows)}`,
    `mouthVariant=happy${String(config.mouth).padStart(2, '0')}`,
    `headVariant=${variant(config.head)}`,
    `noseVariant=${variant(config.nose)}`,
    'beardProbability=0',
    'earringsProbability=0',
    'frecklesProbability=0',
    'hairAccessoriesProbability=0',
  ];
  if (config.glasses) params.push(`glassesVariant=${variant(config.glasses)}`, 'glassesProbability=100');
  else params.push('glassesProbability=0');
  return `https://api.dicebear.com/10.x/lorelei/png?${params.join('&')}`;
}

function parseAvatar(value) {
  if (!value?.includes('/lorelei/')) return DEFAULT_AVATAR;
  const read = (key, fallback) => {
    const match = value.match(new RegExp(`[?&]${key}=variant(\\d+)`));
    return match ? Number.parseInt(match[1], 10) : fallback;
  };
  const mouthMatch = value.match(/[?&]mouthVariant=happy(\d+)/);
  return {
    hair: read('hairVariant', DEFAULT_AVATAR.hair), eyes: read('eyesVariant', DEFAULT_AVATAR.eyes),
    brows: read('eyebrowsVariant', DEFAULT_AVATAR.brows), mouth: mouthMatch ? Number.parseInt(mouthMatch[1], 10) : DEFAULT_AVATAR.mouth,
    glasses: read('glassesVariant', DEFAULT_AVATAR.glasses), head: read('headVariant', DEFAULT_AVATAR.head),
    nose: read('noseVariant', DEFAULT_AVATAR.nose),
  };
}

function Icon({ name, size = 18, color = C.ink }) {
  return <Ionicons name={name} size={size} color={color} />;
}

function FeatureThumbnail({ category, value }) {
  const componentName = { brows: 'eyebrows' }[category] || category;
  const variantName = category === 'mouth'
    ? `happy${String(value).padStart(2, '0')}`
    : variant(value);
  const component = loreleiFeatures[componentName];
  const paths = component?.variants?.[variantName] || [];

  return (
    <Svg width={66} height={66} viewBox={`0 0 ${component.width} ${component.height}`} preserveAspectRatio="xMidYMid meet">
      {paths.map((path, index) => <Path key={`${variantName}-${index}`} d={path.d} fill={path.fill} />)}
    </Svg>
  );
}

export default function AvatarBuilder({ initialAvatar, onAvatarChange }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  styles = isDark ? darkStyles : lightStyles;
  const [activeTab, setActiveTab] = useState('faces');
  const [config, setConfig] = useState(() => parseAvatar(initialAvatar));
  const selectedUrl = useMemo(() => avatarUrl(config), [config]);
  const activeCategory = CATEGORIES.find((category) => category.id === activeTab);

  useEffect(() => { onAvatarChange?.(selectedUrl); }, [selectedUrl, onAvatarChange]);

  const optionConfig = (value) => activeTab === 'faces' ? value : { ...config, [activeTab]: value };
  const isSelected = (value) => {
    if (activeTab === 'faces') return Object.keys(DEFAULT_AVATAR).every((key) => config[key] === value[key]);
    return config[activeTab] === value;
  };
  const choose = (value) => setConfig(optionConfig(value));
  const surprise = () => setConfig(PRESETS[Math.floor(Math.random() * PRESETS.length)]);

  return (
    <View style={styles.container}>
      <View style={styles.previewArea}>
        <View pointerEvents="none" style={StyleSheet.absoluteFill}>
          <View style={styles.previewGlow} />
          <View style={styles.previewCourt}>
            <View style={styles.courtCenter} />
            <View style={styles.courtKitchenTop} />
            <View style={styles.courtKitchenBottom} />
          </View>

        </View>
        <View style={styles.previewAvatarWrap}>
          <View style={[styles.previewFrame, { borderColor: '#D6E94A', backgroundColor: '#FFFFFF' }]}><Image source={{ uri: selectedUrl }} style={styles.previewImage} /></View>
          <View style={styles.avatarBadge}><Text style={styles.avatarBadgeText}>YOU</Text></View>
        </View>
        <View style={styles.previewCopy}>
          <Text style={styles.previewEyebrow}>YOUR PEAKLE CHARACTER</Text>
          <Text style={styles.previewTitle}>Looking good.</Text>
          <Text style={styles.previewBody}>Tune every detail until it feels like you.</Text>
          <Pressable accessibilityRole="button" onPress={surprise} style={styles.surpriseButton}>
            <Icon name="sparkles" size={14} color="#0E2321" /><Text style={styles.surpriseText}>Surprise me</Text>
          </Pressable>
        </View>
      </View>

      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.tabs}>
        {CATEGORIES.map((category) => {
          const active = activeTab === category.id;
          return (
            <Pressable key={category.id} accessibilityRole="tab" accessibilityState={{ selected: active }} onPress={() => setActiveTab(category.id)} style={[styles.tab, active && styles.tabActive]}>
              <Icon name={category.icon} size={16} color={active ? C.ink : C.ink40} />
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{category.label}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <View style={styles.optionsArea}>
        <Text style={styles.optionsHint}>{activeTab === 'faces' ? 'Start with a character' : `Choose your ${activeCategory.label.toLowerCase()}`}</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.options}>
          {activeCategory.values.map((value, index) => {
            const selected = isSelected(value);
            const key = activeTab === 'faces' ? `face-${index}` : `${activeTab}-${value}`;
            return (
              <Pressable key={key} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${activeCategory.label} option ${index + 1}`} onPress={() => choose(value)} style={[styles.option, selected && styles.optionSelected]}>
                {activeTab === 'glasses' && value === 0
                  ? <View style={styles.noneOption}><Icon name="close" size={22} color={C.ink40} /><Text style={styles.noneText}>None</Text></View>
                  : activeTab === 'faces'
                    ? <Image source={{ uri: avatarUrl(optionConfig(value), true) }} resizeMode="contain" style={styles.optionImage} />
                    : <FeatureThumbnail category={activeTab} value={value} />}
                {selected ? <View style={styles.check}><Icon name="checkmark" size={12} color={C.surface} /></View> : null}
              </Pressable>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
}

const lightStyles = StyleSheet.create({
  container: { marginBottom: 24, overflow: 'hidden', borderWidth: 1, borderColor: C.line, borderRadius: 24, backgroundColor: C.surface },
  previewArea: { minHeight: 210, padding: 20, flexDirection: 'row', alignItems: 'center', overflow: 'hidden', backgroundColor: '#0E2321' },
  previewGlow: { position: 'absolute', left: -62, top: -51, width: 246, height: 246, borderRadius: 123, backgroundColor: C.optic, opacity: .13 },
  previewCourt: { position: 'absolute', right: -34, top: -29, width: 224, height: 267, borderWidth: 1, borderColor: 'rgba(243,245,239,.12)', transform: [{ rotate: '11deg' }] },
  courtCenter: { position: 'absolute', top: 0, bottom: 0, left: '50%', width: 1, backgroundColor: 'rgba(243,245,239,.10)' },
  courtKitchenTop: { position: 'absolute', top: '34%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(243,245,239,.10)' },
  courtKitchenBottom: { position: 'absolute', top: '66%', left: 0, right: 0, height: 1, backgroundColor: 'rgba(243,245,239,.10)' },
  previewAccent: { position: 'absolute', left: 20, bottom: 18, width: 48, height: 3, borderRadius: 2, backgroundColor: C.optic },
  previewAvatarWrap: { width: 126, height: 140, justifyContent: 'center' },
  previewFrame: { width: 126, height: 126, overflow: 'hidden', borderWidth: 4, borderColor: C.optic, borderRadius: 63, backgroundColor: '#FFFFFF', shadowColor: '#000000', shadowOpacity: .28, shadowRadius: 16, shadowOffset: { width: 0, height: 9 }, elevation: 7 },
  previewImage: { width: '100%', height: '100%' },
  avatarBadge: { position: 'absolute', right: -3, bottom: 3, minWidth: 38, height: 23, paddingHorizontal: 7, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#0E2321', borderRadius: 12, backgroundColor: C.optic },
  avatarBadgeText: { color: '#0E2321', fontSize: 7, fontWeight: '900', letterSpacing: .7 },
  previewCopy: { flex: 1, paddingLeft: 18 },
  previewEyebrow: { color: C.optic, fontSize: 7, fontWeight: '900', letterSpacing: 1.1 },
  previewTitle: { marginTop: 5, color: '#F3F5EF', fontSize: 23, lineHeight: 27, fontWeight: '900', letterSpacing: -.6 },
  previewBody: { maxWidth: 165, marginTop: 5, color: 'rgba(243,245,239,.62)', fontSize: 9, lineHeight: 13 },
  surpriseButton: { alignSelf: 'flex-start', minHeight: 36, marginTop: 13, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 6, borderRadius: 11, backgroundColor: C.optic },
  surpriseText: { color: '#0E2321', fontSize: 9, fontWeight: '900' },
  tabs: { minHeight: 59, paddingHorizontal: 10, alignItems: 'stretch', borderBottomWidth: 1, borderBottomColor: C.line },
  tab: { minWidth: 68, paddingHorizontal: 11, gap: 3, alignItems: 'center', justifyContent: 'center', borderBottomWidth: 3, borderBottomColor: 'transparent' },
  tabActive: { borderBottomColor: C.optic },
  tabText: { color: C.ink40, fontSize: 8, fontWeight: '800' },
  tabTextActive: { color: C.ink },
  optionsArea: { paddingVertical: 15 },
  optionsHint: { marginBottom: 11, paddingHorizontal: 16, color: C.ink40, fontSize: 8, fontWeight: '800', letterSpacing: .4 },
  options: { paddingHorizontal: 16, gap: 10 },
  option: { width: 74, height: 74, overflow: 'hidden', alignItems: 'center', justifyContent: 'center', borderWidth: 1.5, borderColor: C.line, borderRadius: 18, backgroundColor: C.paper },
  optionSelected: { borderWidth: 2, borderColor: C.ink, backgroundColor: '#F0F6D4' },
  optionImage: { width: 72, height: 72 },
  noneOption: { alignItems: 'center', gap: 2 },
  noneText: { color: C.ink40, fontSize: 7, fontWeight: '800' },
  check: { position: 'absolute', right: 5, bottom: 5, width: 20, height: 20, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: C.surface, borderRadius: 10, backgroundColor: C.ink },
});
const darkStyles = createDarkStyleSheet(lightStyles);
let styles = lightStyles;
