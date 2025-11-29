const path = require('path');

require('dotenv').config({
  path: path.resolve(__dirname, '.env'),
});

const baseConfig = require('./app.json');

module.exports = () => ({
  ...baseConfig,
  expo: {
    ...baseConfig.expo,
    extra: {
      ...baseConfig.expo.extra,
      apiUrl: process.env.EXPO_PUBLIC_API_URL,
    },
  },
});
