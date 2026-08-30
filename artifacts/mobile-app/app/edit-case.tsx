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
import { useUpdateCase, CaseUpdateStatus } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router, useLocalSearchParams } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';

const STATUS_OPTIONS: { label: string; value: CaseUpdateStatus }[] = [
  { label: 'قيد المراجعة', value: 'UNDER_REVIEW' },
  { label: 'استئناف', value: 'APPEAL' },
  { label: 'تنفيذ', value: 'EXECUTION' },
  { label: 'مغلقة', value: 'CLOSED' },
];

export default function EditCaseSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const updateCase = useUpdateCase();

  const params = useLocalSearchParams<{
    id: string;
    subject: string;
    caseNumber: string;
    status: string;
  }>();

  const caseId = parseInt(params.id ?? '0', 10);

  const [subject, setSubject] = useState(params.subject ?? '');
  const [caseNumber, setCaseNumber] = useState(params.caseNumber ?? '');
  const [status, setStatus] = useState<CaseUpdateStatus>(
    (params.status as CaseUpdateStatus) ?? 'UNDER_REVIEW'
  );

  async function handleSubmit() {
    try {
      await updateCase.mutateAsync({
        id: caseId,
        data: {
          subject: subject.trim() || undefined,
          caseNumber: caseNumber.trim() || undefined,
          status,
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['/api/cases'] });
      router.back();
    } catch {
      Alert.alert('خطأ', 'فشل تحديث القضية، يرجى المحاولة مجدداً');
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
    statusGrid: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      gap: 8,
    },
    statusChip: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
    },
    statusChipActive: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    statusChipText: {
      fontSize: 13,
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
  });

  const isLoading = updateCase.isPending;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Platform.OS !== 'ios' && <View style={s.handle} />}
      <View style={s.header}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>إلغاء</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>تعديل القضية</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={s.content}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        <View>
          <Text style={s.fieldLabel}>موضوع القضية</Text>
          <TextInput
            style={[s.input, { minHeight: 80, textAlignVertical: 'top' }]}
            value={subject}
            onChangeText={setSubject}
            placeholder="موضوع القضية"
            placeholderTextColor={colors.mutedForeground}
            autoFocus
            multiline
            numberOfLines={3}
          />
        </View>

        <View>
          <Text style={s.fieldLabel}>رقم القضية</Text>
          <TextInput
            style={s.input}
            value={caseNumber}
            onChangeText={setCaseNumber}
            placeholder="مثال: 1234/2024"
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        <View>
          <Text style={s.fieldLabel}>حالة القضية</Text>
          <View style={s.statusGrid}>
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
          {isLoading ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={s.submitText}>حفظ التعديلات</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
