import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
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
    navigation.navigate('DirectChat', { player, ownerTab: 'Home' });
  };

  return (
    <SafeAreaView style={currentStyles.safe}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <ScrollView contentContainerStyle={currentStyles.content} showsVerticalScrollIndicator={false}>
        <View style={currentStyles.topbar}>
          <Pressable onPress={() => navigation.goBack()} style={currentStyles.backButton}>
            <Icon name="arrow-back" size={24} color={C.ink} />
          </Pressable>
        </View>

        <View style={currentStyles.identity}>
          <View style={currentStyles.avatarContainer}>
            <ProfilePhoto photo={player.avatar} name={player.name} size={90} />
          </View>

          <Text numberOfLines={1} style={currentStyles.playerName}>{player.name}</Text>

          <View style={currentStyles.locationRow}>
            <Icon name="location-outline" size={14} color={C.ink40} />
            <Text numberOfLines={1} style={currentStyles.locationText}>{player.area || 'Unknown location'}</Text>
            {player.rating ? (
              <>
                <Text style={currentStyles.locationDivider}>·</Text>
                <Icon name="star-outline" size={14} color={C.teal} />
                <Text style={currentStyles.ratingText}>{player.rating.toFixed(1)}</Text>
              </>
            ) : null}
          </View>

          {player.reason ? (
            <View style={currentStyles.reasonRow}>
              <Icon name="sparkles-outline" size={14} color={C.teal} />
              <Text numberOfLines={1} style={currentStyles.reasonText}>{player.reason}</Text>
            </View>
          ) : null}

          <View style={currentStyles.socialStats}>
            {mutualCount > 0 && (
              <>
                <View style={currentStyles.socialStat}>
                  <Text style={currentStyles.socialValue}>{formatSocialCount(mutualCount)}</Text>
                  <Text style={currentStyles.socialLabel}>Mutuals</Text>
                </View>
                <View style={currentStyles.socialDivider} />
              </>
            )}
            <View style={currentStyles.socialStat}>
              <Text style={currentStyles.socialValue}>{formatSocialCount(followCounts.followers)}</Text>
              <Text style={currentStyles.socialLabel}>Followers</Text>
            </View>
            <View style={currentStyles.socialDivider} />
            <View style={currentStyles.socialStat}>
              <Text style={currentStyles.socialValue}>{formatSocialCount(followCounts.following)}</Text>
              <Text style={currentStyles.socialLabel}>Following</Text>
            </View>
          </View>

          <View style={currentStyles.actionButtons}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={following ? `Unfollow ${player.name}` : followRequestPending ? `Cancel follow request to ${player.name}` : `Follow ${player.name}`}
              accessibilityState={{ busy: followBusy, disabled: followBusy }}
              disabled={followBusy}
              onPress={handleFollow}
              style={[currentStyles.actionButton, currentStyles.primaryButton, (following || followRequestPending) && currentStyles.secondaryButton, followBusy && { opacity: 0.65 }]}
            >
              {followBusy ? (
                <ActivityIndicator size="small" color={following || followRequestPending ? C.ink : C.surface} />
              ) : (
                <>
                  <Icon name={following ? "person-remove-outline" : followRequestPending ? "time-outline" : "person-add-outline"} size={18} color={following || followRequestPending ? C.ink : C.surface} />
                  <Text style={[currentStyles.actionButtonText, currentStyles.primaryButtonText, (following || followRequestPending) && currentStyles.secondaryButtonText]}>
                    {following ? 'Following' : followRequestPending ? 'Requested' : 'Follow'}
                  </Text>
                </>
              )}
            </Pressable>
            <Pressable onPress={openChat} style={[currentStyles.actionButton, currentStyles.secondaryButton]}>
              <Icon name="chatbubble-ellipses-outline" size={18} color={C.ink} />
              <Text style={[currentStyles.actionButtonText, currentStyles.secondaryButtonText]}>Message</Text>
            </Pressable>
          </View>

          <View style={currentStyles.profileContent}>
            <Text style={currentStyles.sectionLabel}>CONNECTION</Text>
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
                <Text style={currentStyles.mutualEyebrow}>MUTUAL CONNECTIONS</Text>
                <Text style={currentStyles.mutualText}>{mutualCopy}</Text>
              </View>
              <Icon name="git-network-outline" size={20} color={C.teal} />
            </View>

            <Text style={currentStyles.sectionLabel}>PLAYER SNAPSHOT</Text>
            <View style={currentStyles.snapshotCard}>
              <View style={currentStyles.snapshotRow}>
                <View style={currentStyles.snapshotIcon}>
                  <Icon name="star-outline" size={18} color={C.teal} />
                </View>
                <View style={currentStyles.snapshotDetails}>
                  <Text style={currentStyles.snapshotLabel}>SKILL RATING</Text>
                  <Text style={currentStyles.snapshotValue}>
                    {profileDetails.rating != null ? `${Number(profileDetails.rating).toFixed(1)} rating` : 'Not rated yet'}
                  </Text>
                </View>
              </View>
              <View style={[currentStyles.snapshotRow, currentStyles.snapshotRowBorder]}>
                <View style={currentStyles.snapshotIcon}>
                  <Icon name="tennisball-outline" size={18} color={C.teal} />
                </View>
                <View style={currentStyles.snapshotDetails}>
                  <Text style={currentStyles.snapshotLabel}>PREFERRED PLAY</Text>
                  <Text style={currentStyles.snapshotValue}>{profileDetails.playPreference || 'Not set yet'}</Text>
                </View>
              </View>
              <View style={[currentStyles.snapshotRow, currentStyles.snapshotRowBorder]}>
                <View style={currentStyles.snapshotIcon}>
                  <Icon name="people-outline" size={18} color={C.teal} />
                </View>
                <View style={currentStyles.snapshotDetails}>
                  <Text style={currentStyles.snapshotLabel}>HOW YOU’RE CONNECTED</Text>
                  <Text style={currentStyles.snapshotValue}>{player.reason || 'Peakle player'}</Text>
                </View>
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
  content: { paddingHorizontal: 20, paddingBottom: 40 },
  topbar: { height: 60, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 48, height: 48, justifyContent: 'center', alignItems: 'center', borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line, backgroundColor: LIGHT_C.surface },
  identity: { alignItems: 'center', marginTop: 10 },
  avatarContainer: { marginBottom: 16, shadowColor: LIGHT_C.ink, shadowOpacity: 0.1, shadowRadius: 10, shadowOffset: { width: 0, height: 4 }, elevation: 5 },
  playerName: { color: LIGHT_C.ink, fontSize: 28, fontWeight: '900', letterSpacing: -0.5, marginBottom: 8 },
  locationRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  locationText: { color: LIGHT_C.ink40, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  locationDivider: { color: LIGHT_C.ink40, fontSize: 13, marginHorizontal: 8 },
  ratingText: { color: LIGHT_C.teal, fontSize: 13, fontWeight: '800', marginLeft: 4 },
  reasonRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, paddingHorizontal: 12, paddingVertical: 6, backgroundColor: LIGHT_C.surface, borderRadius: 12, borderWidth: 1, borderColor: LIGHT_C.line },
  reasonText: { color: LIGHT_C.teal, fontSize: 12, fontWeight: '800', marginLeft: 6 },
  socialStats: { flexDirection: 'row', alignItems: 'center', marginBottom: 24, paddingVertical: 16, paddingHorizontal: 24, backgroundColor: LIGHT_C.surface, borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line },
  socialStat: { alignItems: 'center' },
  socialValue: { color: LIGHT_C.ink, fontSize: 18, fontWeight: '900' },
  socialLabel: { color: LIGHT_C.ink40, fontSize: 10, fontWeight: '700', marginTop: 2, textTransform: 'uppercase', letterSpacing: 0.5 },
  socialDivider: { width: 1, height: 24, backgroundColor: LIGHT_C.line, marginHorizontal: 20 },
  profileContent: { width: '100%', marginTop: 28 },
  sectionLabel: { alignSelf: 'flex-start', color: LIGHT_C.ink40, fontSize: 10, fontWeight: '900', letterSpacing: 1.1, marginBottom: 8, marginLeft: 2 },
  mutualCard: { width: '100%', minHeight: 76, flexDirection: 'row', alignItems: 'center', marginBottom: 24, paddingHorizontal: 16, paddingVertical: 14, backgroundColor: LIGHT_C.surface, borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line },
  mutualAvatars: { minWidth: 52, flexDirection: 'row', alignItems: 'center' },
  mutualAvatar: { width: 44, height: 44, padding: 2, borderRadius: 22, backgroundColor: LIGHT_C.surface },
  mutualAvatarOverlap: { marginLeft: -17 },
  mutualFallbackIcon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 22, backgroundColor: LIGHT_C.paper },
  mutualDetails: { flex: 1, marginHorizontal: 12 },
  mutualEyebrow: { color: LIGHT_C.teal, fontSize: 9, fontWeight: '900', letterSpacing: 0.8, marginBottom: 4 },
  mutualText: { color: LIGHT_C.ink, fontSize: 13, fontWeight: '700', lineHeight: 18 },
  snapshotCard: { width: '100%', paddingHorizontal: 16, backgroundColor: LIGHT_C.surface, borderRadius: 16, borderWidth: 1, borderColor: LIGHT_C.line },
  snapshotRow: { minHeight: 66, flexDirection: 'row', alignItems: 'center' },
  snapshotRowBorder: { borderTopWidth: 1, borderTopColor: LIGHT_C.line },
  snapshotIcon: { width: 38, height: 38, alignItems: 'center', justifyContent: 'center', marginRight: 12, borderRadius: 12, backgroundColor: LIGHT_C.paper },
  snapshotDetails: { flex: 1 },
  snapshotLabel: { color: LIGHT_C.ink40, fontSize: 9, fontWeight: '800', letterSpacing: 0.7, marginBottom: 3 },
  snapshotValue: { color: LIGHT_C.ink, fontSize: 14, fontWeight: '800' },
  actionButtons: { flexDirection: 'row', width: '100%', gap: 12 },
  actionButton: { flex: 1, height: 50, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', borderRadius: 16, gap: 8 },
  actionButtonText: { fontSize: 15, fontWeight: '800' },
  primaryButton: { backgroundColor: LIGHT_C.ink },
  primaryButtonText: { color: LIGHT_C.surface },
  secondaryButton: { backgroundColor: LIGHT_C.surface, borderWidth: 1, borderColor: LIGHT_C.line },
  secondaryButtonText: { color: LIGHT_C.ink },
});

