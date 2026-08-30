import { useState } from "react";
import {
  useListUsers,
  useCreateUser,
  useUpdateUser,
  useDeleteUser,
  getListUsersQueryKey,
} from "@workspace/api-client-react";
import { Redirect } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import { AppLayout } from "@/components/layout/AppLayout";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger, DialogFooter,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Loader2, UserPlus, Pencil, Trash2, ShieldCheck, Wrench } from "lucide-react";
import { PasswordInput } from "@/components/ui/password-input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/lib/auth";
import { useSortable, SortableHead, IndexHead } from "@/components/ui/sortable-table";

const phoneSchema = z.string().optional().refine(
  (v) => !v || /^05\d{8}$/.test(v),
  "رقم الجوال يجب أن يبدأ بـ 05 ويتكون من 10 أرقام"
);

const createUserSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().min(6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
  role: z.enum(["SYSTEM_MANAGER", "TECHNICIAN"]),
  phone: phoneSchema,
});

const editUserSchema = z.object({
  name: z.string().min(1, "الاسم مطلوب"),
  email: z.string().email("بريد إلكتروني غير صالح"),
  password: z.string().refine((v) => v === "" || v.length >= 6, "كلمة المرور يجب أن تكون 6 أحرف على الأقل"),
  role: z.enum(["SYSTEM_MANAGER", "TECHNICIAN"]),
  phone: phoneSchema,
});

type CreateUserFormValues = z.infer<typeof createUserSchema>;
type EditUserFormValues = z.infer<typeof editUserSchema>;

type UserRow = { id: number; email: string; name?: string | null; role: "SYSTEM_MANAGER" | "TECHNICIAN"; avatarBase64?: string | null; phone?: string | null };

function getErrorMessage(err: unknown, fallback: string): string {
  if (err && typeof err === "object" && "error" in err && typeof (err as { error: unknown }).error === "string") {
    return (err as { error: string }).error;
  }
  return fallback;
}

