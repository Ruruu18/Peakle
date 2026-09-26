import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Pressable, StyleSheet, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Image as ExpoImage } from 'expo-image';
import Modal from './ResponsiveModal';
import AppIcon from './AppIcon';
import ProfilePhoto from './ProfilePhoto';
import ScrollView from './FocusResetScrollView';
import { webDialog } from '../utils/webLayout';
import { DARK_CONTENT_COLORS } from '../context/ThemeContext';
import { MUTE_DURATIONS } from '../services/directMessages';

// Messenger-style "Chat info" shared by private and team conversations: a
// big avatar and name, round quick actions (profile, nicknames, search, mute),
// a preview of shared media with a full media and links library, and grouped
// action rows. Screens pass their own data and handlers; this file owns only
// layout and the small sheets those actions open.

const LIGHT = {
  ink: '#0E2321', paper: '#F3F5EF', surface: '#FFFFFF', optic: '#D6E94A', teal: '#1C6B66',
  brick: '#B6472E', ink70: '#3C4A45', ink40: '#7C8983', line: '#DDE3DA', tealWash: '#E5F0ED', brickWash: '#F7EAE6',
};
const DARK = { ...LIGHT, ...DARK_CONTENT_COLORS, paper: '#0E2321', surface: '#17302D', tealWash: '#203B37' };
export const chatInfoColors = (isDark) => (isDark ? DARK : LIGHT);

