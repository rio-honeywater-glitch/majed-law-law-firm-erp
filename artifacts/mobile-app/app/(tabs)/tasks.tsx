import React, { useCallback, useRef } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
  Pressable,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useListTasks, useUpdateTask } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { useQueryClient } from '@tanstack/react-query';
import * as Haptics from 'expo-haptics';
import type { Task } from '@workspace/api-client-react';
import { router, useFocusEffect } from 'expo-router';
import { usePersistedFilter } from '@/hooks/usePersistedFilter';

const FILTER_STORAGE_KEY = '@tasks_active_filter';
const FILTER_VALID_VALUES = ['all', 'pending', 'overdue', 'completed'] as const;

function formatDate(dateStr: string | undefined | null) {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  return d.toLocaleDateString('ar-SA', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function isOverdue(dateStr: string | undefined | null) {
  if (!dateStr) return false;
  return new Date(dateStr) < new Date();
}

function TaskItem({
  item,
  colors,
  onToggle,
  onEdit,
}: {
  item: Task;
  colors: ReturnType<typeof useColors>;
  onToggle: (id: number, currentStatus: string) => void;
  onEdit: (item: Task) => void;
}) {
  const done = item.status === 'COMPLETED';
  const overdue = !done && isOverdue(item.dueDate);

  const s = StyleSheet.create({
    card: {
      flexDirection: 'row',
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: done ? colors.border : overdue ? '#EF444440' : colors.border,
      padding: 14,
      marginBottom: 8,
      alignItems: 'center',
      gap: 12,
    },
    checkBtn: {
      width: 26,
      height: 26,
      borderRadius: 13,
      borderWidth: 2,
      borderColor: done ? colors.primary : colors.border,
      backgroundColor: done ? colors.primary : 'transparent',
      alignItems: 'center',
      justifyContent: 'center',
    },
    textCol: {
      flex: 1,
    },
    title: {
      fontSize: 15,
      fontFamily: done ? 'Tajawal_400Regular' : 'Tajawal_700Bold',
      color: done ? colors.mutedForeground : colors.foreground,
      textAlign: 'right',
      textDecorationLine: done ? 'line-through' : 'none',
    },
    meta: {
      flexDirection: 'row',
      justifyContent: 'flex-end',
      alignItems: 'center',
      marginTop: 4,
      gap: 8,
      flexWrap: 'wrap',
    },
    dueDate: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: overdue ? '#EF4444' : colors.mutedForeground,
    },
    overdueLabel: {
      fontSize: 11,
      fontFamily: 'Tajawal_700Bold',
      color: '#EF4444',
    },
    caseBadge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.primary + '18',
      borderRadius: 6,
      paddingHorizontal: 6,
      paddingVertical: 2,
    },
    caseBadgeText: {
      fontSize: 11,
      fontFamily: 'Tajawal_400Regular',
      color: colors.primary,
    },
  });

  function handleCasePress() {
    if (item.caseId) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      router.push({ pathname: '/cases/[id]' as any, params: { id: String(item.caseId) } });
    }
  }

  return (
    <TouchableOpacity
      style={s.card}
      onPress={() => onToggle(item.id, item.status)}
      onLongPress={() => onEdit(item)}
      delayLongPress={400}
      activeOpacity={0.85}
    >
      <View style={s.checkBtn}>
        {done && <Feather name="check" size={14} color={colors.primaryForeground} />}
      </View>
      <View style={s.textCol}>
        <Text style={s.title}>{item.title}</Text>
        <View style={s.meta}>
          {overdue && <Text style={s.overdueLabel}>متأخرة</Text>}
          {!!item.dueDate && (
            <Text style={s.dueDate}>{formatDate(item.dueDate)}</Text>
          )}
          {!!item.caseName && !!item.caseId && (
            <Pressable style={s.caseBadge} onPress={handleCasePress} hitSlop={8}>
              <Feather name="briefcase" size={10} color={colors.primary} />
              <Text style={s.caseBadgeText} numberOfLines={1}>{item.caseName}</Text>
            </Pressable>
          )}
        </View>
      </View>
    </TouchableOpacity>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'pending' | 'overdue' | 'completed';

const FILTER_OPTIONS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all',       label: 'الكل',      icon: 'list'         },
  { key: 'pending',   label: 'معلقة',     icon: 'clock'        },
  { key: 'overdue',   label: 'متأخرة',    icon: 'alert-circle' },
  { key: 'completed', label: 'مكتملة',    icon: 'check-circle' },
];

