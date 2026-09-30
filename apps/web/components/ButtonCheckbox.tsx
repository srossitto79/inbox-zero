import { Check, Minus } from "lucide-react";
import { cn } from "@/utils";

export function ButtonCheckbox({
  label,
  checked,
  indeterminate,
  onChange,
}: {
  label: string;
  checked: boolean;
  indeterminate?: boolean;
  onChange: (shiftKey: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-label={label}
      aria-checked={indeterminate ? "mixed" : checked}
      onClick={(e) => {
        e.stopPropagation();
        onChange(e.shiftKey);
      }}
      onDoubleClick={(e) => e.stopPropagation()}
      className={cn(
        "w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all",
        checked || indeterminate
          ? "bg-blue-500 border-blue-500 text-white [[data-palette]_&]:border-primary [[data-palette]_&]:bg-primary [[data-palette]_&]:text-primary-foreground"
          : "border-gray-300 hover:border-gray-400 dark:border-gray-600 dark:hover:border-gray-500 [[data-palette]_&]:border-border [[data-palette]_&]:hover:border-muted-foreground",
      )}
    >
      {checked && <Check className="size-3.5" strokeWidth={3} />}
      {indeterminate && !checked && (
        <Minus className="size-3.5" strokeWidth={3} />
      )}
    </button>
  );
}
