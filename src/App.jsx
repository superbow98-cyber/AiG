import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { AuthProvider } from './context/AuthContext'
import ProtectedRoute from './components/ProtectedRoute'
import Layout from './components/Layout'

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
import Validate from './pages/Validate'
import BatchUpload from './pages/BatchUpload'
import Connections from './pages/Connections'
import Datasets from './pages/Datasets'
import DetectionLab from './pages/DetectionLab'
import ResNetSpatial from './pages/ResNetSpatial'
import XRFWorkspace from './pages/XRFWorkspace'
import FusionEngine from './pages/FusionEngine'

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          {/* Public */}
          <Route path="/" element={<Home />} />

          {/* Protected — all require login (Google or Guest) and share the app shell */}
          <Route element={<ProtectedRoute />}>
            <Route element={<Layout />}>
              <Route path="/dashboard"  element={<Dashboard />} />
              <Route path="/upload"     element={<Upload />} />
              <Route path="/preprocess" element={<Preprocess />} />
              <Route path="/visualise"  element={<Visualise />} />
              <Route path="/detect"     element={<Detect />} />
              <Route path="/classify"   element={<Classify />} />
              <Route path="/cluster"    element={<Cluster />} />
              <Route path="/database"   element={<Database />} />
              <Route path="/results"    element={<Results />} />
              <Route path="/validate"   element={<Validate />} />
              <Route path="/batch"      element={<BatchUpload />} />
              <Route path="/connections" element={<Connections />} />
              <Route path="/datasets"   element={<Datasets />} />

              {/* AI Research Lab — additive, PhD methodology modules */}
              <Route path="/detection-lab"  element={<DetectionLab />} />
              <Route path="/resnet-spatial" element={<ResNetSpatial />} />
              <Route path="/xrf-workspace"  element={<XRFWorkspace />} />
              <Route path="/fusion-engine"  element={<FusionEngine />} />
              <Route path="/settings"   element={<Settings />} />
            </Route>
          </Route>
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  )
}
