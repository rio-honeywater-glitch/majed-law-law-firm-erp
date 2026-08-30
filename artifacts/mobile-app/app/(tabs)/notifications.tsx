import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import {
  useListNotifications,
  useMarkAllNotificationsRead,
  useMarkNotificationRead,
  useGetMissedPushNotifications,
  useAcknowledgeMissedPushNotifications,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import type { Notification } from '@workspace/api-client-react';
import { MissedPushBanner } from '@/components/MissedPushBanner';

function timeAgo(dateStr: string) {
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'الآن';
  if (mins < 60) return `منذ ${mins} دقيقة`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `منذ ${hrs} ساعة`;
  const days = Math.floor(hrs / 24);
  return `منذ ${days} يوم`;
}

function NotificationItem({
  item,
  colors,
  onPress,
}: {
  item: Notification;
  colors: ReturnType<typeof useColors>;
  onPress: (id: number, isRead: boolean) => void;
}) {
  const isRead = item.isRead;

  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      backgroundColor: isRead ? colors.background : colors.card,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      padding: 16,
      gap: 12,
      alignItems: 'flex-start',
    },
    dot: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: isRead ? 'transparent' : colors.primary,
      marginTop: 6,
    },
    content: {
      flex: 1,
    },
    message: {
      fontSize: 14,
      fontFamily: isRead ? 'Tajawal_400Regular' : 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
      lineHeight: 20,
    },
    time: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 4,
    },
  });

  return (
    <TouchableOpacity
      style={s.row}
      onPress={() => onPress(item.id, !!isRead)}
      activeOpacity={0.85}
    >
      <View style={s.dot} />
      <View style={s.content}>
        <Text style={s.message}>{item.message}</Text>
        <Text style={s.time}>{timeAgo(item.createdAt)}</Text>
      </View>
    </TouchableOpacity>
  );
}


export default function NotificationsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();

  const { data: notifications, isLoading, refetch } = useListNotifications();
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();

  // Missed push notifications (Expo delivery failures while app was closed)
  const { data: missedPush } = useGetMissedPushNotifications();
  const acknowledgeMissedPush = useAcknowledgeMissedPushNotifications();
  const missedPushCount = missedPush?.count ?? 0;

  const handleDismissMissedPush = useCallback(async () => {
    try {
      await acknowledgeMissedPush.mutateAsync();
      queryClient.invalidateQueries({ queryKey: ['/api/notifications/missed-push'] });
    } catch {
      // ignore — banner will reappear on next open if still pending
    }
  }, [acknowledgeMissedPush, queryClient]);

  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  const handlePress = useCallback(
    async (id: number, isRead: boolean) => {
      if (isRead) return;
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await markRead.mutateAsync({ id });
        queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
      } catch {
        // ignore
      }
    },
    [markRead, queryClient]
  );

  const handleMarkAll = useCallback(async () => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      await markAll.mutateAsync();
      queryClient.invalidateQueries({ queryKey: ['/api/notifications'] });
    } catch {
      // ignore
    }
  }, [markAll, queryClient]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
      paddingBottom: 14,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-end',
    },
    titleCol: {
      alignItems: 'flex-end',
    },
    title: {
      fontSize: 20,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
    },
    subtitle: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      marginTop: 2,
    },
    markAllBtn: {
      paddingHorizontal: 12,
      paddingVertical: 6,
      backgroundColor: colors.muted,
      borderRadius: 8,
    },
    markAllText: {
      fontSize: 12,
      fontFamily: 'Tajawal_700Bold',
      color: colors.primary,
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: 60,
    },
    emptyText: {
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      marginTop: 12,
      textAlign: 'center',
    },
    listFooter: {
      height: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
    },
  });

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        {unreadCount > 0 && (
          <TouchableOpacity style={s.markAllBtn} onPress={handleMarkAll}>
            <Text style={s.markAllText}>قراءة الكل</Text>
          </TouchableOpacity>
        )}
        <View style={s.titleCol}>
          <Text style={s.title}>الإشعارات</Text>
          {unreadCount > 0 && (
            <Text style={s.subtitle}>{unreadCount} غير مقروءة</Text>
          )}
        </View>
      </View>

      {missedPushCount > 0 && (
        <MissedPushBanner
          count={missedPushCount}
          onDismiss={handleDismissMissedPush}
        />
      )}

      {isLoading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          data={notifications ?? []}
          keyExtractor={(n) => String(n.id)}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Feather name="bell" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>لا توجد إشعارات</Text>
            </View>
          }
          ListFooterComponent={<View style={s.listFooter} />}
          renderItem={({ item }) => (
            <NotificationItem
              item={item}
              colors={colors}
              onPress={handlePress}
            />
          )}
        />
      )}
    </View>
  );
}
