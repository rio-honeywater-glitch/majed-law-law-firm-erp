import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useCreateTask, useListCases } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import type { Case } from '@workspace/api-client-react';

export default function CreateTaskSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const createTask = useCreateTask();

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');

  // Date fields
  const today = new Date();
  const [day, setDay] = useState(String(today.getDate()));
  const [month, setMonth] = useState(String(today.getMonth() + 1));
  const [year, setYear] = useState(String(today.getFullYear()));
  const [dateError, setDateError] = useState<string | null>(null);

  // Case picker
  const [caseSearch, setCaseSearch] = useState('');
  const [selectedCase, setSelectedCase] = useState<Case | null>(null);
  const [showCaseDropdown, setShowCaseDropdown] = useState(false);

  const { data: cases } = useListCases({ search: caseSearch || undefined });

  /** Validates a date given explicit string arguments (never reads React state). */
  function validateDate(
    rawDay: string,
    rawMonth: string,
    rawYear: string,
  ): string | null {
    const d = parseInt(rawDay, 10);
    const m = parseInt(rawMonth, 10);
    const y = parseInt(rawYear, 10);

    if (
      !rawDay.trim() ||
      !rawMonth.trim() ||
      !rawYear.trim() ||
      isNaN(d) ||
      isNaN(m) ||
      isNaN(y)
    ) {
      return 'يرجى إدخال اليوم والشهر والسنة';
    }
    if (y < 2020 || y > 2100) return 'السنة غير صحيحة';
    if (m < 1 || m > 12) return 'الشهر يجب أن يكون بين 1 و 12';
    if (d < 1 || d > 31) return 'اليوم يجب أن يكون بين 1 و 31';

    // Check that the date actually exists (e.g. no Feb 31)
    const date = new Date(y, m - 1, d);
    if (date.getFullYear() !== y || date.getMonth() !== m - 1 || date.getDate() !== d) {
      return 'التاريخ غير موجود (مثلاً 31 فبراير)';
    }

    // Check not in the past (compare date-only, ignoring time)
    const todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    if (date < todayStart) return 'لا يمكن اختيار تاريخ في الماضي';

    return null; // valid
  }

  function checkDateOnChange(newDay: string, newMonth: string, newYear: string) {
    // Only show errors once all three fields have content
    if (!newDay.trim() || !newMonth.trim() || !newYear.trim()) {
      setDateError(null);
      return;
    }
    setDateError(validateDate(newDay, newMonth, newYear));
  }

  function selectCase(c: Case) {
    setSelectedCase(c);
    const label = c.caseNumber
      ? `${c.caseNumber}${c.subject ? ' – ' + c.subject : ''}`
      : c.subject ?? `قضية #${c.id}`;
    setCaseSearch(label);
    setShowCaseDropdown(false);
  }

  function clearCase() {
    setSelectedCase(null);
    setCaseSearch('');
  }

  async function handleSubmit() {
    if (!title.trim()) {
      Alert.alert('خطأ', 'يرجى إدخال عنوان المهمة');
      return;
    }
    const dateErr = validateDate(day, month, year);
    if (dateErr) {
      setDateError(dateErr);
      return;
    }
    const d = parseInt(day, 10);
    const m = parseInt(month, 10);
    const y = parseInt(year, 10);
    const dueDate: string = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    try {
      await createTask.mutateAsync({
        data: {
          title: title.trim(),
          description: description.trim() || null,
          dueDate,
          caseId: selectedCase?.id ?? null,
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['/api/tasks'] });
      router.back();
    } catch {
      Alert.alert('خطأ', 'فشل إنشاء المهمة، يرجى المحاولة مجدداً');
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
    cancelBtn: {
      paddingHorizontal: 4,
    },
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
    dateRow: {
      flexDirection: 'row',
      gap: 8,
    },
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
    dateErrorText: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.destructive,
      textAlign: 'right',
      marginTop: 6,
    },
    caseSearchContainer: {
      position: 'relative',
    },
    caseInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: selectedCase ? colors.primary : colors.border,
      paddingHorizontal: 14,
      gap: 8,
    },
    caseInput: {
      flex: 1,
      paddingVertical: 12,
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.foreground,
      textAlign: 'right',
    },
    dropdown: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      marginTop: 4,
      maxHeight: 200,
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
      elevation: 4,
      zIndex: 100,
    },
    dropdownItem: {
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    dropdownItemText: {
      fontSize: 15,
      fontFamily: 'Tajawal_400Regular',
      color: colors.foreground,
      textAlign: 'right',
    },
    dropdownItemSub: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginTop: 2,
    },
    submitBtn: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 14,
      alignItems: 'center',
      marginTop: 8,
    },
    submitBtnDisabled: {
      opacity: 0.6,
    },
    submitText: {
      fontSize: 16,
      fontFamily: 'Tajawal_700Bold',
      color: colors.primaryForeground,
    },
  });

  const isLoading = createTask.isPending;
  const filteredCases = cases ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Platform.OS !== 'ios' && <View style={s.handle} />}
      <View style={s.header}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>إلغاء</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>مهمة جديدة</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={s.content}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        {/* Title */}
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

        {/* Description */}
        <View>
          <Text style={s.fieldLabel}>الوصف (اختياري)</Text>
          <TextInput
            style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={description}
            onChangeText={setDescription}
            placeholder="وصف المهمة..."
            placeholderTextColor={colors.mutedForeground}
            multiline
            numberOfLines={3}
          />
        </View>

        {/* Due date */}
        <View>
          <Text style={s.fieldLabel}>تاريخ الاستحقاق *</Text>
          <View style={s.dateRow}>
            <View style={{ flex: 1 }}>
              <TextInput
                style={[s.dateField, dateError ? { borderColor: colors.destructive } : null]}
                value={day}
                onChangeText={(t) => {
                  const v = t.replace(/\D/g, '').slice(0, 2);
                  setDay(v);
                  checkDateOnChange(v, month, year);
                }}
                placeholder="اليوم"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={s.dateLabel}>اليوم</Text>
            </View>
            <View style={{ flex: 1 }}>
              <TextInput
                style={[s.dateField, dateError ? { borderColor: colors.destructive } : null]}
                value={month}
                onChangeText={(t) => {
                  const v = t.replace(/\D/g, '').slice(0, 2);
                  setMonth(v);
                  checkDateOnChange(day, v, year);
                }}
                placeholder="الشهر"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={2}
              />
              <Text style={s.dateLabel}>الشهر</Text>
            </View>
            <View style={{ flex: 2 }}>
              <TextInput
                style={[s.dateField, dateError ? { borderColor: colors.destructive } : null]}
                value={year}
                onChangeText={(t) => {
                  const v = t.replace(/\D/g, '').slice(0, 4);
                  setYear(v);
                  checkDateOnChange(day, month, v);
                }}
                placeholder="السنة"
                placeholderTextColor={colors.mutedForeground}
                keyboardType="number-pad"
                maxLength={4}
              />
              <Text style={s.dateLabel}>السنة</Text>
            </View>
          </View>
          {dateError ? (
            <Text style={s.dateErrorText}>{dateError}</Text>
          ) : null}
        </View>

        {/* Case picker */}
        <View>
          <Text style={s.fieldLabel}>القضية (اختياري)</Text>
          <View style={s.caseSearchContainer}>
            <View style={s.caseInputRow}>
              {selectedCase && (
                <TouchableOpacity onPress={clearCase}>
                  <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
              <TextInput
                style={s.caseInput}
                value={caseSearch}
                onChangeText={(t) => {
                  setCaseSearch(t);
                  setSelectedCase(null);
                  setShowCaseDropdown(t.length > 0);
                }}
                onFocus={() =>
                  setShowCaseDropdown(caseSearch.length > 0 || filteredCases.length > 0)
                }
                placeholder="ابحث عن القضية..."
                placeholderTextColor={colors.mutedForeground}
              />
              <Feather name="search" size={16} color={colors.mutedForeground} />
            </View>

            {showCaseDropdown && filteredCases.length > 0 && (
              <View style={s.dropdown}>
                <FlatList
                  data={filteredCases.slice(0, 6)}
                  keyExtractor={(c) => String(c.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: c }) => {
                    const mainLabel = c.caseNumber
                      ? `${c.caseNumber}${c.subject ? ' – ' + c.subject : ''}`
                      : c.subject ?? `قضية #${c.id}`;
                    return (
                      <TouchableOpacity
                        style={s.dropdownItem}
                        onPress={() => selectCase(c)}
                      >
                        <Text style={s.dropdownItemText}>{mainLabel}</Text>
                        {!!c.clientName && (
                          <Text style={s.dropdownItemSub}>{c.clientName}</Text>
                        )}
                      </TouchableOpacity>
                    );
                  }}
                />
              </View>
            )}
          </View>
        </View>

        <TouchableOpacity
          style={[s.submitBtn, isLoading && s.submitBtnDisabled]}
          onPress={handleSubmit}
          disabled={isLoading}
          activeOpacity={0.8}
        >
          {isLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.submitText}>إضافة المهمة</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
