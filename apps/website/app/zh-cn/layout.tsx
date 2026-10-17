import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Traceleaf — 自托管网站分析",
    template: "%s | Traceleaf",
  },
  description: "面向开发者的自托管网站分析，让数据和基础设施保持在自己的掌控之中。",
};

export default function SimplifiedChineseLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div lang="zh-CN">{children}</div>;
}
