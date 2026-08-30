import React from 'react';
import { StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { Feather } from '@expo/vector-icons';
import { useColors } from '@/hooks/useColors';

export function MissedPushBanner({
  count,
  onDismiss,
}: {
  count: number;
  onDismiss: () => void;
}) {
  const colors = useColors();

  const s = StyleSheet.create({
    banner: {
      flexDirection: 'row',
      alignItems: 'center',
      backgroundColor: colors.primary,
      paddingHorizontal: 16,
      paddingVertical: 12,
      gap: 10,
    },
    icon: {
      flexShrink: 0,
    },
    textCol: {
      flex: 1,
    },
    title: {
      fontSize: 14,
      fontFamily: 'Tajawal_700Bold',
      color: '#fff',
      textAlign: 'right',
    },
    subtitle: {
      fontSize: 12,
      fontFamily: 'Tajawal_400Regular',
      color: 'rgba(255,255,255,0.85)',
      textAlign: 'right',
      marginTop: 1,
    },
    closeBtn: {
      padding: 4,
      flexShrink: 0,
    },
  });

  return (
    <View style={s.banner}>
      <TouchableOpacity style={s.closeBtn} onPress={onDismiss} hitSlop={8}>
        <Feather name="x" size={18} color="#fff" />
      </TouchableOpacity>
      <View style={s.textCol}>
        <Text style={s.title}>إشعارات فائتة</Text>
        <Text style={s.subtitle}>
          {count === 1
            ? 'لم يصلك إشعار واحد أثناء إغلاق التطبيق'
            : `لم تصلك ${count} إشعارات أثناء إغلاق التطبيق`}
        </Text>
      </View>
      <Feather name="bell-off" size={20} color="#fff" style={s.icon} />
    </View>
  );
}
