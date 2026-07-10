"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
} from "react";

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

type ExternalLinkStatus = {
  identity: object;
  issue: string | null;
  opening: boolean;
};

export function ExternalLink({
  href,
  appInToss = process.env.NEXT_PUBLIC_APP_IN_TOSS === "1",
  loadBridge = loadCreatorXBridge,
  target = "_blank",
  rel = "noopener noreferrer",
  children,
  ...anchorProps
}: ExternalLinkProps) {
  const identity = useMemo(
    () => ({ appInToss, href, loadBridge }),
    [appInToss, href, loadBridge],
  );
  const [status, setStatus] = useState<ExternalLinkStatus>({
    identity,
    issue: null,
    opening: false,
  });
  const mountedRef = useRef(false);
  const operationGenerationRef = useRef(0);
  const inFlightIdentityRef = useRef<object | null>(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      operationGenerationRef.current += 1;
      inFlightIdentityRef.current = null;
    };
  }, []);

  const visibleStatus =
    status.identity === identity
      ? status
      : { identity, issue: null, opening: false };

  const openNative = useCallback(async () => {
    if (inFlightIdentityRef.current === identity) return;
    inFlightIdentityRef.current = identity;
    const generation = operationGenerationRef.current + 1;
    operationGenerationRef.current = generation;
    setStatus({ identity, issue: null, opening: true });
    try {
      assertHttpsExternalUrl(href);
      const bridge = await loadBridge();
      await bridge.openExternal(href);
    } catch (error) {
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation
      ) {
        setStatus({ identity, issue: errorMessage(error), opening: false });
      }
    } finally {
      if (inFlightIdentityRef.current === identity) {
        inFlightIdentityRef.current = null;
      }
      if (
        mountedRef.current &&
        operationGenerationRef.current === generation
      ) {
        setStatus((current) =>
          current.identity === identity
            ? { ...current, opening: false }
            : current,
        );
      }
    }
  }, [href, identity, loadBridge]);

  return (
    <>
      <a
        {...anchorProps}
        href={href}
        target={target}
        rel={rel}
        aria-busy={appInToss && visibleStatus.opening ? true : undefined}
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
      {visibleStatus.issue !== null ? (
        <RuntimeIssueBanner
          message={visibleStatus.issue}
          onRetry={() => void openNative()}
          retrying={visibleStatus.opening}
        />
      ) : null}
    </>
  );
}
