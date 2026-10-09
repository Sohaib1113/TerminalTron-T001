import { ReactNode } from 'react';
import { NavLink } from 'react-router-dom';
import logo from '../assets/terminatron-logo.png';
import './Sidebar.css';

const ChatIcon = (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true">
    <path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H9.4L5 20.6A1 1 0 0 1 3.4 19.8V16H4a1 1 0 0 1-1-1V5a1 1 0 0 1 1-1Zm3.2 4.2a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm4.8 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Zm4.8 0a1.1 1.1 0 1 0 0 2.2 1.1 1.1 0 0 0 0-2.2Z" />
  </svg>
);

const HomeIcon = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M4 10.6 12 4l8 6.6V20a1 1 0 0 1-1 1h-4.4v-6h-5.2v6H5a1 1 0 0 1-1-1v-9.4Z" />
  </svg>
);

const TaskIcon = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <rect x="3.5" y="3.5" width="17" height="17" rx="3" />
    <path d="m7.6 12.2 3 3 6-6.4" />
  </svg>
);

const AutomationIcon = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.8v2.4m0 13.6v2.4M4.2 12H1.8m20.4 0h-2.4M6.5 6.5 4.8 4.8m14.4 14.4-1.7-1.7M17.5 6.5l1.7-1.7M4.8 19.2l1.7-1.7" />
  </svg>
);

const SettingsIcon = (
  <svg
    viewBox="0 0 24 24"
    width="18"
    height="18"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.7"
    aria-hidden="true"
  >
    <path d="M4 8h10m3 0h3M4 16h3m3 0h10" />
    <circle cx="15.5" cy="8" r="2.2" />
    <circle cx="8.5" cy="16" r="2.2" />
  </svg>
);

const navItems: Array<{ path: string; label: string; icon: ReactNode }> = [
  { path: '/chat', label: 'AI Chat', icon: ChatIcon },
  { path: '/', label: 'Dashboard', icon: HomeIcon },
  { path: '/tasks', label: 'Tasks', icon: TaskIcon },
  { path: '/automation', label: 'Automation', icon: AutomationIcon },
  { path: '/settings', label: 'Settings', icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <aside className="sidebar">
      <div className="sidebar-brand">
        <img className="brand-logo" src={logo} alt="" aria-hidden="true" />
        <span className="sidebar-brand-text">
          <strong>TerminalTron-T001</strong>
          <em>AI Assistant</em>
        </span>
      </div>

      <nav className="sidebar-nav">
        {navItems.map((item) => (
          <NavLink
            key={item.path}
            to={item.path}
            className={({ isActive }) => `nav-link${isActive ? ' active' : ''}`}
          >
            <span className="nav-icon" aria-hidden="true">
              {item.icon}
            </span>
            <span className="nav-label">{item.label}</span>
            <span className="nav-chevron" aria-hidden="true" />
          </NavLink>
        ))}
      </nav>

      <div className="sidebar-foot">
        <span className="foot-hex" aria-hidden="true">
          <span className="foot-hex-core" />
        </span>
        <p className="foot-motto">
          Better
          <br />
          Faster
          <br />
          Smarter
        </p>
      </div>
    </aside>
  );
}

