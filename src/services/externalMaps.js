import { ActionSheetIOS, Alert, Linking, Platform } from 'react-native';

function destinationValue(destination) {
  const latitude = Number(destination?.latitude);
  const longitude = Number(destination?.longitude);
  const hasCoordinates = Number.isFinite(latitude)
    && Number.isFinite(longitude)
    && latitude >= -90
    && latitude <= 90
    && longitude >= -180
    && longitude <= 180
    && !(latitude === 0 && longitude === 0);
  if (hasCoordinates) return `${latitude},${longitude}`;
  const address = [destination?.address, destination?.area].filter(Boolean).join(', ').trim();
  return address || destination?.name?.trim() || '';
}

function mapUrl(provider, destination) {
  const value = destinationValue(destination);
  const encodedDestination = encodeURIComponent(value);
  const encodedName = encodeURIComponent(destination?.name?.trim() || 'Venue');
  const latitude = Number(destination?.latitude);
  const longitude = Number(destination?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  if (provider === 'system') return hasCoordinates
    ? `geo:${latitude},${longitude}?q=${latitude},${longitude}(${encodedName})`
    : `geo:0,0?q=${encodedDestination}`;
  if (provider === 'apple') return `https://maps.apple.com/?daddr=${encodedDestination}&q=${encodedName}&dirflg=d`;
  if (provider === 'google') return Platform.OS === 'ios'
    ? `comgooglemaps://?daddr=${encodedDestination}&directionsmode=driving`
    : `google.navigation:q=${encodedDestination}&mode=d`;
  return `waze://?${hasCoordinates ? `ll=${latitude},${longitude}` : `q=${encodedDestination}`}&navigate=yes`;
}

function mapFallbackUrl(provider, destination) {
  const value = destinationValue(destination);
  const encodedDestination = encodeURIComponent(value);
  const latitude = Number(destination?.latitude);
  const longitude = Number(destination?.longitude);
  const hasCoordinates = Number.isFinite(latitude) && Number.isFinite(longitude) && !(latitude === 0 && longitude === 0);
  if (provider === 'google') return `https://www.google.com/maps/dir/?api=1&destination=${encodedDestination}&travelmode=driving`;
  if (provider === 'waze') return `https://waze.com/ul?${hasCoordinates ? `ll=${latitude},${longitude}` : `q=${encodedDestination}`}&navigate=yes&utm_source=peakle`;
  return mapUrl(provider, destination);
}

export async function openMapProvider(provider, destination) {
  if (!destinationValue(destination)) {
    Alert.alert('Map location unavailable', 'This venue does not have a usable address or precise map coordinates yet.');
    return;
  }
  try {
    await Linking.openURL(mapUrl(provider, destination));
  } catch {
    try {
      await Linking.openURL(mapFallbackUrl(provider, destination));
    } catch {
      Alert.alert('Could not open maps', 'The selected map service could not be opened on this device.');
    }
  }
}

export async function getAvailableMapProviders() {
  const candidates = Platform.OS === 'ios'
    ? [{ id: 'apple', label: 'Apple Maps', always: true }, { id: 'google', label: 'Google Maps' }, { id: 'waze', label: 'Waze' }]
    : [{ id: 'system', label: 'Phone maps', always: true }, { id: 'google', label: 'Google Maps' }, { id: 'waze', label: 'Waze' }];
  const availability = await Promise.all(candidates.map(async (provider) => {
    if (provider.always) return provider;
    try {
      const sample = { latitude: 14.5995, longitude: 120.9842, name: 'Destination' };
      return await Linking.canOpenURL(mapUrl(provider.id, sample)) ? provider : null;
    } catch {
      return null;
    }
  }));
  return availability.filter(Boolean);
}

export async function showExternalMapOptions(destination) {
  if (!destinationValue(destination)) {
    Alert.alert('Map location unavailable', 'This venue does not have a usable address or precise map coordinates yet.');
    return;
  }
  const title = destination?.name ? `Directions to ${destination.name}` : 'Open directions';
  const providers = await getAvailableMapProviders();
  if (Platform.OS === 'ios') {
    const options = [...providers.map((provider) => provider.label), 'Cancel'];
    ActionSheetIOS.showActionSheetWithOptions({ title, message: 'Choose a navigation app', options, cancelButtonIndex: options.length - 1 }, (index) => {
      const provider = providers[index];
      if (provider) openMapProvider(provider.id, destination);
    });
    return;
  }
  Alert.alert(title, 'Choose an installed navigation app.', [
    ...providers.map((provider) => ({ text: provider.label, onPress: () => openMapProvider(provider.id, destination) })),
    { text: 'Cancel', style: 'cancel' },
  ]);
}
