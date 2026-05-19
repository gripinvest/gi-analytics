"use client";
/**
 * AI Insights tab — the full automated read on the latest snapshot: the
 * headline verdict and the three-column strengths / weaknesses /
 * recommendations grid. The condensed verdict + top-3 lives on the Overview
 * tab; this is the unabridged version.
 */

import * as React from "react";
import { RevealSection, SectionHead, AiInsights } from "./primitives";

export default function InsightsTab({ insightsState }) {
  return (
    <RevealSection reduced={false} id="sec-insights">
      <SectionHead
        number="I"
        italic="AI Insights"
        deck="The automated read on this snapshot — what the channel is doing well, where it is leaking, and what to try next."
      />
      <AiInsights state={insightsState} />
    </RevealSection>
  );
}
