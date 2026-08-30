import React from 'react';
import { Platform, StyleSheet, useColorScheme, View } from 'react-native';
import { useColors } from '@/hooks/useColors';
import { Feather } from '@expo/vector-icons';
import { BlurView } from 'expo-blur';
import { isLiquidGlassAvailable } from 'expo-glass-effect';
import { Tabs } from 'expo-router';
import { Badge, Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { SymbolView } from 'expo-symbols';
import { useListNotifications } from '@workspace/api-client-react';

function NativeTabLayout() {
  const { data: notifications } = useListNotifications();
  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  return (
    <NativeTabs>
      <NativeTabs.Trigger name="index">
        <Icon sf={{ default: 'house', selected: 'house.fill' }} />
        <Label>الرئيسية</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="cases">
        <Icon sf={{ default: 'briefcase', selected: 'briefcase.fill' }} />
        <Label>القضايا</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="hearings">
        <Icon sf={{ default: 'calendar', selected: 'calendar' }} />
        <Label>الجلسات</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="tasks">
        <Icon sf={{ default: 'checklist', selected: 'checklist' }} />
        <Label>المهام</Label>
      </NativeTabs.Trigger>
      <NativeTabs.Trigger name="notifications">
        <Icon sf={{ default: 'bell', selected: 'bell.fill' }} />
        <Label>الإشعارات</Label>
        {unreadCount > 0 && <Badge>{String(unreadCount)}</Badge>}
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}

function ClassicTabLayout() {
  const colors = useColors();
  const colorScheme = useColorScheme();
  const isDark = colorScheme === 'dark';
  const isIOS = Platform.OS === 'ios';
  const isWeb = Platform.OS === 'web';

  const { data: notifications } = useListNotifications();
  const unreadCount = (notifications ?? []).filter((n) => !n.isRead).length;

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.mutedForeground,
        tabBarLabelStyle: {
          fontFamily: 'Tajawal_400Regular',
          fontSize: 11,
        },
        tabBarStyle: {
          position: 'absolute',
          backgroundColor: isIOS ? 'transparent' : colors.background,
          borderTopWidth: 1,
          borderTopColor: colors.border,
          elevation: 0,
          height: isWeb ? 84 : 60,
          paddingBottom: isWeb ? 34 : 6,
        },
        tabBarBackground: () =>
          isIOS ? (
            <BlurView
              intensity={90}
              tint={isDark ? 'dark' : 'light'}
              style={StyleSheet.absoluteFill}
            />
          ) : isWeb ? (
            <View
              style={[StyleSheet.absoluteFill, { backgroundColor: colors.background }]}
            />
          ) : null,
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'الرئيسية',
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="house.fill" tintColor={color} size={size} />
            ) : (
              <Feather name="home" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="cases"
        options={{
          title: 'القضايا',
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="briefcase.fill" tintColor={color} size={size} />
            ) : (
              <Feather name="briefcase" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="hearings"
        options={{
          title: 'الجلسات',
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="calendar" tintColor={color} size={size} />
            ) : (
              <Feather name="calendar" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="tasks"
        options={{
          title: 'المهام',
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="checklist" tintColor={color} size={size} />
            ) : (
              <Feather name="check-square" size={size} color={color} />
            ),
        }}
      />
      <Tabs.Screen
        name="notifications"
        options={{
          title: 'الإشعارات',
          tabBarBadge: unreadCount > 0 ? unreadCount : undefined,
          tabBarBadgeStyle: {
            backgroundColor: colors.primary,
            color: colors.primaryForeground,
            fontSize: 10,
          },
          tabBarIcon: ({ color, size }) =>
            isIOS ? (
              <SymbolView name="bell.fill" tintColor={color} size={size} />
            ) : (
              <Feather name="bell" size={size} color={color} />
            ),
        }}
      />
    </Tabs>
  );
}

export default function TabLayout() {
  if (isLiquidGlassAvailable()) {
    return <NativeTabLayout />;
  }
  return <ClassicTabLayout />;
}
