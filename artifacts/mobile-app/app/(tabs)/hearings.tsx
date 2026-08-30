import React from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { usePersistedFilter } from '@/hooks/usePersistedFilter';
import { useColors } from '@/hooks/useColors';
import { useListHearings, useUpdateHearing, getListHearingsQueryKey } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { Feather } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import type { Hearing } from '@workspace/api-client-react';
import { useFocusEffect } from 'expo-router';

const FILTER_STORAGE_KEY = 'hearings_active_filter';
const FILTER_VALID_VALUES = ['all', 'upcoming', 'unregistered', 'postponed'] as const;

const ATTENDANCE_LABELS: Record<string, string> = {
  ATTENDED: 'حضر',
  ABSENT: 'غاب',
  POSTPONED: 'مؤجل',
};

const ATTENDANCE_COLORS: Record<string, string> = {
  ATTENDED: '#22C55E',
  ABSENT: '#EF4444',
  POSTPONED: '#F59E0B',
};

const ATTENDANCE_ICONS: Record<string, string> = {
  ATTENDED: 'check-circle',
  ABSENT: 'x-circle',
  POSTPONED: 'clock',
};

// ─── Attendance Sheet ────────────────────────────────────────────────────────

function AttendanceSheet({
  visible,
  hearing,
  colors,
  onClose,
  onSelect,
  isLoading,
}: {
  visible: boolean;
  hearing: Hearing | null;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  onSelect: (value: string) => void;
  isLoading: boolean;
}) {
  const insets = useSafeAreaInsets();

  const options = [
    { value: 'ATTENDED', label: 'حضر', icon: 'check-circle' as const, color: '#22C55E' },
    { value: 'ABSENT', label: 'غاب', icon: 'x-circle' as const, color: '#EF4444' },
    { value: 'POSTPONED', label: 'مؤجل', icon: 'clock' as const, color: '#F59E0B' },
  ];

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <Pressable
        style={sheet.overlay}
        onPress={onClose}
      />
      <View
        style={[
          sheet.container,
          {
            backgroundColor: colors.card,
            borderColor: colors.border,
            paddingBottom: insets.bottom + 16,
          },
        ]}
      >
        {/* Handle */}
        <View style={[sheet.handle, { backgroundColor: colors.border }]} />

        {/* Title */}
        <Text style={[sheet.title, { color: colors.foreground }]}>
          تسجيل الحضور
        </Text>
        {hearing && (
          <Text style={[sheet.subtitle, { color: colors.mutedForeground }]}>
            قضية #{hearing.caseId} — {hearing.hijriDate}
          </Text>
        )}

        {/* Options */}
        <View style={sheet.optionsRow}>
          {options.map((opt) => {
            const isSelected = hearing?.attendance === opt.value;
            return (
              <TouchableOpacity
                key={opt.value}
                style={[
                  sheet.optionBtn,
                  {
                    backgroundColor: isSelected ? opt.color + '20' : colors.background,
                    borderColor: isSelected ? opt.color : colors.border,
                  },
                ]}
                onPress={() => onSelect(opt.value)}
                disabled={isLoading}
                activeOpacity={0.7}
              >
                <Feather
                  name={opt.icon}
                  size={26}
                  color={isSelected ? opt.color : colors.mutedForeground}
                />
                <Text
                  style={[
                    sheet.optionLabel,
                    { color: isSelected ? opt.color : colors.foreground },
                  ]}
                >
                  {opt.label}
                </Text>
                {isLoading && isSelected && (
                  <ActivityIndicator size="small" color={opt.color} />
                )}
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Cancel */}
        <TouchableOpacity
          style={[sheet.cancelBtn, { borderColor: colors.border }]}
          onPress={onClose}
          activeOpacity={0.7}
        >
          <Text style={[sheet.cancelLabel, { color: colors.mutedForeground }]}>
            إلغاء
          </Text>
        </TouchableOpacity>
      </View>
    </Modal>
  );
}

const sheet = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Tajawal_700Bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Tajawal_400Regular',
    textAlign: 'center',
    marginBottom: 20,
  },
  optionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 16,
  },
  optionBtn: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    borderRadius: 14,
    borderWidth: 1.5,
    paddingVertical: 16,
  },
  optionLabel: {
    fontSize: 15,
    fontFamily: 'Tajawal_700Bold',
  },
  cancelBtn: {
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontFamily: 'Tajawal_400Regular',
  },
});

