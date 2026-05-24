export const metadata = {
  title: 'Basketball Overlay',
}

export default function BasketballOverlayLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body style={{ background: 'transparent', overflow: 'hidden' }}>
        {children}
      </body>
    </html>
  )
}
