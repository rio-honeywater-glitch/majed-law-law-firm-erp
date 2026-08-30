import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin } from "@workspace/api-client-react";
import { useAuth } from "@/lib/auth";
import { cacheTheme, applyTheme } from "@/lib/theme";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { Loader2 } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import logoUrl from "@assets/مكتب_المحامي_ماجد_بن_سلطان_السبيعي_(2)_1783413971019.png";

const loginSchema = z.object({
  email: z.string().email("البريد الإلكتروني غير صالح"),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
});

type LoginFormValues = z.infer<typeof loginSchema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const { login: setAuthContext } = useAuth();
  const { toast } = useToast();
  
  const loginMutation = useLogin();

  const form = useForm<LoginFormValues>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  const onSubmit = async (data: LoginFormValues) => {
    try {
      const response = await loginMutation.mutateAsync({ data });
      // Cache + apply the firm's brand theme so the workspace is branded on entry.
      cacheTheme(response.theme);
      applyTheme(response.theme);
      setAuthContext(response.user, response.token, response.branding);
      toast({
        title: "تم تسجيل الدخول بنجاح",
        description: "مرحباً بك في نظام إدارة المحاماة",
      });
      setLocation("/dashboard");
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "خطأ في تسجيل الدخول",
        description: error?.message || "البريد الإلكتروني أو كلمة المرور غير صحيحة",
      });
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-sidebar p-4 relative overflow-hidden">
      {/* Background decoration */}
      <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
        <div className="absolute top-[-20%] left-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
        <div className="absolute bottom-[-20%] right-[-10%] w-[50%] h-[50%] rounded-full bg-primary/5 blur-[120px]" />
      </div>

      <div className="w-full max-w-md z-10">
        <div className="flex flex-col items-center mb-8">
          <div className="w-32 h-32 mb-6 rounded-full border-4 border-primary/20 p-2 bg-sidebar-accent shadow-2xl shadow-primary/10">
            <img src={logoUrl} alt="Logo" className="w-full h-full object-contain drop-shadow-md" />
          </div>
          <h1 className="text-3xl font-bold text-primary text-center leading-snug">
            مكتب المحامي<br/>ماجد بن سلطان السبيعي
          </h1>
          <p className="text-sidebar-foreground/60 mt-2 text-sm">نظام إدارة الممارسة القانونية</p>
        </div>

        <Card className="border-sidebar-border bg-sidebar-accent/50 backdrop-blur-xl shadow-xl">
          <CardHeader>
            <CardTitle className="text-2xl text-center text-sidebar-foreground">تسجيل الدخول</CardTitle>
            <CardDescription className="text-center text-sidebar-foreground/60">
              أدخل بيانات الاعتماد الخاصة بك للوصول إلى النظام
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <div className="space-y-2">
                <Label htmlFor="email" className="text-sidebar-foreground">البريد الإلكتروني</Label>
                <Input
                  id="email"
                  type="email"
                  placeholder="admin@lawfirm.com"
                  className="bg-sidebar-border/50 border-sidebar-border text-sidebar-foreground focus-visible:ring-primary h-12"
                  {...form.register("email")}
                />
                {form.formState.errors.email && (
                  <p className="text-sm text-destructive">{form.formState.errors.email.message}</p>
                )}
              </div>
              <div className="space-y-2">
                <Label htmlFor="password" className="text-sidebar-foreground">كلمة المرور</Label>
                <PasswordInput
                  id="password"
                  className="bg-sidebar-border/50 border-sidebar-border text-sidebar-foreground focus-visible:ring-primary h-12"
                  {...form.register("password")}
                />
                {form.formState.errors.password && (
                  <p className="text-sm text-destructive">{form.formState.errors.password.message}</p>
                )}
              </div>
              <Button 
                type="submit" 
                className="w-full h-12 text-base font-bold shadow-lg shadow-primary/20 hover:shadow-primary/40 transition-all"
                disabled={loginMutation.isPending}
              >
                {loginMutation.isPending ? (
                  <Loader2 className="w-5 h-5 animate-spin mx-auto" />
                ) : (
                  "دخول"
                )}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}