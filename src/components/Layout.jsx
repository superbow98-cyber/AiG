// AiG — Layout.jsx
// App shell for all protected routes: fixed Navbar (top) + Sidebar (left),
// page content rendered through <Outlet/> inside the offset main region.
import { Outlet } from 'react-router-dom'
import Navbar from './Navbar'
import Sidebar from './Sidebar'

export default function Layout() {
  return (
    <div className="min-h-screen bg-[#FDFBF0]">
      <Navbar />
      <Sidebar />
      <main className="ml-56 pt-14 min-h-screen">
        <Outlet />
      </main>
    </div>
  )
}