const darkStyles = StyleSheet.create({
  ...lightStyles,
  safe: { ...lightStyles.safe, backgroundColor: DARK_CONTENT_COLORS.paper },
  backButton: { ...lightStyles.backButton, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  avatarContainer: { ...lightStyles.avatarContainer, shadowColor: '#000000', shadowOpacity: 0.3 },
  playerName: { ...lightStyles.playerName, color: DARK_CONTENT_COLORS.ink },
  locationText: { ...lightStyles.locationText, color: DARK_CONTENT_COLORS.ink40 },
  locationDivider: { ...lightStyles.locationDivider, color: DARK_CONTENT_COLORS.ink40 },
  ratingText: { ...lightStyles.ratingText, color: DARK_CONTENT_COLORS.teal },
  reasonRow: { ...lightStyles.reasonRow, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  reasonText: { ...lightStyles.reasonText, color: DARK_CONTENT_COLORS.teal },
  socialStats: { ...lightStyles.socialStats, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  socialValue: { ...lightStyles.socialValue, color: DARK_CONTENT_COLORS.ink },
  socialLabel: { ...lightStyles.socialLabel, color: DARK_CONTENT_COLORS.ink40 },
  socialDivider: { ...lightStyles.socialDivider, backgroundColor: DARK_CONTENT_COLORS.line },
  mutualCard: { ...lightStyles.mutualCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  mutualAvatar: { ...lightStyles.mutualAvatar, backgroundColor: DARK_CONTENT_COLORS.surface },
  mutualFallbackIcon: { ...lightStyles.mutualFallbackIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  mutualEyebrow: { ...lightStyles.mutualEyebrow, color: DARK_CONTENT_COLORS.teal },
  mutualText: { ...lightStyles.mutualText, color: DARK_CONTENT_COLORS.ink },
  sectionLabel: { ...lightStyles.sectionLabel, color: DARK_CONTENT_COLORS.ink40 },
  snapshotCard: { ...lightStyles.snapshotCard, backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  snapshotRowBorder: { ...lightStyles.snapshotRowBorder, borderTopColor: DARK_CONTENT_COLORS.line },
  snapshotIcon: { ...lightStyles.snapshotIcon, backgroundColor: DARK_CONTENT_COLORS.paper },
  snapshotLabel: { ...lightStyles.snapshotLabel, color: DARK_CONTENT_COLORS.ink40 },
  snapshotValue: { ...lightStyles.snapshotValue, color: DARK_CONTENT_COLORS.ink },
  primaryButton: { backgroundColor: DARK_CONTENT_COLORS.optic },
  primaryButtonText: { color: '#0E2321' }, // always dark ink on optic
  secondaryButton: { backgroundColor: DARK_CONTENT_COLORS.surface, borderColor: DARK_CONTENT_COLORS.line },
  secondaryButtonText: { color: DARK_CONTENT_COLORS.ink },
});
