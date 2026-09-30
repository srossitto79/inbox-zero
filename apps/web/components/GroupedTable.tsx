"use client";

import Link from "next/link";
import { Fragment, useMemo } from "react";
import { useQueryState } from "nuqs";
import { useLocalStorage } from "usehooks-ts";
import groupBy from "lodash/groupBy";
import {
  useReactTable,
  getCoreRowModel,
  getExpandedRowModel,
  type ColumnDef,
  flexRender,
} from "@tanstack/react-table";
import {
  ArchiveIcon,
  ChevronRight,
  MoreVerticalIcon,
  PencilIcon,
  BookmarkXIcon,
  LayoutGridIcon,
  ListIcon,
} from "lucide-react";
import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { EmailCell } from "@/components/EmailCell";
import { useThreads } from "@/hooks/useThreads";
import { Skeleton } from "@/components/ui/skeleton";
import { decodeSnippet } from "@/utils/gmail/decode";
import { formatShortDate } from "@/utils/date";
import { cn } from "@/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  changeSenderCategoryAction,
  removeAllFromCategoryAction,
} from "@/utils/actions/categorize";
import { toastError, toastSuccess } from "@/components/Toast";
import { Button } from "@/components/ui/button";
import {
  useArchiveSenderStatus,
  useArchiveSenderQueueActions,
} from "@/store/archive-sender-queue";
import { getEmailUrl, getGmailSearchUrl } from "@/utils/url";
import { MessageText } from "@/components/Typography";
import { CreateCategoryDialog } from "@/app/(app)/[emailAccountId]/smart-categories/CreateCategoryButton";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { CategoryWithRules } from "@/utils/category.server";
import { ViewEmailButton } from "@/components/ViewEmailButton";
import { CategorySelect } from "@/components/CategorySelect";
import { useAccount } from "@/providers/EmailAccountProvider";
import { InitialsAvatar } from "@/components/ui/initials-avatar";

const COLUMNS = 4;

type EmailGroup = {
  address: string;
  name?: string | null;
  category: CategoryWithRules | null;
  meta?: { width?: string };
};

