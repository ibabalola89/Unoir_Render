import { Link } from "@remix-run/react";
import { useId, type ReactNode } from "react";

import styles from "../styles/studio.module.css";

export type AppNoticeTone = "info" | "success" | "warning" | "critical";

interface AppNoticeAction {
  label: string;
  to: string;
}

interface AppNoticeProps {
  action?: AppNoticeAction;
  children: ReactNode;
  compact?: boolean;
  label?: string;
  title?: string;
  tone?: AppNoticeTone;
}

const toneClassNames: Record<AppNoticeTone, string> = {
  info: styles.appNoticeInfo,
  success: styles.appNoticeSuccess,
  warning: styles.appNoticeWarning,
  critical: styles.appNoticeCritical,
};

const toneLabels: Record<AppNoticeTone, string> = {
  info: "Notice",
  success: "Complete",
  warning: "Status",
  critical: "Needs attention",
};

const toneSymbols: Record<AppNoticeTone, string> = {
  info: "i",
  success: "OK",
  warning: "!",
  critical: "!",
};

export function AppNotice({
  action,
  children,
  compact = false,
  label,
  title,
  tone = "info",
}: AppNoticeProps) {
  const titleId = useId();
  const className = [
    styles.appNotice,
    toneClassNames[tone],
    compact ? styles.appNoticeCompact : "",
  ].filter(Boolean).join(" ");

  return (
    <section
      aria-labelledby={title ? titleId : undefined}
      className={className}
      role={tone === "critical" ? "alert" : "status"}
    >
      <div className={styles.appNoticeIcon} aria-hidden="true">
        {toneSymbols[tone]}
      </div>
      <div className={styles.appNoticeContent}>
        <div className={styles.appNoticeCopy}>
          <span className={styles.appNoticeLabel}>
            {label ?? toneLabels[tone]}
          </span>
          {title && (
            <h2 className={styles.appNoticeTitle} id={titleId}>
              {title}
            </h2>
          )}
          <div className={styles.appNoticeBody}>{children}</div>
        </div>
        {action && (
          <Link className={styles.appNoticeAction} to={action.to}>
            {action.label}
          </Link>
        )}
      </div>
    </section>
  );
}
