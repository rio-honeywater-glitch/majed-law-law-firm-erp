import React, { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Image,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';
import { useAuth } from '@/contexts/AuthContext';
import { useLogin } from '@workspace/api-client-react';
import * as Haptics from 'expo-haptics';

export default function LoginScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const loginMutation = useLogin();

  async function handleLogin() {
    if (!email.trim() || !password.trim()) {
      Alert.alert('خطأ', 'يرجى إدخال البريد الإلكتروني وكلمة المرور');
      return;
    }
    try {
      await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      const res = await loginMutation.mutateAsync({ data: { email: email.trim(), password } });
      await login(res.token, res.user as any);
    } catch {
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error);
      Alert.alert('فشل تسجيل الدخول', 'البريد الإلكتروني أو كلمة المرور غير صحيحة');
    }
  }

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    inner: {
      flex: 1,
      paddingHorizontal: 28,
      paddingTop: insets.top + (Platform.OS === 'web' ? 67 : 40),
      paddingBottom: insets.bottom + (Platform.OS === 'web' ? 34 : 20),
      justifyContent: 'center',
    },
    logoContainer: {
      alignItems: 'center',
      marginBottom: 48,
    },
    logo: {
      width: 88,
      height: 88,
      borderRadius: 22,
      marginBottom: 16,
    },
    firmName: {
      fontSize: 22,
      fontWeight: '700' as const,
      color: colors.foreground,
      fontFamily: 'Tajawal_700Bold',
      textAlign: 'center',
      marginBottom: 4,
    },
    tagline: {
      fontSize: 14,
      color: colors.mutedForeground,
      fontFamily: 'Tajawal_400Regular',
      textAlign: 'center',
    },
    inputGroup: {
      marginBottom: 16,
    },
    label: {
      fontSize: 13,
      fontFamily: 'Tajawal_700Bold',
      color: colors.foreground,
      marginBottom: 8,
      textAlign: 'right',
    },
    input: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius,
      paddingHorizontal: 16,
      paddingVertical: 14,
      fontSize: 16,
      color: colors.foreground,
      fontFamily: 'Tajawal_400Regular',
      textAlign: 'right',
    },
    inputFocused: {
      borderColor: colors.primary,
    },
    button: {
      backgroundColor: colors.primary,
      borderRadius: colors.radius,
      paddingVertical: 16,
      alignItems: 'center',
      marginTop: 8,
    },
    buttonDisabled: {
      opacity: 0.6,
    },
    buttonText: {
      color: colors.primaryForeground,
      fontSize: 16,
      fontWeight: '700' as const,
      fontFamily: 'Tajawal_700Bold',
    },
    divider: {
      height: 1,
      backgroundColor: colors.border,
      marginVertical: 32,
    },
    footerText: {
      fontSize: 12,
      color: colors.mutedForeground,
      textAlign: 'center',
      fontFamily: 'Tajawal_400Regular',
    },
  });

  const [emailFocused, setEmailFocused] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
    >
      <View style={styles.inner}>
        <View style={styles.logoContainer}>
          <Image
            source={require('@/assets/images/icon.png')}
            style={styles.logo}
            resizeMode="cover"
          />
          <Text style={styles.firmName}>مكتب مجد سلطان السبيعي</Text>
          <Text style={styles.tagline}>للمحاماة والاستشارات القانونية</Text>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>البريد الإلكتروني</Text>
          <TextInput
            style={[styles.input, emailFocused && styles.inputFocused]}
            value={email}
            onChangeText={setEmail}
            placeholder="example@firm.com"
            placeholderTextColor={colors.mutedForeground}
            keyboardType="email-address"
            autoCapitalize="none"
            autoCorrect={false}
            onFocus={() => setEmailFocused(true)}
            onBlur={() => setEmailFocused(false)}
          />
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.label}>كلمة المرور</Text>
          <TextInput
            style={[styles.input, passwordFocused && styles.inputFocused]}
            value={password}
            onChangeText={setPassword}
            placeholder="••••••••"
            placeholderTextColor={colors.mutedForeground}
            secureTextEntry
            onFocus={() => setPasswordFocused(true)}
            onBlur={() => setPasswordFocused(false)}
            onSubmitEditing={handleLogin}
          />
        </View>

        <TouchableOpacity
          style={[styles.button, loginMutation.isPending && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={loginMutation.isPending}
          activeOpacity={0.85}
        >
          {loginMutation.isPending ? (
            <ActivityIndicator color={colors.primaryForeground} />
          ) : (
            <Text style={styles.buttonText}>تسجيل الدخول</Text>
          )}
        </TouchableOpacity>

        <View style={styles.divider} />
        <Text style={styles.footerText}>
          نظام إدارة مكتب المحاماة — النسخة المحمولة
        </Text>
      </View>
    </KeyboardAvoidingView>
  );
}
