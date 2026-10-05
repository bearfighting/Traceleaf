import React from "react";

export function ReportLoadingState({ heading }: { heading: string }) {
  return (
    <section className="card" aria-labelledby={`${heading}-loading-heading`}>
      <h2 id={`${heading}-loading-heading`}>{heading}</h2>
      <p role="status">Loading analytics data...</p>
    </section>
  );
}