const URL_PATTERN = /\b((?:https?:\/\/|www\.)[^\s<>"']+[^\s<>"'.,;:!?)\]])/gi;

// Links shared in a conversation, newest first, one entry per link.
export function extractChatLinks(messages = []) {
  const links = [];
  for (const message of messages) {
    if (!message?.text || message.deletedAt) continue;
    const matches = message.text.match(URL_PATTERN) || [];
    matches.forEach((url, index) => links.push({
      id: `${message.id}:${index}`,
      url: /^https?:\/\//i.test(url) ? url : `https://${url}`,
      label: url.replace(/^https?:\/\//i, '').replace(/^www\./i, ''),
      sender: message.sender,
      createdAt: message.createdAt,
      messageId: message.id,
    }));
  }
  return links.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

const shortDate = (value) => (value ? new Date(value).toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' }) : '');

function Icon({ name, size = 20, color }) {
  return <AppIcon name={name} size={size} color={color} />;
}

function MediaTile({ item, colors, onPress, style }) {
  return (
    <Pressable accessibilityRole="imagebutton" accessibilityLabel={`Open shared ${item.kind === 'video' ? 'video' : item.kind === 'gif' ? 'GIF' : 'photo'}`} onPress={() => onPress(item)} style={({ pressed }) => [styles.mediaTile, { backgroundColor: colors.tealWash }, style, pressed && styles.pressed]}>
      {item.uri && item.kind !== 'video' ? <ExpoImage source={{ uri: item.uri }} contentFit="cover" style={StyleSheet.absoluteFillObject} /> : <View style={[StyleSheet.absoluteFillObject, styles.videoFill]}><Icon name="videocam" size={24} color="#FFFFFF" /></View>}
      {item.kind === 'video' ? <View style={styles.mediaBadge}><Icon name="play" size={10} color="#FFFFFF" /><Text style={styles.mediaBadgeText}>VIDEO</Text></View> : null}
      {item.kind === 'gif' ? <View style={styles.mediaBadge}><Text style={styles.mediaBadgeText}>GIF</Text></View> : null}
    </Pressable>
  );
}

function QuickAction({ action, colors }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={action.accessibilityLabel || action.label} disabled={action.disabled} onPress={action.onPress} style={({ pressed }) => [styles.quickAction, action.disabled && styles.disabled, pressed && styles.pressed]}>
      <View style={[styles.quickActionCircle, { backgroundColor: action.active ? colors.optic : colors.surface, borderColor: colors.line }]}><Icon name={action.icon} size={22} color={action.active ? '#0E2321' : colors.ink} /></View>
      <Text numberOfLines={1} style={[styles.quickActionLabel, { color: colors.ink70 }]}>{action.label}</Text>
    </Pressable>
  );
}

function ActionRow({ row, colors, isLast }) {
  const tint = row.destructive ? colors.brick : colors.ink;
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={row.detail ? `${row.label}. ${row.detail}` : row.label} disabled={row.disabled} onPress={row.onPress} style={({ pressed }) => [styles.actionRow, row.disabled && styles.disabled, pressed && { backgroundColor: colors.tealWash }]}>
      <View style={styles.actionIcon}>{row.busy ? <ActivityIndicator size="small" color={tint} /> : <Icon name={row.icon} size={22} color={tint} />}</View>
      <View style={[styles.actionCopy, !isLast && { borderBottomWidth: StyleSheet.hairlineWidth, borderColor: colors.line }]}>
        <View style={styles.actionText}>
          <Text numberOfLines={1} style={[styles.actionLabel, { color: tint }]}>{row.label}</Text>
          {row.detail ? <Text numberOfLines={1} style={[styles.actionDetail, { color: colors.ink40 }]}>{row.detail}</Text> : null}
        </View>
        {row.chevron ? <Icon name="chevron-forward" size={18} color={colors.ink40} /> : null}
      </View>
    </Pressable>
  );
}

export function ChatInfoSection({ title, colors, children, right }) {
  return (
    <View style={styles.section}>
      <View style={styles.sectionHead}><Text style={[styles.sectionTitle, { color: colors.ink40 }]}>{title}</Text>{right}</View>
      {children}
    </View>
  );
}

export function ChatInfoCard({ colors, children, style }) {
  return <View style={[styles.card, { backgroundColor: colors.surface, borderColor: colors.line }, style]}>{children}</View>;
}

// Photos and videos in a grid, and shared links in a list.
function MediaLibraryModal({ visible, media, links, loading, colors, preview, onClose, onOpenMedia }) {
  const [tab, setTab] = useState('media');
  const { width } = useWindowDimensions();
  const columns = width >= 700 ? 5 : 3;
  const tileSize = (Math.min(width, 760) - 32 - (columns - 1) * 3) / columns;
  useEffect(() => { if (visible) setTab('media'); }, [visible]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fullScreen, { backgroundColor: colors.paper }]}>
        <View style={styles.subHeader}>
          <Pressable accessibilityLabel="Back to chat info" hitSlop={8} onPress={onClose} style={styles.backButton}><Icon name="chevron-back" size={26} color={colors.ink} /></Pressable>
          <Text style={[styles.subHeaderTitle, { color: colors.ink }]}>Media, links and files</Text>
          <View style={styles.backButton} />
        </View>
        <View style={[styles.tabs, { backgroundColor: colors.surface, borderColor: colors.line }]}>
          {[['media', `Media${media.length ? ` · ${media.length}` : ''}`], ['links', `Links${links.length ? ` · ${links.length}` : ''}`]].map(([key, label]) => (
            <Pressable key={key} accessibilityRole="tab" accessibilityState={{ selected: tab === key }} onPress={() => setTab(key)} style={[styles.tab, tab === key && { backgroundColor: colors.optic }]}>
              <Text style={[styles.tabText, { color: tab === key ? '#0E2321' : colors.ink70 }]}>{label}</Text>
            </Pressable>
          ))}
        </View>
        {loading ? <View style={styles.centered}><ActivityIndicator color={colors.teal} /></View> : tab === 'media' ? (
          media.length ? (
            <FlatList
              key={`media-${columns}`}
              data={media}
              numColumns={columns}
              keyExtractor={(item) => item.id}
              columnWrapperStyle={columns > 1 ? styles.gridRow : undefined}
              contentContainerStyle={styles.gridContent}
              renderItem={({ item }) => <MediaTile item={item} colors={colors} onPress={onOpenMedia} style={{ width: tileSize, height: tileSize, borderRadius: 4 }} />}
            />
          ) : <EmptyState icon="images-outline" title="No photos or videos yet" body="Photos and videos shared in this chat will show up here." colors={colors} />
        ) : links.length ? (
          <ScrollView contentContainerStyle={styles.linksContent}>
            <ChatInfoCard colors={colors}>
              {links.map((link, index) => (
                <Pressable key={link.id} accessibilityRole="link" accessibilityLabel={`Open ${link.label}`} onPress={() => Linking.openURL(link.url).catch(() => {})} style={({ pressed }) => [styles.linkRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, pressed && styles.pressed]}>
                  <View style={[styles.linkIcon, { backgroundColor: colors.tealWash }]}><Icon name="link-outline" size={20} color={colors.teal} /></View>
                  <View style={styles.actionText}>
                    <Text numberOfLines={1} style={[styles.actionLabel, { color: colors.ink }]}>{link.label}</Text>
                    <Text numberOfLines={1} style={[styles.actionDetail, { color: colors.ink40 }]}>{[link.sender, shortDate(link.createdAt)].filter(Boolean).join(' · ')}</Text>
                  </View>
                  <Icon name="open-outline" size={17} color={colors.ink40} />
                </Pressable>
              ))}
            </ChatInfoCard>
          </ScrollView>
        ) : <EmptyState icon="link-outline" title="No links yet" body="Links shared in this chat will show up here." colors={colors} />}
      </SafeAreaView>
      {preview}
    </Modal>
  );
}

function EmptyState({ icon, title, body, colors }) {
  return (
    <View style={styles.centered}>
      <View style={[styles.emptyIcon, { backgroundColor: colors.tealWash }]}><Icon name={icon} size={26} color={colors.teal} /></View>
      <Text style={[styles.emptyTitle, { color: colors.ink }]}>{title}</Text>
      <Text style={[styles.emptyBody, { color: colors.ink40 }]}>{body}</Text>
    </View>
  );
}

// Nicknames are shared with everyone in the conversation, like Messenger.
export function NicknamesModal({ visible, people, colors, onSave, onClose }) {
  const [editing, setEditing] = useState(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { if (!visible) { setEditing(null); setError(null); } }, [visible]);
  const startEditing = (person) => {
    setEditing(person);
    setValue(person.nickname || '');
    setError(null);
  };
  const save = async (nickname) => {
    if (!editing || saving) return;
    setSaving(true);
    setError(null);
    try {
      await onSave(editing, nickname.trim() || null);
      setEditing(null);
    } catch (saveError) {
      setError(saveError.message || 'Nickname not saved.');
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={editing ? () => setEditing(null) : onClose}>
      <View {...webDialog('backdrop')} style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close nicknames" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={[styles.sheet, { backgroundColor: colors.paper }]}>
          <View {...webDialog('handle')} style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <View style={styles.sheetHeader}>
            {editing ? <Pressable accessibilityLabel="Back to nicknames" hitSlop={8} onPress={() => setEditing(null)} style={styles.backButton}><Icon name="chevron-back" size={24} color={colors.ink} /></Pressable> : <View style={styles.backButton} />}
            <Text numberOfLines={1} style={[styles.subHeaderTitle, { color: colors.ink }]}>{editing ? `Edit nickname` : 'Nicknames'}</Text>
            <Pressable accessibilityLabel="Close" hitSlop={8} onPress={onClose} style={styles.backButton}><Icon name="close" size={22} color={colors.ink70} /></Pressable>
          </View>
          {editing ? (
            <View style={styles.nicknameEditor}>
              <ProfilePhoto photo={editing.avatar} name={editing.name} size={64} />
              <Text style={[styles.nicknameEditorName, { color: colors.ink70 }]}>{editing.name}{editing.you ? ' (You)' : ''}</Text>
              <TextInput value={value} onChangeText={setValue} autoFocus maxLength={40} placeholder={editing.name} placeholderTextColor={colors.ink40} returnKeyType="done" onSubmitEditing={() => save(value)} style={[styles.nicknameInput, { color: colors.ink, backgroundColor: colors.surface, borderColor: colors.line }]} />
              <Text style={[styles.emptyBody, { color: colors.ink40 }]}>Everyone in this chat will see this nickname.</Text>
              {error ? <Text style={[styles.errorText, { color: colors.brick }]}>{error}</Text> : null}
              <View style={styles.nicknameButtons}>
                {editing.nickname ? <Pressable disabled={saving} onPress={() => save('')} style={[styles.secondaryButton, { borderColor: colors.line }]}><Text style={[styles.secondaryButtonText, { color: colors.brick }]}>Remove</Text></Pressable> : null}
                <Pressable disabled={saving || value.trim() === (editing.nickname || '')} onPress={() => save(value)} style={[styles.primaryButton, { backgroundColor: colors.optic }, (saving || value.trim() === (editing.nickname || '')) && styles.disabled]}>{saving ? <ActivityIndicator size="small" color="#0E2321" /> : <Text style={styles.primaryButtonText}>Save</Text>}</Pressable>
              </View>
            </View>
          ) : (
            <ScrollView style={styles.sheetList} contentContainerStyle={styles.sheetListContent}>
              {people.map((person, index) => (
                <Pressable key={person.id} accessibilityRole="button" accessibilityLabel={`Set nickname for ${person.name}`} onPress={() => startEditing(person)} style={({ pressed }) => [styles.personRow, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, pressed && styles.pressed]}>
                  <ProfilePhoto photo={person.avatar} name={person.name} size={44} />
                  <View style={styles.actionText}>
                    <Text numberOfLines={1} style={[styles.actionLabel, { color: colors.ink }]}>{person.nickname || person.name}{person.you ? ' (You)' : ''}</Text>
                    <Text numberOfLines={1} style={[styles.actionDetail, { color: colors.ink40 }]}>{person.nickname ? person.name : 'Set nickname'}</Text>
                  </View>
                  <Icon name="create-outline" size={19} color={colors.ink40} />
                </Pressable>
              ))}
            </ScrollView>
          )}
        </View>
      </View>
    </Modal>
  );
}

// Finds messages among the ones this chat has loaded.
export function ChatSearchModal({ visible, messages, colors, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  useEffect(() => { if (visible) setQuery(''); }, [visible]);
  const term = query.trim().toLowerCase();
  const results = useMemo(() => (term.length < 2 ? [] : messages
    .filter((message) => message.text && !message.deletedAt && message.text.toLowerCase().includes(term))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .slice(0, 80)), [messages, term]);
  return (
    <Modal visible={visible} animationType="slide" onRequestClose={onClose}>
      <SafeAreaView style={[styles.fullScreen, { backgroundColor: colors.paper }]}>
        <View style={styles.searchHeader}>
          <View style={[styles.searchField, { backgroundColor: colors.surface, borderColor: colors.line }]}>
            <Icon name="search" size={18} color={colors.ink40} />
            <TextInput value={query} onChangeText={setQuery} autoFocus placeholder="Search in conversation" placeholderTextColor={colors.ink40} returnKeyType="search" style={[styles.searchInput, { color: colors.ink }]} />
            {query ? <Pressable accessibilityLabel="Clear search" hitSlop={8} onPress={() => setQuery('')}><Icon name="close-circle" size={18} color={colors.ink40} /></Pressable> : null}
          </View>
          <Pressable accessibilityRole="button" onPress={onClose} hitSlop={8}><Text style={[styles.cancelText, { color: colors.teal }]}>Cancel</Text></Pressable>
        </View>
        {term.length < 2 ? <EmptyState icon="search-outline" title="Search messages" body="Type at least two letters to find messages in this chat." colors={colors} />
          : results.length ? (
            <FlatList
              data={results}
              keyExtractor={(item) => item.id}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.linksContent}
              renderItem={({ item, index }) => (
                <Pressable accessibilityRole="button" accessibilityLabel={`Go to message from ${item.sender}`} onPress={() => onSelect(item)} style={({ pressed }) => [styles.personRow, { backgroundColor: colors.surface }, index > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderColor: colors.line }, pressed && styles.pressed]}>
                  <ProfilePhoto photo={item.avatar} name={item.sender} size={40} />
                  <View style={styles.actionText}>
                    <View style={styles.resultHead}><Text numberOfLines={1} style={[styles.resultSender, { color: colors.ink }]}>{item.sender}</Text><Text style={[styles.actionDetail, { color: colors.ink40 }]}>{shortDate(item.createdAt)}</Text></View>
                    <Text numberOfLines={2} style={[styles.actionDetail, { color: colors.ink70 }]}>{item.text}</Text>
                  </View>
                </Pressable>
              )}
            />
          ) : <EmptyState icon="search-outline" title="No results" body={`No messages match “${query.trim()}”.`} colors={colors} />}
      </SafeAreaView>
    </Modal>
  );
}

function MuteSheet({ visible, name, colors, onSelect, onClose }) {
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View {...webDialog('backdrop')} style={styles.sheetBackdrop}>
        <Pressable accessibilityLabel="Close mute options" onPress={onClose} style={StyleSheet.absoluteFillObject} />
        <View {...webDialog('surface')} style={[styles.sheet, { backgroundColor: colors.paper }]}>
          <View {...webDialog('handle')} style={[styles.sheetHandle, { backgroundColor: colors.line }]} />
          <Text style={[styles.subHeaderTitle, styles.muteTitle, { color: colors.ink }]}>Mute {name}</Text>
          <Text style={[styles.emptyBody, styles.muteBody, { color: colors.ink40 }]}>You won’t be alerted about new messages. Unread messages still show in your inbox.</Text>
          <ChatInfoCard colors={colors} style={styles.muteCard}>
            {MUTE_DURATIONS.map((option, index) => <ActionRow key={option.label} row={{ icon: 'time-outline', label: option.label, onPress: () => onSelect(option.minutes) }} colors={colors} isLast={index === MUTE_DURATIONS.length - 1} />)}
          </ChatInfoCard>
        </View>
      </View>
    </Modal>
  );
}

