"use client";

import { useState, useEffect } from "react";
import { motion } from "framer-motion";
import {
  Bold,
  Italic,
  Link,
  List,
  Smile,
  Paperclip,
  Reply,
  ChevronDown,
} from "lucide-react";

export function DraftRepliesIllustration() {
  const [stage, setStage] = useState(1);

  useEffect(() => {
    const timeouts: NodeJS.Timeout[] = [];

    timeouts.push(setTimeout(() => setStage(2), 800));
    timeouts.push(setTimeout(() => setStage(3), 1400));
    timeouts.push(setTimeout(() => setStage(4), 2000));
    timeouts.push(setTimeout(() => setStage(5), 2600));

    return () => timeouts.forEach(clearTimeout);
  }, []);

  return (
    <div className="flex h-[240px] w-full max-w-[360px] sm:w-[400px] sm:max-w-none flex-col justify-center gap-1.5">
      <motion.div
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="rounded-lg border border-border bg-card shadow-sm"
      >
        <div className="flex items-center gap-2 px-3 py-2">
          <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-pink-100 text-[9px] font-semibold text-pink-600">
            SC
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold text-foreground">
                Sarah Chen
              </span>
              <span className="text-[9px] text-muted-foreground">10:30 AM</span>
            </div>
          </div>
        </div>

        <div className="px-3 pb-2 text-left text-[10px] leading-relaxed text-foreground">
          Hi John, I wanted to follow up on the project timeline. When would be
          a good time to discuss the next steps?
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, height: 0 }}
        animate={{
          opacity: stage >= 2 ? 1 : 0,
          height: stage >= 2 ? "auto" : 0,
        }}
        transition={{ duration: 0.4, ease: [0.25, 0.46, 0.45, 0.94] }}
        className="overflow-hidden rounded-lg border border-border bg-card shadow-sm"
      >
        <div className="flex items-center gap-1 border-b border-border px-3 py-1.5">
          <Reply className="h-3 w-3 text-muted-foreground" />
          <ChevronDown className="h-2.5 w-2.5 text-muted-foreground" />
          <span className="text-[10px] text-foreground">Sarah Chen</span>
        </div>

        <div className="px-3 py-2">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: stage >= 3 ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            className="text-left text-[10px] leading-relaxed text-foreground"
          >
            <p>Hi Sarah,</p>
          </motion.div>

          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: stage >= 4 ? 1 : 0 }}
            transition={{ duration: 0.3 }}
            className="mt-1 text-left text-[10px] leading-relaxed text-foreground"
          >
            <p>
              Thanks for reaching out! I&apos;d be happy to discuss the project
              timeline. How about tomorrow at 2pm?
            </p>
            <p className="mt-1">Best, John</p>
          </motion.div>
        </div>

        <div
          className="flex items-center justify-between border-t border-border px-2 py-2"
          aria-hidden="true"
        >
          <div className="flex items-center gap-1">
            <span className="rounded bg-blue-600 px-2.5 py-0.5 text-[9px] font-medium text-white">
              Send
            </span>
            <div className="ml-1 flex items-center">
              <span className="rounded p-0.5 text-muted-foreground">
                <Bold className="h-2.5 w-2.5" />
              </span>
              <span className="rounded p-0.5 text-muted-foreground">
                <Italic className="h-2.5 w-2.5" />
              </span>
              <span className="rounded p-0.5 text-muted-foreground">
                <Link className="h-2.5 w-2.5" />
              </span>
              <span className="rounded p-0.5 text-muted-foreground">
                <List className="h-2.5 w-2.5" />
              </span>
            </div>
          </div>
          <div className="flex items-center">
            <span className="rounded p-0.5 text-muted-foreground">
              <Paperclip className="h-2.5 w-2.5" />
            </span>
            <span className="rounded p-0.5 text-muted-foreground">
              <Smile className="h-2.5 w-2.5" />
            </span>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
