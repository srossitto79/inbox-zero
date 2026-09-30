"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { PenIcon, SettingsIcon } from "lucide-react";
import { ProfileImage } from "@/components/ProfileImage";
import { AccountSwitcher } from "@/components/AccountSwitcher";
import { NavUser } from "@/components/NavUser";
import { LlmApiStatus } from "@/components/shell/LlmApiStatus";
import {
  getActiveSection,
  MAIL_VIEWS,
  QUEUES,
  SHELL_SECTIONS,
  type ShellItem,
} from "@/components/shell/nav-config";
import { Sidebar, SidebarTrigger, useSidebar } from "@/components/ui/sidebar";
import {
  useCleanerEnabled,
  useIntegrationsEnabled,
  useMeetingBriefsEnabled,
  useMeetingRecorderEnabled,
} from "@/hooks/useFeatureFlags";
import { useLabels } from "@/hooks/useLabels";
import { useAccount } from "@/providers/EmailAccountProvider";
import { useComposeModal } from "@/providers/ComposeModalProvider";
import { cn } from "@/utils";
import { prefixPath } from "@/utils/path";

/**
 * The single shell: an icon rail for the areas of the app and a contextual
 * panel beside it. Collapsing the sidebar leaves just the rail.
 */
export function NewSideNav({ name }: { name: string }) {
  const pathname = usePathname() ?? "";
  const { emailAccountId, emailAccount } = useAccount();
  const section = getActiveSection(pathname);
  const { state } = useSidebar();
  const isOpen = state.includes(name);

  return (
    <Sidebar name={name} collapsible="icon">
      <div className="flex h-full min-w-0">
        <nav
          aria-label="Areas"
          className="flex w-[4.5rem] shrink-0 flex-col items-center gap-1.5 bg-primary py-4 text-primary-foreground"
        >
          <div className="mb-3 flex size-11 items-center justify-center">
            <AccountSwitcher
              trigger={
                <button
                  type="button"
                  title="Accounts"
                  aria-label="Accounts"
                  className="rounded-full ring-2 ring-primary-foreground/25 transition-shadow hover:ring-primary-foreground/60"
                >
                  <ProfileImage
                    image={emailAccount?.image ?? null}
                    label={emailAccount?.name || emailAccount?.email || "?"}
                    className="size-9"
                  />
                </button>
              }
            />
          </div>
          {SHELL_SECTIONS.map((item) => (
            <Link
              key={item.id}
              href={prefixPath(emailAccountId, item.path)}
              title={item.label}
              aria-label={item.label}
              aria-current={item.id === section.id ? "page" : undefined}
              className={cn(
                "flex size-11 items-center justify-center rounded-xl transition-colors",
                item.id === section.id
                  ? "bg-primary-foreground/15 text-primary-foreground"
                  : "text-primary-foreground/55 hover:bg-primary-foreground/10 hover:text-primary-foreground",
              )}
            >
              <item.icon className="size-5" />
            </Link>
          ))}
          <div className="flex-1" />
          <SidebarTrigger
            name={name}
            className="size-11 rounded-xl text-primary-foreground/55 hover:bg-primary-foreground/10 hover:text-primary-foreground"
          />
          <NavUser
            menuSide="right"
            menuAlign="end"
            trigger={
              <button
                type="button"
                title="More options and settings"
                aria-label="More options and settings"
                className="flex size-11 items-center justify-center rounded-xl text-primary-foreground/55 transition-colors hover:bg-primary-foreground/10 hover:text-primary-foreground"
              >
                <SettingsIcon className="size-5" />
              </button>
            }
          />
        </nav>

        {isOpen ? (
          <div className="flex min-w-0 flex-1 flex-col gap-4 border-r border-sidebar-border bg-sidebar px-4 py-4">
            <div className="px-1 pt-1 font-display text-2xl font-semibold leading-tight">
              {section.label}
            </div>
            <ComposeButton />
            {section.id === "mail" ? (
              <MailPanel />
            ) : (
              <SectionPanel items={section.items} />
            )}
            <div className="flex-1" />
            <LlmApiStatus />
          </div>
        ) : null}
      </div>
    </Sidebar>
  );
}

function ComposeButton() {
  const { onOpen } = useComposeModal();
  return (
    <button
      type="button"
      onClick={onOpen}
      className="flex items-center justify-center gap-2 rounded-xl bg-primary px-3 py-3 text-sm font-semibold text-primary-foreground transition-opacity hover:opacity-90"
    >
      <PenIcon className="size-4" />
      Compose
    </button>
  );
}

function SectionPanel({ items }: { items: ShellItem[] }) {
  const pathname = usePathname() ?? "";
  const { emailAccountId } = useAccount();
  const showCleaner = useCleanerEnabled();
  const showBriefs = useMeetingBriefsEnabled();
  const showRecorder = useMeetingRecorderEnabled();
  const showIntegrations = useIntegrationsEnabled();

  const flags = {
    cleaner: showCleaner,
    meetingBriefs: showBriefs,
    meetingRecorder: showRecorder,
    integrations: showIntegrations,
  };

  return (
    <div className="flex flex-col gap-0.5">
      {items
        .filter((item) => !item.flag || flags[item.flag])
        .map((item) => {
          const href = prefixPath(emailAccountId, item.path);
          return (
            <PanelLink
              key={item.path}
              href={href}
              active={pathname === href || pathname.startsWith(`${href}/`)}
            >
              {item.name}
            </PanelLink>
          );
        })}
    </div>
  );
}

function MailPanel() {
  const { emailAccountId } = useAccount();
  const searchParams = useSearchParams();
  const pathname = usePathname() ?? "";
  const { userLabels } = useLabels();
  const activeType = searchParams.get("type") ?? "inbox";
  const activeLabelId = searchParams.get("labelId");
  const onMail = pathname.includes("/mail");

  const queues = useMemo(
    () =>
      QUEUES.map((queue) => ({
        ...queue,
        label: userLabels.find((label) =>
          (queue.labels as readonly string[]).includes(
            label.name.toLowerCase(),
          ),
        ),
      })).filter((queue) => queue.label),
    [userLabels],
  );

  return (
    <>
      <div className="flex flex-col gap-0.5">
        {MAIL_VIEWS.map((view) => (
          <PanelLink
            key={view.type}
            href={prefixPath(emailAccountId, `/mail?type=${view.type}`)}
            active={onMail && !activeLabelId && activeType === view.type}
          >
            {view.name}
          </PanelLink>
        ))}
      </div>
      {queues.length > 0 ? (
        <div className="flex flex-col gap-0.5">
          <PanelHeading>Queues</PanelHeading>
          {queues.map((queue) => (
            <PanelLink
              key={queue.id}
              href={prefixPath(
                emailAccountId,
                `/mail?type=label&labelId=${encodeURIComponent(queue.label?.id ?? "")}`,
              )}
              active={onMail && activeLabelId === queue.label?.id}
              dot={`hsl(var(--queue-${queue.id}))`}
            >
              {queue.name}
            </PanelLink>
          ))}
        </div>
      ) : null}
    </>
  );
}

function PanelHeading({ children }: { children: React.ReactNode }) {
  return (
    <div className="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
      {children}
    </div>
  );
}

function PanelLink({
  href,
  active,
  dot,
  children,
}: {
  href: string;
  active: boolean;
  dot?: string;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-sm transition-colors",
        active
          ? "border-border bg-card font-semibold shadow-sm"
          : "text-sidebar-foreground hover:bg-sidebar-accent",
      )}
    >
      {dot ? (
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: dot }}
        />
      ) : null}
      <span className="truncate">{children}</span>
    </Link>
  );
}
