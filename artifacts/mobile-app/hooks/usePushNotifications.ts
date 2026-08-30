import { useEffect, useRef } from 'react';
import { Platform } from 'react-native';
import { getAuthToken } from '@/contexts/AuthContext';

/**
 * Registers for Expo push notifications on native platforms (iOS/Android).
 * - Requests notification permission from the user.
 * - Obtains an Expo push token (works in Expo Go; standalone builds require
 *   an EAS project ID configured in app.json extra.eas.projectId).
 * - Registers the token with the API server at POST /push/expo-token.
 * - Sets up a notification-received handler so foreground alerts appear.
 *
 * Skipped on web — expo-notifications has only partial web support.
 * All failures are logged as warnings; the app continues to function.
 */
export function usePushNotifications() {
  const registered = useRef(false);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    if (registered.current) return;

    registerForPushNotifications().catch((err) => {
      console.warn('[Push] Registration failed:', err);
    });
  }, []);
}

async function registerForPushNotifications(): Promise<void> {
  // Dynamic import keeps Metro bundle intact when expo-notifications is absent
  const Notifications = await import('expo-notifications');
  const Constants = (await import('expo-constants')).default;

  // Configure foreground notification behaviour
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });

  // Request permission
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== 'granted') {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== 'granted') {
    console.warn('[Push] Notification permission denied — push disabled');
    return;
  }

  // Resolve project ID: prefer EAS config, fall back to the Expo Go environment.
  // On physical devices with a standalone build, projectId is required.
  const projectId: string | undefined =
    Constants.expoConfig?.extra?.eas?.projectId ??
    Constants.easConfig?.projectId ??
    undefined;

  let expoPushToken: string;
  try {
    const tokenData = await Notifications.getExpoPushTokenAsync(
      projectId ? { projectId } : undefined
    );
    expoPushToken = tokenData.data;
    console.log('[Push] Expo push token obtained:', expoPushToken.slice(0, 40) + '...');
  } catch (err) {
    // In Expo Go this often works without a projectId; in bare builds it fails.
    // Token delivery is implemented as a separate server-side feature (task #67).
    console.warn('[Push] Could not obtain Expo push token:', err);
    return;
  }

  // Register token with the API server
  const authToken = getAuthToken();
  if (!authToken) {
    console.warn('[Push] No auth token — skipping server registration');
    return;
  }

  const res = await fetch(
    `https://${process.env.EXPO_PUBLIC_DOMAIN}/api/push/expo-token`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`,
      },
      body: JSON.stringify({ token: expoPushToken }),
    }
  );

  if (!res.ok) {
    console.warn('[Push] Server token registration failed:', res.status);
  } else {
    console.log('[Push] Token registered with server');
  }
}
