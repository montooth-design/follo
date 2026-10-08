import { Heading } from '../../../shared/ui';
import { ArrowRight, Code, Network, Sparkles } from 'lucide-react';
import { VIEW_COPY } from '../../../renderer/view-copy';

export function OverviewView({ onOpenRepositories }: { onOpenRepositories: () => void }) {
  return (
    <div className="hero">
      <div>
        <Heading as="h2" variant="hero">
          {VIEW_COPY.Overview.heading}
        </Heading>
        <p className="subtitle">{VIEW_COPY.Overview.subheading}</p>
        <button className="primary" onClick={onOpenRepositories}>
          Open A Repository <ArrowRight />
        </button>
      </div>
      <div
        className="architecture"
        aria-label="Facts flow into relationships, decisions, and explanation"
      >
        <div className="diagram-node source">
          <Code />
          <span>
            Source code<small>The source of truth</small>
          </span>
        </div>
        <div className="connector" />
        <div className="diagram-node">
          <Network />
          <span>
            Engineering graph<small>Deterministic relationships</small>
          </span>
        </div>
        <div className="connector" />
        <div className="diagram-node optional-node">
          <Sparkles />
          <span>
            Intelligence<small>Optional decisions & explanations</small>
          </span>
        </div>
      </div>
    </div>
  );
}
