import { useState, forwardRef } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";

type PasswordInputProps = Omit<React.ComponentProps<typeof Input>, "type"> & {
  className?: string;
};

export const PasswordInput = forwardRef<HTMLInputElement, PasswordInputProps>(
  ({ className, ...props }, ref) => {
    const [show, setShow] = useState(false);

    return (
      <div className="relative">
        <Input
          ref={ref}
          type={show ? "text" : "password"}
          className={cn("ltr:pr-10 rtl:pl-10", className)}
          {...props}
        />
        <Button
          type="button"
          variant="ghost"
          size="icon"
          tabIndex={-1}
          className="absolute inset-y-0 left-0 h-full w-10 px-0 text-muted-foreground hover:text-foreground hover:bg-transparent"
          onClick={() => setShow((v) => !v)}
          aria-label={show ? "إخفاء كلمة المرور" : "إظهار كلمة المرور"}
        >
          {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
        </Button>
      </div>
    );
  }
);
PasswordInput.displayName = "PasswordInput";
