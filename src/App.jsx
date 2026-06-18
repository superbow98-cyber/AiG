import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'

import Home from './pages/Home'
import Dashboard from './pages/Dashboard'
import Upload from './pages/Upload'
import Preprocess from './pages/Preprocess'
import Visualise from './pages/Visualise'
import Detect from './pages/Detect'
import Classify from './pages/Classify'
import Cluster from './pages/Cluster'
import Database from './pages/Database'
import Results from './pages/Results'
import Settings from './pages/Settings'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />

          {/* Protected — all require login */}
          <Route element={<ProtectedRoute />}>
            <Route path="/dashboard"  element={<Dashboard />} />
            <Route path="/upload"     element={<Upload />} />
            <Route path="/preprocess" element={<Preprocess />} />
            <Route path="/visualise"  element={<Visualise />} />
            <Route path="/detect"     element={<Detect />} />
            <Route path="/classify"   element={<Classify />} />
            <Route path="/cluster"    element={<Cluster />} />
            <Route path="/database"   element={<Database />} />
            <Route path="/results"    element={<Results />} />
            <Route path="/settings"   element={<Settings />} />
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
