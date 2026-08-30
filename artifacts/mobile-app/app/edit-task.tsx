import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useUpdateTask, useDeleteTask, UpdateTaskInputStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

const STATUS_OPTIONS: { label: string; value: UpdateTaskInputStatus }[] = [
  { label: 'معلقة', value: 'PENDING' },
  { label: 'مكتملة', value: 'COMPLETED' },
];

export default function EditTaskSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const updateTask = useUpdateTask();
  const deleteTask = useDeleteTask();

  const params = useLocalSearchParams<{
    id: string;
    title: string;
    dueDate: string;
    status: string;
  }>();

  const taskId = parseInt(params.id ?? '0', 10);

  // Parse existing dueDate
  function parseDateParts(dateStr: string | undefined) {
    if (!dateStr) {
      const today = new Date();
      return {
        day: String(today.getDate()),
        month: String(today.getMonth() + 1),
        year: String(today.getFullYear()),
      };
    }
    const d = new Date(dateStr);
    return {
      day: String(d.getDate()),
      month: String(d.getMonth() + 1),
      year: String(d.getFullYear()),
    };
  }

  const initial = parseDateParts(params.dueDate);

  const [title, setTitle] = useState(params.title ?? '');
  const [day, setDay] = useState(initial.day);
  const [month, setMonth] = useState(initial.month);
  const [year, setYear] = useState(initial.year);
  const [status, setStatus] = useState<UpdateTaskInputStatus>(
    (params.status as UpdateTaskInputStatus) ?? 'PENDING'
  );

  function buildDueDate(): string | null {
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    if (!d || !m || !y || m < 1 || m > 12 || d < 1 || d > 31 || y < 2020) return null;
    // Round-trip validation: JS Date will roll over invalid dates (e.g. Feb 31)
    const candidate = new Date(y, m - 1, d);
    if (
      candidate.getFullYear() !== y ||
      candidate.getMonth() !== m - 1 ||
      candidate.getDate() !== d
    ) {
      return null;
    }
    const mm = String(m).padStart(2, '0');
    const dd = String(d).padStart(2, '0');
    return `${y}-${mm}-${dd}`;
  }

  function handleDelete() {
    Alert.alert(
      'حذف المهمة',
      'هل أنت متأكد من حذف هذه المهمة؟ لا يمكن التراجع عن هذا الإجراء.',
      [
        { text: 'إلغاء', style: 'cancel' },
        {
          text: 'حذف',
          style: 'destructive',
          onPress: async () => {
            try {
              await deleteTask.mutateAsync({ id: taskId });
              await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
              queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
              router.back();
            } catch {
              Alert.alert('خطأ', 'فشل حذف المهمة، يرجى المحاولة مجدداً');
            }
          },
        },
      ]
    );
  }

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('خطأ', 'يرجى إدخال عنوان المهمة');
      return;
    }
    const dueDate = buildDueDate();
    if (!dueDate) {
      Alert.alert('خطأ', 'يرجى إدخال تاريخ صحيح');
      return;
    }
    try {
      await updateTask.mutateAsync({
        id: taskId,
        data: { title: title.trim(), dueDate, status },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      router.back();
    } catch {
      Alert.alert('خطأ', 'فشل تحديث المهمة، يرجى المحاولة مجدداً');
    }
  }

  const s = StyleSheet.create({
    handle: {
      alignSelf: 'center',
      width: 36,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.border,
      marginTop: 12,
      marginBottom: 4,
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    headerTitle: {
      fontSize: 17,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'center',
    },
    cancelBtn: { paddingHorizontal: 4 },
    cancelText: {
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    content: {
      paddingHorizontal: 20,
      paddingTop: 20,
      paddingBottom: insets.bottom + 24,
      gap: 16,
    },
    fieldLabel: {
      fontSize: 13,
      fontFamily: 'Tajawal_700Bold',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginBottom: 6,
    },
    input: {
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.foreground,
      textAlign: 'right',
    },
    dateRow: { flexDirection: 'row', gap: 8 },
    dateField: {
      flex: 1,
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      paddingHorizontal: 8,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.foreground,
      textAlign: 'center',
    },
    dateLabel: {
      fontSize: 11,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'center',
      marginTop: 4,
    },
    statusRow: { flexDirection: 'row', gap: 8 },
    statusChip: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
      alignItems: 'center',
    },
    statusChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    statusChipText: {
      fontSize: 14,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    statusChipTextActive: {
      color: colors.primaryForeground,
      fontFamily: 'Tajawal_700Bold',
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    submitBtnDisabled: { opacity: 0.6 },
    submitText: {
      fontSize: 16,
      fontFamily: 'Tajawal_700Bold',
      color: colors.primaryForeground,
    },
    deleteBtn: {
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 4,
      borderWidth: 1,
      borderColor: '#ef4444',
    },
    deleteBtnDisabled: { opacity: 0.6 },
    deleteText: {
      fontSize: 16,
      fontFamily: 'Tajawal_700Bold',
      color: '#ef4444',
    },
  });

  const isLoading = updateTask.isPending || deleteTask.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Platform.OS !== 'ios' && <View style={s.handle} />}
      <View style={s.header}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>إلغاء</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>تعديل المهمة</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={s.content}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={s.fieldLabel}>العنوان *</Text>
          <TextInput
            style={s.input}
            value={title}
            onChangeText={setTitle}
            placeholder="عنوان المهمة"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            returnKeyType="next"
          />
        </View>

        <View>
          <Text style={s.fieldLabel}>تاريخ الاستحقاق *</Text>
          <View style={s.dateRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={s.dateField}
                value={day}
                onChangeText={(t) => setDay(t.replace(/\D/g, '').slice(0, 2))}
                placeholder="اليوم"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={s.dateLabel}>اليوم</Text>
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                style={s.dateField}
                value={month}
                onChangeText={(t) => setMonth(t.replace(/\D/g, '').slice(0, 2))}
                placeholder="الشهر"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={s.dateLabel}>الشهر</Text>
            </View>
            <View style={{ flex: 2 }}>
              <TextInput
                style={s.dateField}
                value={year}
                onChangeText={(t) => setYear(t.replace(/\D/g, '').slice(0, 4))}
                placeholder="السنة"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={s.dateLabel}>السنة</Text>
            </View>
          </View>
        </View>

        <View>
          <Text style={s.fieldLabel}>الحالة</Text>
          <View style={s.statusRow}>
            {STATUS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[s.statusChip, status === opt.value && s.statusChipActive]}
                onPress={() => setStatus(opt.value)}
                activeOpacity={0.8}
              >
                <Text
                  style={[
                    s.statusChipText,
                    status === opt.value && s.statusChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        <TouchableOpacity
          style={[s.submitBtn, isLoading && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {updateTask.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.submitText}>حفظ التعديلات</Text>
          )}
        </TouchableOpacity>

        <TouchableOpacity
          style={[s.deleteBtn, isLoading && s.deleteBtnDisabled]}
          onPress={handleDelete}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {deleteTask.isPending ? (
            <ActivityIndicator color="#ef4444" />
          ) : (
            <Text style={s.deleteText}>حذف المهمة</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
