import React, { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import AppIcon from '../components/AppIcon';
import ProfilePhoto from '../components/ProfilePhoto';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { followPlayer, searchDirectMessageCandidates } from '../services/directMessages';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED',
};

export default function PlayerSearchScreen({ navigation }) {
  const { isDark } = useTheme();
  const C = isDark ? { ...LIGHT, ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37' } : LIGHT;
  const inputRef = useRef(null);
  const followInFlight = useRef(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [followError, setFollowError] = useState('');
  const [followingId, setFollowingId] = useState(null);
  const [retry, setRetry] = useState(0);
  const term = query.trim();

  // Refresh on return from a profile, where the follow relationship may change.
  useFocusEffect(useCallback(() => {
    if (term.length < 2) {
      setResults([]);
      setSearching(false);
      setSearchError('');
      return undefined;
    }
    let active = true;
    setSearching(true);
    setSearchError('');
    const timer = setTimeout(() => {
      searchDirectMessageCandidates(term)
        .then((players) => { if (active) setResults(players); })
        .catch(() => {
          if (!active) return;
          setResults([]);
          setSearchError('Player search is unavailable right now. Please try again.');
        })
        .finally(() => { if (active) setSearching(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [term, retry]));

  const changeQuery = (value) => {
    if (value.trim() !== term) {
      setResults([]);
      setSearchError('');
      setFollowError('');
      setSearching(value.trim().length >= 2);
    }
    setQuery(value);
  };

  const follow = async (player) => {
    if (followInFlight.current || player.isFollowing || player.followRequestPending) return;
    followInFlight.current = true;
    setFollowingId(player.id);
    setFollowError('');
    try {
      const permission = await followPlayer(player.id);
      setResults((current) => current.map((item) => item.id === player.id ? { ...item, ...permission } : item));
    } catch {
      setFollowError(`Could not follow ${player.display_name}. Please try again.`);
    } finally {
      followInFlight.current = false;
      setFollowingId(null);
    }
  };

  const openProfile = (player) => navigation.navigate('PublicProfile', {
    ownerTab: 'Home',
    player: {
      ...player,
      name: player.display_name,
      avatar: player.avatar_url,
      area: player.home_area,
      rating: player.skill_rating,
    },
  });

  const renderPlayer = ({ item }) => {
    const label = item.isFollowing ? 'Following' : item.followRequestPending ? 'Requested' : item.followsYou ? 'Follow back' : 'Follow';
    const busy = followingId === item.id;
    const connected = item.isFollowing || item.followRequestPending;
    return (
      <View style={[s.playerRow, { borderColor: C.line, backgroundColor: C.surface }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`View ${item.display_name}'s profile`}
          onPress={() => openProfile(item)}
          style={({ pressed }) => [s.profileButton, pressed && s.pressed]}
        >
          <ProfilePhoto photo={item.avatar_url} name={item.display_name} size={48} />
          <View style={s.playerCopy}>
            <Text numberOfLines={2} style={[s.playerName, { color: C.ink }]}>{item.display_name}</Text>
            <Text numberOfLines={1} style={[s.playerMeta, { color: C.ink40 }]}>{item.home_area || 'Peakle player'}</Text>
            {item.followsYou ? <Text style={[s.relationship, { color: C.teal }]}>Follows you</Text> : null}
          </View>
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${label} ${item.display_name}`}
          accessibilityState={{ disabled: Boolean(connected || followingId), busy }}
          disabled={Boolean(connected || followingId)}
          onPress={() => follow(item)}
          style={({ pressed }) => [s.followButton, { backgroundColor: connected ? C.tealWash : LIGHT.optic }, pressed && s.pressed]}
        >
          {busy ? <ActivityIndicator size="small" color={LIGHT.ink} /> : <Text style={[s.followLabel, { color: connected ? C.teal : LIGHT.ink }]}>{label}</Text>}
        </Pressable>
      </View>
    );
  };

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={s.content}>
        <View style={s.header}>
          <Pressable accessibilityRole="button" accessibilityLabel="Go back" onPress={() => navigation.canGoBack() ? navigation.goBack() : navigation.navigate('Home')} style={[s.iconButton, { backgroundColor: C.surface, borderColor: C.line }]}>
            <AppIcon name="arrow-back" size={22} color={C.ink} />
          </Pressable>
          <View style={s.headerCopy}>
            <Text accessibilityRole="header" style={[s.title, { color: C.ink }]}>Search players</Text>
            <Text style={[s.subtitle, { color: C.ink40 }]}>Find your friends. Follow their game.</Text>
          </View>
        </View>
        <View style={[s.search, { backgroundColor: C.surface, borderColor: C.line }]}>
          <AppIcon name="search-outline" size={21} color={C.teal} />
          <TextInput
            ref={inputRef}
            autoFocus
            accessibilityLabel="Search players by name"
            placeholder="Search players by name"
            placeholderTextColor={C.ink40}
            value={query}
            onChangeText={changeQuery}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            style={[s.input, { color: C.ink }]}
          />
          {query ? <Pressable accessibilityRole="button" accessibilityLabel="Clear player search" onPress={() => { changeQuery(''); inputRef.current?.focus(); }} style={s.clearButton}><AppIcon name="close-circle" size={20} color={C.ink40} /></Pressable> : null}
        </View>
        {followError ? <Text accessibilityRole="alert" style={[s.error, { color: isDark ? '#F2A48D' : '#B6472E' }]}>{followError}</Text> : null}
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          renderItem={renderPlayer}
          keyboardShouldPersistTaps="handled"
          keyboardDismissMode="on-drag"
          contentContainerStyle={s.results}
          ListHeaderComponent={searching ? <View accessibilityLiveRegion="polite" style={s.loading}><ActivityIndicator size="small" color={C.teal} /><Text style={[s.subtitle, { color: C.ink40 }]}>Searching players…</Text></View> : null}
          ListEmptyComponent={!searching ? <View style={s.empty}>
            <View style={[s.emptyIcon, { backgroundColor: C.tealWash }]}><AppIcon name={searchError ? 'cloud-offline-outline' : term.length < 2 ? 'people-outline' : 'search-outline'} size={28} color={C.teal} /></View>
            <Text style={[s.emptyTitle, { color: C.ink }]}>{searchError ? 'Search unavailable' : term.length < 2 ? 'Find players to follow' : 'No players found'}</Text>
            <Text style={[s.emptyCopy, { color: C.ink40 }]}>{searchError || (term.length < 2 ? 'Type at least 2 letters of a name to find players in any city.' : `No players match “${term}”. Try a different name or check the spelling.`)}</Text>
            {searchError ? <Pressable accessibilityRole="button" onPress={() => setRetry((value) => value + 1)} style={[s.retryButton, { backgroundColor: LIGHT.optic }]}><Text style={[s.followLabel, { color: LIGHT.ink }]}>Try again</Text></Pressable> : null}
          </View> : null}
        />
      </View>
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  content: { flex: 1, width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingTop: 18 },
  header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 22 },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center', borderRadius: 14, borderWidth: 1 },
  headerCopy: { flex: 1 },
  title: { fontSize: 24, fontWeight: '600', letterSpacing: -0.6 },
  subtitle: { fontSize: 13, lineHeight: 19, marginTop: 3 },
  search: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingLeft: 15, paddingRight: 4, borderRadius: 16, borderWidth: 1 },
  input: { flex: 1, minWidth: 0, height: 54, fontSize: 16 },
  clearButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  results: { paddingTop: 18, paddingBottom: 36, gap: 10 },
  playerRow: { flexDirection: 'row', alignItems: 'center', gap: 10, borderWidth: 1, borderRadius: 18, padding: 12 },
  profileButton: { flex: 1, minWidth: 0, flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 54 },
  playerCopy: { flex: 1, minWidth: 0 },
  playerName: { fontSize: 15, lineHeight: 20, fontWeight: '600' },
  playerMeta: { fontSize: 12, lineHeight: 18, marginTop: 2 },
  relationship: { fontSize: 11, lineHeight: 16, marginTop: 2 },
  followButton: { minWidth: 90, minHeight: 44, paddingHorizontal: 12, alignItems: 'center', justifyContent: 'center', borderRadius: 13 },
  followLabel: { fontSize: 12, fontWeight: '600' },
  loading: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10, paddingVertical: 12 },
  empty: { alignItems: 'center', paddingHorizontal: 20, paddingVertical: 36 },
  emptyIcon: { width: 64, height: 64, borderRadius: 22, alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  emptyTitle: { fontSize: 19, fontWeight: '600', textAlign: 'center' },
  emptyCopy: { fontSize: 14, lineHeight: 22, textAlign: 'center', maxWidth: 340, marginTop: 8 },
  retryButton: { marginTop: 20, minHeight: 44, justifyContent: 'center', paddingHorizontal: 24, borderRadius: 13 },
  error: { fontSize: 13, lineHeight: 19, marginTop: 14 },
  pressed: { opacity: 0.72 },
});
