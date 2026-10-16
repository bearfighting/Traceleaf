"use client";

import { useReducedMotion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import type { Copy } from "@/lib/content";
import {
  DAILY_PAGE_VIEWS,
  SELECTED_RANGE_PAGE_VIEWS,
  SITE_TOTAL_PAGE_VIEWS,
  TOP_PAGE_BAR_WIDTHS,
  TOP_PAGES,
  createPreviewTrendPoints,
  formatPreviewDate,
  formatPreviewDateRange,
} from "@/lib/product-preview-data";

const chartPoints = createPreviewTrendPoints();

function createSmoothChartLine(points: typeof chartPoints): string {
  const [firstPoint, ...remainingPoints] = points;

  return remainingPoints.reduce((path, point, index) => {
    const previousPoint = points[index];
    const nextPoint = points[index + 2] ?? point;
    const controlOne = {
      x: previousPoint.x + (point.x - (points[index - 1]?.x ?? previousPoint.x)) / 6,
      y: previousPoint.y + (point.y - (points[index - 1]?.y ?? previousPoint.y)) / 6,
    };
    const controlTwo = {
      x: point.x - (nextPoint.x - previousPoint.x) / 6,
      y: point.y - (nextPoint.y - previousPoint.y) / 6,
    };

    return `${path} C${controlOne.x} ${controlOne.y} ${controlTwo.x} ${controlTwo.y} ${point.x} ${point.y}`;
  }, `M${firstPoint.x} ${firstPoint.y}`);
}

const chartLine = createSmoothChartLine(chartPoints);
const chartArea = `${chartLine} V126 H54Z`;

export function ProductPreview({ copy }: { copy: Copy }) {
  const [playing, setPlaying] = useState(true);
  const [replay, setReplay] = useState(0);
  const reducedMotion = useReducedMotion();

  return (
    <div className="preview-frame relative mx-auto w-full max-w-2xl">
      <div className="preview-orbit" />
      <Card className="product-preview-card relative overflow-hidden rounded-2xl p-0 shadow-xl shadow-foreground/5">
        <div className="preview-header flex flex-wrap items-center justify-between gap-2 px-5 py-4 sm:px-7">
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
              <p className="preview-muted text-xs">{copy.dashboard}</p>
            </div>
          </div>
          <span className="preview-date-range rounded-full px-3 py-1.5 text-xs font-medium">
            {formatPreviewDateRange(DAILY_PAGE_VIEWS, copy.localeName)}
          </span>
        </div>

        <div
          className={`preview-content p-5 sm:p-7 ${playing ? "" : "animation-paused"}`}
          id="product-preview-content"
          key={replay}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              {
                label: copy.siteTotalPageViews,
                value: SITE_TOTAL_PAGE_VIEWS.toLocaleString(
                  copy.localeName === "English" ? "en-US" : "zh-CN",
                ),
              },
              {
                label: copy.selectedRangePageViews,
                value: SELECTED_RANGE_PAGE_VIEWS.toLocaleString(
                  copy.localeName === "English" ? "en-US" : "zh-CN",
                ),
              },
            ].map((metric, index) => (
              <div
                className={`metric-card ${reducedMotion ? "" : "metric-card-enter"}`}
                key={metric.label}
                style={{ "--metric-delay": `${index * 140}ms` } as React.CSSProperties}
              >
                <p className="preview-muted text-xs font-medium">{metric.label}</p>
                <div className="mt-2">
                  <p className="text-2xl font-semibold tracking-tight">{metric.value}</p>
                </div>
              </div>
            ))}
          </div>

          <div className="preview-detail-grid mt-5 grid gap-5">
            <section
              aria-labelledby="preview-page-views-title"
              className="preview-panel min-w-0 rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-semibold" id="preview-page-views-title">
                    {copy.pageViewsByDay}
                  </h2>
                  <p className="preview-muted mt-1 text-xs">{copy.sample}</p>
                </div>
                <span className="text-sm font-semibold text-primary">
                  {SELECTED_RANGE_PAGE_VIEWS.toLocaleString(
                    copy.localeName === "English" ? "en-US" : "zh-CN",
                  )}
                </span>
              </div>
              <svg
                aria-hidden="true"
                className="preview-chart mt-4 w-full"
                viewBox="0 0 440 156"
                preserveAspectRatio="none"
              >
                {[20, 55, 90, 125].map((y, index) => (
                  <g key={y}>
                    <line className="chart-grid" x1="42" x2="436" y1={y} y2={y} />
                    <text className="chart-axis-label" textAnchor="end" x="36" y={y + 4}>
                      {[1500, 1250, 1000, 750][index].toLocaleString(
                        copy.localeName === "English" ? "en-US" : "zh-CN",
                      )}
                    </text>
                  </g>
                ))}
                <path className="chart-area" d={chartArea} />
                <path className="chart-stroke" d={chartLine} />
                <circle
                  className="chart-dot"
                  cx={chartPoints[chartPoints.length - 1].x}
                  cy={chartPoints[chartPoints.length - 1].y}
                  r="4"
                />
                {DAILY_PAGE_VIEWS.map((item, index) => (
                  <text
                    className="chart-axis-label"
                    key={item.day}
                    textAnchor="middle"
                    x={chartPoints[index].x}
                    y="148"
                  >
                    {formatPreviewDate(item.day, copy.localeName)}
                  </text>
                ))}
              </svg>
              <ul aria-label={copy.dailyPageViews} className="preview-daily-values">
                {DAILY_PAGE_VIEWS.map((item) => (
                  <li key={item.day}>
                    <span>
                      {formatPreviewDate(item.day, copy.localeName)} · {item.day}
                    </span>
                    <span>
                      {item.page_views.toLocaleString(
                        copy.localeName === "English" ? "en-US" : "zh-CN",
                      )}{" "}
                      {copy.views}
                    </span>
                  </li>
                ))}
              </ul>
            </section>

            <section
              aria-label={copy.topPages}
              className="preview-panel min-w-0 rounded-xl p-4 sm:p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">{copy.topPages}</h2>
                <span className="preview-muted shrink-0 text-xs">{copy.sample}</span>
              </div>
              <ol className="mt-4 space-y-4">
                {TOP_PAGE_BAR_WIDTHS.map((item, index) => (
                  <li className="page-row is-playing" key={item.path}>
                    <div className="mb-1.5 flex items-center justify-between gap-3 text-xs">
                      <span className="min-w-0 break-all font-medium">{item.path}</span>
                      <span className="preview-muted shrink-0">
                        {item.page_views.toLocaleString(
                          copy.localeName === "English" ? "en-US" : "zh-CN",
                        )}
                      </span>
                    </div>
                    <div
                      aria-label={`${item.path}: ${item.page_views} ${copy.views}`}
                      aria-valuemax={TOP_PAGES[0].page_views}
                      aria-valuemin={0}
                      aria-valuenow={item.page_views}
                      className="preview-bar-track h-1.5 overflow-hidden rounded-full"
                      role="progressbar"
                    >
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
                  </li>
                ))}
              </ol>
            </section>
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
            aria-label={copy.previewAnimation}
            aria-controls="product-preview-content"
            aria-pressed={playing}
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
            aria-label={copy.replayPreview}
            aria-controls="product-preview-content"
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
