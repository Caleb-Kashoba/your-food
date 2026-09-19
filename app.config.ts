import type { ExpoConfig, ConfigContext } from 'expo/config';

const APP_VERSION = '1.0.0';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: 'Your Food',
  owner: 'caleb_kashoba',
  slug: 'your-food-admin',
  version: APP_VERSION,
  orientation: 'portrait',
  scheme: 'yourfoodadmin',
  userInterfaceStyle: 'automatic',
  icon: './assets/images/icon-your-food.png',
  ios: {
    supportsTablet: true,
    bundleIdentifier: 'com.yourfood.admin',
    buildNumber: '1',
    infoPlist: {
      ITSAppUsesNonExemptEncryption: false
    }
  },
  android: {
    package: 'com.yourfood.admin',
    versionCode: 1,
    adaptiveIcon: {
      foregroundImage: './assets/images/adaptive-icon-your-food.png',
      backgroundColor: '#FFF7EA'
    }
  },
  web: {
    bundler: 'metro',
    favicon: './assets/images/favicon-your-food.png'
  },
  plugins: [
    'expo-router',
    [
      'expo-splash-screen',
      {
        image: './assets/images/splash-your-food.png',
        imageWidth: 210,
        resizeMode: 'contain',
        backgroundColor: '#FFF7EA',
        dark: {
          backgroundColor: '#35170E'
        }
      }
    ]
  ],
  experiments: {
    typedRoutes: true
  },
  extra: {
    eas: {
      projectId: '9edc5fe3-6ec5-48f5-a874-0ca1a879765a'
    }
  }
});
