import React, { createContext, useContext, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import Modal from './ResponsiveModal';
import AppIcon from './AppIcon';
import ProfilePhoto from './ProfilePhoto';
import { webDialog } from '../utils/webLayout';
import { useAuth } from '../context/AuthContext';
import { DARK_CONTENT_COLORS, LIGHT_CONTENT_COLORS, useTheme } from '../context/ThemeContext';
import useDesktopLayout from '../hooks/useDesktopLayout';
import { APP_VERSION_LABEL } from '../config/appInfo';

// On web, Profile leaves the tab bar: the player's avatar opens this menu and
// Chats takes the freed tab. Native keeps its Profile tab until this ships there.
export const ACCOUNT_MENU_NAV = Platform.OS === 'web';

const AccountMenuContext = createContext({ open: false, setOpen: () => {} });

export function AccountMenuProvider({ children }) {
  const [open, setOpen] = useState(false);
  const value = useMemo(() => ({ open, setOpen }), [open]);
  return <AccountMenuContext.Provider value={value}>{children}</AccountMenuContext.Provider>;
}

export function useAccountMenu() {
  return useContext(AccountMenuContext);
}

// Screen-header trigger. Desktop opens the menu from the sidebar footer instead.
export function HeaderAvatar({ size = 38, style }) {
  const { setOpen } = useAccountMenu();
  const { user } = useAuth();
  const desktop = useDesktopLayout();
  if (!ACCOUNT_MENU_NAV || desktop) return null;
  const name = user?.name?.trim() || 'Player';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Open your account menu"
      hitSlop={6}
      onPress={() => setOpen(true)}
      style={({ pressed }) => [{ borderRadius: size / 2 }, pressed && styles.pressed, style]}
    >
      <ProfilePhoto photo={user?.picture || user?.avatar} name={name} size={size} />
    </Pressable>
  );
}

export const ACCOUNT_MENU_ITEMS = [
  { key: 'matches', label: 'Match history', icon: 'stats-chart-outline', route: 'Profile', params: () => ({ openTab: 'Matches', openTabToken: Date.now() }) },
  { key: 'ratings', label: 'Ratings', icon: 'ribbon-outline', route: 'Pickleball', params: () => ({ openTab: 'Ratings', ownerTab: 'Profile' }) },
  { key: 'connections', label: 'Followers & following', icon: 'people-circle-outline', route: 'Connections', params: () => ({ initialTab: 'Followers', openToken: Date.now() }) },
  { key: 'settings', label: 'Settings', icon: 'settings-outline', route: 'Profile', params: () => ({ openTab: 'Settings', openTabToken: Date.now() }) },
  { key: 'help', label: 'Help & support', icon: 'help-circle-outline', route: 'HelpSupport', params: () => undefined },
];

// Rendered once by the tab bar so navigation passes through its leave-match guard.
export function AccountMenuSheet({ onNavigate, onSignOut }) {
  const { open, setOpen } = useAccountMenu();
  const { user } = useAuth();
  const { isDark } = useTheme();
  const desktop = useDesktopLayout();
  const insets = useSafeAreaInsets();
  const colors = isDark ? DARK_CONTENT_COLORS : LIGHT_CONTENT_COLORS;
  const surface = isDark ? '#17302D' : colors.surface;
  const name = user?.name?.trim() || 'Player';
  const close = () => setOpen(false);
  const go = (route, params) => { close(); onNavigate(route, params); };
  const meta = [user?.skill ? `${user.skill} rating` : 'Unrated', user?.location].filter(Boolean).join(' · ');

  return (
    <Modal visible={open} transparent animationType={desktop ? 'fade' : 'slide'} statusBarTranslucent onRequestClose={close}>
      <View {...webDialog('backdrop')} style={styles.backdrop}>
        <Pressable accessibilityLabel="Close account menu" onPress={close} style={StyleSheet.absoluteFill} />
        <View {...webDialog('surface')} accessibilityViewIsModal style={[styles.sheet, { backgroundColor: colors.paper, paddingBottom: Math.max(insets.bottom, 16) }]}>
          {!desktop ? <View style={[styles.grabber, { backgroundColor: colors.line }]} /> : null}
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="View your player profile"
            onPress={() => go('Profile', { openTab: 'Overview', openTabToken: Date.now() })}
            style={({ pressed, hovered }) => [styles.identity, { backgroundColor: surface, borderColor: colors.line }, (pressed || hovered) && styles.pressed]}
          >
            <ProfilePhoto photo={user?.picture || user?.avatar} name={name} size={52} />
            <View style={styles.identityCopy}>
              <Text numberOfLines={1} style={[styles.name, { color: colors.ink }]}>{name}</Text>
              <Text numberOfLines={1} style={[styles.meta, { color: colors.ink40 }]}>{meta}</Text>
              <Text style={[styles.viewProfile, { color: colors.teal }]}>View profile</Text>
            </View>
            <AppIcon name="chevron-forward" size={18} color={colors.ink40} />
          </Pressable>
          <View style={[styles.list, { backgroundColor: surface, borderColor: colors.line }]}>
            {ACCOUNT_MENU_ITEMS.map((item, index) => (
              <Pressable
                key={item.key}
                accessibilityRole="button"
                onPress={() => go(item.route, item.params())}
                style={({ pressed, hovered }) => [styles.row, index > 0 && [styles.rowBorder, { borderColor: colors.line }], (pressed || hovered) && { backgroundColor: colors.tealWash }]}
              >
                <AppIcon name={item.icon} size={20} color={colors.teal} />
                <Text style={[styles.rowLabel, { color: colors.ink }]}>{item.label}</Text>
                <AppIcon name="chevron-forward" size={16} color={colors.ink40} />
              </Pressable>
            ))}
          </View>
          <Pressable
            accessibilityRole="button"
            onPress={() => { close(); onSignOut(); }}
            style={({ pressed, hovered }) => [styles.row, styles.logOut, { backgroundColor: surface, borderColor: colors.line }, (pressed || hovered) && { backgroundColor: colors.brickWash }]}
          >
            <AppIcon name="log-out-outline" size={20} color={colors.brick} />
            <Text style={[styles.rowLabel, { color: colors.brick }]}>Log out</Text>
          </Pressable>
          <Text selectable style={[styles.version, { color: colors.ink40 }]}>{APP_VERSION_LABEL}</Text>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  pressed: { opacity: 0.82 },
  backdrop: { flex: 1, justifyContent: 'flex-end', alignItems: 'center', backgroundColor: 'rgba(14,35,33,.5)' },
  sheet: { width: '100%', maxWidth: 620, paddingHorizontal: 16, paddingTop: 10, borderTopLeftRadius: 28, borderTopRightRadius: 28, gap: 12 },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  identity: { flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, borderWidth: 1, borderRadius: 18 },
  identityCopy: { flex: 1, minWidth: 0 },
  name: { fontSize: 17, fontWeight: '800', letterSpacing: -0.3 },
  meta: { marginTop: 2, fontSize: 12 },
  viewProfile: { marginTop: 4, fontSize: 12, fontWeight: '800' },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 52, paddingHorizontal: 16 },
  rowBorder: { borderTopWidth: StyleSheet.hairlineWidth },
  rowLabel: { flex: 1, fontSize: 15, fontWeight: '700' },
  logOut: { borderWidth: 1, borderRadius: 18 },
  version: { marginTop: 10, textAlign: 'center', fontSize: 11, fontWeight: '600' },
});