export default function UsersPage() {
  const { user, isManager, isLoading: isAuthLoading } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [deletingUser, setDeletingUser] = useState<UserRow | null>(null);

  const { data: users, isLoading } = useListUsers({
    query: { enabled: isManager, queryKey: getListUsersQueryKey() },
  });
  const { sorted: sortedUsers, sortKey, sortDir, toggle } = useSortable(users, {
    name: (u) => u.name,
    email: (u) => u.email,
    role: (u) => u.role,
  });
  const createUser = useCreateUser();
  const updateUser = useUpdateUser();
  const deleteUser = useDeleteUser();

  const invalidate = () => queryClient.invalidateQueries({ queryKey: getListUsersQueryKey() });

  const createForm = useForm<CreateUserFormValues>({
    resolver: zodResolver(createUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "TECHNICIAN", phone: "" },
  });

  const editForm = useForm<EditUserFormValues>({
    resolver: zodResolver(editUserSchema),
    defaultValues: { name: "", email: "", password: "", role: "TECHNICIAN", phone: "" },
  });

  if (!isAuthLoading && !isManager) {
    return <Redirect to="/dashboard" />;
  }

  const onCreate = async (data: CreateUserFormValues) => {
    try {
      await createUser.mutateAsync({ data: { ...data, phone: data.phone || undefined } });
      invalidate();
      toast({ title: "✅ تم إنشاء المستخدم بنجاح" });
      setIsCreateOpen(false);
      createForm.reset();
    } catch (err) {
      toast({ variant: "destructive", title: "فشل إنشاء المستخدم", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  const openEdit = (u: UserRow) => {
    setEditingUser(u);
    editForm.reset({ name: u.name || "", email: u.email, password: "", role: u.role, phone: u.phone || "" });
  };

  const onEdit = async (data: EditUserFormValues) => {
    if (!editingUser) return;
    try {
      await updateUser.mutateAsync({
        id: editingUser.id,
        data: {
          name: data.name,
          email: data.email,
          role: data.role,
          ...(data.password ? { password: data.password } : {}),
          phone: data.phone || undefined,
        },
      });
      invalidate();
      toast({ title: "✅ تم تحديث بيانات المستخدم" });
      setEditingUser(null);
    } catch (err) {
      toast({ variant: "destructive", title: "فشل تحديث المستخدم", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
    }
  };

  const onDelete = async () => {
    if (!deletingUser) return;
    try {
      await deleteUser.mutateAsync({ id: deletingUser.id });
      invalidate();
      toast({ title: "تم حذف المستخدم" });
      setDeletingUser(null);
    } catch (err) {
      toast({ variant: "destructive", title: "فشل حذف المستخدم", description: getErrorMessage(err, "حدث خطأ غير متوقع") });
      setDeletingUser(null);
    }
  };

  const roleBadge = (role: string) =>
    role === "SYSTEM_MANAGER" ? (
      <Badge className="gap-1 bg-primary/15 text-primary hover:bg-primary/20 border border-primary/30">
        <ShieldCheck className="w-3 h-3" />
        مدير النظام
      </Badge>
    ) : (
      <Badge variant="secondary" className="gap-1">
        <Wrench className="w-3 h-3" />
        ثانوي
      </Badge>
    );

  return (
    <AppLayout>
      <div className="space-y-6">
        <div className="flex items-center justify-between flex-wrap gap-3">
          <div>
            <h2 className="text-2xl font-bold tracking-tight">إدارة المستخدمين</h2>
            <p className="text-muted-foreground mt-1">إضافة وتعديل حسابات فريق العمل وصلاحياتهم</p>
          </div>
          <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
            <DialogTrigger asChild>
              <Button className="gap-2">
                <UserPlus className="w-4 h-4" />
                إضافة مستخدم جديد
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-md" dir="rtl">
              <DialogHeader>
                <DialogTitle>إضافة مستخدم جديد</DialogTitle>
              </DialogHeader>
              <form onSubmit={createForm.handleSubmit(onCreate)} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="create-name">الاسم *</Label>
                  <Input id="create-name" placeholder="مثال: عبدالله المطيري" {...createForm.register("name")} />
                  {createForm.formState.errors.name && (
                    <p className="text-xs text-destructive">{createForm.formState.errors.name.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-email">البريد الإلكتروني *</Label>
                  <Input id="create-email" type="email" dir="ltr" placeholder="user@lawfirm.sa" {...createForm.register("email")} />
                  {createForm.formState.errors.email && (
                    <p className="text-xs text-destructive">{createForm.formState.errors.email.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-password">كلمة المرور *</Label>
                  <PasswordInput id="create-password" dir="ltr" {...createForm.register("password")} />
                  {createForm.formState.errors.password && (
                    <p className="text-xs text-destructive">{createForm.formState.errors.password.message}</p>
                  )}
                </div>
                <div className="space-y-2">
                  <Label>الدور *</Label>
                  <Select
                    value={createForm.watch("role")}
                    onValueChange={(v) => createForm.setValue("role", v as "SYSTEM_MANAGER" | "TECHNICIAN")}
                  >
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="TECHNICIAN">ثانوي</SelectItem>
                      <SelectItem value="SYSTEM_MANAGER">مدير النظام</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="create-phone">رقم الجوال <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
                  <Input
                    id="create-phone"
                    dir="ltr"
                    placeholder="05xxxxxxxx"
                    maxLength={10}
                    {...createForm.register("phone")}
                  />
                  {createForm.formState.errors.phone && (
                    <p className="text-xs text-destructive">{createForm.formState.errors.phone.message}</p>
                  )}
                </div>
                <DialogFooter>
                  <Button type="submit" disabled={createUser.isPending} className="w-full gap-2">
                    {createUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                    إنشاء المستخدم
                  </Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="bg-card border rounded-lg overflow-hidden shadow-sm">
          <Table>
            <TableHeader>
              <TableRow className="bg-muted/30">
                <IndexHead />
                <SortableHead label="الاسم" sortKey="name" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <SortableHead label="البريد الإلكتروني" sortKey="email" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <TableHead className="text-right">رقم الجوال</TableHead>
                <SortableHead label="الدور" sortKey="role" currentKey={sortKey} dir={sortDir} onToggle={toggle} />
                <TableHead className="text-right w-32">إجراءات</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-24">
                    <Loader2 className="w-6 h-6 animate-spin mx-auto text-primary" />
                  </TableCell>
                </TableRow>
              ) : !users || users.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center h-32 text-muted-foreground">
                    لا يوجد مستخدمون
                  </TableCell>
                </TableRow>
              ) : (
                sortedUsers?.map((u, idx) => (
                  <TableRow key={u.id} className="hover:bg-muted/30">
                    <TableCell className="text-muted-foreground font-mono">{idx + 1}</TableCell>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2.5">
                        {u.avatarBase64 ? (
                          <img
                            src={u.avatarBase64}
                            alt={u.name || ""}
                            className="w-8 h-8 rounded-full object-cover shrink-0 border border-border"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0 text-sm font-semibold select-none">
                            {(u.name || u.email).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <span>
                          {u.name || "-"}
                          {u.id === user?.id && (
                            <Badge variant="outline" className="mr-2 text-xs">أنت</Badge>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell dir="ltr" className="text-right font-mono text-sm">{u.email}</TableCell>
                    <TableCell dir="ltr" className="text-right font-mono text-sm">{(u as UserRow).phone || <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell>{roleBadge(u.role)}</TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          title="تعديل"
                          onClick={() => openEdit(u as UserRow)}
                        >
                          <Pencil className="w-4 h-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-muted-foreground hover:text-destructive"
                          title="حذف"
                          disabled={u.id === user?.id}
                          onClick={() => setDeletingUser(u as UserRow)}
                        >
                          <Trash2 className="w-4 h-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </div>

      {/* Edit dialog */}
      <Dialog open={!!editingUser} onOpenChange={(open) => !open && setEditingUser(null)}>
        <DialogContent className="sm:max-w-md" dir="rtl">
          <DialogHeader>
            <DialogTitle>تعديل بيانات المستخدم</DialogTitle>
          </DialogHeader>
          <form onSubmit={editForm.handleSubmit(onEdit)} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-name">الاسم *</Label>
              <Input id="edit-name" {...editForm.register("name")} />
              {editForm.formState.errors.name && (
                <p className="text-xs text-destructive">{editForm.formState.errors.name.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-email">البريد الإلكتروني *</Label>
              <Input id="edit-email" type="email" dir="ltr" {...editForm.register("email")} />
              {editForm.formState.errors.email && (
                <p className="text-xs text-destructive">{editForm.formState.errors.email.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-password">كلمة مرور جديدة (اتركها فارغة للإبقاء على الحالية)</Label>
              <PasswordInput id="edit-password" dir="ltr" {...editForm.register("password")} />
              {editForm.formState.errors.password && (
                <p className="text-xs text-destructive">{editForm.formState.errors.password.message}</p>
              )}
            </div>
            <div className="space-y-2">
              <Label>الدور *</Label>
              <Select
                value={editForm.watch("role")}
                onValueChange={(v) => editForm.setValue("role", v as "SYSTEM_MANAGER" | "TECHNICIAN")}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="TECHNICIAN">ثانوي</SelectItem>
                  <SelectItem value="SYSTEM_MANAGER">مدير النظام</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit-phone">رقم الجوال <span className="text-muted-foreground text-xs">(اختياري)</span></Label>
              <Input
                id="edit-phone"
                dir="ltr"
                placeholder="05xxxxxxxx"
                maxLength={10}
                {...editForm.register("phone")}
              />
              {editForm.formState.errors.phone && (
                <p className="text-xs text-destructive">{editForm.formState.errors.phone.message}</p>
              )}
            </div>
            <DialogFooter>
              <Button type="submit" disabled={updateUser.isPending} className="w-full gap-2">
                {updateUser.isPending && <Loader2 className="w-4 h-4 animate-spin" />}
                حفظ التعديلات
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deletingUser} onOpenChange={(open) => !open && setDeletingUser(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>حذف المستخدم</AlertDialogTitle>
            <AlertDialogDescription>
              هل أنت متأكد من حذف المستخدم "{deletingUser?.name || deletingUser?.email}"؟ لا يمكن التراجع عن هذا الإجراء.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={onDelete}
            >
              {deleteUser.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : "حذف"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </AppLayout>
  );
}