function FilterBar({
  active,
  onChange,
  counts,
  colors,
}: {
  active: FilterKey;
  onChange: (key: FilterKey) => void;
  counts: Partial<Record<FilterKey, number>>;
  colors: ReturnType<typeof useColors>;
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={filterBar.row}
      style={{ backgroundColor: colors.background }}
    >
      {FILTER_OPTIONS.map((opt) => {
        const isActive = opt.key === active;
        const count = counts[opt.key] ?? 0;
        // "الكل" never shows a badge
        const showBadge = opt.key !== 'all' && count > 0;
        return (
          <TouchableOpacity
            key={opt.key}
            onPress={() => onChange(opt.key)}
            activeOpacity={0.7}
            style={[
              filterBar.chip,
              {
                backgroundColor: isActive ? colors.primary : colors.card,
                borderColor: isActive ? colors.primary : colors.border,
              },
            ]}
          >
            <Feather
              name={opt.icon as any}
              size={13}
              color={isActive ? '#fff' : colors.mutedForeground}
            />
            <Text
              style={[
                filterBar.chipLabel,
                { color: isActive ? '#fff' : colors.foreground },
              ]}
            >
              {opt.label}
            </Text>
            {showBadge && (
              <View
                style={[
                  filterBar.badge,
                  {
                    backgroundColor: isActive
                      ? 'rgba(255,255,255,0.25)'
                      : colors.primary + '20',
                  },
                ]}
              >
                <Text
                  style={[
                    filterBar.badgeText,
                    { color: isActive ? '#fff' : colors.primary },
                  ]}
                >
                  {count}
                </Text>
              </View>
            )}
          </TouchableOpacity>
        );
      })}
    </ScrollView>
  );
}

