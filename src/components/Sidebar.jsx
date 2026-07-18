// AiG — Sidebar.jsx  (pastel/gold theme)
// Nav grouped by the PhD 4-stage unified framework, so the app visibly mirrors
// the research pipeline: Survey → Predict → Confirm/Map → Validate.
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  Upload,
  SlidersHorizontal,
  Eye,
  ScanSearch,
  Tags,
  GitFork,
  FileBarChart,
  Database,
  ClipboardCheck,
  Settings,
  Layers,
  Share2,
  Users,
  Brain,
  FlaskConical,
  Combine,
  BoxSelect,
} from 'lucide-react'

const GROUPS = [
  {
    heading: null,
    links: [{ to: '/dashboard', label: 'Dashboard', Icon: LayoutDashboard }],
  },
  {
    heading: 'Stage 1 · Survey',
    links: [
      { to: '/upload',     label: 'Upload',     Icon: Upload },
      { to: '/batch',      label: 'Batch Upload', Icon: Layers },
      { to: '/preprocess', label: 'Preprocess', Icon: SlidersHorizontal },
      { to: '/visualise',  label: 'Visualise',  Icon: Eye },
      { to: '/detect',     label: 'Detect',     Icon: ScanSearch },
    ],
  },
  {
    heading: 'Stage 2 · Predict',
    links: [
      { to: '/classify', label: 'Classify', Icon: Tags },
      { to: '/cluster',  label: 'Cluster',  Icon: GitFork },
    ],
  },
  {
    heading: 'Stage 3–4 · Confirm & Map',
    links: [
      { to: '/results',  label: 'Results',  Icon: FileBarChart },
      { to: '/database', label: 'Database', Icon: Database },
    ],
  },
  {
    heading: 'Stage 5 · Validate',
    links: [{ to: '/validate', label: 'Validation', Icon: ClipboardCheck }],
  },
  {
    heading: 'AI Research Lab',
    links: [
      { to: '/detection-lab',  label: 'AI Detection Lab',    Icon: BoxSelect },
      { to: '/resnet-spatial', label: 'ResNet-18 Spatial AI', Icon: Brain },
      { to: '/xrf-workspace',  label: 'XRF AI Workspace',     Icon: FlaskConical },
      { to: '/fusion-engine',  label: 'Fusion Engine',        Icon: Combine },
    ],
  },
  {
    heading: 'Collaborate',
    links: [
      { to: '/connections', label: 'Connect Users', Icon: Users },
      { to: '/datasets',    label: 'Datasets & Chat', Icon: Share2 },
    ],
  },
  {
    heading: null,
    links: [{ to: '/settings', label: 'Settings', Icon: Settings }],
  },
]

function linkClass({ isActive }) {
  return `flex items-center gap-3 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
    isActive
      ? 'bg-amber-50 text-amber-800 border-l-2 border-amber-500'
      : 'text-stone-600 hover:bg-[#F0E9B8] border-l-2 border-transparent'
  }`
}

export default function Sidebar({ open = false, onClose = () => {} }) {
  return (
    <>
      {/* Mobile backdrop — tap outside to close. Hidden entirely on lg+
          since the sidebar is always visible there (no drawer behaviour). */}
      {open && (
        <div
          className="fixed inset-0 top-14 bg-black/30 z-20 lg:hidden"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <aside
        className={`fixed top-14 left-0 bottom-0 w-56 z-30 overflow-y-auto bg-[#F7F3D0] border-r border-[#F0E9B8] py-4
          transform transition-transform duration-200 ease-out
          ${open ? 'translate-x-0' : '-translate-x-full'} lg:translate-x-0`}
      >
        <nav className="flex flex-col gap-1 px-3">
          {GROUPS.map((group, gi) => (
            <div key={gi} className={gi > 0 ? 'mt-3' : ''}>
              {group.heading && (
                <p className="px-3 mb-1 text-[10px] font-bold uppercase tracking-wider text-stone-400">
                  {group.heading}
                </p>
              )}
              {group.links.map(({ to, label, Icon }) => (
                <NavLink key={to} to={to} className={linkClass} onClick={onClose}>
                  <Icon className="w-4 h-4 shrink-0" />
                  {label}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="px-5 mt-6 pt-4 border-t border-[#F0E9B8]">
          <p className="text-[10px] leading-relaxed text-stone-400">
            AiG mirrors the GPR+XRF+AI unified framework — pre-excavation material prediction.
          </p>
        </div>
      </aside>
    </>
  )
}
