import "./globals.css";

export const metadata = {
  title: "FreightTrigger Ops",
  description: "Internal FreightTrigger signal intelligence cockpit"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
