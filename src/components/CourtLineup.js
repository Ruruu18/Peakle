import React from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import ResilientImage from './ResilientImage';
import { normalizeProfilePhoto } from '../services/profilePhotos';
import { createDarkStyleSheet, DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { createMobileStyleSheet } from '../utils/mobileStyles';

const C = LIGHT_CONTENT_COLORS;
const normalizedPlayerName = (name) => name?.trim().toLocaleLowerCase() || '';
const Icon = Ionicons;
const shadow = Platform.select({ ios: { shadowColor: C.ink, shadowOpacity: .09, shadowRadius: 14, shadowOffset: { width: 0, height: 5 } }, android: { elevation: 4 } });

function CourtPlayerAvatar({ name, avatar, colors: C, styles }) {
  const playerInitials = name.trim()
    ? name.trim().split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()
    : '?';
  const visiblePhoto = normalizeProfilePhoto(avatar);
  return <ResilientImage uri={visiblePhoto} fallback={<Text style={styles.courtPlayerInitials}>{playerInitials}</Text>} fallbackColor={C.ink} showLoadingIndicator={false} style={styles.courtPlayerAvatar} />;
}

export default function CourtLineup({ players, matchType, court, onSwap, currentUserName, currentUserAvatar, registeredPlayers = [] }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const styles = isDark ? darkStyles : lightStyles;
  const visiblePlayers = matchType === 'singles' ? 1 : 2;
  const currentUserKey = normalizedPlayerName(currentUserName);
  const avatarFor = (name) => {
    const playerKey = normalizedPlayerName(name);
    if ((playerKey === currentUserKey || playerKey === 'you') && currentUserAvatar) return currentUserAvatar;
    return registeredPlayers.find((player) => normalizedPlayerName(player.name) === playerKey)?.avatar || null;
  };

  return (
    <View style={[styles.courtModel, { backgroundColor: court?.color || C.teal }]}>
      <View style={styles.courtGlow} />
      <View style={styles.courtGrain} />
      <View style={styles.courtOutline} />
      <View style={[styles.kitchenZone, styles.kitchenZoneTop]} />
      <View style={[styles.kitchenZone, styles.kitchenZoneBottom]} />
      <View style={[styles.courtCenterLine, styles.courtCenterLineTop]} />
      <View style={[styles.courtCenterLine, styles.courtCenterLineBottom]} />
      <View style={styles.courtKitchenTop} />
      <View style={styles.courtKitchenBottom} />
      <View style={styles.courtNetShadow} />
      <View style={styles.courtNet}>
        <View style={styles.netPost} /><View style={[styles.netPost, styles.netPostRight]} />
        <View style={styles.courtNetSolid} /><View style={styles.courtNetMesh} /><View style={styles.courtNetDash} />
      </View>
      <View style={styles.venuePill}><Icon name="location" size={9} color={C.surface} /><Text numberOfLines={1} style={styles.venuePillText}>{court?.name || 'PICKLE COURT'}</Text></View>
      {[0, 1].map((team) => (
        <View key={team} style={[styles.courtSide, team === 1 && styles.courtSideAway]}>
          {players[team].slice(0, visiblePlayers).map((name, index) => {
            const playerAvatar = avatarFor(name);
            return (
              <View key={`${team}-${index}`} style={[styles.courtPlayer, visiblePlayers === 1 && styles.courtPlayerSingle]}>
                <View style={styles.playerMarkerShadow} />
                <CourtPlayerAvatar name={name} avatar={playerAvatar} colors={C} styles={styles} />
                <Text numberOfLines={1} style={styles.courtPlayerName}>{name.trim() || `Open spot ${index + 1}`}</Text>
              </View>
            );
          })}
        </View>
      ))}
      {onSwap ? <Pressable accessibilityLabel="Swap teams on court" onPress={onSwap} style={({ pressed }) => [styles.courtSwap, pressed && styles.pressed]}>
        <Icon name="swap-vertical" size={16} color="#0E2321" /><Text style={[styles.courtSwapText, { color: '#0E2321' }]}>SWAP</Text>
      </Pressable> : null}
    </View>
  );
}

const lightStyles = createMobileStyleSheet({
  courtModel: { height: 250, padding: 10, overflow: 'hidden', borderRadius: 22, borderBottomLeftRadius: 9, borderBottomRightRadius: 9, ...shadow },
  courtGlow: { position: 'absolute', width: 260, height: 260, top: -150, right: -85, borderRadius: 130, backgroundColor: 'rgba(255,255,255,.08)' },
  courtGrain: { ...StyleSheet.absoluteFillObject, borderWidth: 10, borderColor: 'rgba(5,38,35,.12)' },
  courtOutline: { ...StyleSheet.absoluteFillObject, margin: 16, borderWidth: 2, borderColor: 'rgba(255,255,255,.72)' },
  kitchenZone: { position: 'absolute', left: 16, right: 16, height: 31, backgroundColor: 'rgba(216,233,74,.07)' }, kitchenZoneTop: { top: 94 }, kitchenZoneBottom: { top: 125 },
  courtCenterLine: { position: 'absolute', alignSelf: 'center', width: 2, backgroundColor: 'rgba(255,255,255,.48)' }, courtCenterLineTop: { top: 16, height: 78 }, courtCenterLineBottom: { top: 156, bottom: 16 },
  courtKitchenTop: { position: 'absolute', top: 93, left: 16, right: 16, height: 2, backgroundColor: 'rgba(255,255,255,.72)' }, courtKitchenBottom: { position: 'absolute', top: 155, left: 16, right: 16, height: 2, backgroundColor: 'rgba(255,255,255,.72)' },
  courtNetShadow: { position: 'absolute', zIndex: 2, top: 126, left: 7, right: 7, height: 8, backgroundColor: 'rgba(5,25,23,.2)' },
  courtNet: { position: 'absolute', top: 120, left: 7, right: 7, height: 13, zIndex: 4 }, courtNetSolid: { height: 3, backgroundColor: C.surface }, courtNetMesh: { height: 7, backgroundColor: 'rgba(14,35,33,.38)', borderLeftWidth: 1, borderRightWidth: 1, borderColor: 'rgba(255,255,255,.6)' }, courtNetDash: { borderTopWidth: 1, borderStyle: 'dashed', borderColor: 'rgba(255,255,255,.72)' }, netPost: { position: 'absolute', zIndex: 2, left: -3, top: -3, width: 5, height: 18, borderRadius: 2, backgroundColor: C.surface }, netPostRight: { left: undefined, right: -3 },
  venuePill: { position: 'absolute', zIndex: 2, top: 6, alignSelf: 'center', width: 124, minHeight: 20, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, borderRadius: 10, backgroundColor: C.ink }, venuePillText: { flexShrink: 1, color: C.surface, fontSize: 6, fontWeight: '900', letterSpacing: .5 },
  courtSide: { position: 'absolute', top: 28, left: 18, right: 18, height: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around' }, courtSideAway: { top: 150 }, courtPlayer: { width: '45%', alignItems: 'center' }, courtPlayerSingle: { width: '72%' }, playerMarkerShadow: { position: 'absolute', top: 30, width: 40, height: 11, borderRadius: 20, backgroundColor: 'rgba(5,25,23,.2)' }, courtPlayerInitials: { color: C.optic, fontSize: 9, fontWeight: '900', textAlign: 'center' }, courtPlayerAvatar: { width: 40, height: 40, borderRadius: 20, borderWidth: 3, borderColor: C.surface, backgroundColor: C.ink, ...shadow }, courtPlayerName: { maxWidth: 105, marginTop: 4, paddingHorizontal: 7, paddingVertical: 3, overflow: 'hidden', borderRadius: 8, color: C.surface, backgroundColor: 'rgba(14,35,33,.82)', fontSize: 7, fontWeight: '800', textAlign: 'center' }, courtSwap: { position: 'absolute', zIndex: 6, top: 102, alignSelf: 'center', width: 60, height: 46, alignItems: 'center', justifyContent: 'center', borderRadius: 23, borderWidth: 3, borderColor: C.surface, backgroundColor: C.optic, ...shadow }, courtSwapText: { color: C.ink, fontSize: 5, fontWeight: '900', letterSpacing: .6 },
  pressed: { opacity: .78, transform: [{ scale: .985 }] },
});
const darkStyles = createDarkStyleSheet(lightStyles);
