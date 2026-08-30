import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { CalendarDays, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type DateRangePreset = "all" | "today" | "week" | "month" | "custom";

export interface DateRangeValue {
  preset: DateRangePreset;
  from?: string; // ISO date string YYYY-MM-DD
  to?: string;
}

interface DateRangeFilterProps {
  value: DateRangeValue;
  onChange: (v: DateRangeValue) => void;
  className?: string;
}

const PRESETS: { key: DateRangePreset; label: string }[] = [
  { key: "all",   label: "منذ البداية" },
  { key: "today", label: "اليوم" },
  { key: "week",  label: "الأسبوع" },
  { key: "month", label: "الشهر" },
  { key: "custom",label: "مخصص" },
];

export function getDateRangeWindow(value: DateRangeValue): { from: Date; to: Date } | null {
  const now = new Date();
  const startOfDay = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
  const endOfDay   = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999);

  switch (value.preset) {
    case "all":
      return null;
    case "today":
      return { from: startOfDay(now), to: endOfDay(now) };
    case "week": {
      const day = now.getDay(); // 0=Sun
      const diff = (day + 6) % 7; // Monday as start
      const mon = new Date(now); mon.setDate(now.getDate() - diff);
      return { from: startOfDay(mon), to: endOfDay(now) };
    }
    case "month": {
      const from = new Date(now.getFullYear(), now.getMonth(), 1);
      return { from: startOfDay(from), to: endOfDay(now) };
    }
    case "custom": {
      if (!value.from && !value.to) return null;
      const from = value.from ? new Date(value.from + "T00:00:00") : new Date(0);
      const to   = value.to   ? new Date(value.to   + "T23:59:59") : endOfDay(now);
      return { from, to };
    }
    default:
      return null;
  }
}

export function filterByDateRange<T extends { createdAt?: string | null }>(
  items: T[] | undefined,
  value: DateRangeValue,
): T[] | undefined {
  if (!items) return items;
  const window = getDateRangeWindow(value);
  if (!window) return items;
  return items.filter((item) => {
    if (!item.createdAt) return true;
    const d = new Date(item.createdAt);
    return d >= window.from && d <= window.to;
  });
}

export function DateRangeFilter({ value, onChange, className }: DateRangeFilterProps) {
  const [open, setOpen] = useState(false);

  const activeLabel = PRESETS.find((p) => p.key === value.preset)?.label ?? "منذ البداية";
  const isCustom = value.preset === "custom";

  return (
    <div className={cn("flex items-center gap-1 flex-wrap", className)}>
      {/* Quick preset pills */}
      {PRESETS.filter((p) => p.key !== "custom").map((p) => (
        <Button
          key={p.key}
          size="sm"
          variant={value.preset === p.key ? "default" : "outline"}
          className={cn(
            "h-8 rounded-full px-3 text-xs font-medium transition-all",
            value.preset === p.key
              ? "shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
          onClick={() => onChange({ preset: p.key })}
        >
          {p.label}
        </Button>
      ))}

      {/* Custom date range */}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            size="sm"
            variant={isCustom ? "default" : "outline"}
            className={cn(
              "h-8 rounded-full px-3 text-xs font-medium gap-1 transition-all",
              isCustom ? "shadow-sm" : "text-muted-foreground hover:text-foreground",
            )}
          >
            <CalendarDays className="w-3.5 h-3.5" />
            {isCustom && value.from
              ? `${value.from} — ${value.to ?? "..."}`
              : "مخصص"}
            <ChevronDown className="w-3 h-3 opacity-60" />
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-4 space-y-3" dir="rtl">
          <p className="text-sm font-medium">نطاق مخصص</p>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">من</label>
            <Input
              type="date"
              dir="ltr"
              value={value.from ?? ""}
              onChange={(e) =>
                onChange({ preset: "custom", from: e.target.value || undefined, to: value.to })
              }
            />
          </div>
          <div className="space-y-2">
            <label className="text-xs text-muted-foreground">إلى</label>
            <Input
              type="date"
              dir="ltr"
              value={value.to ?? ""}
              onChange={(e) =>
                onChange({ preset: "custom", from: value.from, to: e.target.value || undefined })
              }
            />
          </div>
          <Button
            size="sm"
            className="w-full"
            onClick={() => setOpen(false)}
          >
            تطبيق
          </Button>
        </PopoverContent>
      </Popover>
    </div>
  );
}
