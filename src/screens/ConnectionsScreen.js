import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import Ionicons from '@expo/vector-icons/Ionicons';
import ProfilePhoto from '../components/ProfilePhoto';
import { DARK_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import { listFollowerPlayers, listFollowingPlayers } from '../services/directMessages';

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A',
  teal: '#1C6B66', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED',
};
const DARK = { ...LIGHT, ...DARK_CONTENT_COLORS, surface: '#17302D', tealWash: '#203B37' };
const TABS = ['Followers', 'Following'];

function Icon({ name, size = 20, color }) {
  return <Ionicons name={name} size={size} color={color} />;
}

export default function ConnectionsScreen({ navigation, route }) {
  const { isDark } = useTheme();
  const C = isDark ? DARK : LIGHT;
  const requestedTab = route.params?.initialTab === 'Following' ? 'Following' : 'Followers';
  const [tab, setTab] = useState(requestedTab);
  const [followers, setFollowers] = useState([]);
  const [following, setFollowing] = useState([]);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setTab(requestedTab);
    setQuery('');
  }, [requestedTab, route.params?.openToken]);

  const load = useCallback(async (isRefresh = false) => {
    if (isRefresh) setRefreshing(true);
    else setLoading(true);
    setError('');
    try {
      const [nextFollowers, nextFollowing] = await Promise.all([
        listFollowerPlayers(),
        listFollowingPlayers(),
      ]);
      const followingIds = new Set(nextFollowing.map((player) => player.id));
      setFollowers(nextFollowers.map((player) => ({ ...player, isFollowing: followingIds.has(player.id) })));
      setFollowing(nextFollowing.map((player) => ({ ...player, isFollowing: true })));
    } catch (loadError) {
      setError(loadError.message || 'Your connections could not be loaded.');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useFocusEffect(useCallback(() => {
    load();
  }, [load]));

  const activePlayers = tab === 'Followers' ? followers : following;
  const visiblePlayers = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    if (!normalizedQuery) return activePlayers;
    return activePlayers.filter((player) => (
      player.name.toLowerCase().includes(normalizedQuery)
      || (player.area || '').toLowerCase().includes(normalizedQuery)
    ));
  }, [activePlayers, query]);

  const openPlayer = (player) => navigation.navigate('PublicProfile', { player, ownerTab: 'Profile' });
  const emptyTitle = query.trim()
    ? 'No players found'
    : tab === 'Followers' ? 'No followers yet' : 'Not following anyone yet';
  const emptyCopy = query.trim()
    ? 'Try searching for a different name or location.'
    : tab === 'Followers'
      ? 'Players who follow you will appear here.'
      : 'Players you follow will appear here.';

  const renderPlayer = ({ item, index }) => (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${item.name}'s profile`}
      onPress={() => openPlayer(item)}
      style={({ pressed }) => [
        s.playerRow,
        { borderTopColor: C.line },
        index > 0 && s.playerRowBorder,
        pressed && s.pressed,
      ]}
    >
      <View style={s.avatarWrap}>
        <ProfilePhoto photo={item.avatar} name={item.name} size={52} />
        <View style={[s.statusRing, { backgroundColor: C.surface }]}>
          <View style={[s.statusDot, { backgroundColor: item.playerStatus === 'away' ? '#D49A32' : item.playerStatus === 'in_play' ? '#2F80ED' : '#68B96B' }]} />
        </View>
      </View>
      <View style={s.playerCopy}>
        <Text numberOfLines={1} style={[s.playerName, { color: C.ink }]}>{item.name}</Text>
        <View style={s.metaRow}>
          <Icon name="location-outline" size={13} color={C.ink40} />
          <Text numberOfLines={1} style={[s.playerMeta, { color: C.ink40 }]}>{item.area || 'Location not added'}</Text>
        </View>
      </View>
      <View style={[s.relationshipPill, { backgroundColor: item.isFollowing ? C.tealWash : C.paper }]}>
        <Text style={[s.relationshipText, { color: item.isFollowing ? C.teal : C.ink40 }]}>
          {item.isFollowing ? 'Following' : 'Follows you'}
        </Text>
      </View>
      <Icon name="chevron-forward" size={18} color={C.ink40} />
    </Pressable>
  );

  return (
    <SafeAreaView style={[s.safe, { backgroundColor: C.paper }]}>
      <StatusBar style={isDark ? 'light' : 'dark'} backgroundColor={C.paper} />
      <View style={s.header}>
        <Pressable accessibilityLabel="Go back" onPress={() => navigation.goBack()} style={[s.iconButton, { backgroundColor: C.surface, borderColor: C.line }]}>
          <Icon name="arrow-back" size={22} color={C.ink} />
        </Pressable>
        <View style={s.headerCopy}>
          <Text style={[s.eyebrow, { color: C.ink40 }]}>YOUR PROFILE</Text>
          <Text style={[s.title, { color: C.ink }]}>Connections</Text>
        </View>
        <View style={[s.peopleIcon, { backgroundColor: C.optic }]}>
          <Icon name="people" size={21} color="#0E2321" />
        </View>
      </View>

      <View style={[s.tabs, { backgroundColor: C.tealWash }]}>
        {TABS.map((item) => {
          const selected = tab === item;
          const count = item === 'Followers' ? followers.length : following.length;
          return (
            <Pressable
              key={item}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              onPress={() => { setTab(item); setQuery(''); }}
              style={[s.tab, selected && { backgroundColor: C.optic }]}
            >
              <Text style={[s.tabText, { color: selected ? '#0E2321' : C.ink40 }]}>{item}</Text>
              <View style={[s.countPill, { backgroundColor: selected ? 'rgba(14,35,33,.11)' : C.surface }]}>
                <Text style={[s.countText, { color: selected ? '#0E2321' : C.ink40 }]}>{count}</Text>
              </View>
            </Pressable>
          );
        })}
      </View>

      <View style={[s.search, { backgroundColor: C.surface, borderColor: C.line }]}>
        <Icon name="search-outline" size={19} color={C.ink40} />
        <TextInput
          accessibilityLabel={`Search ${tab.toLowerCase()}`}
          autoCapitalize="none"
          autoCorrect={false}
          onChangeText={setQuery}
          placeholder={`Search ${tab.toLowerCase()}`}
          placeholderTextColor={C.ink40}
          style={[s.searchInput, { color: C.ink }]}
          value={query}
        />
        {query ? <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}><Icon name="close-circle" size={19} color={C.ink40} /></Pressable> : null}
      </View>

      {loading ? (
        <View style={s.centerState}>
          <ActivityIndicator color={C.teal} />
          <Text style={[s.stateCopy, { color: C.ink40 }]}>Loading connections…</Text>
        </View>
      ) : error ? (
        <View style={s.centerState}>
          <View style={[s.stateIcon, { backgroundColor: C.tealWash }]}><Icon name="cloud-offline-outline" size={25} color={C.teal} /></View>
          <Text style={[s.stateTitle, { color: C.ink }]}>Couldn’t load connections</Text>
          <Text style={[s.stateCopy, { color: C.ink40 }]}>{error}</Text>
          <Pressable onPress={() => load()} style={[s.retryButton, { backgroundColor: C.ink }]}><Text style={[s.retryText, { color: C.paper }]}>Try again</Text></Pressable>
        </View>
      ) : (
        <FlatList
          contentContainerStyle={[s.listContent, { backgroundColor: C.surface }, !visiblePlayers.length && s.emptyListContent]}
          data={visiblePlayers}
          keyExtractor={(item) => item.id}
          keyboardShouldPersistTaps="handled"
          onRefresh={() => load(true)}
          refreshing={refreshing}
          renderItem={renderPlayer}
          showsVerticalScrollIndicator={false}
          ListEmptyComponent={(
            <View style={s.centerState}>
              <View style={[s.stateIcon, { backgroundColor: C.tealWash }]}><Icon name={query.trim() ? 'search-outline' : 'people-outline'} size={26} color={C.teal} /></View>
              <Text style={[s.stateTitle, { color: C.ink }]}>{emptyTitle}</Text>
              <Text style={[s.stateCopy, { color: C.ink40 }]}>{emptyCopy}</Text>
            </View>
          )}
        />
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  safe: { flex: 1 },
  header: { minHeight: 82, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 12 },
  iconButton: { width: 43, height: 43, borderRadius: 22, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  headerCopy: { flex: 1 },
  eyebrow: { fontSize: 9, fontWeight: '900', letterSpacing: 1 },
  title: { marginTop: 2, fontSize: 27, lineHeight: 32, fontWeight: '900', letterSpacing: -.5 },
  peopleIcon: { width: 43, height: 43, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  tabs: { marginHorizontal: 20, padding: 4, flexDirection: 'row', borderRadius: 15 },
  tab: { minHeight: 45, flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 11 },
  tabText: { fontSize: 11, fontWeight: '900' },
  countPill: { minWidth: 24, height: 20, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  countText: { fontSize: 8, fontWeight: '900', fontVariant: ['tabular-nums'] },
  search: { height: 50, marginHorizontal: 20, marginTop: 14, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 9, borderRadius: 14, borderWidth: 1 },
  searchInput: { flex: 1, height: '100%', paddingVertical: 0, fontSize: 12 },
  listContent: { marginHorizontal: 20, marginTop: 14, marginBottom: 30, paddingHorizontal: 13, borderRadius: 18, overflow: 'hidden' },
  emptyListContent: { flexGrow: 1, marginHorizontal: 0, paddingHorizontal: 20 },
  playerRow: { minHeight: 78, flexDirection: 'row', alignItems: 'center', gap: 10 },
  playerRowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  pressed: { opacity: .7 },
  avatarWrap: { width: 52, height: 52 },
  statusRing: { position: 'absolute', right: -1, bottom: -1, width: 15, height: 15, borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  statusDot: { width: 10, height: 10, borderRadius: 5 },
  playerCopy: { minWidth: 0, flex: 1 },
  playerName: { fontSize: 12, fontWeight: '900' },
  metaRow: { marginTop: 4, flexDirection: 'row', alignItems: 'center', gap: 3 },
  playerMeta: { minWidth: 0, flex: 1, fontSize: 9 },
  relationshipPill: { minHeight: 27, paddingHorizontal: 8, alignItems: 'center', justifyContent: 'center', borderRadius: 14 },
  relationshipText: { fontSize: 7, fontWeight: '900' },
  centerState: { flex: 1, minHeight: 250, paddingHorizontal: 28, alignItems: 'center', justifyContent: 'center' },
  stateIcon: { width: 52, height: 52, marginBottom: 12, borderRadius: 17, alignItems: 'center', justifyContent: 'center' },
  stateTitle: { fontSize: 16, fontWeight: '900', textAlign: 'center' },
  stateCopy: { maxWidth: 280, marginTop: 6, fontSize: 10, lineHeight: 15, textAlign: 'center' },
  retryButton: { minHeight: 42, marginTop: 15, paddingHorizontal: 20, alignItems: 'center', justifyContent: 'center', borderRadius: 12 },
  retryText: { fontSize: 9, fontWeight: '900' },
});
