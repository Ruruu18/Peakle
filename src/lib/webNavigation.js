// Keep URLs shareable: carry record IDs, never entire profile/event objects.
export function webNavigationState(state) {
  return {
    ...state,
    routes: state.routes.map((route) => {
      const params = { ...route.params };
      if (route.name === 'PublicProfile') params.userId ||= params.player?.id;
      if (route.name === 'ActivityDetails') {
        params.activityType ||= params.activity?.type;
        params.activityId ||= params.activity?.sourceId;
      }
      return {
        ...route,
        params: Object.fromEntries(Object.entries(params).filter(([, value]) => ['string', 'number', 'boolean'].includes(typeof value))),
        ...(route.state ? { state: webNavigationState(route.state) } : {}),
      };
    }),
  };
}
