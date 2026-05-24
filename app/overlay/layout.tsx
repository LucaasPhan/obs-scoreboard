export const metadata = {
  title: 'La Liga Overlay',
}

export default function OverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body style={{ background: 'transparent', overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  )
}
