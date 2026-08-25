module.exports = ({ config }) => {
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON;
  if (process.env.EAS_BUILD_PROFILE === 'production' && !googleServicesFile) {
    throw new Error('Production Android builds require the GOOGLE_SERVICES_JSON EAS file secret.');
  }

  return {
    ...config,
    android: {
      ...config.android,
      ...(googleServicesFile ? { googleServicesFile } : {}),
    },
  };
};
