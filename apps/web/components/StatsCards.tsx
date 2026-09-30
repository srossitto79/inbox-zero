import { StatTile } from "@/components/ui/stat-tile";
import { cn } from "@/utils";

export function StatsCards(props: {
  stats: {
    name: string;
    value: string | number;
    subvalue?: string;
    icon: React.ReactNode;
  }[];
}) {
  return (
    <div
      className={cn(
        "grid gap-3 md:grid-cols-2 md:gap-4",
        props.stats.length === 3 ? "lg:grid-cols-3" : "lg:grid-cols-4",
      )}
    >
      {props.stats.map((stat) => (
        <StatTile
          key={stat.name}
          value={stat.value}
          label={
            <span className="flex items-center gap-2">
              <span className="text-brand">{stat.icon}</span>
              {stat.name}
            </span>
          }
          hint={stat.subvalue}
        />
      ))}
    </div>
  );
}
