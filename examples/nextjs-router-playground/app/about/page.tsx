import type { Metadata } from "next";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <main>
      <h1>About</h1>
      <p>This page is used to test a normal App Router navigation.</p>
    </main>
  );
}
