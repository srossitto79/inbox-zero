"use client";

import { ColdEmailList } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailList";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ColdEmailRejected } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailRejected";
import { ColdEmailTest } from "@/app/(app)/[emailAccountId]/cold-email-blocker/ColdEmailTest";
import { Button } from "@/components/ui/button";
import { prefixPath } from "@/utils/path";
import { useAccount } from "@/providers/EmailAccountProvider";
import Link from "next/link";
import { BanIcon, FileTextIcon, TagsIcon } from "lucide-react";

export function ColdEmailContent({ searchParam }: { searchParam?: string }) {
  const { emailAccountId } = useAccount();

  return (
    <Tabs defaultValue="cold-emails" searchParam={searchParam}>
      <TabsList>
        <TabsTrigger value="cold-emails">Cold Emails</TabsTrigger>
        <TabsTrigger value="rejected">Marked Not Cold</TabsTrigger>
        <TabsTrigger value="test">Test</TabsTrigger>
        <TabsTrigger value="settings">Settings</TabsTrigger>
      </TabsList>

      <TabsContent value="test" className="mb-10">
        <ColdEmailTest />
      </TabsContent>

      <TabsContent value="cold-emails" className="mb-10">
        <Card>
          <ColdEmailList />
        </Card>
      </TabsContent>
      <TabsContent value="rejected" className="mb-10">
        <Card>
          <ColdEmailRejected />
        </Card>
      </TabsContent>

      <TabsContent value="settings" className="mb-10">
        <div className="grid gap-3 md:grid-cols-3">
          {SETTINGS.map(({ icon: Icon, title }) => (
            <Card key={title} className="flex items-center gap-3 p-4">
              <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand/15 text-brand">
                <Icon className="size-4" />
              </span>
              <span className="text-sm font-medium">{title}</span>
            </Card>
          ))}
        </div>
        <p className="my-4 text-sm text-muted-foreground">
          To manage cold email settings, go to the Assistant Rules tab and click
          Edit on the Cold Email rule.
        </p>
        <Button asChild variant="outline">
          <Link href={prefixPath(emailAccountId, "/automation?tab=rules")}>
            Go to Assistant Rules
          </Link>
        </Button>
      </TabsContent>
    </Tabs>
  );
}

const SETTINGS = [
  { icon: BanIcon, title: "Blocking policy" },
  { icon: FileTextIcon, title: "Prompt" },
  { icon: TagsIcon, title: "Labels" },
];