const filterBar = StyleSheet.create({
  row: {
    flexDirection: 'row',
    paddingHorizontal: 16,
    paddingVertical: 10,
    gap: 8,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 20,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 7,
  },
  chipLabel: {
    fontSize: 13,
    fontFamily: 'Tajawal_700Bold',
  },
  badge: {
    borderRadius: 10,
    minWidth: 20,
    height: 20,
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: {
    fontSize: 11,
    fontFamily: 'Tajawal_700Bold',
    lineHeight: 14,
  },
});

// ─── Main Screen ──────────────────────────────────────────────────────────────

export default function TasksScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
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

  const { data: tasks, isLoading, refetch } = useListTasks();
  const updateTaskMutation = useUpdateTask();

  const [activeFilter, handleFilterChange] = usePersistedFilter<FilterKey>(
    FILTER_STORAGE_KEY,
    'all',
    FILTER_VALID_VALUES
  );

  const toggleTask = useCallback(
    async (id: number, currentStatus: string) => {
      const newStatus = currentStatus === 'COMPLETED' ? 'PENDING' : 'COMPLETED';
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      try {
        await updateTaskMutation.mutateAsync({
          id,
          data: { status: newStatus },
        });
        queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      } catch {
        // ignore
      }
    },
    [updateTaskMutation, queryClient]
  );

  const openEditTask = useCallback(async (task: Task) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    router.push({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      pathname: '/edit-task' as any,
      params: {
        id: String(task.id),
        title: task.title ?? '',
        dueDate: task.dueDate ?? '',
        status: task.status ?? 'PENDING',
      },
    });
  }, []);

  const allTasks = tasks ?? [];
  const pendingTasks = allTasks.filter((t) => t.status !== 'COMPLETED');
  const overdueTasks = allTasks.filter((t) => t.status !== 'COMPLETED' && isOverdue(t.dueDate));
  const completedTasks = allTasks.filter((t) => t.status === 'COMPLETED');

  const filterCounts = React.useMemo<Record<FilterKey, number>>(() => ({
    all:       allTasks.length,
    pending:   pendingTasks.length,
    overdue:   overdueTasks.length,
    completed: completedTasks.length,
  }), [allTasks.length, pendingTasks.length, overdueTasks.length, completedTasks.length]);

  const filteredTasks = React.useMemo(() => {
    switch (activeFilter) {
      case 'pending':   return pendingTasks;
      case 'overdue':   return overdueTasks;
      case 'completed': return completedTasks;
      default:          return allTasks;
    }
  }, [activeFilter, allTasks, pendingTasks, overdueTasks, completedTasks]);

  // For "all" view keep the two-section layout; for filtered views show flat list
  const showSections = activeFilter === 'all';
  const pending = pendingTasks;
  const done = completedTasks;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    topBar: {
      paddingHorizontal: 20,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
      paddingBottom: 14,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
    },
    title: {
      fontSize: 20,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
    },
    subtitle: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 2,
    },
    addBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.primary,
      alignItems: 'center',
      justifyContent: 'center',
    },
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
    },
    sectionLabel: {
      fontSize: 13,
      fontFamily: 'Tajawal_700Bold',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginBottom: 8,
      marginTop: 4,
      paddingHorizontal: 2,
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 16,
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
  });

  interface ListSection {
    type: 'label' | 'item' | 'divider';
    text?: string;
    task?: Task;
    key: string;
  }

  const listData: ListSection[] = [];
  if (showSections) {
    if (pending.length > 0) {
      listData.push({ type: 'label', text: `المهام المعلقة (${pending.length})`, key: 'lbl-pending' });
      pending.forEach((t) => listData.push({ type: 'item', task: t, key: `t-${t.id}` }));
    }
    if (done.length > 0) {
      if (pending.length > 0) listData.push({ type: 'divider', key: 'div' });
      listData.push({ type: 'label', text: `المهام المكتملة (${done.length})`, key: 'lbl-done' });
      done.forEach((t) => listData.push({ type: 'item', task: t, key: `t-${t.id}` }));
    }
  } else {
    filteredTasks.forEach((t) => listData.push({ type: 'item', task: t, key: `t-${t.id}` }));
  }

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        <View style={s.topRow}>
          <TouchableOpacity
            style={s.addBtn}
            onPress={async () => {
              await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              router.push('/create-task' as any);
            }}
            activeOpacity={0.8}
          >
            <Feather name="plus" size={20} color={colors.primaryForeground} />
          </TouchableOpacity>
          <Text style={s.title}>المهام</Text>
        </View>
        <Text style={s.subtitle}>
          {pending.length > 0 ? `${pending.length} مهام معلقة` : 'كل المهام مكتملة ✓'}
        </Text>
      </View>

      <FilterBar
        active={activeFilter}
        onChange={handleFilterChange}
        counts={filterCounts}
        colors={colors}
      />

      {isLoading ? (
        <View style={s.loadingContainer}>
          <ActivityIndicator color={colors.primary} size="large" />
        </View>
      ) : listData.length === 0 ? (
        <View style={s.emptyContainer}>
          <Feather name="check-circle" size={40} color={colors.mutedForeground} />
          <Text style={s.emptyText}>
            {tasks?.length === 0 ? 'لا توجد مهام\nاسحب للتحديث' : 'لا توجد مهام في هذا الفلتر'}
          </Text>
        </View>
      ) : (
        <FlatList
          ref={flatListRef}
          data={listData}
          keyExtractor={(i) => i.key}
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
          renderItem={({ item: row }) => {
            if (row.type === 'label') {
              return <Text style={s.sectionLabel}>{row.text}</Text>;
            }
            if (row.type === 'divider') {
              return <View style={s.divider} />;
            }
            if (row.task) {
              return (
                <TaskItem
                  item={row.task}
                  colors={colors}
                  onToggle={toggleTask}
                  onEdit={openEditTask}
                />
              );
            }
            return null;
          }}
        />
      )}
    </View>
  );
}
