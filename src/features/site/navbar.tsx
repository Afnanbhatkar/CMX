"use client";

/**
 * Public-site navbar: fixed, restrained, anchor-based navigation.
 * Links only point at anchors that exist on this page (no dead routes).
 */
import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { LogoMark } from "./logo";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { label: "Product", href: "#product" },
  { label: "Features", href: "#features" },
  { label: "How It Works", href: "#how-it-works" },
  { label: "Architecture", href: "#architecture" },
  { label: "Security", href: "#security" },
  { label: "Git", href: "#git" },
] as const;

export function Navbar() {
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "fixed inset-x-0 top-0 z-[200] border-b transition-colors duration-300",
        scrolled
          ? "border-border bg-background/85 backdrop-blur-md"
          : "border-transparent bg-transparent",
      )}
    >
      <a
        href="#main"
        className="sr-only focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-10 focus:rounded-sm focus:bg-surface focus:px-3 focus:py-2 focus:text-sm"
      >
        Skip to content
      </a>
      <nav
        aria-label="Main"
        className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6"
      >
        <a href="#top" aria-label="CodeMind X — back to top" className="rounded-sm">
          <LogoMark />
        </a>

        <ul className="mx-auto hidden items-center gap-1 lg:flex">
          {NAV_LINKS.map((link) => (
            <li key={link.href}>
              <a
                href={link.href}
                className="rounded-sm px-2.5 py-1.5 text-[13px] text-muted-foreground transition-colors hover:bg-surface-hover hover:text-foreground"
              >
                {link.label}
              </a>
            </li>
          ))}
        </ul>

        <div className="ml-auto flex items-center gap-2 lg:ml-0">
          <Button asChild size="sm" variant="secondary" className="hidden sm:inline-flex">
            <a href="#workspace">Open Workspace</a>
          </Button>
          {/* Mobile menu */}
          <Sheet open={open} onOpenChange={setOpen}>
            <SheetTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                className="lg:hidden"
                aria-label="Open navigation menu"
              >
                <Menu className="size-5" />
              </Button>
            </SheetTrigger>
            <SheetContent
              side="right"
              className="w-72 border-border bg-background"
              role="dialog"
              aria-label="Navigation menu"
            >
              <SheetHeader>
                <SheetTitle asChild>
                  <div>
                    <LogoMark />
                  </div>
                </SheetTitle>
                <SheetDescription className="sr-only">
                  CodeMind X site navigation
                </SheetDescription>
              </SheetHeader>
              <nav aria-label="Mobile">
                <ul className="flex flex-col gap-1 px-4">
                  {NAV_LINKS.map((link) => (
                    <li key={link.href}>
                      <a
                        href={link.href}
                        onClick={() => setOpen(false)}
                        className="block rounded-sm px-2 py-2 text-sm text-muted-foreground hover:bg-surface-hover hover:text-foreground"
                      >
                        {link.label}
                      </a>
                    </li>
                  ))}
                  <li className="mt-2">
                    <Button asChild size="sm" className="w-full">
                      <a href="#workspace" onClick={() => setOpen(false)}>
                        Open Workspace
                      </a>
                    </Button>
                  </li>
                </ul>
              </nav>
            </SheetContent>
          </Sheet>
        </div>
      </nav>
    </header>
  );
}