// ─── Report Sheet ─────────────────────────────────────────────────────────────

function ReportSheet({
  visible,
  hearing,
  colors,
  onClose,
  onSave,
  isLoading,
}: {
  visible: boolean;
  hearing: Hearing | null;
  colors: ReturnType<typeof useColors>;
  onClose: () => void;
  onSave: (report: string, notes: string) => void;
  isLoading: boolean;
}) {
  const insets = useSafeAreaInsets();
  const [reportText, setReportText] = React.useState('');
  const [notesText, setNotesText] = React.useState('');
  const originalReport = React.useRef('');
  const originalNotes = React.useRef('');

  // Sync text when a new hearing is selected
  React.useEffect(() => {
    if (visible) {
      const initialReport = hearing?.hearingReport ?? '';
      const initialNotes = hearing?.notes ?? '';
      setReportText(initialReport);
      setNotesText(initialNotes);
      originalReport.current = initialReport;
      originalNotes.current = initialNotes;
    }
  }, [visible, hearing?.id]);

  const trimmedReport = reportText.trim();
  const trimmedNotes = notesText.trim();
  const hasChanged =
    trimmedReport !== originalReport.current.trim() ||
    trimmedNotes !== originalNotes.current.trim();
  const isSaveDisabled = isLoading || !hasChanged;

  const handleSave = () => {
    // If the user had a previous report and is now clearing it, ask for confirmation
    if (originalReport.current.trim().length > 0 && trimmedReport.length === 0) {
      Alert.alert(
        'حذف التقرير',
        'سيتم حذف التقرير الحالي. هل أنت متأكد؟',
        [
          { text: 'إلغاء', style: 'cancel' },
          {
            text: 'حذف',
            style: 'destructive',
            onPress: () => onSave('', trimmedNotes),
          },
        ]
      );
      return;
    }
    onSave(trimmedReport, trimmedNotes);
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      >
        <Pressable style={reportSheet.overlay} onPress={onClose} />
        <View
          style={[
            reportSheet.container,
            {
              backgroundColor: colors.card,
              borderColor: colors.border,
              paddingBottom: insets.bottom + 16,
            },
          ]}
        >
          {/* Handle */}
          <View style={[reportSheet.handle, { backgroundColor: colors.border }]} />

          {/* Title */}
          <Text style={[reportSheet.title, { color: colors.foreground }]}>
            تقرير الجلسة وملاحظاتها
          </Text>
          {hearing && (
            <Text style={[reportSheet.subtitle, { color: colors.mutedForeground }]}>
              قضية #{hearing.caseId} — {hearing.hijriDate}
            </Text>
          )}

          {/* Report field */}
          <Text style={[reportSheet.fieldLabel, { color: colors.mutedForeground }]}>
            تقرير الجلسة
          </Text>
          <TextInput
            style={[
              reportSheet.input,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={reportText}
            onChangeText={setReportText}
            placeholder="اكتب تقرير الجلسة هنا…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlign="right"
            textAlignVertical="top"
            editable={!isLoading}
          />

          {/* Notes field */}
          <Text style={[reportSheet.fieldLabel, { color: colors.mutedForeground }]}>
            ملاحظات
          </Text>
          <TextInput
            style={[
              reportSheet.input,
              reportSheet.notesInput,
              {
                backgroundColor: colors.background,
                borderColor: colors.border,
                color: colors.foreground,
              },
            ]}
            value={notesText}
            onChangeText={setNotesText}
            placeholder="أضف ملاحظات إضافية هنا…"
            placeholderTextColor={colors.mutedForeground}
            multiline
            textAlign="right"
            textAlignVertical="top"
            editable={!isLoading}
          />

          {/* Actions */}
          <View style={reportSheet.actions}>
            <TouchableOpacity
              style={[reportSheet.cancelBtn, { borderColor: colors.border }]}
              onPress={onClose}
              activeOpacity={0.7}
              disabled={isLoading}
            >
              <Text style={[reportSheet.cancelLabel, { color: colors.mutedForeground }]}>
                إلغاء
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[
                reportSheet.saveBtn,
                {
                  backgroundColor: colors.primary,
                  opacity: isSaveDisabled ? 0.4 : 1,
                },
              ]}
              onPress={handleSave}
              activeOpacity={0.7}
              disabled={isSaveDisabled}
            >
              {isLoading ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Text style={reportSheet.saveLabel}>حفظ</Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const reportSheet = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
  },
  container: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderTopWidth: 1,
    paddingHorizontal: 20,
    paddingTop: 12,
  },
  handle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    alignSelf: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 17,
    fontFamily: 'Tajawal_700Bold',
    textAlign: 'center',
    marginBottom: 4,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: 'Tajawal_400Regular',
    textAlign: 'center',
    marginBottom: 16,
  },
  fieldLabel: {
    fontSize: 12,
    fontFamily: 'Tajawal_700Bold',
    textAlign: 'right',
    marginBottom: 6,
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 14,
    fontFamily: 'Tajawal_400Regular',
    minHeight: 100,
    marginBottom: 12,
  },
  notesInput: {
    minHeight: 80,
    marginBottom: 16,
  },
  actions: {
    flexDirection: 'row',
    gap: 10,
  },
  cancelBtn: {
    flex: 1,
    borderRadius: 12,
    borderWidth: 1,
    paddingVertical: 14,
    alignItems: 'center',
  },
  cancelLabel: {
    fontSize: 15,
    fontFamily: 'Tajawal_400Regular',
  },
  saveBtn: {
    flex: 2,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveLabel: {
    fontSize: 15,
    fontFamily: 'Tajawal_700Bold',
    color: '#fff',
  },
});

