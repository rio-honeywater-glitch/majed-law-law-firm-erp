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
import { useCreateCase, useListClients } from '@workspace/api-client-react';
import { useQueryClient } from '@tanstack/react-query';
import { router } from 'expo-router';
import * as Haptics from 'expo-haptics';
import { Feather } from '@expo/vector-icons';
import { KeyboardAwareScrollViewCompat } from '@/components/KeyboardAwareScrollViewCompat';
import type { Client } from '@workspace/api-client-react';

const STATUS_OPTIONS = [
  { label: 'قيد المراجعة', value: 'UNDER_REVIEW' },
  { label: 'استئناف', value: 'APPEAL' },
  { label: 'تنفيذ', value: 'EXECUTION' },
  { label: 'مغلقة', value: 'CLOSED' },
];

const CLIENT_ROLE_OPTIONS = [
  { label: 'مدعي', value: 'PLAINTIFF' },
  { label: 'مدعى عليه', value: 'DEFENDANT' },
];

export default function CreateCaseSheet() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const createCase = useCreateCase();

  const [clientSearch, setClientSearch] = useState('');
  const [selectedClient, setSelectedClient] = useState<Client | null>(null);
  const [showClientDropdown, setShowClientDropdown] = useState(false);

  const [subject, setSubject] = useState('');
  const [caseNumber, setCaseNumber] = useState('');
  const [status, setStatus] = useState<string>('UNDER_REVIEW');
  const [clientRole, setClientRole] = useState<string>('PLAINTIFF');

  const { data: clients } = useListClients({
    search: clientSearch || undefined,
  });

  async function handleSubmit() {
    if (!selectedClient) {
      Alert.alert('خطأ', 'يرجى اختيار الموكل');
      return;
    }
    try {
      await createCase.mutateAsync({
        data: {
          clientId: selectedClient.id,
          subject: subject.trim() || undefined,
          caseNumber: caseNumber.trim() || undefined,
          status: status as 'UNDER_REVIEW' | 'APPEAL' | 'EXECUTION' | 'CLOSED',
          clientRole: clientRole as 'PLAINTIFF' | 'DEFENDANT',
        },
      });
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      queryClient.invalidateQueries({ queryKey: ['/api/cases'] });
      router.back();
    } catch {
      Alert.alert('خطأ', 'فشل إنشاء القضية، يرجى المحاولة مجدداً');
    }
  }

  function selectClient(client: Client) {
    setSelectedClient(client);
    setClientSearch(client.name);
    setShowClientDropdown(false);
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
    clientSearchContainer: {
      position: 'relative',
    },
    clientInputRow: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.muted,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: selectedClient ? colors.primary : colors.border,
      paddingHorizontal: 14,
      gap: 8,
    },
    clientInput: {
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
    optionsRow: {
      flexDirection: 'row-reverse',
      flexWrap: 'wrap',
      gap: 8,
    },
    optionChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: 20,
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.muted,
    },
    optionChipActive: {
      borderColor: colors.primary,
      backgroundColor: colors.primary + '15',
    },
    optionChipText: {
      fontSize: 13,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    optionChipTextActive: {
      color: colors.primary,
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

  const isLoading = createCase.isPending;
  const filteredClients = clients ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      {Platform.OS !== 'ios' && <View style={s.handle} />}
      <View style={s.header}>
        <TouchableOpacity style={s.cancelBtn} onPress={() => router.back()}>
          <Text style={s.cancelText}>إلغاء</Text>
        </TouchableOpacity>
        <Text style={s.headerTitle}>قضية جديدة</Text>
        <View style={{ width: 44 }} />
      </View>

      <KeyboardAwareScrollViewCompat
        contentContainerStyle={s.content}
        bottomOffset={80}
        keyboardShouldPersistTaps="handled"
      >
        {/* Client search */}
        <View>
          <Text style={s.fieldLabel}>الموكل *</Text>
          <View style={s.clientSearchContainer}>
            <View style={s.clientInputRow}>
              {selectedClient && (
                <TouchableOpacity
                  onPress={() => {
                    setSelectedClient(null);
                    setClientSearch('');
                  }}
                >
                  <Feather name="x-circle" size={16} color={colors.mutedForeground} />
                </TouchableOpacity>
              )}
              <TextInput
                style={s.clientInput}
                value={clientSearch}
                onChangeText={(t) => {
                  setClientSearch(t);
                  setSelectedClient(null);
                  setShowClientDropdown(t.length > 0);
                }}
                onFocus={() => setShowClientDropdown(clientSearch.length > 0 || filteredClients.length > 0)}
                placeholder="ابحث عن الموكل..."
                placeholderTextColor={colors.mutedForeground}
                autoFocus
              />
              <Feather name="search" size={16} color={colors.mutedForeground} />
            </View>

            {showClientDropdown && filteredClients.length > 0 && (
              <View style={s.dropdown}>
                <FlatList
                  data={filteredClients.slice(0, 6)}
                  keyExtractor={(c) => String(c.id)}
                  keyboardShouldPersistTaps="handled"
                  renderItem={({ item: client }) => (
                    <TouchableOpacity
                      style={s.dropdownItem}
                      onPress={() => selectClient(client)}
                    >
                      <Text style={s.dropdownItemText}>{client.name}</Text>
                      {!!client.phone && (
                        <Text style={s.dropdownItemSub}>{client.phone}</Text>
                      )}
                    </TouchableOpacity>
                  )}
                />
              </View>
            )}
          </View>
        </View>

        {/* Subject */}
        <View>
          <Text style={s.fieldLabel}>موضوع القضية</Text>
          <TextInput
            style={s.input}
            value={subject}
            onChangeText={setSubject}
            placeholder="موضوع القضية..."
            placeholderTextColor={colors.mutedForeground}
          />
        </View>

        {/* Case number */}
        <View>
          <Text style={s.fieldLabel}>رقم القضية</Text>
          <TextInput
            style={s.input}
            value={caseNumber}
            onChangeText={setCaseNumber}
            placeholder="رقم القضية (اختياري)"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="default"
          />
        </View>

        {/* Client role */}
        <View>
          <Text style={s.fieldLabel}>دور الموكل</Text>
          <View style={s.optionsRow}>
            {CLIENT_ROLE_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[s.optionChip, clientRole === opt.value && s.optionChipActive]}
                onPress={() => setClientRole(opt.value)}
              >
                <Text
                  style={[
                    s.optionChipText,
                    clientRole === opt.value && s.optionChipTextActive,
                  ]}
                >
                  {opt.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>
        </View>

        {/* Status */}
        <View>
          <Text style={s.fieldLabel}>حالة القضية</Text>
          <View style={s.optionsRow}>
            {STATUS_OPTIONS.map((opt) => (
              <TouchableOpacity
                key={opt.value}
                style={[s.optionChip, status === opt.value && s.optionChipActive]}
                onPress={() => setStatus(opt.value)}
              >
                <Text
                  style={[
                    s.optionChipText,
                    status === opt.value && s.optionChipTextActive,
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
            <Text style={s.submitText}>إضافة القضية</Text>
          )}
        </TouchableOpacity>
      </KeyboardAwareScrollViewCompat>
    </View>
  );
}
