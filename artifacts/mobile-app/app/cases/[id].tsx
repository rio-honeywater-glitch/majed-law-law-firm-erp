import React from 'react';
import {
  ActivityIndicator,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useGetCase } from '@workspace/api-client-react';
import { Feather } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

const STATUS_LABELS: Record<string, string> = {
  UNDER_REVIEW: 'قيد المراجعة',
  APPEAL: 'استئناف',
  EXECUTION: 'تنفيذ',
  CLOSED: 'مغلقة',
};
const STATUS_COLORS: Record<string, string> = {
  UNDER_REVIEW: '#3B82F6',
  APPEAL: '#F59E0B',
  EXECUTION: '#8B5CF6',
  CLOSED: '#6B7280',
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
const ROLE_LABELS: Record<string, string> = {
  PLAINTIFF: 'مدعي',
  DEFENDANT: 'مدعى عليه',
};

function Section({ title, children, colors }: { title: string; children: React.ReactNode; colors: ReturnType<typeof useColors> }) {
  const s = StyleSheet.create({
    section: {
      marginBottom: 20,
    },
    sectionTitle: {
      fontSize: 14,
      fontFamily: 'Tajawal_700Bold',
      color: colors.mutedForeground,
      textAlign: 'right',
      marginBottom: 10,
      paddingHorizontal: 20,
    },
  });
  return (
    <View style={s.section}>
      <Text style={s.sectionTitle}>{title}</Text>
      {children}
    </View>
  );
}

function InfoRow({ label, value, colors }: { label: string; value: string | null | undefined; colors: ReturnType<typeof useColors> }) {
  if (!value) return null;
  const s = StyleSheet.create({
    row: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    label: {
      fontSize: 14,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
    },
    value: {
      fontSize: 14,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
      flex: 1,
      marginLeft: 12,
    },
  });
  return (
    <View style={s.row}>
      <Text style={s.label}>{label}</Text>
      <Text style={s.value}>{value}</Text>
    </View>
  );
}

export default function CaseDetailScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { id } = useLocalSearchParams<{ id: string }>();

  const caseId = parseInt(id ?? '0', 10);
  const { data: caseDetail, isLoading } = useGetCase(caseId);

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    header: {
      paddingHorizontal: 16,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 8),
      paddingBottom: 16,
      backgroundColor: colors.background,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    backBtn: {
      width: 36,
      height: 36,
      borderRadius: 18,
      backgroundColor: colors.muted,
      alignItems: 'center',
      justifyContent: 'center',
    },
    titleCol: {
      flex: 1,
      alignItems: 'flex-end',
    },
    caseNum: {
      fontSize: 18,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
    },
    clientName: {
      fontSize: 14,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      marginTop: 2,
    },
    badgesRow: {
      flexDirection: 'row',
      paddingHorizontal: 20,
      paddingVertical: 14,
      gap: 8,
      justifyContent: 'flex-end',
    },
    badge: {
      borderRadius: 8,
      paddingHorizontal: 12,
      paddingVertical: 4,
    },
    badgeText: {
      fontSize: 13,
      fontFamily: 'Tajawal_700Bold',
    },
    infoCard: {
      marginHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 20,
    },
    subCard: {
      marginHorizontal: 16,
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: 'hidden',
      marginBottom: 8,
      padding: 14,
    },
    subCardTitle: {
      fontSize: 14,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      textAlign: 'right',
      marginBottom: 4,
    },
    subCardMeta: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: colors.mutedForeground,
      textAlign: 'right',
    },
    loadingContainer: {
      flex: 1,
      alignItems: 'center',
      justifyContent: 'center',
    },
    content: {
      paddingTop: 16,
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 40),
    },
  });

  if (isLoading) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <ActivityIndicator color={colors.primary} size="large" />
      </View>
    );
  }

  if (!caseDetail) {
    return (
      <View style={[s.container, s.loadingContainer]}>
        <Feather name="alert-circle" size={40} color={colors.mutedForeground} />
        <Text style={{ color: colors.mutedForeground, marginTop: 12, fontFamily: 'Tajawal_400Regular' }}>
          لم يتم العثور على القضية
        </Text>
      </View>
    );
  }

  const statusColor = STATUS_COLORS[caseDetail.status] ?? '#6B7280';
  const outcomeColor = OUTCOME_COLORS[caseDetail.outcome] ?? '#6B7280';

  return (
    <View style={s.container}>
      <View style={s.header}>
        <TouchableOpacity style={s.backBtn} onPress={() => router.back()}>
          <Feather name="arrow-left" size={18} color={colors.foreground} />
        </TouchableOpacity>
        <View style={s.titleCol}>
          <Text style={s.caseNum}>
            قضية {caseDetail.caseNumber ?? `#${caseDetail.id}`}
          </Text>
          <Text style={s.clientName}>{caseDetail.clientName ?? 'موكل'}</Text>
        </View>
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <View style={s.content}>
          {/* Badges */}
          <View style={s.badgesRow}>
            <View style={[s.badge, { backgroundColor: statusColor + '20' }]}>
              <Text style={[s.badgeText, { color: statusColor }]}>
                {STATUS_LABELS[caseDetail.status] ?? caseDetail.status}
              </Text>
            </View>
            <View style={[s.badge, { backgroundColor: outcomeColor + '20' }]}>
              <Text style={[s.badgeText, { color: outcomeColor }]}>
                {OUTCOME_LABELS[caseDetail.outcome] ?? caseDetail.outcome}
              </Text>
            </View>
          </View>

          {/* Basic info */}
          <Section title="معلومات القضية" colors={colors}>
            <View style={s.infoCard}>
              <InfoRow label="رقم القضية" value={caseDetail.caseNumber} colors={colors} />
              <InfoRow label="الموكل" value={caseDetail.clientName} colors={colors} />
              <InfoRow label="صفة الموكل" value={caseDetail.clientRole ? ROLE_LABELS[caseDetail.clientRole] : null} colors={colors} />
              <InfoRow label="الخصم" value={caseDetail.opponentName} colors={colors} />
              <InfoRow label="موضوع القضية" value={caseDetail.subject} colors={colors} />
              <InfoRow label="الاختصاص القضائي" value={caseDetail.jurisdiction} colors={colors} />
            </View>
          </Section>

          {/* Hearings */}
          {caseDetail.hearings && caseDetail.hearings.length > 0 && (
            <Section title={`الجلسات (${caseDetail.hearings.length})`} colors={colors}>
              {caseDetail.hearings.map((h) => (
                <View key={h.id} style={s.subCard}>
                  <Text style={s.subCardTitle}>{h.hijriDate}</Text>
                  {h.attendance && (
                    <Text style={s.subCardMeta}>
                      الحضور:{' '}
                      {h.attendance === 'ATTENDED' ? 'حضر' : h.attendance === 'ABSENT' ? 'غاب' : h.attendance}
                    </Text>
                  )}
                  {h.requiresLawsuitEditing && (
                    <Text style={[s.subCardMeta, { color: '#F59E0B' }]}>
                      ⚠ تعديل لائحة مطلوب
                    </Text>
                  )}
                </View>
              ))}
            </Section>
          )}

          {/* Pleadings */}
          {caseDetail.pleadings && caseDetail.pleadings.length > 0 && (
            <Section title={`المرافعات (${caseDetail.pleadings.length})`} colors={colors}>
              {caseDetail.pleadings.map((p) => (
                <View key={p.id} style={s.subCard}>
                  <Text style={s.subCardTitle}>{p.type ?? 'مرافعة'}</Text>
                  {p.content && (
                    <Text style={s.subCardMeta} numberOfLines={3}>
                      {p.content}
                    </Text>
                  )}
                  <Text style={[s.subCardMeta, { marginTop: 4 }]}>
                    الحالة: {p.status === 'SUBMITTED' ? 'مُقدَّمة' : 'مسودة'}
                  </Text>
                </View>
              ))}
            </Section>
          )}

          {/* Executions */}
          {caseDetail.executions && caseDetail.executions.length > 0 && (
            <Section title={`التنفيذات (${caseDetail.executions.length})`} colors={colors}>
              {caseDetail.executions.map((e) => (
                <View key={e.id} style={s.subCard}>
                  <Text style={s.subCardTitle}>
                    {e.executionNumber ?? `تنفيذ #${e.id}`}
                  </Text>
                  <Text style={s.subCardMeta}>
                    المبلغ الإجمالي: {e.totalAmount.toLocaleString('ar-SA')} ر.س
                  </Text>
                  <Text style={s.subCardMeta}>
                    المدفوع: {e.paidAmount.toLocaleString('ar-SA')} ر.س
                  </Text>
                  <Text style={s.subCardMeta}>
                    المتبقي: {e.remainingAmount.toLocaleString('ar-SA')} ر.س
                  </Text>
                </View>
              ))}
            </Section>
          )}
        </View>
      </ScrollView>
    </View>
  );
}
