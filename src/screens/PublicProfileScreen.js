import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTheme } from '../context/ThemeContext';
import ProfilePhoto from '../components/ProfilePhoto';
import {
  followPlayer,
  getDirectMessagePermission,
  getPlayerFollowCounts,
  getPlayerMutualConnections,
  getPublicPlayerProfile,
  unfollowPlayer,
} from '../services/directMessages';
import { supabase } from '../lib/supabase';

const LIGHT_C = {
  ink: '#0E2321',
  ink40: '#7C8983',
  teal: '#1C6B66',
  optic: '#D6E94A',
  surface: '#FFFFFF',
  paper: '#F3F5EF',
  line: '#DDE3DA',
};

const DARK_CONTENT_COLORS = {
  ink: '#F3F5EF',
  ink40: '#9FB3AC',
  teal: '#D6E94A',
  optic: '#1C6B66',
  surface: '#17302D',
  paper: '#0E2321',
  line: '#304743',
};

let C = LIGHT_C;
const BALL_IMAGE = require('../../public/images/ball.png');

function Icon({ name, size = 24, color = C.ink, style }) {
  return <Ionicons name={name} size={size} color={color} style={style} />;
}

function formatSocialCount(count) {
  if (count >= 1000000) return `${(count / 1000000).toFixed(1)}m`;
  if (count >= 1000) return `${(count / 1000).toFixed(1)}k`;
  return String(count);
}

function mutualConnectionsCopy(connections, count) {
  const names = connections.slice(0, 2).map((connection) => connection.name);
  if (!count) return 'You don’t follow any of the same players yet.';
  if (!names.length) return `${count} mutual ${count === 1 ? 'connection' : 'connections'}`;

  const remaining = Math.max(0, count - names.length);
  const visibleNames = names.length === 1 ? names[0] : `${names[0]} and ${names[1]}`;
  if (!remaining) return `You both follow ${visibleNames}`;
  const namesBeforeRemainder = names.length === 1 ? names[0] : `${names[0]}, ${names[1]}`;
  return `You both follow ${namesBeforeRemainder} and ${remaining} ${remaining === 1 ? 'other' : 'others'}`;
}

