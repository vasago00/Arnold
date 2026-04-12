import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arnold.health',
  appName: 'Arnold',
  webDir: 'dist',
  server: {
    // In development, point to Vite dev server
    // url: 'http://localhost:5173',
    // cleartext: true,
    androidScheme: 'https',
  },
  android: {
    // Minimum SDK 26 required for Health Connect
    minSdkVersion: 26,
  },
  plugins: {
    HealthConnect: {
      // Plugin-specific settings
      syncIntervalMinutes: 15,
    },
  },
};

export default config;
