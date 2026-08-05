import { useEffect, useMemo, useState } from 'react';
import { listDrivingRouteDistances } from '../services/routeDistance';

function coordinatesKey(value) {
  return [value?.latitude, value?.longitude].every(Number.isFinite)
    ? `${value.latitude.toFixed(5)},${value.longitude.toFixed(5)}`
    : '';
}

export default function useDrivingDistances(origin, destinations = []) {
  const requestKey = useMemo(() => [
    coordinatesKey(origin),
    ...destinations.map((destination) => `${destination.id}:${coordinatesKey(destination)}`),
  ].join('|'), [destinations, origin]);
  const [state, setState] = useState({ requestKey: '', routes: {}, loading: false, error: '' });

  useEffect(() => {
    let active = true;
    if (!coordinatesKey(origin) || !destinations.length) {
      setState({ requestKey, routes: {}, loading: false, error: '' });
      return () => { active = false; };
    }
    setState({ requestKey, routes: {}, loading: true, error: '' });
    listDrivingRouteDistances(origin, destinations)
      .then((routes) => {
        if (active) setState({ requestKey, routes, loading: false, error: '' });
      })
      .catch((error) => {
        if (active) setState({ requestKey, routes: {}, loading: false, error: error.message || 'Driving routes are unavailable.' });
      });
    return () => { active = false; };
  }, [requestKey]);

  return state.requestKey === requestKey
    ? { routeDistances: state.routes, routesLoading: state.loading, routesError: state.error }
    : { routeDistances: {}, routesLoading: true, routesError: '' };
}

