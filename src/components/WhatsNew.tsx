import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowUpRight, LoaderCircle, Megaphone, X } from "lucide-react";
import { Dialog } from "radix-ui";
import { useState } from "react";
import Markdown, { type Components } from "react-markdown";

import { REMARK_PLUGINS } from "@/components/MarkdownPreview";
import { MENU_TRIGGER } from "@/components/ui/menu";
import { type AppConfig, loadConfig, patchConfig } from "@/lib/config";
import { desktop } from "@/lib/desktop";
import { notify } from "@/lib/notifications";
import { qk } from "@/lib/queryKeys";
import type { ForkRelease } from "@/types/appUpdate";

const releasesUrl = "https://github.com/Skithrills/app-bloxbot-ai/releases";
const releaseDate = new Intl.DateTimeFormat(undefined, { dateStyle: "long" });
const externalLink =
  "text-brand-text underline decoration-brand/40 underline-offset-2 hover:decoration-brand";
const releaseMarkdown = [
  "space-y-3 wrap-anywhere text-sm leading-6 text-muted-foreground",
  "[&_:is(h1,h2,h3,h4,h5,h6)]:mt-6 [&_:is(h1,h2,h3,h4,h5,h6)]:leading-tight [&_:is(h1,h2,h3,h4,h5,h6)]:font-semibold [&_:is(h1,h2,h3,h4,h5,h6)]:text-foreground",
  "[&_h1]:text-base [&_h2]:text-base [&_h3]:text-xs [&_h3]:tracking-wider [&_h3]:uppercase",
  "[&_:is(ol,ul)]:space-y-2.5 [&_:is(ol,ul)]:pl-5 [&_ol]:list-decimal [&_ul]:list-disc [&_li::marker]:text-muted-foreground",
  "[&_strong]:font-semibold [&_strong]:text-foreground [&_li>p+p]:mt-2",
  "[&_code]:font-mono [&_:not(pre)>code]:rounded-sm [&_:not(pre)>code]:bg-muted [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:py-0.5 [&_:not(pre)>code]:text-foreground",
  "[&_pre]:overflow-auto [&_pre]:rounded-md [&_pre]:bg-muted [&_pre]:p-3",
].join(" ");
const markdownComponents: Components = {
  a: ({ href, children }) =>
    href && /^https?:\/\//i.test(href) ? (
      <a href={href} className={externalLink} target="_blank" rel="noopener noreferrer">
        {children}
      </a>
    ) : (
      children
    ),
  img: ({ alt }) => alt || null,
};

