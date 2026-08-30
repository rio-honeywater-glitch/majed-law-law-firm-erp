import { useState, useRef, useCallback, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useGetProfile, useUpdateProfile } from "@workspace/api-client-react";
import { Loader2, Camera, ShieldCheck, Wrench, UserCircle, Save, KeyRound, AtSign, User as UserIcon } from "lucide-react";

// ─── Image compression via canvas (max 200×200, quality 0.6) ─────────────────
async function compressAvatar(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const MAX = 200;
      let { width, height } = img;
      if (width > MAX || height > MAX) {
        const ratio = Math.min(MAX / width, MAX / height);
        width = Math.round(width * ratio);
        height = Math.round(height * ratio);
      }
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext("2d")!;
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL("image/jpeg", 0.6));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("فشل تحميل الصورة")); };
    img.src = url;
  });
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const profileSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح"),
});

const passwordSchema = z.object({
  password: z.string().min(6, "6 أحرف على الأقل"),
  confirmPassword: z.string(),
}).refine((d) => d.password === d.confirmPassword, {
  message: "كلمتا المرور غير متطابقتين",
  path: ["confirmPassword"],
});

type ProfileFormValues = z.infer<typeof profileSchema>;
type PasswordFormValues = z.infer<typeof passwordSchema>;

