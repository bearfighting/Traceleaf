"use client";

import { motion, useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Copy } from "@/lib/content";

const paths = [
  { name: "/", views: "2,841", width: "82%" },
  { name: "/docs/getting-started", views: "1,624", width: "56%" },
  { name: "/pricing", views: "986", width: "34%" },
];

export function ProductPreview({ copy }: { copy: Copy }) {
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  const reducedMotion = useReducedMotion();

  return (
    <div className="preview-frame relative mx-auto w-full max-w-2xl">
      <div className="preview-orbit" />
      <Card className="relative overflow-hidden rounded-2xl p-0 shadow-xl shadow-foreground/5">
        <div className="flex items-center justify-between border-b border-border px-5 py-4 sm:px-7">
          <div className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-secondary text-primary">
              <svg aria-hidden="true" className="size-4" fill="none" viewBox="0 0 24 24">
                <path
                  d="M12 20c-1.1-4.2-5-5.2-6-9.1C5 7.2 8.2 4.4 12.4 4c.4 4.3 3.6 6.1 3.2 9.7-.2 2.6-1.7 4.8-3.6 6.3Z"
                  stroke="currentColor"
                  strokeWidth="1.7"
                />
                <path
                  d="M8.4 9.8c2.7 1.7 4.1 4.3 4.2 8m.1-4.2c1-1.6 2.4-2.7 4.1-3.4"
                  stroke="currentColor"
                  strokeLinecap="round"
                  strokeWidth="1.7"
                />
              </svg>
            </span>
            <div>
              <p className="text-sm font-semibold">traceleaf.dev</p>
              <p className="text-xs text-muted-foreground">{copy.dashboard}</p>
            </div>
          </div>
          <span className="rounded-full border border-border bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
            {copy.last7Days}
          </span>
        </div>

        <div
          className={`preview-content p-5 sm:p-7 ${playing ? "" : "animation-paused"}`}
          key={replay}
        >
          <div className="grid gap-3 sm:grid-cols-3">
            {[
              { label: copy.pageViews, value: "8,492", change: "+12.8%" },
              { label: copy.visitors, value: "3,106", change: "+8.2%" },
              { label: copy.avgDuration, value: "2m 14s", change: "+4.6%" },
            ].map((metric, index) => (
              <motion.div
                animate={{ opacity: 1, y: 0 }}
                className="metric-card"
                initial={reducedMotion ? false : { opacity: 0, y: 12 }}
                key={metric.label}
                transition={{ delay: reducedMotion ? 0 : index * 0.14, duration: 0.45 }}
              >
                <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
                <div className="mt-2 flex items-end justify-between gap-2">
                  <p className="text-2xl font-semibold tracking-tight">{metric.value}</p>
                  <span className="mb-1 rounded-full bg-success-subtle px-2 py-0.5 text-xs font-semibold text-success">
                    {metric.change}
                  </span>
                </div>
              </motion.div>
            ))}
          </div>

          <div className="preview-detail-grid mt-5 grid gap-5">
            <div className="rounded-xl border border-border p-4 sm:p-5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-semibold">{copy.pageViews}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{copy.sample}</p>
                </div>
                <span className="text-sm font-semibold text-primary">8,492</span>
              </div>
              <svg
                aria-label={copy.pageViews}
                className="mt-4 w-full overflow-visible"
                role="img"
                viewBox="0 0 440 130"
              >
                {[20, 55, 90, 125].map((y) => (
                  <line className="chart-grid" key={y} x1="0" x2="440" y1={y} y2={y} />
                ))}
                <path
                  className={`chart-area ${playing ? "is-playing" : "is-paused"}`}
                  d="M4 100 C28 98 35 67 66 78 S99 94 128 65 S161 74 190 58 S225 80 254 48 S289 58 318 35 S354 63 382 32 S413 45 436 18 V126 H4Z"
                />
                <path
                  className={`chart-stroke ${playing ? "is-playing" : "is-paused"}`}
                  d="M4 100 C28 98 35 67 66 78 S99 94 128 65 S161 74 190 58 S225 80 254 48 S289 58 318 35 S354 63 382 32 S413 45 436 18"
                />
                <circle
                  className={`chart-dot ${playing ? "is-playing" : "is-paused"}`}
                  cx="318"
                  cy="35"
                  r="4"
                />
              </svg>
              <div className="mt-1 flex justify-between text-xs text-muted-foreground">
                <span>Mon</span>
                <span>Tue</span>
                <span>Wed</span>
                <span>Thu</span>
                <span>Fri</span>
                <span>Sat</span>
                <span>Sun</span>
              </div>
            </div>

            <div className="rounded-xl border border-border p-4 sm:p-5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{copy.topPages}</p>
                <span className="text-xs text-muted-foreground">{copy.sample}</span>
              </div>
              <div className="mt-4 space-y-4">
                {paths.map((item, index) => (
                  <div
                    className={`page-row ${playing ? "is-playing" : "is-paused"}`}
                    key={item.name}
                  >
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 truncate font-medium">{item.name}</span>
                      <span className="shrink-0 text-muted-foreground">{item.views}</span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                      <span
                        className="page-bar"
                        style={
                          {
                            "--bar-width": item.width,
                            "--bar-delay": `${index * 160}ms`,
                          } as React.CSSProperties
                        }
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </Card>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3">
        <p className="inline-flex items-center gap-2 text-xs text-muted-foreground">
          <span className="size-1.5 rounded-full bg-primary" />
          {copy.demoLabel}
        </p>
        <div className="flex gap-2">
          <Button
            aria-pressed={!playing}
            className="min-h-9 px-3 text-xs"
            onClick={() => setPlaying((value) => !value)}
            variant="secondary"
          >
            {playing
              ? copy.localeName === "English"
                ? "Pause"
                : "暂停"
              : copy.localeName === "English"
                ? "Resume"
                : "继续"}
          </Button>
          <Button
            className="min-h-9 px-3 text-xs"
            onClick={() => {
              setReplay((value) => value + 1);
              setPlaying(true);
            }}
            variant="secondary"
          >
            {copy.localeName === "English" ? "Replay" : "重播"}
          </Button>
        </div>
      </div>
    </div>
  );
}
