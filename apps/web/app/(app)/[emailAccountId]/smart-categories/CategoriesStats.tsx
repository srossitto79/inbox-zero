"use client";

import useSWR from "swr";
import { StatTile } from "@/components/ui/stat-tile";
import type { UncategorizedSendersResponse } from "@/app/api/user/categorize/senders/uncategorized/route";

export function CategoriesStats({
  categoryCount,
  categorizedCount,
}: {
  categoryCount: number;
  categorizedCount: number;
}) {
  const { data } = useSWR<UncategorizedSendersResponse>(
    "/api/user/categorize/senders/uncategorized?offset=0",
    { revalidateOnFocus: false },
  );

  const uncategorized = data
    ? `${data.uncategorizedSenders.length.toLocaleString()}${data.nextOffset ? "+" : ""}`
    : "-";

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
      <StatTile value={categoryCount.toLocaleString()} label="Categories" />
      <StatTile
        value={categorizedCount.toLocaleString()}
        label="Categorized senders"
      />
      <StatTile value={uncategorized} label="Uncategorized" />
    </div>
  );
}
