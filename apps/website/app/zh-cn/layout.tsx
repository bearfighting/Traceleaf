import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: {
    default: "Traceleaf — 自托管网站分析",
    template: "%s | Traceleaf",
  },
  description: "面向希望掌控数据与基础设施的开发者的自托管网站分析平台。",
};

export default function SimplifiedChineseLayout({ children }: Readonly<{ children: ReactNode }>) {
  return <div lang="zh-CN">{children}</div>;
}
