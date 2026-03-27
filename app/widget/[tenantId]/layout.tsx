// Standalone layout for the embeddable widget — no nav, no Clerk, minimal chrome
export default function WidgetLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, padding: 0, background: 'transparent' }}>
        {children}
      </body>
    </html>
  );
}
