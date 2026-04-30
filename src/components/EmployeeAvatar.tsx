import { cn } from "@/lib/utils";

export interface EmployeeAvatarData {
  id?: string;
  name: string;
  color?: string | null;
  photo_url?: string | null;
  role?: string | null;
}

const SIZE_CLASSES: Record<string, string> = {
  xs: "h-5 w-5 text-[9px]",
  sm: "h-6 w-6 text-[10px]",
  md: "h-7 w-7 text-[11px]",
  lg: "h-9 w-9 text-xs",
  xl: "h-12 w-12 text-sm",
};

const getInitials = (name: string) => {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
};

export function EmployeeAvatar({
  employee,
  size = "md",
  className,
  ring = true,
  title,
}: {
  employee: EmployeeAvatarData;
  size?: keyof typeof SIZE_CLASSES;
  className?: string;
  ring?: boolean;
  title?: string;
}) {
  const bg = employee.color || "#7B61FF";
  return (
    <div
      title={title ?? `${employee.name}${employee.role ? ` · ${employee.role}` : ""}`}
      className={cn(
        "relative inline-flex shrink-0 aspect-square items-center justify-center rounded-full font-semibold text-white shadow-sm overflow-hidden",
        ring && "ring-2 ring-white",
        SIZE_CLASSES[size],
        className,
      )}
      style={{ backgroundColor: bg }}
    >
      {employee.photo_url ? (
        <img
          src={employee.photo_url}
          alt={employee.name}
          loading="lazy"
          className="absolute inset-0 h-full w-full aspect-square rounded-full object-cover object-center"
          onError={(e) => {
            (e.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      ) : null}
      {!employee.photo_url && <span className="select-none">{getInitials(employee.name)}</span>}
    </div>
  );
}

export function EmployeeAvatarStack({
  employees,
  size = "sm",
  max = 3,
}: {
  employees: EmployeeAvatarData[];
  size?: keyof typeof SIZE_CLASSES;
  max?: number;
}) {
  if (!employees?.length) return null;
  const visible = employees.slice(0, max);
  const overflow = employees.length - visible.length;
  return (
    <div className="flex -space-x-2">
      {visible.map((e, i) => (
        <EmployeeAvatar key={e.id || `${e.name}-${i}`} employee={e} size={size} />
      ))}
      {overflow > 0 && (
        <div
          className={cn(
            "relative inline-flex shrink-0 items-center justify-center rounded-full bg-muted text-foreground/70 font-semibold ring-2 ring-white",
            SIZE_CLASSES[size],
          )}
        >
          +{overflow}
        </div>
      )}
    </div>
  );
}