export function GroupedTable({
  emailGroups,
  categories,
}: {
  emailGroups: EmailGroup[];
  categories: CategoryWithRules[];
}) {
  const { emailAccountId, userEmail } = useAccount();
  const { queueArchiveSenders } = useArchiveSenderQueueActions(emailAccountId);

  const categoryMap = useMemo(
    () =>
      categories.reduce<Record<string, CategoryWithRules>>((acc, category) => {
        acc[category.name] = category;
        return acc;
      }, {}),
    [categories],
  );

  const groupedEmails = useMemo(() => {
    const grouped = groupBy(
      emailGroups,
      (group) =>
        categoryMap[group.category?.name || ""]?.name || "Uncategorized",
    );

    // Add empty arrays for categories without any emails
    for (const category of categories) {
      if (!grouped[category.name]) {
        grouped[category.name] = [];
      }
    }

    return grouped;
  }, [emailGroups, categories, categoryMap]);

  const [expanded, setExpanded] = useQueryState("expanded", {
    parse: (value) => value.split(","),
    serialize: (value) => value.join(","),
  });

  const columns: ColumnDef<EmailGroup>[] = useMemo(
    () => [
      {
        id: "expander",
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              className="p-2"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 transform transition-all duration-300 ease-in-out",
                  row.getIsExpanded() ? "rotate-90" : "rotate-0",
                )}
              />
            </button>
          ) : null,
        meta: { size: "20px" },
      },
      {
        accessorKey: "address",
        cell: ({ row }) => (
          <Link
            href={getGmailSearchUrl(row.original.address, userEmail)}
            target="_blank"
            className="hover:underline"
          >
            <div className="flex items-center justify-between">
              <EmailCell
                emailAddress={row.original.address}
                className="flex gap-2"
              />
            </div>
          </Link>
        ),
      },
      {
        accessorKey: "preview",
        cell: ({ row }) => (
          <ArchiveStatusCell
            emailAccountId={emailAccountId}
            sender={row.original.address}
          />
        ),
      },
      {
        accessorKey: "date",
        cell: ({ row }) => (
          <Select
            defaultValue={row.original.category?.id || ""}
            onValueChange={async (value) => {
              const result = await changeSenderCategoryAction(emailAccountId, {
                sender: row.original.address,
                categoryId: value,
              });

              if (result?.serverError) {
                toastError({ description: result.serverError });
              } else {
                toastSuccess({ description: "Category changed" });
              }
            }}
          >
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="Select category" />
            </SelectTrigger>
            <SelectContent>
              {categories.map((category) => (
                <SelectItem key={category.id} value={category.id.toString()}>
                  {category.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        ),
      },
    ],
    [categories, userEmail, emailAccountId],
  );

  const table = useReactTable({
    data: emailGroups,
    columns,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  const [selectedCategoryName, setSelectedCategoryName] =
    useQueryState("categoryName");

  const [viewMode, setViewMode] = useLocalStorage<CategoryView>(
    "smart-categories-view",
    "grid",
    { initializeWithValue: false },
  );

  return (
    <>
      <div className="flex justify-end px-4 pt-4">
        <ViewToggle value={viewMode} onChange={setViewMode} />
      </div>
      {viewMode === "grid" ? (
        <div className="grid grid-cols-1 gap-4 p-4 md:grid-cols-2 xl:grid-cols-3">
          {Object.entries(groupedEmails).map(([categoryName, senders]) => {
            const category = categoryMap[categoryName];
            if (!category) return null;
            const isCategoryExpanded = !!expanded?.includes(categoryName);
            return (
              <CategoryCard
                key={categoryName}
                category={category}
                senders={senders}
                categories={categories}
                isExpanded={isCategoryExpanded}
                onToggle={() =>
                  setExpanded((prev) =>
                    isCategoryExpanded
                      ? (prev || []).filter((c) => c !== categoryName)
                      : [...(prev || []), categoryName],
                  )
                }
                onArchiveAll={() =>
                  queueArchiveSenders({
                    senders: senders.map((sender) => sender.address),
                  })
                }
                onEditCategory={() => setSelectedCategoryName(categoryName)}
                onRemoveAllFromCategory={() =>
                  removeAllFromCategory({ emailAccountId, categoryName })
                }
              />
            );
          })}
        </div>
      ) : (
        <Table>
          <TableBody>
            {Object.entries(groupedEmails).map(([categoryName, senders]) => {
              const isCategoryExpanded = expanded?.includes(categoryName);

              const onArchiveAll = async () => {
                await queueArchiveSenders({
                  senders: senders.map((sender) => sender.address),
                });
              };

              const onEditCategory = () => {
                setSelectedCategoryName(categoryName);
              };

              const onRemoveAllFromCategory = () =>
                removeAllFromCategory({ emailAccountId, categoryName });

              const category = categoryMap[categoryName];

              if (!category) {
                return null;
              }

              return (
                <Fragment key={categoryName}>
                  <GroupRow
                    category={category}
                    count={senders.length}
                    isExpanded={!!isCategoryExpanded}
                    onToggle={() => {
                      setExpanded((prev) =>
                        isCategoryExpanded
                          ? (prev || []).filter((c) => c !== categoryName)
                          : [...(prev || []), categoryName],
                      );
                    }}
                    onArchiveAll={onArchiveAll}
                    onEditCategory={onEditCategory}
                    onRemoveAllFromCategory={onRemoveAllFromCategory}
                  />
                  {isCategoryExpanded && (
                    <SenderRows
                      table={table}
                      senders={senders}
                      userEmail={userEmail}
                    />
                  )}
                </Fragment>
              );
            })}
          </TableBody>
        </Table>
      )}

      <CreateCategoryDialog
        isOpen={selectedCategoryName !== null}
        onOpenChange={(open) =>
          setSelectedCategoryName(open ? selectedCategoryName : null)
        }
        closeModal={() => setSelectedCategoryName(null)}
        category={
          selectedCategoryName
            ? categories.find((c) => c.name === selectedCategoryName)
            : undefined
        }
      />
    </>
  );
}

export function SendersTable({
  senders,
  categories,
}: {
  senders: EmailGroup[];
  categories: CategoryWithRules[];
}) {
  const { emailAccountId, userEmail } = useAccount();

  const columns: ColumnDef<EmailGroup>[] = useMemo(
    () => [
      {
        id: "expander",
        cell: ({ row }) =>
          row.getCanExpand() ? (
            <button
              type="button"
              onClick={row.getToggleExpandedHandler()}
              className="p-2"
            >
              <ChevronRight
                className={cn(
                  "h-4 w-4 transform transition-all duration-300 ease-in-out",
                  row.getIsExpanded() ? "rotate-90" : "rotate-0",
                )}
              />
            </button>
          ) : null,
        meta: { size: "20px" },
      },
      {
        accessorKey: "address",
        cell: ({ row }) => (
          <div className="flex items-center justify-between">
            <EmailCell
              emailAddress={row.original.address}
              name={row.original.name}
              className="flex gap-2"
            />
          </div>
        ),
      },
      {
        accessorKey: "preview",
      },
      {
        accessorKey: "category",
        cell: ({ row }) => (
          <CategorySelect
            emailAccountId={emailAccountId}
            sender={row.original.address}
            senderCategory={row.original.category}
            categories={categories}
          />
        ),
      },
    ],
    [categories, emailAccountId],
  );

  const table = useReactTable({
    data: senders,
    columns,
    getRowCanExpand: () => true,
    getCoreRowModel: getCoreRowModel(),
    getExpandedRowModel: getExpandedRowModel(),
  });

  return (
    <Table>
      <TableBody>
        <SenderRows table={table} senders={senders} userEmail={userEmail} />
      </TableBody>
    </Table>
  );
}

function GroupRow({
  category,
  count,
  isExpanded,
  onToggle,
  onArchiveAll,
  onEditCategory,
  onRemoveAllFromCategory,
}: {
  category: CategoryWithRules;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
  onArchiveAll: () => void;
  onEditCategory: () => void;
  onRemoveAllFromCategory: () => void;
}) {
  return (
    <TableRow className="h-8 cursor-pointer bg-muted/50">
      <TableCell
        colSpan={3}
        className="py-1 text-sm font-medium text-foreground"
        onClick={onToggle}
      >
        <div className="flex items-center">
          <ChevronRight
            className={cn(
              "mr-2 size-4 transform transition-all duration-300 ease-in-out",
              isExpanded ? "rotate-90" : "rotate-0",
            )}
          />
          {category.name}
          <span className="ml-2 text-xs text-muted-foreground">({count})</span>
        </div>
      </TableCell>
      <TableCell className="flex justify-end gap-1.5 py-1">
        <CategoryActionsMenu
          onEditCategory={onEditCategory}
          onRemoveAllFromCategory={onRemoveAllFromCategory}
        />

        <Button variant="outline" size="xs" onClick={onArchiveAll}>
          <ArchiveIcon className="mr-2 size-4" />
          Archive all
        </Button>
      </TableCell>
    </TableRow>
  );
}

function CategoryActionsMenu({
  onEditCategory,
  onRemoveAllFromCategory,
}: {
  onEditCategory: () => void;
  onRemoveAllFromCategory: () => void;
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="xs">
          <MoreVerticalIcon className="size-4" />
          <span className="sr-only">More</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuItem onClick={onEditCategory}>
          <PencilIcon className="mr-2 size-4" />
          Edit
        </DropdownMenuItem>
        <DropdownMenuItem onClick={onRemoveAllFromCategory}>
          <BookmarkXIcon className="mr-2 size-4" />
          Remove All From Category
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function ViewToggle({
  value,
  onChange,
}: {
  value: CategoryView;
  onChange: (value: CategoryView) => void;
}) {
  return (
    <div className="flex rounded-xl bg-muted p-0.5">
      {(
        [
          { mode: "grid", label: "Grid view", icon: LayoutGridIcon },
          { mode: "list", label: "List view", icon: ListIcon },
        ] as const
      ).map(({ mode, label, icon: Icon }) => (
        <button
          key={mode}
          type="button"
          aria-label={label}
          aria-pressed={value === mode}
          title={label}
          onClick={() => onChange(mode)}
          className={cn(
            "rounded-lg px-2.5 py-1.5 text-muted-foreground transition-colors",
            value === mode && "bg-card text-foreground shadow-sm",
          )}
        >
          <Icon className="size-4" />
        </button>
      ))}
    </div>
  );
}

function CategoryCard({
  category,
  senders,
  categories,
  isExpanded,
  onToggle,
  onArchiveAll,
  onEditCategory,
  onRemoveAllFromCategory,
}: {
  category: CategoryWithRules;
  senders: EmailGroup[];
  categories: CategoryWithRules[];
  isExpanded: boolean;
  onToggle: () => void;
  onArchiveAll: () => void;
  onEditCategory: () => void;
  onRemoveAllFromCategory: () => void;
}) {
  const { emailAccountId } = useAccount();

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4">
      <div className="flex items-center gap-2">
        <span
          aria-hidden
          className={cn(
            "size-2.5 shrink-0 rounded-full",
            getDotColor(category.name),
          )}
        />
        <button
          type="button"
          aria-expanded={isExpanded}
          onClick={onToggle}
          className="flex min-w-0 flex-1 items-baseline gap-2 text-left"
        >
          <span className="truncate text-sm font-semibold">
            {category.name}
          </span>
          <span className="text-xs text-muted-foreground">
            {senders.length.toLocaleString()}{" "}
            {senders.length === 1 ? "sender" : "senders"}
          </span>
        </button>
        <CategoryActionsMenu
          onEditCategory={onEditCategory}
          onRemoveAllFromCategory={onRemoveAllFromCategory}
        />
      </div>

      {category.description && (
        <p className="line-clamp-2 text-xs text-muted-foreground">
          {category.description}
        </p>
      )}

      <div className="flex items-center justify-between gap-2">
        <div className="flex -space-x-2">
          {senders.slice(0, 5).map((sender) => (
            <InitialsAvatar
              key={sender.address}
              name={sender.name || sender.address}
              seed={sender.address}
              size="sm"
              className="ring-2 ring-card"
            />
          ))}
        </div>
        <Button variant="outline" size="xs" onClick={onArchiveAll}>
          <ArchiveIcon className="mr-2 size-4" />
          Archive all
        </Button>
      </div>

      {isExpanded && (
        <div className="flex flex-col gap-2 border-t border-border pt-3">
          {senders.length ? (
            senders.map((sender) => (
              <div
                key={sender.address}
                className="flex items-center justify-between gap-2"
              >
                <EmailCell
                  emailAddress={sender.address}
                  name={sender.name}
                  className="flex min-w-0 gap-2"
                />
                <CategorySelect
                  emailAccountId={emailAccountId}
                  sender={sender.address}
                  senderCategory={sender.category}
                  categories={categories}
                />
              </div>
            ))
          ) : (
            <MessageText>This category is empty</MessageText>
          )}
        </div>
      )}
    </div>
  );
}

function SenderRows({
  table,
  senders,
  userEmail,
}: {
  table: ReturnType<typeof useReactTable<EmailGroup>>;
  senders: EmailGroup[];
  userEmail: string;
}) {
  if (!senders.length) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMNS}>
          <MessageText>This category is empty</MessageText>
        </TableCell>
      </TableRow>
    );
  }

  return senders.map((sender) => {
    const row = table
      .getRowModel()
      .rows.find((r) => r.original.address === sender.address);
    if (!row) return null;
    return (
      <Fragment key={row.id}>
        <TableRow>
          {row.getVisibleCells().map((cell) => (
            <TableCell
              key={cell.id}
              style={{
                width:
                  (cell.column.columnDef.meta as { size?: string } | undefined)
                    ?.size || "auto",
              }}
              className="py-1"
            >
              {flexRender(cell.column.columnDef.cell, cell.getContext())}
            </TableCell>
          ))}
        </TableRow>
        {row.getIsExpanded() && (
          <ExpandedRows sender={row.original.address} userEmail={userEmail} />
        )}
      </Fragment>
    );
  });
}

function ExpandedRows({
  sender,
  userEmail,
}: {
  sender: string;
  userEmail: string;
}) {
  const { provider } = useAccount();

  const { data, isLoading, error } = useThreads({
    fromEmail: sender,
    limit: 5,
    type: "all",
  });

  if (isLoading) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMNS}>
          <Skeleton className="h-10 w-full" />
        </TableCell>
      </TableRow>
    );
  }

  if (error) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMNS}>Error loading emails</TableCell>
      </TableRow>
    );
  }

  if (!data?.threads.length) {
    return (
      <TableRow>
        <TableCell colSpan={COLUMNS}>No emails found</TableCell>
      </TableRow>
    );
  }

  return (
    <>
      {data.threads.map((thread) => {
        const firstMessage = thread.messages[0];
        const subject = firstMessage.subject;
        const date = firstMessage.date;

        return (
          <TableRow key={thread.id} className="bg-muted/50">
            <TableCell className="py-3">
              <ViewEmailButton threadId={thread.id} messageId={thread.id} />
            </TableCell>
            <TableCell className="py-3">
              <Link
                href={getEmailUrl(thread.id, userEmail, provider)}
                target="_blank"
                className="hover:underline"
              >
                {subject}
              </Link>
            </TableCell>
            <TableCell className="py-3">
              {decodeSnippet(thread.messages[0].snippet)}
            </TableCell>
            <TableCell className="text-nowrap py-3">
              {formatShortDate(new Date(date))}
            </TableCell>
          </TableRow>
        );
      })}
    </>
  );
}

