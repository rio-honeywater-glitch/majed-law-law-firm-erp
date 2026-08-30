import React, { useState, useRef, useCallback } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useListCases } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { router, useFocusEffect } from 'expo-router';
import type { Case } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';
import { usePersistedFilter } from '@/hooks/usePersistedFilter';

const FILTER_STORAGE_KEY = '@cases_active_filter';
const FILTER_VALID_VALUES = ['all', 'UNDER_REVIEW', 'APPEAL', 'EXECUTION', 'CLOSED'] as const;
type CaseFilterKey = typeof FILTER_VALID_VALUES[number];

const STATUS_FILTERS: { label: string; value: CaseFilterKey }[] = [
  { label: 'الكل', value: 'all' },
  { label: 'قيد المراجعة', value: 'UNDER_REVIEW' },
  { label: 'استئناف', value: 'APPEAL' },
  { label: 'تنفيذ', value: 'EXECUTION' },
  { label: 'مغلقة', value: 'CLOSED' },
];

const STATUS_COLORS: Record<string, string> = {
  UNDER_REVIEW: '#3B82F6',
  APPEAL: '#F59E0B',
  EXECUTION: '#8B5CF6',
  CLOSED: '#6B7280',
};

const STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: 'قيد المراجعة',
  APPEAL: 'استئناف',
  EXECUTION: 'تنفيذ',
  CLOSED: 'مغلقة',
};

const OUTCOME_LABELS: Record<string, string> = {
  WON: 'فاز',
  LOST: 'خسر',
  PENDING: 'جارية',
};

const OUTCOME_COLORS: Record<string, string> = {
  WON: '#22C55E',
  LOST: '#EF4444',
  PENDING: '#F59E0B',
};

function CaseCard({
  item,
  colors,
  onEdit,
}: {
  item: Case;
  colors: ReturnType<typeof useColors>;
  onEdit: (item: Case) => void;
}) {
  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 10,
    },
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 6,
    },
    caseNum: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    statusBadge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    statusText: {
      fontSize: 11,
      fontFamily: 'Tajawal_700Bold',
    },
    clientName: {
      fontSize: 16,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
    },
    subject: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 4,
    },
    outcomeBadge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 2,
      alignSelf: 'flex-end',
      marginTop: 8,
    },
    outcomeText: {
      fontSize: 11,
      fontFamily: 'Tajawal_700Bold',
    },
  });

  const statusColor = STATUS_COLORS[item.status] ?? '#6B7280';
  const outcomeColor = OUTCOME_COLORS[item.outcome] ?? '#6B7280';

  return (
    <TouchableOpacity
      style={s.card}
      onPress={() => router.push(`/cases/${item.id}`)}
      onLongPress={() => onEdit(item)}
      delayLongPress={400}
      activeOpacity={0.85}
    >
      <View style={s.row}>
        <View
          style={[
            s.statusBadge,
            { backgroundColor: statusColor + '20' },
          ]}
        >
          <Text style={[s.statusText, { color: statusColor }]}>
            {STATUS_LABELS[item.status] ?? item.status}
          </Text>
        </View>
        <Text style={s.caseNum}>{item.caseNumber ?? `#${item.id}`}</Text>
      </View>

      <Text style={s.clientName}>{item.clientName ?? 'موكل غير معروف'}</Text>
      {!!item.subject && <Text style={s.subject}>{item.subject}</Text>}

      {item.outcome !== 'PENDING' && (
        <View
          style={[
            s.outcomeBadge,
            { backgroundColor: outcomeColor + '20' },
          ]}
        >
          <Text style={[s.outcomeText, { color: outcomeColor }]}>
            {OUTCOME_LABELS[item.outcome] ?? item.outcome}
          </Text>
        </View>
      )}
    </TouchableOpacity>
  );
}

export default function CasesScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const [search, setSearch] = useState('');
  const flatListRef = useRef<FlatList>(null);
  const scrollOffsetRef = useRef(0);

  useFocusEffect(
    useCallback(() => {
      if (scrollOffsetRef.current > 0) {
        flatListRef.current?.scrollToOffset({
          offset: scrollOffsetRef.current,
          animated: false,
        });
      }
    }, [])
  );

  const [activeFilter, setActiveFilter] = usePersistedFilter<CaseFilterKey>(
    FILTER_STORAGE_KEY,
    'all',
    FILTER_VALID_VALUES
  );

  const { data: cases, isLoading, refetch } = useListCases({
    search: search || undefined,
    status: activeFilter === 'all' ? undefined : activeFilter,
  });

  function openEditCase(item: Case) {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pathname: '/edit-case' as any,
      params: {
        id: String(item.id),
        subject: item.subject ?? '',
        caseNumber: item.caseNumber ?? '',
        status: item.status ?? 'UNDER_REVIEW',
      },
    });
  }

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
      paddingBottom: 12,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      gap: 10,
    },
    titleRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      paddingHorizontal: 4,
    },
    titleText: {
      fontSize: 20,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
    },
    addBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      paddingHorizontal: 12,
      gap: 8,
    },
    searchInput: {
      flex: 1,
      paddingVertical: 11,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: 'Tajawal_400Regular',
      textAlign: 'right',
    },
    filtersRow: {
      flexDirection: 'row-reverse',
    },
    filterChip: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: 20,
      marginLeft: 8,
      backgroundColor: colors.muted,
    },
    filterChipActive: {
      backgroundColor: colors.primary,
    },
    filterChipText: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    filterChipTextActive: {
      color: colors.primaryForeground,
      fontFamily: 'Tajawal_700Bold',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
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
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        <View style={s.titleRow}>
          <TouchableOpacity
            style={s.addBtn}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              router.push('/create-case' as any);
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
          <Text style={s.titleText}>القضايا</Text>
        </View>
        <View style={s.searchRow}>
          <Feather name="search" size={16} color={colors.mutedForeground} />
          <TextInput
            style={s.searchInput}
            value={search}
            onChangeText={setSearch}
            placeholder="بحث في القضايا..."
            placeholderTextColor={colors.mutedForeground}
            autoCorrect={false}
          />
          {!!search && (
            <TouchableOpacity onPress={() => setSearch('')}>
              <Feather name="x" size={16} color={colors.mutedForeground} />
            </TouchableOpacity>
          )}
        </View>

        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={STATUS_FILTERS}
          keyExtractor={(f) => String(f.value)}
          style={s.filtersRow}
          inverted
          renderItem={({ item: f }) => (
            <TouchableOpacity
              style={[
                s.filterChip,
                activeFilter === f.value && s.filterChipActive,
              ]}
              onPress={() => setActiveFilter(f.value)}
            >
              <Text
                style={[
                  s.filterChipText,
                  activeFilter === f.value && s.filterChipTextActive,
                ]}
              >
                {f.label}
              </Text>
            </TouchableOpacity>
          )}
        />
      </View>

      {isLoading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={cases}
          keyExtractor={(c) => String(c.id)}
          contentContainerStyle={s.listContent}
          showsVerticalScrollIndicator={false}
          onScroll={(e) => { scrollOffsetRef.current = e.nativeEvent.contentOffset.y; }}
          scrollEventThrottle={16}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor={colors.primary}
            />
          }
          ListEmptyComponent={
            <View style={s.emptyContainer}>
              <Feather name="briefcase" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>لا توجد قضايا</Text>
            </View>
          }
          renderItem={({ item }) => (
            <CaseCard item={item} colors={colors} onEdit={openEditCase} />
          )}
        />
      )}
    </View>
  );
}