// media: [{ id, uri, kind: 'photo' | 'video' | 'gif', source }]
// links: from extractChatLinks
// quickActions: [{ key, icon, label, onPress, active?, disabled? }]
// sections: [{ title, rows: [{ key, icon, label, detail?, chevron?, destructive?, onPress }] }]
// mute: { muted, label, name, onMute(minutes), onUnmute } adds a Mute row to Actions.
// preview: the screen's media preview modal. It renders inside the media
// library while that is open, since iOS presents only one modal per parent.
export default function ChatInfoScreen({
  colors,
  title,
  subtitle,
  avatar,
  online = false,
  quickActions = [],
  media = [],
  links = [],
  mediaLoading = false,
  onOpenMedia,
  preview = null,
  mute,
  sections = [],
  children,
  footer,
  onBack,
}) {
  const [libraryOpen, setLibraryOpen] = useState(false);
  const [muteOpen, setMuteOpen] = useState(false);
  const { width } = useWindowDimensions();
  const previewSize = (Math.min(width, 760) - 32 - 24 - 12) / 3;
  const actionSections = mute ? [
    {
      title: 'Actions',
      rows: [
        { key: 'mute', icon: mute.muted ? 'notifications-off' : 'notifications', label: mute.muted ? `Unmute ${mute.name}` : `Mute ${mute.name}`, detail: mute.label, onPress: () => (mute.muted ? mute.onUnmute() : setMuteOpen(true)) },
        ...(sections.find((section) => section.title === 'Actions')?.rows || []),
      ],
    },
    ...sections.filter((section) => section.title !== 'Actions'),
  ] : sections;
  const openMedia = (item) => onOpenMedia?.(item);
  const renderSection = (section) => (section.rows.length ? (
    <ChatInfoSection key={section.title} title={section.title} colors={colors}>
      <ChatInfoCard colors={colors}>
        {section.rows.map((row, index) => <ActionRow key={row.key} row={row} colors={colors} isLast={index === section.rows.length - 1} />)}
      </ChatInfoCard>
    </ChatInfoSection>
  ) : null);
  return (
    <View style={[styles.fullScreen, { backgroundColor: colors.paper }]}>
      <View style={styles.topBar}>
        <Pressable accessibilityLabel="Back to chat" hitSlop={8} onPress={onBack} style={styles.backButton}><Icon name="chevron-back" size={28} color={colors.ink} /></Pressable>
      </View>
      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <View style={styles.hero}>
          <View>
            {avatar}
            {online ? <View style={[styles.onlineDot, { borderColor: colors.paper }]} /> : null}
          </View>
          <Text numberOfLines={2} style={[styles.title, { color: colors.ink }]}>{title}</Text>
          {subtitle ? <Text numberOfLines={1} style={[styles.subtitle, { color: colors.ink40 }]}>{subtitle}</Text> : null}
        </View>
        <View style={styles.quickActions}>
          {quickActions.map((action) => <QuickAction key={action.key} action={action} colors={colors} />)}
        </View>

        <ChatInfoSection title="Chat info" colors={colors}>
          <ChatInfoCard colors={colors}>
            {mediaLoading && !media.length ? <View style={styles.previewLoading}><ActivityIndicator color={colors.teal} /></View>
              : media.length ? <View style={styles.previewRow}>{media.slice(0, 3).map((item) => <MediaTile key={item.id} item={item} colors={colors} onPress={openMedia} style={{ width: previewSize, height: previewSize * 1.25 }} />)}</View> : null}
            <ActionRow row={{ key: 'library', icon: 'images-outline', label: 'Media, links and files', detail: media.length || links.length ? [media.length ? `${media.length} ${media.length === 1 ? 'item' : 'items'}` : null, links.length ? `${links.length} ${links.length === 1 ? 'link' : 'links'}` : null].filter(Boolean).join(' · ') : 'Nothing shared yet', chevron: true, onPress: () => setLibraryOpen(true) }} colors={colors} isLast />
          </ChatInfoCard>
        </ChatInfoSection>

        {actionSections.filter((section) => section.title === 'Actions').map(renderSection)}
        {children}
        {actionSections.filter((section) => section.title !== 'Actions').map(renderSection)}
        {footer}
      </ScrollView>
      <MediaLibraryModal visible={libraryOpen} media={media} links={links} loading={mediaLoading} colors={colors} preview={libraryOpen ? preview : null} onClose={() => setLibraryOpen(false)} onOpenMedia={openMedia} />
      {libraryOpen ? null : preview}
      {mute ? <MuteSheet visible={muteOpen} name={mute.name} colors={colors} onClose={() => setMuteOpen(false)} onSelect={(minutes) => { setMuteOpen(false); mute.onMute(minutes); }} /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fullScreen: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.45 },
  topBar: { minHeight: 48, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
  backButton: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  content: { width: '100%', maxWidth: 760, alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 48 },
  hero: { alignItems: 'center', paddingTop: 4 },
  onlineDot: { position: 'absolute', right: 6, bottom: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 4, backgroundColor: '#31A24C' },
  title: { marginTop: 14, fontSize: 26, lineHeight: 32, fontWeight: '900', letterSpacing: -0.6, textAlign: 'center' },
  subtitle: { marginTop: 3, fontSize: 13, fontWeight: '600' },
  quickActions: { marginTop: 20, flexDirection: 'row', justifyContent: 'center', gap: 14, flexWrap: 'wrap' },
  quickAction: { width: 72, alignItems: 'center', gap: 7 },
  quickActionCircle: { width: 50, height: 50, borderRadius: 25, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  quickActionLabel: { fontSize: 12, fontWeight: '700' },
  section: { marginTop: 26 },
  sectionHead: { marginBottom: 8, paddingHorizontal: 4, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  sectionTitle: { fontSize: 14, fontWeight: '800' },
  card: { borderRadius: 16, borderWidth: 1, overflow: 'hidden' },
  previewRow: { padding: 12, paddingBottom: 4, flexDirection: 'row', gap: 6 },
  previewLoading: { height: 90, alignItems: 'center', justifyContent: 'center' },
  mediaTile: { overflow: 'hidden', borderRadius: 10 },
  videoFill: { alignItems: 'center', justifyContent: 'center', backgroundColor: '#17302D' },
  mediaBadge: { position: 'absolute', right: 6, bottom: 6, paddingHorizontal: 6, paddingVertical: 3, flexDirection: 'row', alignItems: 'center', gap: 3, borderRadius: 8, backgroundColor: 'rgba(0,0,0,.55)' },
  mediaBadgeText: { color: '#FFFFFF', fontSize: 9, fontWeight: '900', letterSpacing: 0.6 },
  actionRow: { minHeight: 56, paddingLeft: 16, flexDirection: 'row', alignItems: 'center' },
  actionIcon: { width: 28, alignItems: 'center' },
  actionCopy: { flex: 1, minHeight: 56, marginLeft: 14, paddingRight: 14, flexDirection: 'row', alignItems: 'center', gap: 8 },
  actionText: { flex: 1, minWidth: 0 },
  actionLabel: { fontSize: 16, fontWeight: '600' },
  actionDetail: { marginTop: 2, fontSize: 12, lineHeight: 16 },
  subHeader: { minHeight: 52, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center' },
  subHeaderTitle: { flex: 1, fontSize: 17, fontWeight: '900', textAlign: 'center' },
  tabs: { marginHorizontal: 16, marginBottom: 12, padding: 4, flexDirection: 'row', borderRadius: 14, borderWidth: 1 },
  tab: { flex: 1, minHeight: 36, alignItems: 'center', justifyContent: 'center', borderRadius: 10 },
  tabText: { fontSize: 13, fontWeight: '800' },
  gridContent: { paddingHorizontal: 16, paddingBottom: 32, gap: 3 },
  gridRow: { gap: 3 },
  linksContent: { paddingHorizontal: 16, paddingBottom: 32 },
  linkRow: { minHeight: 62, paddingHorizontal: 14, flexDirection: 'row', alignItems: 'center', gap: 12 },
  linkIcon: { width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  centered: { flex: 1, paddingHorizontal: 32, paddingVertical: 40, alignItems: 'center', justifyContent: 'center' },
  emptyIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { marginTop: 12, fontSize: 16, fontWeight: '900' },
  emptyBody: { marginTop: 5, fontSize: 13, lineHeight: 18, textAlign: 'center' },
  sheetBackdrop: { flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(14,35,33,.5)' },
  sheet: { maxHeight: '86%', paddingBottom: 28, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetHandle: { width: 40, height: 5, marginTop: 8, marginBottom: 4, alignSelf: 'center', borderRadius: 3 },
  sheetHeader: { minHeight: 50, paddingHorizontal: 8, flexDirection: 'row', alignItems: 'center' },
  sheetList: { flexGrow: 0 },
  sheetListContent: { paddingHorizontal: 12, paddingBottom: 8 },
  personRow: { minHeight: 64, paddingHorizontal: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  nicknameEditor: { paddingHorizontal: 22, paddingTop: 6, alignItems: 'center' },
  nicknameEditorName: { marginTop: 8, fontSize: 14, fontWeight: '700' },
  nicknameInput: { alignSelf: 'stretch', minHeight: 50, marginTop: 16, paddingHorizontal: 14, borderRadius: 14, borderWidth: 1, fontSize: 17, fontWeight: '600', textAlign: 'center' },
  nicknameButtons: { alignSelf: 'stretch', marginTop: 18, flexDirection: 'row', gap: 10 },
  primaryButton: { flex: 1, minHeight: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  primaryButtonText: { color: '#0E2321', fontSize: 15, fontWeight: '900' },
  secondaryButton: { flex: 1, minHeight: 48, borderRadius: 24, borderWidth: 1, alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { fontSize: 15, fontWeight: '800' },
  errorText: { marginTop: 10, fontSize: 13, fontWeight: '700', textAlign: 'center' },
  searchHeader: { paddingHorizontal: 16, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 12 },
  searchField: { flex: 1, minHeight: 42, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 8, borderRadius: 21, borderWidth: 1 },
  searchInput: { flex: 1, minHeight: 40, fontSize: 15 },
  cancelText: { fontSize: 15, fontWeight: '800' },
  resultHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  resultSender: { flex: 1, fontSize: 14, fontWeight: '800' },
  muteTitle: { marginTop: 10 },
  muteBody: { marginHorizontal: 24 },
  muteCard: { marginTop: 16, marginHorizontal: 16 },
});
