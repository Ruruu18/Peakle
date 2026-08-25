import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { captureError } from '../services/errorReporting';

const colors = { ink: '#0E2321', optic: '#D6E94A', surface: '#FFFFFF' };

export default class ErrorBoundary extends React.Component {
  state = { error: null };

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    captureError(error, { componentStack: info?.componentStack });
  }

  reset = () => this.setState({ error: null });

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <View style={styles.screen}>
        <Text style={styles.title}>Something went wrong</Text>
        <Text style={styles.detail}>The app hit an unexpected error. It's been reported and we'll look into it.</Text>
        <Pressable onPress={this.reset} style={styles.button}>
          <Text style={styles.buttonText}>Try again</Text>
        </Pressable>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, backgroundColor: colors.ink },
  title: { color: colors.surface, fontSize: 20, fontWeight: '900', textAlign: 'center' },
  detail: { marginTop: 10, color: '#B7C6C1', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  button: { marginTop: 22, height: 48, paddingHorizontal: 24, alignItems: 'center', justifyContent: 'center', borderRadius: 14, backgroundColor: colors.optic },
  buttonText: { color: colors.ink, fontSize: 13, fontWeight: '900' },
});
