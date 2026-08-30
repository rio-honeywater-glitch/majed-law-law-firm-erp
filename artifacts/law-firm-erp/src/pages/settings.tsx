import {
  useGetSystemSetting,
  useUpdateSystemSetting,
  useSendOfficialSenderTestEmail,
  getGetSystemSettingQueryKey,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Settings as SettingsIcon, ClipboardList, Bell, Mail, MailCheck, ShieldCheck } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { useState, useEffect } from "react";

export const TASKS_MODULE_KEY = "TASKS_MODULE_VISIBLE";
export const TRANSFER_ALERT_DAYS_KEY = "TRANSFER_ORDER_ALERT_DAYS";
export const EXECUTION_REMINDER_DAYS_KEY = "EXECUTION_REMINDER_DAYS";
export const OFFICIAL_SENDER_EMAIL_KEY = "OFFICIAL_SENDER_EMAIL";

export default function Settings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: tasksSetting, isLoading: tasksLoading } = useGetSystemSetting(TASKS_MODULE_KEY);
  const { data: alertDaysSetting, isLoading: alertDaysLoading } = useGetSystemSetting(TRANSFER_ALERT_DAYS_KEY);
  const { data: reminderDaysSetting, isLoading: reminderDaysLoading } = useGetSystemSetting(EXECUTION_REMINDER_DAYS_KEY);
  const { data: senderEmailSetting, isLoading: senderEmailLoading } = useGetSystemSetting(OFFICIAL_SENDER_EMAIL_KEY);
  const updateSetting = useUpdateSystemSetting();
  const testEmail = useSendOfficialSenderTestEmail();

  const [alertDaysInput, setAlertDaysInput] = useState<string>("7");
  const [reminderDaysInput, setReminderDaysInput] = useState<string>("7");
  const [senderEmailInput, setSenderEmailInput] = useState<string>("");
  const [testRecipientInput, setTestRecipientInput] = useState<string>("");

  useEffect(() => {
    if (alertDaysSetting?.numericValue != null) {
      setAlertDaysInput(String(alertDaysSetting.numericValue));
    }
  }, [alertDaysSetting?.numericValue]);

  useEffect(() => {
    if (reminderDaysSetting?.numericValue != null) {
      setReminderDaysInput(String(reminderDaysSetting.numericValue));
    }
  }, [reminderDaysSetting?.numericValue]);

  useEffect(() => {
    setSenderEmailInput(senderEmailSetting?.textValue ?? "");
  }, [senderEmailSetting?.textValue]);

  const handleToggle = async (value: boolean) => {
    try {
      await updateSetting.mutateAsync({ key: TASKS_MODULE_KEY, data: { value } });
      queryClient.invalidateQueries({ queryKey: getGetSystemSettingQueryKey(TASKS_MODULE_KEY) });
      toast({ title: value ? "تم تفعيل وحدة المهام" : "تم إخفاء وحدة المهام" });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الإعداد" });
    }
  };

  const handleSaveAlertDays = async () => {
    const parsed = parseInt(alertDaysInput, 10);
    if (isNaN(parsed) || parsed < 1) {
      toast({ variant: "destructive", title: "يجب أن يكون العدد رقماً صحيحاً موجباً" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: TRANSFER_ALERT_DAYS_KEY, data: { numericValue: parsed } });
      queryClient.invalidateQueries({ queryKey: getGetSystemSettingQueryKey(TRANSFER_ALERT_DAYS_KEY) });
      toast({ title: `تم حفظ عدد أيام التنبيه: ${parsed} يوم` });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الإعداد" });
    }
  };

  const handleSaveReminderDays = async () => {
    const parsed = parseInt(reminderDaysInput, 10);
    if (isNaN(parsed) || parsed < 1) {
      toast({ variant: "destructive", title: "يجب أن يكون العدد رقماً صحيحاً موجباً" });
      return;
    }
    try {
      await updateSetting.mutateAsync({ key: EXECUTION_REMINDER_DAYS_KEY, data: { numericValue: parsed } });
      queryClient.invalidateQueries({ queryKey: getGetSystemSettingQueryKey(EXECUTION_REMINDER_DAYS_KEY) });
      toast({ title: `تم حفظ عدد أيام تذكير التنفيذ: ${parsed} يوم` });
    } catch {
      toast({ variant: "destructive", title: "فشل تحديث الإعداد" });
    }
  };

  const handleSaveSenderEmail = async () => {
    const normalizedEmail = senderEmailInput.trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail);
    if (!validEmail) {
      toast({ variant: "destructive", title: "يرجى إدخال عنوان بريد إلكتروني صالح" });
      return;
    }
    try {
      await updateSetting.mutateAsync({
        key: OFFICIAL_SENDER_EMAIL_KEY,
        data: { textValue: normalizedEmail },
      });
      queryClient.invalidateQueries({ queryKey: getGetSystemSettingQueryKey(OFFICIAL_SENDER_EMAIL_KEY) });
      setSenderEmailInput(normalizedEmail);
      toast({ title: "تم حفظ البريد الرسمي للمرسل" });
    } catch (error) {
      toast({
        variant: "destructive",
        title: error instanceof Error ? error.message : "فشل حفظ البريد الرسمي للمرسل",
      });
    }
  };

  const handleSendTestEmail = async () => {
    const recipient = testRecipientInput.trim().toLowerCase();
    const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient);
    if (!validEmail) {
      toast({ variant: "destructive", title: "يرجى إدخال بريد إلكتروني صالح لاستلام الرسالة التجريبية" });
      return;
    }

    try {
      const result = await testEmail.mutateAsync({ data: { to: recipient } });
      toast({
        title: "تم إرسال رسالة الاختبار",
        description: result.message,
      });
    } catch (error) {
      const apiError = error as { data?: { error?: unknown } };
      const message = typeof apiError.data?.error === "string"
        ? apiError.data.error
        : error instanceof Error
          ? error.message
          : "تعذر إرسال رسالة الاختبار";
      toast({ variant: "destructive", title: message });
    }
  };

  return (
    <AppLayout>
      <div className="space-y-6 max-w-3xl mx-auto">
        <div>
          <h2 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <SettingsIcon className="w-6 h-6 text-primary" />
            إعدادات النظام
          </h2>
          <p className="text-muted-foreground mt-1">التحكم في وحدات النظام الظاهرة للفريق</p>
        </div>

        <div className="bg-card border rounded-lg shadow-sm divide-y">
          {/* Tasks module toggle */}
          <div className="flex items-center justify-between p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <ClipboardList className="w-5 h-5 text-primary" />
              </div>
              <div>
                <Label htmlFor="tasks-toggle" className="text-base font-bold cursor-pointer">
                  وحدة المهام المشتركة
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  عند التعطيل، تُخفى صفحة المهام ورابطها من القائمة الجانبية لجميع المستخدمين
                </p>
              </div>
            </div>
            {tasksLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
            ) : (
              <Switch
                id="tasks-toggle"
                checked={tasksSetting?.value ?? true}
                onCheckedChange={handleToggle}
                disabled={updateSetting.isPending}
              />
            )}
          </div>

          {/* Official sender email */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Mail className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1 min-w-0">
                <Label htmlFor="sender-email-input" className="text-base font-bold">
                  البريد الرسمي للمرسل
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5">
                  يظهر هذا العنوان للعملاء عند إرسال تقارير القضايا والعقود من النظام.
                </p>
                <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50/70 p-3 my-3 text-sm text-amber-900">
                  <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" />
                  <p>
                    يجب أن يكون نطاق البريد موثقاً في Resend. مفتاح الخدمة السري محفوظ خارج النظام ولا يظهر في هذه الصفحة.
                  </p>
                </div>
                {senderEmailLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                ) : (
                  <div className="space-y-4 max-w-2xl">
                    <div className="flex items-center gap-3">
                      <Input
                        id="sender-email-input"
                        type="email"
                        value={senderEmailInput}
                        onChange={(event) => setSenderEmailInput(event.target.value)}
                        placeholder="reports@example.com"
                        dir="ltr"
                        autoComplete="email"
                      />
                      <Button
                        size="sm"
                        onClick={handleSaveSenderEmail}
                        disabled={updateSetting.isPending || !senderEmailInput.trim()}
                      >
                        {updateSetting.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حفظ"}
                      </Button>
                    </div>
                    {senderEmailInput.trim() && (
                      <p className="text-xs text-muted-foreground" dir="rtl">
                        سيظهر للعميل: مكتب المحامي ماجد بن سلطان السبيعي
                        {" "}
                        <span dir="ltr">&lt;{senderEmailInput.trim()}&gt;</span>
                      </p>
                    )}
                    <div className="rounded-md border bg-muted/20 p-3 space-y-2">
                      <div className="flex items-center gap-2">
                        <MailCheck className="w-4 h-4 text-primary" />
                        <Label htmlFor="test-recipient-input" className="text-sm font-semibold">
                          إرسال رسالة اختبار
                        </Label>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        أدخل بريداً داخلياً تملكه للتأكد من توثيق النطاق وعمل الإرسال. يرفض النظام أي بريد مسجل لعميل.
                      </p>
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                        <Input
                          id="test-recipient-input"
                          type="email"
                          value={testRecipientInput}
                          onChange={(event) => setTestRecipientInput(event.target.value)}
                          placeholder="your-email@example.com"
                          dir="ltr"
                          autoComplete="email"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="whitespace-nowrap"
                          onClick={handleSendTestEmail}
                          disabled={testEmail.isPending || !testRecipientInput.trim()}
                        >
                          {testEmail.isPending ? (
                            <Loader2 className="w-4 h-4 animate-spin" />
                          ) : (
                            "إرسال رسالة اختبار"
                          )}
                        </Button>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Transfer order alert days */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <Label htmlFor="alert-days-input" className="text-base font-bold">
                  عدد أيام التنبيه لأوامر التحويل
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5 mb-3">
                  إذا مرّت هذه المدة دون تسجيل أمر تحويل لتنفيذ نشط، يُرسَل تنبيه تلقائي. القيمة الافتراضية: 7 أيام.
                </p>
                {alertDaysLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                ) : (
                  <div className="flex items-center gap-3 max-w-xs">
                    <Input
                      id="alert-days-input"
                      type="number"
                      min={1}
                      max={365}
                      value={alertDaysInput}
                      onChange={(e) => setAlertDaysInput(e.target.value)}
                      className="w-28 text-center"
                      dir="ltr"
                    />
                    <span className="text-sm text-muted-foreground">يوم</span>
                    <Button
                      size="sm"
                      onClick={handleSaveAlertDays}
                      disabled={updateSetting.isPending}
                    >
                      {updateSetting.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "حفظ"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Execution reminder days */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center shrink-0">
                <Bell className="w-5 h-5 text-primary" />
              </div>
              <div className="flex-1">
                <Label htmlFor="reminder-days-input" className="text-base font-bold">
                  عدد أيام تذكير التنفيذ
                </Label>
                <p className="text-sm text-muted-foreground mt-0.5 mb-3">
                  إذا مرّت هذه المدة دون تحديث تنفيذ نشط، يُرسَل تذكير يومي تلقائي. القيمة الافتراضية: 7 أيام.
                </p>
                {reminderDaysLoading ? (
                  <Loader2 className="w-5 h-5 animate-spin text-primary" />
                ) : (
                  <div className="flex items-center gap-3 max-w-xs">
                    <Input
                      id="reminder-days-input"
                      type="number"
                      min={1}
                      max={365}
                      value={reminderDaysInput}
                      onChange={(e) => setReminderDaysInput(e.target.value)}
                      className="w-28 text-center"
                      dir="ltr"
                    />
                    <span className="text-sm text-muted-foreground">يوم</span>
                    <Button
                      size="sm"
                      onClick={handleSaveReminderDays}
                      disabled={updateSetting.isPending}
                    >
                      {updateSetting.isPending ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        "حفظ"
                      )}
                    </Button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </AppLayout>
  );
}
