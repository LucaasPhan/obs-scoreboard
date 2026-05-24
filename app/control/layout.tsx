export const metadata = {
  title: 'La Liga Overlay — Control Panel',
}

export default function ControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body style={{ background: '#0F0F1A' }}>
        {children}
      </body>
    </html>
  )
}
