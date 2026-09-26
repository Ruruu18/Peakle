import React, { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Linking, Modal, PanResponder, Platform, Pressable, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { Image as ExpoImage } from 'expo-image';
import * as ImageManipulator from 'expo-image-manipulator';
import * as MediaLibrary from 'expo-media-library';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from './AppIcon';

// Messenger-style photo picker for chats on phones: a Recents grid with an
// album switcher, HD toggle and multi-select. It opens full screen from the
// camera and as a sheet under the composer. Browsers cannot read the photo
// library, so the web keeps the system file picker.

const PAGE_SIZE = 90;
const MAX_SELECTED = 10;
// With HD off, photos are sent at a size that still looks sharp full screen.
const STANDARD_PHOTO_EDGE = 2048;
const MEDIA_TYPES = [MediaLibrary.MediaType.photo, MediaLibrary.MediaType.video];
const GRANULAR = ['photo', 'video'];
const RECENTS = { id: null, title: 'Recents' };
const PHOTO_MIMES = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', heic: 'image/heic', heif: 'image/heif', gif: 'image/gif' };

const formatDuration = (seconds) => `${Math.floor(seconds / 60)}:${String(Math.round(seconds % 60)).padStart(2, '0')}`;

export const getMediaPermission = () => MediaLibrary.getPermissionsAsync(false, GRANULAR);

// The newest photo or video, for the camera's gallery button. Never prompts.
export async function getLatestMediaThumbnail() {
  if (Platform.OS === 'web') return null;
  const permission = await getMediaPermission();
  if (!permission.granted) return null;
  const page = await MediaLibrary.getAssetsAsync({ first: 1, mediaType: MEDIA_TYPES, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
  return page.assets[0]?.uri || null;
}

// Turns picked library items into files the chat upload understands.
export async function prepareGalleryItems(items, hd) {
  const prepared = [];
  for (const item of items) {
    const info = await MediaLibrary.getAssetInfoAsync(item, { shouldDownloadFromNetwork: true });
    const uri = info.localUri || item.uri;
    const fileName = item.filename || uri.split('/').pop()?.split('?')[0] || 'media';
    const extension = fileName.split('.').pop()?.toLowerCase();
    if (item.mediaType === MediaLibrary.MediaType.video) {
      prepared.push({ type: 'video', asset: { uri, fileName, width: item.width, height: item.height, duration: Math.round(item.duration * 1000), mimeType: extension === 'mov' ? 'video/quicktime' : 'video/mp4' } });
      continue;
    }
    const longEdge = Math.max(item.width, item.height);
    if (!hd && longEdge > STANDARD_PHOTO_EDGE) {
      const resize = item.width >= item.height ? { width: STANDARD_PHOTO_EDGE } : { height: STANDARD_PHOTO_EDGE };
      const smaller = await ImageManipulator.manipulateAsync(uri, [{ resize }], { compress: 0.85, format: ImageManipulator.SaveFormat.JPEG });
      prepared.push({ type: 'image', asset: { uri: smaller.uri, width: smaller.width, height: smaller.height, fileName: 'photo.jpg', mimeType: 'image/jpeg' } });
      continue;
    }
    prepared.push({ type: 'image', asset: { uri, fileName, width: item.width, height: item.height, mimeType: PHOTO_MIMES[extension] || 'image/jpeg' } });
  }
  return prepared;
}

function useLibrary(active, album) {
  const [permission, setPermission] = useState(null);
  const [assets, setAssets] = useState([]);
  const [albums, setAlbums] = useState([]);
  const [loading, setLoading] = useState(false);
  const cursor = useRef({ after: undefined, hasNextPage: true, loading: false, generation: 0 });

  const request = useCallback(async () => {
    const current = await getMediaPermission();
    const next = current.granted || !current.canAskAgain ? current : await MediaLibrary.requestPermissionsAsync(false, GRANULAR);
    setPermission(next);
    return next;
  }, []);

  const loadMore = useCallback(async (reset = false) => {
    const state = cursor.current;
    if (reset) { state.generation += 1; state.after = undefined; state.hasNextPage = true; state.loading = false; }
    if (state.loading || !state.hasNextPage) return;
    const generation = state.generation;
    state.loading = true;
    setLoading(true);
    try {
      const page = await MediaLibrary.getAssetsAsync({ first: PAGE_SIZE, after: state.after, album: album.id || undefined, mediaType: MEDIA_TYPES, sortBy: [[MediaLibrary.SortBy.creationTime, false]] });
      if (generation !== state.generation) return;
      state.after = page.endCursor;
      state.hasNextPage = page.hasNextPage;
      setAssets((current) => (reset ? page.assets : [...current, ...page.assets]));
    } finally {
      if (generation === state.generation) { state.loading = false; setLoading(false); }
    }
  }, [album.id]);

  useEffect(() => {
    if (!active) return;
    request().catch(() => setPermission({ granted: false, canAskAgain: false }));
  }, [active, request]);

  useEffect(() => {
    if (!active || !permission?.granted) return;
    loadMore(true).catch(() => {});
  }, [active, permission?.granted, loadMore]);

  useEffect(() => {
    if (!active || !permission?.granted) return;
    MediaLibrary.getAlbumsAsync({ includeSmartAlbums: true })
      .then((list) => setAlbums(list.filter((item) => item.assetCount > 0).sort((a, b) => b.assetCount - a.assetCount)))
      .catch(() => setAlbums([]));
  }, [active, permission?.granted]);

  // Pick up photos taken while the picker was open, or newly shared ones.
  useEffect(() => {
    if (!active || !permission?.granted) return undefined;
    const subscription = MediaLibrary.addListener(() => loadMore(true).catch(() => {}));
    return () => subscription.remove();
  }, [active, permission?.granted, loadMore]);

  return { permission, request, assets, albums, loading, loadMore };
}

function GalleryCell({ item, size, order, onPress }) {
  const selected = order > 0;
  const isVideo = item.mediaType === MediaLibrary.MediaType.video;
  return (
    <Pressable accessibilityRole="checkbox" accessibilityState={{ checked: selected }} accessibilityLabel={`${isVideo ? 'Video' : 'Photo'}${isVideo ? `, ${formatDuration(item.duration)}` : ''}`} onPress={() => onPress(item)} style={{ width: size, height: size }}>
      <ExpoImage source={{ uri: item.uri }} recyclingKey={item.id} contentFit="cover" style={StyleSheet.absoluteFill} />
      {selected ? <View style={styles.cellSelected} /> : null}
      <View style={[styles.cellCheck, selected && styles.cellCheckOn]}>{selected ? <Text style={styles.cellCheckText}>{order}</Text> : null}</View>
      {isVideo ? <Text style={styles.cellDuration}>{formatDuration(item.duration)}</Text> : null}
    </Pressable>
  );
}

// The grid, album list and send bar shared by the full-screen picker and the
// chat sheet. `header` renders above the grid with the album title and HD.
function GalleryBrowser({ active, dark, colors, width, renderHeader, onSend, footerInset = 0 }) {
  const [album, setAlbum] = useState(RECENTS);
  const [albumsOpen, setAlbumsOpen] = useState(false);
  const [hd, setHd] = useState(true);
  const [selected, setSelected] = useState([]);
  const [sending, setSending] = useState(false);
  const { permission, request, assets, albums, loading, loadMore } = useLibrary(active, album);
  const ink = dark ? '#FFFFFF' : colors.ink;
  const muted = dark ? 'rgba(255,255,255,.65)' : colors.ink70;
  const cell = Math.floor((width - 4) / 3);

  useEffect(() => {
    if (active) return;
    setSelected([]);
    setAlbumsOpen(false);
  }, [active]);

  const toggle = (item) => setSelected((current) => {
    if (current.some((entry) => entry.id === item.id)) return current.filter((entry) => entry.id !== item.id);
    return current.length >= MAX_SELECTED ? current : [...current, item];
  });
  const send = async () => {
    if (!selected.length || sending) return;
    setSending(true);
    try {
      await onSend(selected, hd);
      setSelected([]);
    } finally {
      setSending(false);
    }
  };
  const limited = permission?.accessPrivileges === 'limited';

  const header = renderHeader({
    title: album.title,
    albumsOpen,
    onTitle: () => setAlbumsOpen((open) => !open),
    hd,
    onHd: () => setHd((value) => !value),
    ink,
  });

  let body;
  if (!permission) {
    body = <ActivityIndicator color={ink} style={styles.center} />;
  } else if (!permission.granted) {
    body = (
      <View style={styles.center}>
        <AppIcon name="images-outline" size={38} color={ink} />
        <Text style={[styles.emptyTitle, { color: ink }]}>Allow access to your photos</Text>
        <Text style={[styles.emptyBody, { color: muted }]}>Peakle shows your recent photos and videos here so you can send them in chats.</Text>
        <Pressable accessibilityRole="button" onPress={permission.canAskAgain ? request : () => Linking.openSettings()} style={styles.emptyButton}>
          <Text style={styles.emptyButtonText}>{permission.canAskAgain ? 'Allow access' : 'Open Settings'}</Text>
        </Pressable>
      </View>
    );
  } else if (albumsOpen) {
    body = (
      <FlatList
        data={[RECENTS, ...albums]}
        keyExtractor={(item) => item.id || 'recents'}
        renderItem={({ item }) => (
          <Pressable accessibilityRole="button" accessibilityState={{ selected: item.id === album.id }} onPress={() => { setAlbum(item); setAlbumsOpen(false); }} style={({ pressed }) => [styles.albumRow, pressed && styles.pressed]}>
            <Text numberOfLines={1} style={[styles.albumTitle, { color: ink }]}>{item.title}</Text>
            {item.assetCount != null ? <Text style={[styles.albumCount, { color: muted }]}>{item.assetCount}</Text> : null}
            {item.id === album.id ? <AppIcon name="checkmark" size={20} color={ink} /> : null}
          </Pressable>
        )}
      />
    );
  } else {
    body = (
      <FlatList
        data={assets}
        keyExtractor={(item) => item.id}
        numColumns={3}
        columnWrapperStyle={styles.gridRow}
        contentContainerStyle={[styles.grid, { paddingBottom: (selected.length ? 84 : 12) + footerInset }]}
        initialNumToRender={24}
        windowSize={7}
        onEndReachedThreshold={0.6}
        onEndReached={() => loadMore().catch(() => {})}
        ListHeaderComponent={limited ? (
          <Pressable accessibilityRole="button" onPress={() => MediaLibrary.presentPermissionsPickerAsync().catch(() => Linking.openSettings())} style={styles.limited}>
            <Text style={[styles.limitedText, { color: muted }]}>You've allowed Peakle to see some of your photos.</Text>
            <Text style={styles.limitedAction}>Manage</Text>
          </Pressable>
        ) : null}
        ListEmptyComponent={loading ? <ActivityIndicator color={ink} style={styles.emptyLoading} /> : <Text style={[styles.emptyBody, styles.emptyList, { color: muted }]}>No photos or videos yet.</Text>}
        renderItem={({ item }) => <GalleryCell item={item} size={cell} order={selected.findIndex((entry) => entry.id === item.id) + 1} onPress={toggle} />}
      />
    );
  }

  return (
    <View style={styles.flex}>
      {header}
      {body}
      {selected.length && !albumsOpen ? (
        <View style={[styles.sendBar, { paddingBottom: 12 + footerInset }]}>
          <Pressable accessibilityRole="button" accessibilityLabel={`Send ${selected.length} ${selected.length === 1 ? 'item' : 'items'}${hd ? ' in HD' : ''}`} disabled={sending} onPress={send} style={({ pressed }) => [styles.sendButton, pressed && styles.pressed]}>
            {sending ? <ActivityIndicator color="#0E2321" /> : <><Text style={styles.sendText}>Send{selected.length > 1 ? ` ${selected.length}` : ''}</Text><AppIcon name="send" size={17} color="#0E2321" /></>}
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function AlbumTitle({ title, open, onPress, ink }) {
  return (
    <Pressable accessibilityRole="button" accessibilityLabel={`${title}, choose album`} accessibilityState={{ expanded: open }} onPress={onPress} hitSlop={8} style={styles.albumButton}>
      <Text numberOfLines={1} style={[styles.headerTitle, { color: ink }]}>{title}</Text>
      <AppIcon name={open ? 'chevron-up' : 'chevron-down'} size={18} color={ink} />
    </Pressable>
  );
}

function HdToggle({ on, onPress, ink }) {
  return (
    <Pressable accessibilityRole="switch" accessibilityLabel="Send in HD" accessibilityState={{ checked: on }} onPress={onPress} hitSlop={10} style={[styles.hd, { borderColor: ink }, on && { backgroundColor: ink }]}>
      <Text style={[styles.hdText, { color: on ? '#000000' : ink }]}>HD</Text>
    </Pressable>
  );
}

// Full screen, opened from the camera's gallery button.
export function ChatGalleryPicker({ visible, onClose, onSend }) {
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  return (
    <Modal visible={visible} animationType="slide" presentationStyle="fullScreen" statusBarTranslucent onRequestClose={onClose}>
      <View style={[styles.picker, { paddingTop: insets.top }]}>
        <GalleryBrowser
          active={visible}
          dark
          width={width}
          footerInset={insets.bottom}
          onSend={onSend}
          renderHeader={({ title, albumsOpen, onTitle, hd, onHd, ink }) => (
            <View style={styles.pickerHeader}>
              <Pressable accessibilityRole="button" onPress={onClose} hitSlop={10} style={styles.headerSide}><Text style={styles.cancel}>Cancel</Text></Pressable>
              <AlbumTitle title={title} open={albumsOpen} onPress={onTitle} ink={ink} />
              <View style={[styles.headerSide, styles.headerSideEnd]}><HdToggle on={hd} onPress={onHd} ink={ink} /></View>
            </View>
          )}
        />
      </View>
    </Modal>
  );
}

// Under the composer, opened from the chat's gallery button. Drag the handle
// up to expand, or down to close.
export function ChatGallerySheet({ visible, colors, isDark, onClose, onSend }) {
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [expanded, setExpanded] = useState(false);
  const latest = useRef({});
  latest.current = { onClose, expanded };
  const pan = useRef(PanResponder.create({
    onMoveShouldSetPanResponder: (_, gesture) => Math.abs(gesture.dy) > 8,
    onPanResponderRelease: (_, gesture) => {
      if (gesture.dy < -40) setExpanded(true);
      else if (gesture.dy > 40 && latest.current.expanded) setExpanded(false);
      else if (gesture.dy > 40) latest.current.onClose();
    },
  })).current;
  useEffect(() => { if (!visible) setExpanded(false); }, [visible]);
  if (!visible) return null;
  const surface = isDark ? '#1C1C1E' : colors.surface;
  return (
    <View style={[styles.sheet, { height: Math.round(height * (expanded ? 0.82 : 0.46)), backgroundColor: surface, borderColor: colors.line }]}>
      <GalleryBrowser
        active={visible}
        dark={isDark}
        colors={colors}
        width={width}
        footerInset={insets.bottom}
        onSend={onSend}
        renderHeader={({ title, albumsOpen, onTitle, hd, onHd, ink }) => (
          <View {...pan.panHandlers}>
            <Pressable accessibilityRole="button" accessibilityLabel={expanded ? 'Show less' : 'Show more photos'} onPress={() => setExpanded((open) => !open)} style={styles.handleArea}>
              <View style={[styles.handle, { backgroundColor: isDark ? 'rgba(255,255,255,.35)' : colors.line }]} />
            </Pressable>
            <View style={styles.sheetHeader}>
              <Pressable accessibilityRole="button" accessibilityLabel="Close photos" onPress={onClose} hitSlop={10} style={styles.headerSide}><AppIcon name="close" size={24} color={ink} /></Pressable>
              <AlbumTitle title={title} open={albumsOpen} onPress={onTitle} ink={ink} />
              <View style={[styles.headerSide, styles.headerSideEnd]}><HdToggle on={hd} onPress={onHd} ink={ink} /></View>
            </View>
          </View>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  picker: { flex: 1, backgroundColor: '#000000' },
  pickerHeader: { height: 56, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  sheet: { borderTopLeftRadius: 18, borderTopRightRadius: 18, borderTopWidth: StyleSheet.hairlineWidth, overflow: 'hidden' },
  handleArea: { alignItems: 'center', paddingTop: 8, paddingBottom: 4 },
  handle: { width: 40, height: 5, borderRadius: 3 },
  sheetHeader: { height: 48, paddingHorizontal: 16, flexDirection: 'row', alignItems: 'center' },
  headerSide: { width: 72, justifyContent: 'center' },
  headerSideEnd: { alignItems: 'flex-end' },
  cancel: { color: '#4DA3FF', fontSize: 17 },
  albumButton: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4 },
  headerTitle: { maxWidth: '85%', fontSize: 17, fontWeight: '700' },
  hd: { paddingHorizontal: 5, paddingVertical: 1, borderRadius: 5, borderWidth: 1.8 },
  hdText: { fontSize: 12, fontWeight: '900', letterSpacing: 0.3 },
  grid: { gap: 2 },
  gridRow: { gap: 2 },
  cellSelected: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(255,255,255,.28)' },
  cellCheck: { position: 'absolute', top: 6, right: 6, width: 24, height: 24, borderRadius: 12, borderWidth: 1.5, borderColor: '#FFFFFF', backgroundColor: 'rgba(0,0,0,.2)', alignItems: 'center', justifyContent: 'center' },
  cellCheckOn: { borderColor: '#D6E94A', backgroundColor: '#D6E94A' },
  cellCheckText: { color: '#0E2321', fontSize: 13, fontWeight: '800' },
  cellDuration: { position: 'absolute', right: 6, bottom: 5, color: '#FFFFFF', fontSize: 12, fontWeight: '700', textShadowColor: 'rgba(0,0,0,.6)', textShadowRadius: 3 },
  albumRow: { minHeight: 52, paddingHorizontal: 20, flexDirection: 'row', alignItems: 'center', gap: 10 },
  albumTitle: { flex: 1, fontSize: 16, fontWeight: '600' },
  albumCount: { fontSize: 14 },
  limited: { paddingHorizontal: 14, paddingVertical: 10, flexDirection: 'row', alignItems: 'center', gap: 10 },
  limitedText: { flex: 1, fontSize: 13 },
  limitedAction: { color: '#4DA3FF', fontSize: 14, fontWeight: '700' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 10, paddingHorizontal: 36 },
  emptyTitle: { fontSize: 17, fontWeight: '800', textAlign: 'center' },
  emptyBody: { fontSize: 14, lineHeight: 20, textAlign: 'center' },
  emptyList: { marginTop: 40 },
  emptyLoading: { marginTop: 40 },
  emptyButton: { marginTop: 8, paddingHorizontal: 22, paddingVertical: 12, borderRadius: 24, backgroundColor: '#D6E94A' },
  emptyButtonText: { color: '#0E2321', fontSize: 15, fontWeight: '800' },
  sendBar: { position: 'absolute', left: 0, right: 0, bottom: 0, paddingTop: 12, paddingHorizontal: 16, alignItems: 'flex-end' },
  sendButton: { minWidth: 110, height: 48, paddingHorizontal: 22, borderRadius: 24, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, backgroundColor: '#D6E94A' },
  sendText: { color: '#0E2321', fontSize: 16, fontWeight: '800' },
});
