import { LogoMark } from "./logo";

/**
 * Public-site footer. Only real, in-page anchors are linked — the workspace
 * and documentation routes arrive with later phases and are labeled as such
 * instead of being fake links (RULES.md §9).
 */
const PRODUCT_LINKS = [
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Workspace preview", href: "#workspace" },
] as const;

const CAPABILITY_LINKS = [
  { label: "Repository Intelligence", href: "#repository" },
  { label: "Hybrid Search", href: "#search" },
  { label: "Architecture", href: "#architecture" },
  { label: "AI Coding", href: "#ai-coding" },
  { label: "Security", href: "#security" },
  { label: "Testing", href: "#testing" },
  { label: "Git Intelligence", href: "#git" },
] as const;

export function Footer() {
  return (
    <footer className="mt-auto border-t border-border-subtle bg-[#131110]">
      <div className="mx-auto w-full max-w-6xl px-4 py-12 sm:px-6">
        <div className="grid grid-cols-1 gap-10 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <LogoMark />
            <p className="mt-3 max-w-xs text-sm leading-relaxed text-muted-foreground">
              An AI software engineering platform. Understand your repository, build with
              context, and verify every change before it ships.
            </p>
          </div>
          <nav aria-label="Footer — product">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Product
            </p>
            <ul className="mt-3 space-y-2">
              {PRODUCT_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
          <nav aria-label="Footer — capabilities">
            <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-muted-foreground">
              Capabilities
            </p>
            <ul className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2 sm:gap-x-6">
              {CAPABILITY_LINKS.map((l) => (
                <li key={l.href}>
                  <a
                    href={l.href}
                    className="text-sm text-muted-foreground transition-colors hover:text-foreground"
                  >
                    {l.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        </div>

        <div className="mt-10 flex flex-col gap-2 border-t border-border-subtle pt-6 text-[12px] text-muted-foreground/80 sm:flex-row sm:items-center sm:justify-between">
          <p>© {new Date().getFullYear()} CodeMind X — under active development.</p>
          <p>
            The engineering workspace and documentation ship with Phase&nbsp;2 and later —
            this page shows the product, honestly.
          </p>
        </div>
      </div>
    </footer>
  );
}
