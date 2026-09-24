import React from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

// Human-readable labels for each route name used as the browser tab title.
const ROUTE_TITLES = {
  Home: 'Home',
  Book: 'Explore',
  Play: 'Play',
  Team: 'Teams',
  Profile: 'Profile',
  Pickleball: 'Pickleball Hub',
  Activities: 'Activities',
  ActivityDetails: 'Activity Details',
  OpenPlayActivity: 'Open Play',
  Privacy: 'Privacy',
  LegalDocument: 'Legal',
  AccountDeletion: 'Delete Account',
  PaymentHistory: 'Payment History',
  HelpSupport: 'Help & Support',
  SupportChat: 'Support Chat',
  CommunityChat: 'Community Chat',
  NotificationTest: 'Notification Test',
  Inbox: 'Messages',
  DirectChat: 'Direct Chat',
  PublicProfile: 'Player Profile',
  Connections: 'Connections',
  Leaderboard: 'Leaderboard',
  CompetitionDivision: 'Competition Division',
};

function updatePageTitle(routeName) {
  if (typeof document === 'undefined') return;
  const label = ROUTE_TITLES[routeName] || routeName;
  document.title = `${label} | Peakle`;
}

export function BrowserScene({ children, route }) {
  const focused = useIsFocused();
  // Preserve match state while excluding inactive scenes from all focus paths.
  return (
    <View
      dataSet={{ browserScene: route.key, screen: route.name }}
      tabIndex={-1}
      inert={!focused}
      style={{ flex: 1, display: focused ? 'flex' : 'none' }}
    >
      {children}
    </View>
  );
}

export class BrowserNavigationLayout extends React.Component {
  container = React.createRef();

  componentDidMount() {
    // Set the title for the initial route on first load.
    const currentRoute = this.props.state.routes[this.props.state.index];
    updatePageTitle(currentRoute.name);
  }

  getSnapshotBeforeUpdate(previousProps) {
    const previousKey = previousProps.state.routes[previousProps.state.index].key;
    const nextKey = this.props.state.routes[this.props.state.index].key;
    if (previousKey === nextKey) return false;

    const activeElement = this.container.current?.ownerDocument.activeElement;
    const scene = activeElement?.closest('[data-browser-scene]');
    if (!this.container.current?.contains(scene) || scene.dataset.browserScene !== previousKey) return false;

    // React Navigation sets aria-hidden during DOM updates. Effects and route
    // blur listeners run too late; release focus before that mutation happens.
    activeElement.blur();
    return true;
  }

  componentDidUpdate(previousProps, _previousState, shouldMoveFocus) {
    const previousIndex = previousProps.state.index;
    const nextIndex = this.props.state.index;

    // Update the browser tab title whenever the active route changes.
    if (previousIndex !== nextIndex || previousProps.state.routes[previousIndex]?.name !== this.props.state.routes[nextIndex]?.name) {
      const currentRoute = this.props.state.routes[nextIndex];
      updatePageTitle(currentRoute.name);
    }

    const container = this.container.current;
    if (!shouldMoveFocus || container.ownerDocument.activeElement !== container.ownerDocument.body) return;

    // Preserve focus in the tab bar or an autofocus control. When the old
    // scene owned focus, start keyboard navigation at the newly visible scene.
    const focusedKey = this.props.state.routes[nextIndex].key;
    const scene = [...container.querySelectorAll('[data-browser-scene]')]
      .find((element) => element.dataset.browserScene === focusedKey);
    scene?.focus({ preventScroll: true });
  }

  render() {
    return <View ref={this.container} style={{ flex: 1 }}>{this.props.children}</View>;
  }
}
