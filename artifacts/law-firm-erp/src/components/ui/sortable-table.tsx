import { useMemo, useState } from "react";
import { TableHead } from "@/components/ui/table";
import { ArrowUp, ArrowDown, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";

export type SortDir = "asc" | "desc";

export type SortAccessor<T> = (item: T) => string | number | Date | boolean | null | undefined;

function readSortStorage(storageKey: string): { sortKey: string | null; sortDir: SortDir } {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return { sortKey: null, sortDir: "asc" };
    const parsed = JSON.parse(raw) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "sortKey" in parsed &&
      "sortDir" in parsed &&
      (parsed as { sortDir: unknown }).sortDir === "asc" ||
      (parsed as { sortDir: unknown }).sortDir === "desc"
    ) {
      return {
        sortKey: ((parsed as { sortKey: unknown }).sortKey as string | null) ?? null,
        sortDir: (parsed as { sortDir: unknown }).sortDir as SortDir,
      };
    }
  } catch {
    // ignore
  }
  return { sortKey: null, sortDir: "asc" };
}

export function useSortable<T>(
  data: T[] | undefined,
  accessors: Record<string, SortAccessor<T>>,
  storageKey?: string,
) {
  const [sortKey, setSortKey] = useState<string | null>(() => {
    if (!storageKey) return null;
    return readSortStorage(storageKey).sortKey;
  });
  const [sortDir, setSortDir] = useState<SortDir>(() => {
    if (!storageKey) return "asc";
    return readSortStorage(storageKey).sortDir;
  });

  const toggle = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => {
        const next = d === "asc" ? "desc" : "asc";
        if (storageKey) {
          try { localStorage.setItem(storageKey, JSON.stringify({ sortKey: key, sortDir: next })); } catch { /* ignore */ }
        }
        return next;
      });
    } else {
      setSortKey(key);
      setSortDir("asc");
      if (storageKey) {
        try { localStorage.setItem(storageKey, JSON.stringify({ sortKey: key, sortDir: "asc" })); } catch { /* ignore */ }
      }
    }
  };

  const sorted = useMemo(() => {
    if (!data || !sortKey) return data;
    const acc = accessors[sortKey];
    if (!acc) return data;
    return [...data].sort((a, b) => {
      const va = acc(a);
      const vb = acc(b);
      const aNull = va === null || va === undefined || va === "";
      const bNull = vb === null || vb === undefined || vb === "";
      if (aNull && bNull) return 0;
      if (aNull) return 1;
      if (bNull) return -1;
      let cmp: number;
      if (typeof va === "number" && typeof vb === "number") {
        cmp = va - vb;
      } else if (va instanceof Date && vb instanceof Date) {
        cmp = va.getTime() - vb.getTime();
      } else if (typeof va === "boolean" && typeof vb === "boolean") {
        cmp = Number(va) - Number(vb);
      } else {
        cmp = String(va).localeCompare(String(vb), "ar");
      }
      return sortDir === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sortKey, sortDir]);

  return { sorted, sortKey, sortDir, toggle };
}

interface SortableHeadProps {
  label: React.ReactNode;
  sortKey: string;
  currentKey: string | null;
  dir: SortDir;
  onToggle: (key: string) => void;
  className?: string;
}

export function SortableHead({ label, sortKey, currentKey, dir, onToggle, className }: SortableHeadProps) {
  const active = currentKey === sortKey;
  return (
    <TableHead className={cn("text-right", className)}>
      <button
        type="button"
        onClick={() => onToggle(sortKey)}
        className={cn(
          "inline-flex items-center gap-1 select-none transition-colors hover:text-foreground",
          active && "text-primary font-semibold",
        )}
      >
        {label}
        {active ? (
          dir === "asc" ? (
            <ArrowUp className="w-3.5 h-3.5 shrink-0" />
          ) : (
            <ArrowDown className="w-3.5 h-3.5 shrink-0" />
          )
        ) : (
          <ChevronsUpDown className="w-3.5 h-3.5 shrink-0 opacity-40" />
        )}
      </button>
    </TableHead>
  );
}

export function IndexHead({ className }: { className?: string }) {
  return <TableHead className={cn("text-right w-12", className)}>م</TableHead>;
}
