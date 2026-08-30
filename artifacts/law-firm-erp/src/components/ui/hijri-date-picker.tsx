"use client";

import * as React from "react";
import { ChevronRight, ChevronLeft, CalendarDays } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

// ─── Hijri calendar utilities ────────────────────────────────────────────────

export function gregorianToHijri(date: Date): { year: number; month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-u-ca-islamic-umalqura", {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  }).formatToParts(date);
  return {
    year: Number(parts.find((p) => p.type === "year")?.value ?? 0),
    month: Number(parts.find((p) => p.type === "month")?.value ?? 0),
    day: Number(parts.find((p) => p.type === "day")?.value ?? 0),
  };
}

export function hijriToGregorian(year: number, month: number, day: number): Date {
  // Approximate Hijri epoch: 16 July 622 CE
  const approxMs =
    Date.UTC(622, 6, 16) +
    ((year - 1) * 354.367 + (month - 1) * 29.53 + (day - 1)) * 86_400_000;
  const candidate = new Date(approxMs);

  for (let offset = -5; offset <= 5; offset++) {
    const d = new Date(candidate.getTime() + offset * 86_400_000);
    const h = gregorianToHijri(d);
    if (h.year === year && h.month === month && h.day === day) return d;
  }
  for (let offset = -45; offset <= 45; offset++) {
    const d = new Date(candidate.getTime() + offset * 86_400_000);
    const h = gregorianToHijri(d);
    if (h.year === year && h.month === month && h.day === day) return d;
  }
  return candidate;
}

function getHijriMonthLength(year: number, month: number): number {
  const first = hijriToGregorian(year, month, 1);
  const nm = month === 12 ? 1 : month + 1;
  const ny = month === 12 ? year + 1 : year;
  const next = hijriToGregorian(ny, nm, 1);
  return Math.round((next.getTime() - first.getTime()) / 86_400_000);
}

/** Sunday = 0 …  Saturday = 6  (matches Date.getDay()) */
function getFirstWeekdayOfHijriMonth(year: number, month: number): number {
  return hijriToGregorian(year, month, 1).getDay();
}

function formatHijriValue(year: number, month: number, day: number): string {
  return `${year}/${String(month).padStart(2, "0")}/${String(day).padStart(2, "0")}`;
}

export function gregorianStringToHijriValue(value?: string | null): string {
  if (!value) return "";
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return "";
  const hijri = gregorianToHijri(date);
  return formatHijriValue(hijri.year, hijri.month, hijri.day);
}

export function hijriValueToGregorianString(value?: string | null): string {
  if (!value) return "";
  const parsed = parseHijriValue(value);
  if (!parsed) return "";
  const date = hijriToGregorian(parsed.year, parsed.month, parsed.day);
  return [
    date.getUTCFullYear(),
    String(date.getUTCMonth() + 1).padStart(2, "0"),
    String(date.getUTCDate()).padStart(2, "0"),
  ].join("-");
}

function parseHijriValue(value: string): { year: number; month: number; day: number } | null {
  const match = value.match(/^(\d{4})\/(\d{1,2})\/(\d{1,2})$/);
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

// ─── Arabic labels ────────────────────────────────────────────────────────────

const HIJRI_MONTHS = [
  "محرم", "صفر", "ربيع الأول", "ربيع الآخر",
  "جمادى الأولى", "جمادى الآخرة", "رجب", "شعبان",
  "رمضان", "شوال", "ذو القعدة", "ذو الحجة",
];

// Week starts Sunday (Ahad) in Saudi Arabia
const WEEKDAYS = ["أحد", "اثن", "ثلا", "أرب", "خمي", "جمع", "سبت"];

// ─── Component ────────────────────────────────────────────────────────────────

interface HijriDatePickerProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  hasError?: boolean;
}