// ─── Hearing Card ─────────────────────────────────────────────────────────────

function HearingCard({
  item,
  colors,
  onAttendancePress,
  onReportPress,
}: {
  item: Hearing;
  colors: ReturnType<typeof useColors>;
  onAttendancePress: (hearing: Hearing) => void;
  onReportPress: (hearing: Hearing) => void;
}) {
  const attendanceColor = item.attendance
    ? ATTENDANCE_COLORS[item.attendance] ?? '#6B7280'
    : undefined;

  const utcDate = new Date(item.utcDate);
  const isUpcoming = utcDate >= new Date();

  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: isUpcoming ? colors.primary + '40' : colors.border,
      padding: 16,
      marginBottom: 10,
    },
    topRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      marginBottom: 8,
    },
    dateContainer: {
      backgroundColor: isUpcoming ? colors.primary + '15' : colors.muted,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 4,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    dateText: {
      fontSize: 13,
      fontFamily: 'Tajawal_700Bold',
      color: isUpcoming ? colors.primary : colors.mutedForeground,
    },
    attendanceBadge: {
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
    },
    attendanceText: {
      fontSize: 12,
      fontFamily: 'Tajawal_700Bold',
    },
    caseId: {
      fontSize: 15,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
    },
    report: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 4,
      numberOfLines: 2,
    } as any,
    notes: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 3,
      opacity: 0.75,
    } as any,
    requiresBadge: {
      alignSelf: 'flex-end',
      marginTop: 8,
      backgroundColor: '#F59E0B20',
      borderRadius: 6,
      paddingHorizontal: 8,
      paddingVertical: 3,
    },
    requiresText: {
      fontSize: 11,
      fontFamily: 'Tajawal_700Bold',
      color: '#F59E0B',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 12,
    },
    attendanceRow: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'center',
      gap: 8,
    },
    attendanceHint: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    actionBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.primary + '15',
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    actionBtnText: {
      fontSize: 12,
      fontFamily: 'Tajawal_700Bold',
      color: colors.primary,
    },
    reportBtn: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      backgroundColor: colors.muted,
      borderRadius: 8,
      paddingHorizontal: 10,
      paddingVertical: 6,
    },
    reportBtnText: {
      fontSize: 12,
      fontFamily: 'Tajawal_700Bold',
      color: colors.mutedForeground,
    },
  });

  return (
    <View style={s.card}>
      <View style={s.topRow}>
        {item.attendance ? (
          <TouchableOpacity
            onPress={() => onAttendancePress(item)}
            activeOpacity={0.7}
          >
            <View
              style={[
                s.attendanceBadge,
                { backgroundColor: (attendanceColor ?? '#6B7280') + '20' },
              ]}
            >
              <Feather
                name={ATTENDANCE_ICONS[item.attendance] as any ?? 'help-circle'}
                size={11}
                color={attendanceColor ?? '#6B7280'}
              />
              <Text style={[s.attendanceText, { color: attendanceColor ?? '#6B7280' }]}>
                {ATTENDANCE_LABELS[item.attendance] ?? item.attendance}
              </Text>
            </View>
          </TouchableOpacity>
        ) : (
          <View />
        )}
        <View style={s.dateContainer}>
          <Feather
            name="calendar"
            size={12}
            color={isUpcoming ? colors.primary : colors.mutedForeground}
          />
          <Text style={s.dateText}>{item.hijriDate}</Text>
        </View>
      </View>

      <Text style={s.caseId}>قضية #{item.caseId}</Text>

      {!!item.hearingReport && (
        <Text style={s.report} numberOfLines={2}>
          {item.hearingReport}
        </Text>
      )}

      {!!item.notes && (
        <Text style={s.notes} numberOfLines={1}>
          📝 {item.notes}
        </Text>
      )}

      {item.requiresLawsuitEditing && (
        <View style={s.requiresBadge}>
          <Text style={s.requiresText}>⚠ تعديل لائحة مطلوب</Text>
        </View>
      )}

      {/* Action row */}
      <View style={s.divider} />
      <View style={s.attendanceRow}>
        <TouchableOpacity
          style={s.reportBtn}
          onPress={() => onReportPress(item)}
          activeOpacity={0.7}
        >
          <Feather
            name={item.hearingReport ? 'file-text' : 'plus-circle'}
            size={12}
            color={colors.mutedForeground}
          />
          <Text style={s.reportBtnText}>
            {item.hearingReport ? 'عرض التقرير' : 'إضافة تقرير'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={s.actionBtn}
          onPress={() => onAttendancePress(item)}
          activeOpacity={0.7}
        >
          <Feather name="edit-2" size={12} color={colors.primary} />
          <Text style={s.actionBtnText}>
            {item.attendance ? 'تعديل الحضور' : 'تسجيل الحضور'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

// ─── Filter Bar ───────────────────────────────────────────────────────────────

type FilterKey = 'all' | 'upcoming' | 'unregistered' | 'postponed';

const FILTER_OPTIONS: { key: FilterKey; label: string; icon: string }[] = [
  { key: 'all',          label: 'الكل',        icon: 'list'        },
  { key: 'upcoming',     label: 'قادمة',       icon: 'clock'       },
  { key: 'unregistered', label: 'غير مسجّلة',  icon: 'help-circle' },
  { key: 'postponed',    label: 'مؤجلة',       icon: 'pause-circle'},
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
        const showBadge = count > 0;
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

export default function HearingsScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const flatListRef = React.useRef<FlatList>(null);
  const scrollOffsetRef = React.useRef(0);

  useFocusEffect(
    React.useCallback(() => {
      if (scrollOffsetRef.current > 0) {
        flatListRef.current?.scrollToOffset({
          offset: scrollOffsetRef.current,
          animated: false,
        });
      }
    }, [])
  );

  const { data: hearings, isLoading, refetch } = useListHearings();
  const { mutate: updateHearing, isPending: isUpdating } = useUpdateHearing();

  // Filter state – persisted across app sessions via shared hook
  const [activeFilter, handleFilterChange] = usePersistedFilter<FilterKey>(
    FILTER_STORAGE_KEY,
    'all',
    FILTER_VALID_VALUES
  );

  // Attendance sheet state
  const [selectedHearing, setSelectedHearing] = React.useState<Hearing | null>(null);
  const [sheetVisible, setSheetVisible] = React.useState(false);

  // Report sheet state
  const [reportHearing, setReportHearing] = React.useState<Hearing | null>(null);
  const [reportSheetVisible, setReportSheetVisible] = React.useState(false);
  const [isSavingReport, setIsSavingReport] = React.useState(false);

  const sorted = React.useMemo(() => {
    if (!hearings) return [];
    return [...hearings].sort(
      (a, b) => new Date(a.utcDate).getTime() - new Date(b.utcDate).getTime()
    );
  }, [hearings]);

  const filterCounts = React.useMemo<Record<FilterKey, number>>(() => {
    const now = new Date();
    return {
      all:          sorted.length,
      upcoming:     sorted.filter((h) => new Date(h.utcDate) >= now).length,
      unregistered: sorted.filter((h) => !h.attendance).length,
      postponed:    sorted.filter((h) => h.attendance === 'POSTPONED').length,
    };
  }, [sorted]);

  const filtered = React.useMemo(() => {
    const now = new Date();
    switch (activeFilter) {
      case 'upcoming':
        return sorted.filter((h) => new Date(h.utcDate) >= now);
      case 'unregistered':
        return sorted.filter((h) => !h.attendance);
      case 'postponed':
        return sorted.filter((h) => h.attendance === 'POSTPONED');
      default:
        return sorted;
    }
  }, [sorted, activeFilter]);

  // ── Attendance handlers ──────────────────────────────────────────────────

  const handleAttendancePress = React.useCallback((hearing: Hearing) => {
    setSelectedHearing(hearing);
    setSheetVisible(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const handleAttendanceSelect = React.useCallback(
    (attendance: string) => {
      if (!selectedHearing) return;

      updateHearing(
        { id: selectedHearing.id, data: { attendance } },
        {
          onSuccess: () => {
            setSheetVisible(false);
            setSelectedHearing(null);
            queryClient.invalidateQueries({ queryKey: getListHearingsQueryKey() });
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
          onError: () => {
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
            Alert.alert('خطأ', 'تعذّر تحديث الحضور، يرجى المحاولة مجدداً.');
          },
        }
      );
    },
    [selectedHearing, updateHearing, queryClient]
  );

  // ── Report handlers ──────────────────────────────────────────────────────

  const handleReportPress = React.useCallback((hearing: Hearing) => {
    setReportHearing(hearing);
    setReportSheetVisible(true);
    if (Platform.OS !== 'web') {
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    }
  }, []);

  const handleReportSave = React.useCallback(
    (hearingReport: string, notes: string) => {
      if (!reportHearing) return;
      setIsSavingReport(true);

      updateHearing(
        { id: reportHearing.id, data: { hearingReport, notes } },
        {
          onSuccess: () => {
            setIsSavingReport(false);
            setReportSheetVisible(false);
            setReportHearing(null);
            queryClient.invalidateQueries({ queryKey: getListHearingsQueryKey() });
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
            }
          },
          onError: () => {
            setIsSavingReport(false);
            if (Platform.OS !== 'web') {
              Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
            }
            Alert.alert('خطأ', 'تعذّر حفظ التقرير، يرجى المحاولة مجدداً.');
          },
        }
      );
    },
    [reportHearing, updateHearing, queryClient]
  );

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
    listContent: {
      paddingHorizontal: 16,
      paddingTop: 16,
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 84 : 80),
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

  const emptyMessage =
    activeFilter === 'upcoming'
      ? 'لا توجد جلسات قادمة'
      : activeFilter === 'unregistered'
      ? 'لا توجد جلسات غير مسجّلة'
      : activeFilter === 'postponed'
      ? 'لا توجد جلسات مؤجلة'
      : 'لا توجد جلسات';

  return (
    <View style={s.container}>
      <View style={s.topBar}>
        <Text style={s.title}>الجلسات</Text>
        <Text style={s.subtitle}>
          {filtered.length > 0 ? `${filtered.length} جلسة` : emptyMessage}
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
      ) : (
        <FlatList
          ref={flatListRef}
          data={filtered}
          keyExtractor={(h) => String(h.id)}
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
              <Feather name="calendar" size={40} color={colors.mutedForeground} />
              <Text style={s.emptyText}>{emptyMessage}{'\n'}اسحب للتحديث</Text>
            </View>
          }
          renderItem={({ item }) => (
            <HearingCard
              item={item}
              colors={colors}
              onAttendancePress={handleAttendancePress}
              onReportPress={handleReportPress}
            />
          )}
        />
      )}

      {/* Attendance bottom sheet */}
      <AttendanceSheet
        visible={sheetVisible}
        hearing={selectedHearing}
        colors={colors}
        onClose={() => {
          setSheetVisible(false);
          setSelectedHearing(null);
        }}
        onSelect={handleAttendanceSelect}
        isLoading={isUpdating}
      />

      {/* Report bottom sheet */}
      <ReportSheet
        visible={reportSheetVisible}
        hearing={reportHearing}
        colors={colors}
        onClose={() => {
          setReportSheetVisible(false);
          setReportHearing(null);
        }}
        onSave={handleReportSave}
        isLoading={isSavingReport}
      />
    </View>
  );
}
