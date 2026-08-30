import React, { useCallback } from 'react';
import {
  ActivityIndicator,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import {
  useGetDashboardSummary,
  useGetUpcomingHearings,
  useGetMissedPushNotifications,
  useAcknowledgeMissedPushNotifications,
} from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { router } from 'expo-router';
import { useQueryClient } from '@tanstack/react-query';
import { MissedPushBanner } from '@/components/MissedPushBanner';

function greetingForTime() {
  const h = new Date().getHours();
  if (h < 12) return 'صباح الخير';
  if (h < 17) return 'مساء الخير';
  return 'مساء النور';
}

function formatHijriDate(hijri: string) {
  return hijri || '—';
}

function caseStatusLabel(status: string) {
  const map: Record<string, string> = {
    UNDER_REVIEW: 'قيد المراجعة',
    APPEAL: 'استئناف',
    EXECUTION: 'تنفيذ',
    CLOSED: 'مغلقة',
  };
  return map[status] ?? status;
}

export default function DashboardScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const {
    data: summary,
    isLoading: summaryLoading,
    refetch: refetchSummary,
  } = useGetDashboardSummary();

  const {
    data: hearings,
    isLoading: hearingsLoading,
    refetch: refetchHearings,
  } = useGetUpcomingHearings({ days: 30 });

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

  const isRefreshing = summaryLoading || hearingsLoading;

  const onRefresh = useCallback(() => {
    refetchSummary();
    refetchHearings();
  }, [refetchSummary, refetchHearings]);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    greeting: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: 'Tajawal_400Regular',
      textAlign: 'right',
    },
    userName: {
      fontSize: 22,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
      marginTop: 2,
    },
    statsRow: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      paddingHorizontal: 12,
      paddingTop: 16,
      gap: 10,
    },
    statCard: {
      flex: 1,
      minWidth: '43%',
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
    },
    statValue: {
      fontSize: 28,
      fontFamily: 'Tajawal_700Bold',
      color: colors.primary,
      textAlign: 'right',
    },
    statLabel: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 2,
    },
    sectionHeader: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 20,
      marginTop: 24,
      marginBottom: 12,
    },
    sectionTitle: {
      fontSize: 17,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
    },
    seeAll: {
      fontSize: 13,
      color: colors.primary,
      fontFamily: 'Tajawal_400Regular',
    },
    hearingCard: {
      marginHorizontal: 16,
      marginBottom: 10,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
    },
    hearingTopRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    hearingDate: {
      fontSize: 13,
      color: colors.primary,
      fontFamily: 'Tajawal_700Bold',
    },
    hearingRequires: {
      backgroundColor: colors.accent,
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    hearingRequiresText: {
      fontSize: 11,
      color: colors.accentForeground,
      fontFamily: 'Tajawal_700Bold',
    },
    hearingCase: {
      fontSize: 14,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
    },
    hearingClient: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 2,
    },
    emptyContainer: {
      alignItems: 'center',
      paddingVertical: 40,
    },
    emptyText: {
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      marginTop: 12,
    },
    bottomPad: {
      height: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
    },
  });

  const stats = [
    { label: 'إجمالي القضايا', value: summary?.totalCases ?? '—' },
    { label: 'القضايا النشطة', value: summary?.activeCases ?? '—' },
    { label: 'جلسات قادمة', value: summary?.upcomingHearingsCount ?? '—' },
    { label: 'إشعارات غير مقروءة', value: summary?.pendingNotifications ?? '—' },
  ];

  return (
    <View style={s.container}>
      <View style={s.header}>
        <Text style={s.greeting}>{greetingForTime()}</Text>
        <Text style={s.userName}>{user?.name ?? user?.email ?? 'مرحباً'}</Text>
      </View>

      {missedPushCount > 0 && (
        <MissedPushBanner
          count={missedPushCount}
          onDismiss={handleDismissMissedPush}
        />
      )}

      <ScrollView
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor={colors.primary}
          />
        }
      >
        {/* Stats */}
        {summaryLoading ? (
          <ActivityIndicator color={colors.primary} style={{ marginTop: 32 }} />
        ) : (
          <View style={s.statsRow}>
            {stats.map((stat) => (
              <View key={stat.label} style={s.statCard}>
                <Text style={s.statValue}>{stat.value}</Text>
                <Text style={s.statLabel}>{stat.label}</Text>
              </View>
            ))}
          </View>
        )}

        {/* Upcoming Hearings */}
        <View style={s.sectionHeader}>
          <TouchableOpacity onPress={() => router.push('/(tabs)/hearings')}>
            <Text style={s.seeAll}>عرض الكل</Text>
          </TouchableOpacity>
          <Text style={s.sectionTitle}>الجلسات القادمة</Text>
        </View>

        {hearingsLoading ? (
          <ActivityIndicator color={colors.primary} />
        ) : !hearings?.length ? (
          <View style={s.emptyContainer}>
            <Feather name="calendar" size={36} color={colors.mutedForeground} />
            <Text style={s.emptyText}>لا توجد جلسات قادمة</Text>
          </View>
        ) : (
          hearings.slice(0, 5).map((h) => (
            <TouchableOpacity
              key={h.id}
              style={s.hearingCard}
              onPress={() => router.push(`/(tabs)/hearings`)}
              activeOpacity={0.8}
            >
              <View style={s.hearingTopRow}>
                {h.requiresLawsuitEditing && (
                  <View style={s.hearingRequires}>
                    <Text style={s.hearingRequiresText}>تعديل مطلوب</Text>
                  </View>
                )}
                <Text style={s.hearingDate}>{formatHijriDate(h.hijriDate)}</Text>
              </View>
              <Text style={s.hearingCase}>
                قضية {h.caseNumber ?? `#${h.caseId}`}
              </Text>
              <Text style={s.hearingClient}>{h.clientName ?? 'موكل'}</Text>
            </TouchableOpacity>
          ))
        )}

        <View style={s.bottomPad} />
      </ScrollView>
    </View>
  );
}