function ArchiveStatusCell({
  emailAccountId,
  sender,
}: {
  emailAccountId: string;
  sender: string;
}) {
  const status = useArchiveSenderStatus(emailAccountId, sender);

  switch (status?.status) {
    case "pending":
      return <span className="text-muted-foreground">Queued</span>;
    case "processing":
      return (
        <span className="text-queue-waiting">
          {status.threadsTotal
            ? `${status.threadsTotal - status.threadIds.length} / ${status.threadsTotal}`
            : "Archiving..."}
        </span>
      );
    case "completed":
      return (
        <span className="text-muted-foreground">
          {status.threadsTotal ? `Archived ${status.threadsTotal}` : "Archived"}
        </span>
      );
    case "failed":
      return <span className="text-destructive">Failed</span>;
    default:
      return null;
  }
}

type CategoryView = "grid" | "list";

const DOT_COLORS = [
  "bg-queue-reply",
  "bg-queue-waiting",
  "bg-queue-newsletter",
  "bg-queue-receipt",
  "bg-queue-calendar",
  "bg-queue-fyi",
];

// Categories have no stored color, so derive a stable one from the name.
function getDotColor(name: string) {
  let hash = 0;
  for (const char of name) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return DOT_COLORS[hash % DOT_COLORS.length];
}

async function removeAllFromCategory({
  emailAccountId,
  categoryName,
}: {
  emailAccountId: string;
  categoryName: string;
}) {
  const yes = confirm(
    "This will remove all emails from this category. You can re-categorize them later. Do you want to continue?",
  );
  if (!yes) return;
  const result = await removeAllFromCategoryAction(emailAccountId, {
    categoryName,
  });

  if (result?.serverError) {
    toastError({ description: result.serverError });
  } else {
    toastSuccess({ description: "All emails removed from category" });
  }
}
