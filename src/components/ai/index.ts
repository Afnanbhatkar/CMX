/**
 * CodeMind X V2 — AI activity components barrel.
 *
 * Safe, user-visible execution summaries for the CodeMind X activity engine.
 * PRIVACY CONTRACT: these components render only category labels + short
 * system-activity messages — never private model chain-of-thought.
 * Each file remains independently replaceable per the reference contract.
 */
export {
  ThinkingOrb,
  type ThinkingOrbState,
  type ThinkingOrbProps,
} from "./ThinkingOrb";
export { LatticeLoader, type LatticeLoaderProps } from "./LatticeLoader";
export {
  ThoughtChain,
  type ThoughtStep,
  type ThoughtStepStatus,
  type ThoughtChainProps,
} from "./ThoughtChain";
export { ActivityPreview, type ActivityPreviewProps } from "./ActivityPreview";
