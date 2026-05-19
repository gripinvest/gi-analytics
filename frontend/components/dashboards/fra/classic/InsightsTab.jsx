"use client";
/**
 * InsightsTab — Tab 6 of the FRA classic dashboard.
 *
 * The full automated read on the latest snapshot: the headline verdict and the
 * stacked strengths / weaknesses / recommendations groups. The condensed
 * verdict + top-3 lives on the Overview tab; this is the unabridged version.
 */

import * as React from "react";
import { Section, AiInsightsCard } from "./primitives";

export default function InsightsTab({ insightsState }) {
  return (
    <div className="flex flex-col gap-10">
      <Section
        index={1}
        title="AI insights"
        deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
      >
        <AiInsightsCard state={insightsState} />
      </Section>
    </div>
  );
}