function ReleaseNotes({ release }: { release: ForkRelease }) {
  // The release workflow prepends installer links. The release page already provides those.
  const markdown = release.body
    .trim()
    .replace(/^## Download BloxBot(?:\r?\n[\s\S]*?)?(?=\r?\n#{1,6} |$)/, "")
    .trim();

  return (
    <article className="border-b border-border py-6 first:pt-1 last:border-b-0 last:pb-2">
      <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5">
        <h3 className="text-base font-semibold tracking-tight sm:text-lg">
          <time dateTime={release.publishedAt}>
            {releaseDate.format(new Date(release.publishedAt))}
          </time>
        </h3>
        <div className="ml-auto flex items-center gap-1.5">
          <span className="rounded-full bg-muted px-2.5 py-1 font-mono text-xs text-foreground">
            {release.version}
          </span>
          <a
            href={release.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`View ${release.version} on GitHub`}
            title={`View ${release.version} on GitHub`}
            className={`${MENU_TRIGGER} shrink-0 px-1.5`}
          >
            <ArrowUpRight size={14} aria-hidden="true" />
          </a>
        </div>
      </header>
      {markdown ? (
        <div className={releaseMarkdown}>
          <Markdown remarkPlugins={REMARK_PLUGINS} components={markdownComponents} skipHtml>
            {markdown}
          </Markdown>
        </div>
      ) : (
        <p className="text-sm text-muted-foreground">No release notes were published.</p>
      )}
    </article>
  );
}

export function WhatsNew({ titleBar = false }: { titleBar?: boolean }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: version } = useQuery({
    queryKey: qk.appVersion,
    queryFn: () => desktop.getVersion(),
    staleTime: Infinity,
  });
  const { data: config } = useQuery({ queryKey: qk.config, queryFn: loadConfig });
  const seen = useMutation({
    mutationFn: (whatsNewSeenVersion: string) => patchConfig({ whatsNewSeenVersion }),
    onSuccess: async (_, whatsNewSeenVersion) => {
      await queryClient.cancelQueries({ queryKey: qk.config, exact: true });
      queryClient.setQueryData<AppConfig>(qk.config, (current) =>
        current ? { ...current, whatsNewSeenVersion } : current,
      );
    },
    onError: () => notify.error("Couldn't save the release notes as seen"),
  });
  const history = useQuery({
    queryKey: ["app-release-history"],
    queryFn: () => desktop.listReleaseHistory(),
    enabled: open,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });

  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        setOpen(next);
        if (next && version && config && config.whatsNewSeenVersion !== version)
          seen.mutate(version);
      }}
    >
      {(!titleBar ||
        (version && config && config.whatsNewSeenVersion !== version && !seen.isPending)) && (
        <Dialog.Trigger type="button" className={`${MENU_TRIGGER} shrink-0`}>
          <Megaphone size={14} className="shrink-0" aria-hidden="true" />
          <span className={titleBar ? "max-[680px]:sr-only" : undefined}>
            {titleBar ? "What’s new" : "Release history"}
          </span>
        </Dialog.Trigger>
      )}
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[250] bg-black/55" />
        <Dialog.Content
          onCloseAutoFocus={(event) => {
            if (titleBar && (seen.isPending || config?.whatsNewSeenVersion === version)) {
              event.preventDefault();
              document.getElementById("titlebar-actions")?.focus();
            }
          }}
          className="fixed top-1/2 left-1/2 z-[251] flex h-[min(42rem,calc(100%-3rem))] w-[calc(100%-2rem)] max-w-[42rem] -translate-1/2 flex-col overflow-hidden rounded-xl border bg-card text-card-foreground shadow-2xl"
        >
          <header className="flex shrink-0 items-start justify-between gap-3 border-b border-border px-5 py-4 sm:px-7">
            <div>
              <Dialog.Title className="text-lg font-semibold tracking-tight">
                What’s new
              </Dialog.Title>
              <Dialog.Description className="mt-0.5 text-sm text-muted-foreground">
                BloxBot release history
              </Dialog.Description>
            </div>
            <Dialog.Close type="button" aria-label="Close release history" className={MENU_TRIGGER}>
              <X size={16} aria-hidden="true" />
            </Dialog.Close>
          </header>
          <section
            aria-label="Release notes"
            // biome-ignore lint/a11y/noNoninteractiveTabindex: The release list needs native keyboard scrolling.
            tabIndex={0}
            className="app-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-5 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-ring sm:px-7"
          >
            {history.isPending && (
              <output className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle size={14} className="motion-safe:animate-spin" aria-hidden="true" />
                Loading release history…
              </output>
            )}
            {history.isError && (
              <div className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
                <p role="alert">Couldn’t load release history.</p>
                <button
                  type="button"
                  className={MENU_TRIGGER}
                  disabled={history.isFetching}
                  onClick={() => void history.refetch()}
                >
                  Try again
                </button>
              </div>
            )}
            {history.data?.length === 0 && (
              <p className="text-sm text-muted-foreground">No releases are available yet.</p>
            )}
            {history.data?.map((release) => (
              <ReleaseNotes key={release.version} release={release} />
            ))}
          </section>
          <footer className="shrink-0 border-t border-border px-5 py-3 text-xs sm:px-7">
            <a
              href={releasesUrl}
              className={`${externalLink} inline-flex items-center gap-1.5`}
              target="_blank"
              rel="noopener noreferrer"
            >
              Release history on GitHub
              <ArrowUpRight size={13} aria-hidden="true" />
            </a>
          </footer>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
