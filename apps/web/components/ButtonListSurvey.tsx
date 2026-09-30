import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/utils";

export function ButtonListSurvey({
  options,
  onClick,
  className,
}: {
  options: {
    label: string;
    value: string;
    recommended?: boolean;
  }[];
  onClick: (value: string) => void;
  className?: string;
}) {
  return (
    <div className={cn("mx-auto flex max-w-lg flex-col gap-3", className)}>
      {options.map((option) => (
        <Button
          key={option.value}
          variant="outline"
          onClick={() => onClick(option.value)}
          className={cn(
            "relative h-14 w-full rounded-2xl bg-card text-base hover:border-brand hover:bg-muted/50",
            option.recommended && "border-brand ring-1 ring-inset ring-brand",
          )}
        >
          <span className="absolute inset-0 flex items-center justify-center">
            {option.label}
          </span>
          {option.recommended && (
            <span className="relative ml-auto">
              <Badge className="ml-2">Recommended</Badge>
            </span>
          )}
        </Button>
      ))}
    </div>
  );
}