export default function ProfilePage() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [avatarData, setAvatarData] = useState<string | null | undefined>(undefined); // undefined = no change

  const profileForm = useForm<ProfileFormValues>({
    resolver: zodResolver(profileSchema),
    defaultValues: { name: user?.name ?? "", email: user?.email ?? "" },
  });

  const { data: profile, isLoading } = useGetProfile();
  const updateProfile = useUpdateProfile();

  useEffect(() => {
    if (!profile) return;
    profileForm.reset({ name: profile.name ?? "", email: profile.email });
  }, [profile, profileForm]);

  const passwordForm = useForm<PasswordFormValues>({
    resolver: zodResolver(passwordSchema),
    defaultValues: { password: "", confirmPassword: "" },
  });

  const handleAvatarChange = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const compressed = await compressAvatar(file);
      setAvatarPreview(compressed);
      setAvatarData(compressed);
    } catch {
      toast({ variant: "destructive", title: "تعذّر ضغط الصورة" });
    }
    e.target.value = "";
  }, [toast]);

  const handleRemoveAvatar = () => {
    setAvatarPreview(null);
    setAvatarData(null); // explicitly clear
  };

  const onSaveProfile = async (data: ProfileFormValues) => {
    try {
      const payload: Record<string, unknown> = {};
      // Only include fields that have actually changed to avoid false conflicts
      if (data.name !== (profile?.name ?? "")) payload.name = data.name;
      if (data.email.trim().toLowerCase() !== (profile?.email ?? "").toLowerCase()) payload.email = data.email;
      if (avatarData !== undefined) payload.avatarBase64 = avatarData; // null = remove
      if (Object.keys(payload).length === 0) {
        // nothing changed
        setAvatarData(undefined);
        return;
      }
      const updated = await updateProfile.mutateAsync({ data: payload as any });
      updateUser(updated as any);
      setAvatarData(undefined); // reset dirty flag
      toast({ title: "✅ تم حفظ الملف الشخصي" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "فشل الحفظ", description: err?.error || "حدث خطأ غير متوقع" });
    }
  };

  const onChangePassword = async (data: PasswordFormValues) => {
    try {
      await updateProfile.mutateAsync({ data: { password: data.password } });
      passwordForm.reset();
      toast({ title: "✅ تم تغيير كلمة المرور" });
    } catch (err: any) {
      toast({ variant: "destructive", title: "فشل التغيير", description: err?.error || "حدث خطأ غير متوقع" });
    }
  };

  const displayAvatar = avatarPreview ?? profile?.avatarBase64 ?? null;
  const displayName = profile?.name ?? user?.name ?? "";
  const displayRole = profile?.role ?? user?.role;

  if (isLoading) {
    return (
      <AppLayout>
        <div className="flex items-center justify-center h-64">
          <Loader2 className="w-8 h-8 animate-spin text-primary" />
        </div>
      </AppLayout>
    );
  }

  return (
    <AppLayout>
      <div className="max-w-2xl mx-auto space-y-6" dir="rtl">
        {/* Page header */}
        <div>
          <h2 className="text-2xl font-bold tracking-tight">ملف الموظف</h2>
          <p className="text-muted-foreground mt-1">إدارة بياناتك الشخصية وبيانات تسجيل الدخول</p>
        </div>

        {/* ── Avatar + identity card ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <UserIcon className="w-4 h-4 text-primary" />
              الصورة الشخصية والمعرّف
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-6">
              {/* Avatar */}
              <div className="relative shrink-0">
                <div className="w-24 h-24 rounded-full border-4 border-primary/20 overflow-hidden bg-primary/10 flex items-center justify-center">
                  {displayAvatar ? (
                    <img src={displayAvatar} alt="صورة الموظف" className="w-full h-full object-cover" />
                  ) : (
                    <span className="text-3xl font-bold text-primary">
                      {displayName?.charAt(0) || "م"}
                    </span>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => avatarInputRef.current?.click()}
                  className="absolute bottom-0 left-0 w-7 h-7 rounded-full bg-primary text-primary-foreground flex items-center justify-center shadow-md hover:bg-primary/90 transition-colors"
                  title="تغيير الصورة"
                >
                  <Camera className="w-3.5 h-3.5" />
                </button>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handleAvatarChange}
                />
              </div>

              {/* Info */}
              <div className="flex-1 min-w-0">
                <p className="text-lg font-semibold truncate">{displayName || "—"}</p>
                <p className="text-sm text-muted-foreground truncate">{profile?.email ?? user?.email}</p>
                <div className="mt-2">
                  {displayRole === "SYSTEM_MANAGER" ? (
                    <Badge className="gap-1 bg-primary/15 text-primary border border-primary/30">
                      <ShieldCheck className="w-3 h-3" />
                      مدير النظام
                    </Badge>
                  ) : (
                    <Badge variant="secondary" className="gap-1">
                      <Wrench className="w-3 h-3" />
                      ثانوي
                    </Badge>
                  )}
                </div>
                {displayAvatar && (
                  <button
                    type="button"
                    onClick={handleRemoveAvatar}
                    className="mt-2 text-xs text-destructive hover:underline"
                  >
                    حذف الصورة
                  </button>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* ── Personal info form ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <AtSign className="w-4 h-4 text-primary" />
              بيانات الحساب
            </CardTitle>
            <CardDescription>الاسم والبريد الإلكتروني المستخدمَين في النظام</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={profileForm.handleSubmit(onSaveProfile)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="profile-name">الاسم</Label>
                <Input id="profile-name" placeholder="اسمك الكامل" {...profileForm.register("name")} />
                {profileForm.formState.errors.name && (
                  <p className="text-xs text-destructive">{profileForm.formState.errors.name.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="profile-email">البريد الإلكتروني</Label>
                <Input id="profile-email" type="email" dir="ltr" placeholder="you@example.com" {...profileForm.register("email")} />
                {profileForm.formState.errors.email && (
                  <p className="text-xs text-destructive">{profileForm.formState.errors.email.message}</p>
                )}
              </div>
              <Button
                type="submit"
                disabled={updateProfile.isPending}
                className="gap-2"
              >
                {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                حفظ البيانات
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* ── Password change ── */}
        <Card>
          <CardHeader className="pb-4">
            <CardTitle className="text-base flex items-center gap-2">
              <KeyRound className="w-4 h-4 text-primary" />
              تغيير كلمة المرور
            </CardTitle>
            <CardDescription>اترك الحقول فارغة إن لم ترغب في التغيير</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={passwordForm.handleSubmit(onChangePassword)} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="new-password">كلمة المرور الجديدة</Label>
                <PasswordInput id="new-password" dir="ltr" {...passwordForm.register("password")} />
                {passwordForm.formState.errors.password && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.password.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">تأكيد كلمة المرور</Label>
                <PasswordInput id="confirm-password" dir="ltr" {...passwordForm.register("confirmPassword")} />
                {passwordForm.formState.errors.confirmPassword && (
                  <p className="text-xs text-destructive">{passwordForm.formState.errors.confirmPassword.message}</p>
                )}
              </div>
              <Button
                type="submit"
                variant="outline"
                disabled={updateProfile.isPending}
                className="gap-2"
              >
                {updateProfile.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <KeyRound className="w-4 h-4" />}
                تغيير كلمة المرور
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