export function HijriDatePicker({
  value,
  onChange,
  placeholder = "اختر التاريخ الهجري",
  className,
  hasError,
}: HijriDatePickerProps) {
  const today = gregorianToHijri(new Date());

  const [open, setOpen] = React.useState(false);

  // Which month/year we're viewing in the calendar
  const initialView = React.useMemo(() => {
    const parsed = value ? parseHijriValue(value) : null;
    return parsed ?? { year: today.year, month: today.month };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const [viewYear, setViewYear] = React.useState(initialView.year);
  const [viewMonth, setViewMonth] = React.useState(initialView.month);

  // Sync view when popover opens
  const handleOpenChange = (o: boolean) => {
    if (o) {
      const parsed = value ? parseHijriValue(value) : null;
      setViewYear(parsed?.year ?? today.year);
      setViewMonth(parsed?.month ?? today.month);
    }
    setOpen(o);
  };

  const prevMonth = () => {
    if (viewMonth === 1) { setViewMonth(12); setViewYear((y) => y - 1); }
    else setViewMonth((m) => m - 1);
  };
  const nextMonth = () => {
    if (viewMonth === 12) { setViewMonth(1); setViewYear((y) => y + 1); }
    else setViewMonth((m) => m + 1);
  };

  const selectedParsed = value ? parseHijriValue(value) : null;
  const monthLen = getHijriMonthLength(viewYear, viewMonth);
  const firstWeekday = getFirstWeekdayOfHijriMonth(viewYear, viewMonth);

  const handleDayClick = (day: number) => {
    onChange(formatHijriValue(viewYear, viewMonth, day));
    setOpen(false);
  };

  // Build grid: leading empty cells + day cells
  const cells: Array<{ type: "empty" } | { type: "day"; day: number }> = [
    ...Array.from({ length: firstWeekday }, () => ({ type: "empty" as const })),
    ...Array.from({ length: monthLen }, (_, i) => ({ type: "day" as const, day: i + 1 })),
  ];

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className={cn(
            "flex h-9 w-full items-center justify-between rounded-md border bg-background px-3 py-2 text-sm ring-offset-background",
            "focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
            "hover:bg-muted/40 transition-colors",
            hasError ? "border-destructive" : "border-input",
            !value && "text-muted-foreground",
            className,
          )}
        >
          <span className="font-medium">{value || placeholder}</span>
          <CalendarDays className="h-4 w-4 text-muted-foreground shrink-0 ms-2" />
        </button>
      </PopoverTrigger>

      <PopoverContent
        align="start"
        side="bottom"
        className="w-[300px] p-0 shadow-lg"
        dir="rtl"
      >
        {/* ── Header ── */}
        <div className="flex items-center justify-between gap-1 border-b px-3 py-2.5 bg-muted/30">
          <button
            type="button"
            onClick={nextMonth}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="الشهر التالي"
          >
            <ChevronRight className="h-4 w-4" />
          </button>

          <span className="text-sm font-semibold select-none">
            {HIJRI_MONTHS[viewMonth - 1]}{" "}
            <span className="text-primary">{viewYear}</span>
          </span>

          <button
            type="button"
            onClick={prevMonth}
            className="p-1 rounded hover:bg-muted transition-colors"
            aria-label="الشهر السابق"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </div>

        {/* ── Weekday labels ── */}
        <div className="grid grid-cols-7 border-b px-2 pt-2 pb-1">
          {WEEKDAYS.map((d) => (
            <div key={d} className="text-center text-[11px] font-medium text-muted-foreground py-0.5">
              {d}
            </div>
          ))}
        </div>

        {/* ── Day grid ── */}
        <div className="grid grid-cols-7 gap-px px-2 py-2">
          {cells.map((cell, i) => {
            if (cell.type === "empty") {
              return <div key={`e-${i}`} />;
            }

            const day = cell.day;
            const isToday =
              today.year === viewYear && today.month === viewMonth && today.day === day;
            const isSelected =
              selectedParsed &&
              selectedParsed.year === viewYear &&
              selectedParsed.month === viewMonth &&
              selectedParsed.day === day;

            return (
              <button
                key={day}
                type="button"
                onClick={() => handleDayClick(day)}
                className={cn(
                  "aspect-square w-full text-sm rounded-md flex items-center justify-center transition-colors",
                  isSelected
                    ? "bg-primary text-primary-foreground font-bold shadow-sm"
                    : isToday
                    ? "bg-primary/15 text-primary font-semibold ring-1 ring-primary/40"
                    : "hover:bg-muted text-foreground",
                )}
              >
                {day}
              </button>
            );
          })}
        </div>

        {/* ── Footer: jump to today ── */}
        <div className="border-t px-3 py-2 flex justify-center">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="text-xs h-7"
            onClick={() => {
              setViewYear(today.year);
              setViewMonth(today.month);
            }}
          >
            الذهاب إلى اليوم
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