export default function PublicProfileScreen({ navigation, route }) {
  const { isDark } = useTheme();
  C = isDark ? { ...LIGHT_C, ...DARK_CONTENT_COLORS } : LIGHT_C;
  const currentStyles = isDark ? darkStyles : lightStyles;
  const player = route.params?.player || {};

  const [following, setFollowing] = useState(player.isFollowing || false);
  const [followRequestPending, setFollowRequestPending] = useState(player.followRequestPending || false);
  const [followBusy, setFollowBusy] = useState(false);
  const [followCounts, setFollowCounts] = useState({
    followers: Number(player.followers || 0),
    following: Number(player.following || 0),
  });
  const [mutualCount, setMutualCount] = useState(Number(player.mutuals || 0));
  const [mutualConnections, setMutualConnections] = useState(
    Array.isArray(player.mutualConnections) ? player.mutualConnections : [],
  );
  const [profileDetails, setProfileDetails] = useState({
    area: player.area || null,
    rating: player.rating ?? null,
    playPreference: player.playPreference || null,
  });

  useEffect(() => {
    let active = true;
    setFollowCounts({
      followers: Number(player.followers || 0),
      following: Number(player.following || 0),
    });
    setMutualCount(Number(player.mutuals || 0));
    setMutualConnections(Array.isArray(player.mutualConnections) ? player.mutualConnections : []);
    setProfileDetails({
      area: player.area || null,
      rating: player.rating ?? null,
      playPreference: player.playPreference || null,
    });
    setFollowing(Boolean(player.isFollowing));
    setFollowRequestPending(Boolean(player.followRequestPending));
    if (!player.id) return () => { active = false; };

    const refreshRelationship = () => {
      getDirectMessagePermission(player.id)
        .then((permission) => {
          if (!active || !permission) return;
          setFollowing(permission.isFollowing);
          setFollowRequestPending(permission.followRequestPending);
        })
        .catch(() => {
          // Keep the relationship supplied by the previous screen when the
          // latest state cannot be refreshed.
        });
      getPlayerFollowCounts(player.id)
        .then((counts) => {
          if (active) setFollowCounts(counts);
        })
        .catch(() => {
          // Keep the route counts when a refresh is unavailable.
        });
    };
    refreshRelationship();
    const unsubscribeFocus = navigation.addListener('focus', refreshRelationship);
    getPlayerMutualConnections(player.id)
      .then((result) => {
        if (!active) return;
        setMutualCount(result.count);
        setMutualConnections(result.connections);
      })
      .catch(() => {
        // Keep the count supplied by the previous screen when the preview
        // cannot be refreshed; profile navigation should remain usable.
      });
    getPublicPlayerProfile(player.id)
      .then((details) => {
        if (active && details) setProfileDetails(details);
      })
      .catch(() => {
        // Route data still provides a useful snapshot if refreshing fails.
      });
    return () => {
      active = false;
      unsubscribeFocus();
    };
  }, [navigation, player.id]);

  useEffect(() => {
    if (!supabase || !player.id) return undefined;
    let active = true;
    let refreshTimer;
    const refreshRelationship = () => {
      clearTimeout(refreshTimer);
      refreshTimer = setTimeout(() => {
        Promise.all([
          getDirectMessagePermission(player.id),
          getPlayerFollowCounts(player.id),
        ]).then(([permission, counts]) => {
          if (!active) return;
          if (permission) {
            setFollowing(permission.isFollowing);
            setFollowRequestPending(permission.followRequestPending);
          }
          setFollowCounts(counts);
        }).catch(() => {});
      }, 80);
    };
    const channel = supabase.channel(`public-profile-follows-${player.id}`)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'player_follows',
      }, refreshRelationship)
      .on('postgres_changes', {
        event: '*',
        schema: 'public',
        table: 'player_follow_requests',
      }, refreshRelationship)
      .subscribe();
    return () => {
      active = false;
      clearTimeout(refreshTimer);
      supabase.removeChannel(channel);
    };
  }, [player.id]);

  const mutualCopy = useMemo(
    () => mutualConnectionsCopy(mutualConnections, mutualCount),
    [mutualConnections, mutualCount],
  );

  const handleFollow = async () => {
    if (!player.id || followBusy) return;
    const wasFollowing = following;
    const wasPending = followRequestPending;
    setFollowBusy(true);
    try {
      const permission = wasFollowing || wasPending
        ? await unfollowPlayer(player.id)
        : await followPlayer(player.id);
      const isFollowing = Boolean(permission?.isFollowing);
      setFollowing(isFollowing);
      setFollowRequestPending(Boolean(permission?.followRequestPending));
      try {
        setFollowCounts(await getPlayerFollowCounts(player.id));
      } catch {
        if (wasFollowing !== isFollowing) {
          setFollowCounts((current) => ({
            ...current,
            followers: Math.max(0, current.followers + (isFollowing ? 1 : -1)),
          }));
        }
      }
    } catch (error) {
      Alert.alert(
        wasFollowing || wasPending ? 'Could not remove follow' : 'Follow request not sent',
        error.message || 'Please try again.',
      );
    } finally {
      setFollowBusy(false);
    }
  };

  const openChat = () => {
    navigation.navigate('DirectChat', { player, ownerTab: route.params?.ownerTab || 'Home' });
  };

  const playerName = player.name || 'Peakle player';
  const area = profileDetails.area || player.area || 'Location not shared';
  const numericRating = Number(profileDetails.rating);
  const hasRating = profileDetails.rating != null && profileDetails.rating !== '' && Number.isFinite(numericRating);
  const rating = hasRating ? numericRating.toFixed(1) : 'Unrated';
  const playPreference = profileDetails.playPreference || 'Not set yet';
  const isFollowed = following || followRequestPending;

  return (
    <SafeAreaView style={currentStyles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={currentStyles.content} showsVerticalScrollIndicator={false}>
        <View style={currentStyles.page}>
          <View style={currentStyles.topbar}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go back"
              hitSlop={8}
              onPress={() => navigation.goBack()}
              style={({ pressed }) => [currentStyles.backButton, pressed && currentStyles.buttonPressed]}
            >
              <Icon name="arrow-back" size={22} color={C.ink} />
            </Pressable>
            <View style={currentStyles.topbarTitle}>
              <Text style={currentStyles.topbarEyebrow}>PLAYER PROFILE</Text>
              <Text style={currentStyles.topbarSubtitle}>Peakle community</Text>
            </View>
            <View style={currentStyles.topbarSpacer} />
          </View>

          <View style={currentStyles.heroCard}>
            <View style={currentStyles.heroCover}>
              <View style={currentStyles.heroBrand}>
                <View style={currentStyles.heroBrandIcon}>
                  <Image accessibilityIgnoresInvertColors accessible={false} source={BALL_IMAGE} resizeMode="contain" style={currentStyles.heroBallImage} />
                </View>
                <Text style={currentStyles.heroBrandText}>READY TO RALLY</Text>
              </View>
              <Image
                accessibilityIgnoresInvertColors
                accessible={false}
                pointerEvents="none"
                source={BALL_IMAGE}
                resizeMode="contain"
                style={currentStyles.heroBallArtwork}
              />
            </View>

            <View style={currentStyles.heroBody}>
              <View style={currentStyles.avatarRing}>
                <ProfilePhoto photo={player.avatar} name={playerName} size={96} />
              </View>

              <Text numberOfLines={2} style={currentStyles.playerName}>{playerName}</Text>
              <View style={currentStyles.locationPill}>
                <Icon name="location-outline" size={14} color={C.teal} />
                <Text numberOfLines={1} style={currentStyles.locationText}>{area}</Text>
              </View>

              {player.reason ? (
                <View style={currentStyles.reasonRow}>
                  <Icon name="sparkles" size={14} color={C.teal} />
                  <Text numberOfLines={2} style={currentStyles.reasonText}>{player.reason}</Text>
                </View>
              ) : null}

              <View style={currentStyles.socialStats}>
                <View style={currentStyles.socialStat}>
                  <Text style={currentStyles.socialValue}>{formatSocialCount(followCounts.followers)}</Text>
                  <Text style={currentStyles.socialLabel}>Followers</Text>
                </View>
                <View style={currentStyles.socialDivider} />
                <View style={currentStyles.socialStat}>
                  <Text style={currentStyles.socialValue}>{formatSocialCount(followCounts.following)}</Text>
                  <Text style={currentStyles.socialLabel}>Following</Text>
                </View>
                <View style={currentStyles.socialDivider} />
                <View style={currentStyles.socialStat}>
                  <Text style={currentStyles.socialValue}>{formatSocialCount(mutualCount)}</Text>
                  <Text style={currentStyles.socialLabel}>Mutuals</Text>
                </View>
              </View>

              <View style={currentStyles.actionButtons}>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={following ? `Unfollow ${playerName}` : followRequestPending ? `Cancel follow request to ${playerName}` : `Follow ${playerName}`}
                  accessibilityState={{ busy: followBusy, disabled: followBusy }}
                  disabled={followBusy}
                  onPress={handleFollow}
                  style={({ pressed }) => [
                    currentStyles.actionButton,
                    currentStyles.primaryButton,
                    isFollowed && currentStyles.secondaryButton,
                    pressed && currentStyles.buttonPressed,
                    followBusy && currentStyles.buttonBusy,
                  ]}
                >
                  {followBusy ? (
                    <ActivityIndicator size="small" color={isFollowed ? C.ink : (isDark ? '#0E2321' : C.surface)} />
                  ) : (
                    <>
                      <Icon name={following ? 'checkmark-circle' : followRequestPending ? 'time' : 'person-add'} size={18} color={isFollowed ? C.ink : (isDark ? '#0E2321' : C.surface)} />
                      <Text style={[currentStyles.actionButtonText, currentStyles.primaryButtonText, isFollowed && currentStyles.secondaryButtonText]}>
                        {following ? 'Following' : followRequestPending ? 'Requested' : 'Follow'}
                      </Text>
                    </>
                  )}
                </Pressable>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Message ${playerName}`}
                  onPress={openChat}
                  style={({ pressed }) => [currentStyles.actionButton, currentStyles.secondaryButton, pressed && currentStyles.buttonPressed]}
                >
                  <Icon name="chatbubble-ellipses" size={17} color={C.ink} />
                  <Text style={[currentStyles.actionButtonText, currentStyles.secondaryButtonText]}>Message</Text>
                </Pressable>
              </View>
            </View>
          </View>

          <View style={currentStyles.profileContent}>
            <View style={currentStyles.sectionHeading}>
              <View>
                <Text style={currentStyles.sectionLabel}>SHARED CIRCLE</Text>
                <Text style={currentStyles.sectionTitle}>Your connection</Text>
              </View>
              <View style={currentStyles.countBadge}>
                <Text style={currentStyles.countBadgeText}>{mutualCount}</Text>
              </View>
            </View>
            <View
              accessible
              accessibilityLabel={`${mutualCount} mutual ${mutualCount === 1 ? 'connection' : 'connections'}. ${mutualCopy}`}
              style={currentStyles.mutualCard}
            >
              <View style={currentStyles.mutualAvatars}>
                {mutualConnections.slice(0, 3).map((connection, index) => (
                  <View
                    key={connection.id || `${connection.name}-${index}`}
                    style={[currentStyles.mutualAvatar, index > 0 && currentStyles.mutualAvatarOverlap]}
                  >
                    <ProfilePhoto photo={connection.avatar} name={connection.name} size={40} />
                  </View>
                ))}
                {!mutualConnections.length ? (
                  <View style={currentStyles.mutualFallbackIcon}>
                    <Icon name="people-outline" size={20} color={C.teal} />
                  </View>
                ) : null}
              </View>
              <View style={currentStyles.mutualDetails}>
                <Text style={currentStyles.mutualEyebrow}>{mutualCount ? 'PEOPLE YOU BOTH KNOW' : 'GROW YOUR CIRCLE'}</Text>
                <Text style={currentStyles.mutualText}>{mutualCopy}</Text>
              </View>
              <View style={currentStyles.mutualIcon}>
                <Icon name="git-network-outline" size={19} color={C.teal} />
              </View>
            </View>

            <View style={currentStyles.sectionHeading}>
              <View>
                <Text style={currentStyles.sectionLabel}>ON THE COURT</Text>
                <Text style={currentStyles.sectionTitle}>Player snapshot</Text>
              </View>
            </View>
            <View style={currentStyles.detailsGrid}>
              <View style={currentStyles.detailCard}>
                <View style={currentStyles.detailIcon}>
                  <Icon name="star" size={18} color={C.teal} />
                </View>
                <Text style={currentStyles.detailLabel}>PERFORMANCE RATING</Text>
                <Text style={currentStyles.detailValue}>{rating}</Text>
                <Text style={currentStyles.detailMeta}>{hasRating ? 'Based on match scores' : 'No completed matches'}</Text>
              </View>
              <View style={[currentStyles.detailCard, currentStyles.detailCardAccent]}>
                <View style={currentStyles.detailIconAccent}>
                  <Image accessibilityIgnoresInvertColors accessible={false} source={BALL_IMAGE} resizeMode="contain" style={currentStyles.detailBallImage} />
                </View>
                <Text style={currentStyles.detailLabelAccent}>PREFERRED PLAY</Text>
                <Text numberOfLines={2} style={currentStyles.detailValueAccent}>{playPreference}</Text>
                <Text style={currentStyles.detailMetaAccent}>Court style</Text>
              </View>
              <View style={currentStyles.detailWideCard}>
                <View style={currentStyles.detailWideIcon}>
                  <Icon name="navigate" size={18} color={C.teal} />
                </View>
                <View style={currentStyles.detailWideCopy}>
                  <Text style={currentStyles.detailLabel}>PLAYS AROUND</Text>
                  <Text numberOfLines={2} style={currentStyles.detailWideValue}>{area}</Text>
                </View>
                <Icon name="location-outline" size={20} color={C.ink40} />
              </View>
            </View>
          </View>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const lightStyles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: LIGHT_C.paper },
  content: { paddingHorizontal: 18, paddingBottom: 48 },
  page: { width: '100%', maxWidth: 680, alignSelf: 'center' },
  topbar: { minHeight: 66, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  topbarTitle: { alignItems: 'center' },
  topbarEyebrow: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1.5 },
  topbarSubtitle: { color: LIGHT_C.ink, fontSize: 13, fontWeight: '800', marginTop: 2 },
  topbarSpacer: { width: 44 },
  backButton: { width: 44, height: 44, justifyContent: 'center', alignItems: 'center', borderRadius: 15, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  buttonPressed: { opacity: 0.72, transform: [{ scale: 0.98 }] },
  buttonBusy: { opacity: 0.62 },
  heroCard: { overflow: 'hidden', backgroundColor: LIGHT_C.surface, borderRadius: 28, borderWidth: 1, borderColor: LIGHT_C.line, shadowColor: LIGHT_C.ink, shadowOpacity: 0.08, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 4 },
  heroCover: { height: 126, overflow: 'hidden', paddingHorizontal: 20, paddingTop: 18, backgroundColor: LIGHT_C.ink },
  heroBrand: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  heroBrandIcon: { width: 28, height: 28, alignItems: 'center', justifyContent: 'center', borderRadius: 10, backgroundColor: LIGHT_C.optic },
  heroBallImage: { width: 17, height: 17, tintColor: '#0E2321' },
  heroBrandText: { color: LIGHT_C.surface, fontSize: 9, fontWeight: '900', letterSpacing: 1.4 },
  heroBallArtwork: { position: 'absolute', right: -42, top: -34, width: 210, height: 210, tintColor: LIGHT_C.optic, opacity: 0.16, transform: [{ rotate: '-12deg' }] },
  heroBody: { alignItems: 'center', paddingHorizontal: 18, paddingBottom: 20 },
  avatarRing: { width: 108, height: 108, alignItems: 'center', justifyContent: 'center', marginTop: -54, borderRadius: 54, backgroundColor: LIGHT_C.surface, shadowColor: LIGHT_C.ink, shadowOpacity: 0.16, shadowRadius: 12, shadowOffset: { width: 0, height: 5 }, elevation: 6 },
  playerName: { maxWidth: '94%', color: LIGHT_C.ink, fontSize: 28, lineHeight: 34, fontWeight: '900', letterSpacing: -0.7, textAlign: 'center', marginTop: 14 },
  locationPill: { maxWidth: '90%', flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingHorizontal: 11, paddingVertical: 6, borderRadius: 999, backgroundColor: LIGHT_C.paper },
  locationText: { flexShrink: 1, color: '#3C4A45', fontSize: 12, fontWeight: '700', marginLeft: 5 },
  reasonRow: { maxWidth: '94%', flexDirection: 'row', alignItems: 'center', marginTop: 12, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#E5F0ED', borderRadius: 12 },
  reasonText: { flexShrink: 1, color: LIGHT_C.teal, fontSize: 12, lineHeight: 16, fontWeight: '800', marginLeft: 6, textAlign: 'center' },
  socialStats: { width: '100%', flexDirection: 'row', alignItems: 'center', marginTop: 20, paddingVertical: 16, backgroundColor: LIGHT_C.paper, borderRadius: 18 },
  socialStat: { flex: 1, alignItems: 'center' },
  socialValue: { color: LIGHT_C.ink, fontSize: 19, fontWeight: '900', letterSpacing: -0.25 },
  socialLabel: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '800', marginTop: 3, textTransform: 'uppercase', letterSpacing: 0.65 },
  socialDivider: { width: 1, height: 28, backgroundColor: LIGHT_C.line },
  actionButtons: { flexDirection: 'row', width: '100%', marginTop: 14, gap: 10 },
  actionButton: { flex: 1, minHeight: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, gap: 8 },
  actionButtonText: { fontSize: 14, fontWeight: '900' },
  primaryButton: { backgroundColor: LIGHT_C.ink },
  primaryButtonText: { color: LIGHT_C.surface },
  secondaryButton: { backgroundColor: LIGHT_C.surface, borderWidth: 1, borderColor: LIGHT_C.line },
  secondaryButtonText: { color: LIGHT_C.ink },
  profileContent: { width: '100%', marginTop: 32 },
  sectionHeading: { minHeight: 46, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 12, paddingHorizontal: 2 },
  sectionLabel: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 1.35, marginBottom: 3 },
  sectionTitle: { color: LIGHT_C.ink, fontSize: 21, fontWeight: '900', letterSpacing: -0.4 },
  countBadge: { minWidth: 30, height: 30, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 8, borderRadius: 15, backgroundColor: LIGHT_C.ink },
  countBadgeText: { color: LIGHT_C.surface, fontSize: 12, fontWeight: '900' },
  mutualCard: { width: '100%', minHeight: 92, flexDirection: 'row', alignItems: 'center', marginBottom: 30, paddingHorizontal: 16, paddingVertical: 16, backgroundColor: LIGHT_C.surface, borderRadius: 20, borderWidth: 1, borderColor: LIGHT_C.line },
  mutualAvatars: { minWidth: 48, flexDirection: 'row', alignItems: 'center' },
  mutualAvatar: { width: 44, height: 44, padding: 2, borderRadius: 22, backgroundColor: LIGHT_C.surface },
  mutualAvatarOverlap: { marginLeft: -17 },
  mutualFallbackIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: LIGHT_C.paper },
  mutualDetails: { flex: 1, marginHorizontal: 12 },
  mutualEyebrow: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 0.85, marginBottom: 5 },
  mutualText: { color: LIGHT_C.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  mutualIcon: { width: 34, height: 34, alignItems: 'center', justifyContent: 'center', borderRadius: 12, backgroundColor: LIGHT_C.paper },
  detailsGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  detailCard: { flex: 1, minWidth: 140, minHeight: 148, justifyContent: 'flex-end', padding: 16, backgroundColor: LIGHT_C.surface, borderRadius: 20, borderWidth: 1, borderColor: LIGHT_C.line },
  detailCardAccent: { backgroundColor: LIGHT_C.optic, borderColor: LIGHT_C.optic },
  detailIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 18, borderRadius: 12, backgroundColor: LIGHT_C.paper },
  detailIconAccent: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginBottom: 18, borderRadius: 12, backgroundColor: 'rgba(255,255,255,0.52)' },
  detailBallImage: { width: 21, height: 21, tintColor: '#0E2321' },
  detailLabel: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '900', letterSpacing: 0.85, marginBottom: 5 },
  detailValue: { color: LIGHT_C.ink, fontSize: 25, lineHeight: 28, fontWeight: '900', letterSpacing: -0.5 },
  detailMeta: { color: LIGHT_C.ink40, fontSize: 11, fontWeight: '700', marginTop: 3 },
  detailLabelAccent: { color: '#3C4A45', fontSize: 9, fontWeight: '900', letterSpacing: 0.85, marginBottom: 5 },
  detailValueAccent: { color: '#0E2321', fontSize: 18, lineHeight: 22, fontWeight: '900', letterSpacing: -0.35 },
  detailMetaAccent: { color: '#3C4A45', fontSize: 11, fontWeight: '700', marginTop: 3 },
  detailWideCard: { width: '100%', minHeight: 80, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingVertical: 14, backgroundColor: LIGHT_C.surface, borderRadius: 20, borderWidth: 1, borderColor: LIGHT_C.line },
  detailWideIcon: { width: 42, height: 42, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderRadius: 14, backgroundColor: LIGHT_C.paper },
  detailWideCopy: { flex: 1, marginRight: 10 },
  detailWideValue: { color: LIGHT_C.ink, fontSize: 15, lineHeight: 20, fontWeight: '900' },
});

const darkStyles = StyleSheet.create({
  ...lightStyles,
  safe: { ...lightStyles.safe, backgroundColor: DARK_CONTENT_COLORS.paper },
  backButton: { ...lightStyles.backButton, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  topbarEyebrow: { ...lightStyles.topbarEyebrow, color: DARK_CONTENT_COLORS.teal },
  topbarSubtitle: { ...lightStyles.topbarSubtitle, color: DARK_CONTENT_COLORS.ink },
  heroCard: { ...lightStyles.heroCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line, shadowColor: '#000000', shadowOpacity: 0.28 },
  heroCover: { ...lightStyles.heroCover, backgroundColor: '#102825' },
  avatarRing: { ...lightStyles.avatarRing, backgroundColor: DARK_CONTENT_COLORS.surface, shadowColor: '#000000', shadowOpacity: 0.34 },
  playerName: { ...lightStyles.playerName, color: DARK_CONTENT_COLORS.ink },
  locationPill: { ...lightStyles.locationPill, backgroundColor: DARK_CONTENT_COLORS.paper },
  locationText: { ...lightStyles.locationText, color: DARK_CONTENT_COLORS.ink40 },
  reasonRow: { ...lightStyles.reasonRow, backgroundColor: '#203B37' },
  reasonText: { ...lightStyles.reasonText, color: DARK_CONTENT_COLORS.teal },
  socialStats: { ...lightStyles.socialStats, backgroundColor: DARK_CONTENT_COLORS.paper },
  socialValue: { ...lightStyles.socialValue, color: DARK_CONTENT_COLORS.ink },
  socialLabel: { ...lightStyles.socialLabel, color: DARK_CONTENT_COLORS.ink40 },
  socialDivider: { ...lightStyles.socialDivider, backgroundColor: DARK_CONTENT_COLORS.line },
  sectionLabel: { ...lightStyles.sectionLabel, color: DARK_CONTENT_COLORS.teal },
  sectionTitle: { ...lightStyles.sectionTitle, color: DARK_CONTENT_COLORS.ink },
  countBadge: { ...lightStyles.countBadge, backgroundColor: DARK_CONTENT_COLORS.optic },
  countBadgeText: { ...lightStyles.countBadgeText, color: '#0E2321' },
  mutualCard: { ...lightStyles.mutualCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  mutualAvatar: { ...lightStyles.mutualAvatar, backgroundColor: DARK_CONTENT_COLORS.surface },
  mutualFallbackIcon: { ...lightStyles.mutualFallbackIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  mutualEyebrow: { ...lightStyles.mutualEyebrow, color: DARK_CONTENT_COLORS.teal },
  mutualText: { ...lightStyles.mutualText, color: DARK_CONTENT_COLORS.ink },
  mutualIcon: { ...lightStyles.mutualIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  detailCard: { ...lightStyles.detailCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  detailCardAccent: { ...lightStyles.detailCardAccent, backgroundColor: '#D6E94A', borderColor: '#D6E94A' },
  detailIcon: { ...lightStyles.detailIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  detailLabel: { ...lightStyles.detailLabel, color: DARK_CONTENT_COLORS.ink40 },
  detailValue: { ...lightStyles.detailValue, color: DARK_CONTENT_COLORS.ink },
  detailMeta: { ...lightStyles.detailMeta, color: DARK_CONTENT_COLORS.ink40 },
  detailWideCard: { ...lightStyles.detailWideCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  detailWideIcon: { ...lightStyles.detailWideIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  detailWideValue: { ...lightStyles.detailWideValue, color: DARK_CONTENT_COLORS.ink },
  primaryButton: { backgroundColor: '#D6E94A' }, // lime accent — readable with dark ink
  primaryButtonText: { color: '#0E2321' }, // dark ink on lime
  secondaryButton: { backgroundColor: DARK_CONTENT_COLORS.paper, borderColor: DARK_CONTENT_COLORS.line },
  secondaryButtonText: { color: DARK_CONTENT_COLORS.ink },
});
