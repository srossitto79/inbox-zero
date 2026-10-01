export type LayoutSegment = {
  id: string;
  /** Minutes from local midnight. */
  start: number;
  end: number;
};

export type LayoutPlacement = {
  id: string;
  /** Zero-based column inside the cluster of overlapping events. */
  column: number;
  /** Columns in the cluster. */
  columns: number;
  /** Columns this event spans; widens into free columns to its right. */
  span: number;
};

// A 5-minute event still needs room to be read and clicked, so overlap is
// judged on at least this height.
const MIN_LAYOUT_MINUTES = 20;

/**
 * Places the timed events of one day side by side. Events that overlap, even
 * through a chain of other events, share a cluster and split its width. Each
 * event takes the first free column and then widens into free columns to its
 * right so a lone event beside a busy slot is not squeezed.
 */
export function layoutDayEvents(segments: LayoutSegment[]): LayoutPlacement[] {
  const sorted = segments
    .map((segment) => ({
      ...segment,
      layoutEnd: Math.max(segment.end, segment.start + MIN_LAYOUT_MINUTES),
    }))
    .sort(
      (a, b) =>
        a.start - b.start ||
        b.layoutEnd - a.layoutEnd ||
        a.id.localeCompare(b.id),
    );

  const placements: LayoutPlacement[] = [];
  let cluster: typeof sorted = [];
  let clusterEnd = Number.NEGATIVE_INFINITY;

  for (const segment of sorted) {
    if (cluster.length > 0 && segment.start >= clusterEnd) {
      placements.push(...placeCluster(cluster));
      cluster = [];
      clusterEnd = Number.NEGATIVE_INFINITY;
    }
    cluster.push(segment);
    clusterEnd = Math.max(clusterEnd, segment.layoutEnd);
  }
  if (cluster.length > 0) placements.push(...placeCluster(cluster));

  return placements;
}

type ClusterSegment = LayoutSegment & { layoutEnd: number };

function placeCluster(cluster: ClusterSegment[]): LayoutPlacement[] {
  const columnEnds: number[] = [];
  const assigned = cluster.map((segment) => {
    let column = columnEnds.findIndex((end) => end <= segment.start);
    if (column === -1) column = columnEnds.length;
    columnEnds[column] = segment.layoutEnd;
    return { segment, column };
  });
  const columns = columnEnds.length;

  return assigned.map(({ segment, column }) => {
    let span = 1;
    while (column + span < columns) {
      const blocked = assigned.some(
        (other) =>
          other.column === column + span &&
          other.segment.start < segment.layoutEnd &&
          other.segment.layoutEnd > segment.start,
      );
      if (blocked) break;
      span += 1;
    }
    return { id: segment.id, column, columns, span };
  });
}
