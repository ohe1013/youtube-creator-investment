"use client";

import { useCallback, useState, type AnchorHTMLAttributes } from "react";

import { RuntimeIssueBanner } from "@/components/runtime/RuntimeIssueBanner";
import {
  assertHttpsExternalUrl,
  loadCreatorXBridge,
  type CreatorXBridgeLoader,
} from "@/lib/appintoss/bridge";

type ExternalLinkProps = Omit<
  AnchorHTMLAttributes<HTMLAnchorElement>,
  "href" | "onClick"
> & {
  href: string;
  appInToss?: boolean;
  loadBridge?: CreatorXBridgeLoader;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : "외부 링크를 열지 못했습니다.";
}

export function ExternalLink({
  href,
  appInToss = process.env.NEXT_PUBLIC_APP_IN_TOSS === "1",
  loadBridge = loadCreatorXBridge,
  target = "_blank",
  rel = "noopener noreferrer",
  children,
  ...anchorProps
}: ExternalLinkProps) {
  const [issue, setIssue] = useState<string | null>(null);
  const [opening, setOpening] = useState(false);

  const openNative = useCallback(async () => {
    if (opening) return;
    setOpening(true);
    setIssue(null);
    try {
      assertHttpsExternalUrl(href);
      const bridge = await loadBridge();
      await bridge.openExternal(href);
    } catch (error) {
      setIssue(errorMessage(error));
    } finally {
      setOpening(false);
    }
  }, [href, loadBridge, opening]);

  return (
    <>
      <a
        {...anchorProps}
        href={href}
        target={target}
        rel={rel}
        aria-busy={appInToss && opening ? true : undefined}
        onClick={
          appInToss
            ? (event) => {
                event.preventDefault();
                void openNative();
              }
            : undefined
        }
      >
        {children}
      </a>
      {issue !== null ? (
        <RuntimeIssueBanner
          message={issue}
          onRetry={() => void openNative()}
          retrying={opening}
        />
      ) : null}
    </>
  );
}
