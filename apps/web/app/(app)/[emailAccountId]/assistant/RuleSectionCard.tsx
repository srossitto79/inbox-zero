import { TypographyH3 } from "@/components/Typography";
import { cn } from "@/utils";

export function RuleSectionCard({
  icon: Icon,
  color,
  title,
  errors,
  children,
  className,
}: {
  icon: React.ComponentType<{ className?: string }>;
  color: "blue" | "green";
  title: string;
  errors?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={className}>
      <div className="flex items-center gap-3">
        <Icon
          className={cn("size-5", {
            "text-brand": color === "blue",
            "text-queue-receipt": color === "green",
          })}
        />
        <TypographyH3 className="font-display text-lg font-semibold">
          {title}
        </TypographyH3>
      </div>

      {errors && <div className="mt-2">{errors}</div>}

      {children && <div className="mt-4 space-y-2">{children}</div>}
    </div>
  );
}
