// AiG — Layout.jsx
// App shell for all protected routes: fixed Navbar (top) + Sidebar (left),
// page content rendered through <Outlet/> inside the offset main region.
//
// Mobile: Sidebar becomes a slide-in drawer (off-canvas by default, toggled
// via the Navbar hamburger button) instead of permanently reserving ~224px
// of a ~375-414px phone screen. Desktop (lg+): unchanged, always-visible
// fixed sidebar with a matching content margin.
import { useState } from 'react'
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout() {
  const [sidebarOpen, setSidebarOpen] = useState(false)

  return (
    <div className="min-h-screen bg-[#FDFBF0]">
      <Navbar onMenuClick={() => setSidebarOpen((v) => !v)} />
      <Sidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <main className="lg:ml-56 pt-14 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
