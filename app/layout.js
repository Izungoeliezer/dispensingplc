import './globals.css'
export const metadata = { title: 'Dispensing Unit' }
export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  )
}
