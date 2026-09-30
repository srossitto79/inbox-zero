import {
  BarChartBigIcon,
  BrushIcon,
  InboxIcon,
  SparklesIcon,
  WrenchIcon,
  type LucideIcon,
} from "lucide-react";

export type ShellItem = {
  name: string;
  path: `/${string}`;
  /** Only shown when the matching feature flag is on. */
  flag?: "cleaner" | "meetingBriefs" | "meetingRecorder" | "integrations";
};

export type ShellSection = {
  id: "mail" | "assistant" | "cleanup" | "insights" | "tools";
  label: string;
  icon: LucideIcon;
  path: `/${string}`;
  /** First path segments (after the account id) that belong to this section. */
  segments: string[];
  items: ShellItem[];
};

export const SHELL_SECTIONS: ShellSection[] = [
  {
    id: "mail",
    label: "Mail",
    icon: InboxIcon,
    path: "/mail",
    segments: ["mail", "compose"],
    items: [],
  },
  {
    id: "assistant",
    label: "Assistant",
    icon: SparklesIcon,
    path: "/assistant",
    segments: ["assistant", "automation", "channels", "reply-zero"],
    items: [
      { name: "Chat", path: "/assistant" },
      { name: "Rules", path: "/automation" },
      { name: "Channels", path: "/channels" },
      { name: "Reply tracking", path: "/reply-zero" },
    ],
  },
  {
    id: "cleanup",
    label: "Cleanup",
    icon: BrushIcon,
    path: "/bulk-unsubscribe",
    segments: [
      "bulk-unsubscribe",
      "bulk-archive",
      "quick-bulk-archive",
      "smart-categories",
      "cold-email-blocker",
      "no-reply",
      "clean",
    ],
    items: [
      { name: "Bulk unsubscribe", path: "/bulk-unsubscribe" },
      { name: "Bulk archive", path: "/bulk-archive" },
      { name: "Sender categories", path: "/smart-categories" },
      { name: "Cold email blocker", path: "/cold-email-blocker" },
      { name: "No-reply senders", path: "/no-reply" },
      { name: "Deep clean", path: "/clean", flag: "cleaner" },
    ],
  },
  {
    id: "insights",
    label: "Insights",
    icon: BarChartBigIcon,
    path: "/stats",
    segments: ["stats", "usage"],
    items: [
      { name: "Analytics", path: "/stats" },
      { name: "Usage", path: "/usage" },
    ],
  },
  {
    id: "tools",
    label: "Tools",
    icon: WrenchIcon,
    path: "/calendars",
    segments: ["calendars", "drive", "briefs", "integrations", "meetings"],
    items: [
      { name: "Calendars", path: "/calendars" },
      { name: "Attachments", path: "/drive" },
      { name: "Meeting briefs", path: "/briefs", flag: "meetingBriefs" },
      { name: "Meetings", path: "/meetings", flag: "meetingRecorder" },
      { name: "Integrations", path: "/integrations", flag: "integrations" },
    ],
  },
];

export const MAIL_VIEWS = [
  { name: "Inbox", type: "inbox" },
  { name: "Drafts", type: "draft" },
  { name: "Sent", type: "sent" },
  { name: "Archive", type: "archive" },
] as const;

/** Queues are the labels the assistant already applies, matched by name. */
export const QUEUES = [
  { id: "reply", name: "To reply", labels: ["to reply"] },
  { id: "waiting", name: "Waiting on others", labels: ["awaiting reply"] },
  { id: "fyi", name: "FYI", labels: ["fyi"] },
  { id: "newsletter", name: "Newsletters", labels: ["newsletter"] },
  { id: "receipt", name: "Receipts", labels: ["receipt"] },
  { id: "calendar", name: "Calendar", labels: ["calendar"] },
] as const;

export function getActiveSection(pathname: string): ShellSection {
  const segment = pathname.split("/").filter(Boolean)[1];
  return (
    SHELL_SECTIONS.find((section) => section.segments.includes(segment)) ??
    SHELL_SECTIONS[1]
  );
}
