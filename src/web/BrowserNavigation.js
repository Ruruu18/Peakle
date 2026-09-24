import React from 'react';
import { View } from 'react-native';
import { useIsFocused } from '@react-navigation/native';

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

  componentDidUpdate(_previousProps, _previousState, shouldMoveFocus) {
    const container = this.container.current;
    if (!shouldMoveFocus || container.ownerDocument.activeElement !== container.ownerDocument.body) return;

    // Preserve focus in the tab bar or an autofocus control. When the old
    // scene owned focus, start keyboard navigation at the newly visible scene.
    const focusedKey = this.props.state.routes[this.props.state.index].key;
    const scene = [...container.querySelectorAll('[data-browser-scene]')]
      .find((element) => element.dataset.browserScene === focusedKey);
    scene?.focus({ preventScroll: true });
  }

  render() {
    return <View ref={this.container} style={{ flex: 1 }}>{this.props.children}</View>;
  }
}
