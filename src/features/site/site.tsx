import { Navbar } from "./navbar";
import { Footer } from "./footer";
import { Hero } from "./hero";
import { StorySection } from "./sections/story";
import { FeaturesSection } from "./sections/features";
import {
  RepositorySection,
  SearchSection,
  CodeUnderstandingSection,
  AssistantSection,
} from "./sections/intelligence";
import {
  ArchitectureSection,
  AICodingSection,
  SecurityTestingSection,
  GitSection,
} from "./sections/engineering";
import { ContextComposite, SurfaceSection } from "./sections/synthesis";
import { HowItWorksSection } from "./sections/how-it-works";
import { FinalCta } from "./sections/final-cta";

/**
 * CodeMind X V2 — public website (Phase 1).
 *
 * Narrative order follows the Phase 1 spec (§24): hero → what it is →
 * features → intelligence arc → engineering arc → connected context →
 * product surface → workflow → open workspace → footer.
 */
export function Site() {
  return (
    <div className="flex min-h-screen flex-col bg-background">
      <Navbar />
      <main id="main" className="flex-1">
        <Hero />
        <StorySection />
        <FeaturesSection />
        <RepositorySection />
        <SearchSection />
        <CodeUnderstandingSection />
        <AssistantSection />
        <ArchitectureSection />
        <AICodingSection />
        <SecurityTestingSection />
        <GitSection />
        <ContextComposite />
        <SurfaceSection />
        <HowItWorksSection />
        <FinalCta />
      </main>
      <Footer />
    </div>
  );
}
