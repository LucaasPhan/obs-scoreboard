export const metadata = {
  title: 'Basketball Overlay - Control Panel',
}

export default function BasketballControlLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head />
      <body style={{ background: '#080A0F' }}>
        {children}
      </body>
    </html>
  )
}
