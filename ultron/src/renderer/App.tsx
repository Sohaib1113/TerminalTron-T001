import { MemoryRouter as Router, Routes, Route } from 'react-router-dom';
import { Toaster } from 'react-hot-toast';
import TitleBar from './components/TitleBar';
import Sidebar from './components/Sidebar';
import Dashboard from './pages/Dashboard';
import Tasks from './pages/Tasks';
import Chat from './pages/Chat';
import Automation from './pages/Automation';
import Settings from './pages/Settings';
import './App.css';

export default function App() {
  return (
    <Router>
      <div className="app-shell">
        <TitleBar />
        <div className="app-body">
          <Sidebar />
          <main className="main-content">
            <Routes>
              <Route path="/" element={<Dashboard />} />
              <Route path="/tasks" element={<Tasks />} />
              <Route path="/chat" element={<Chat />} />
              <Route path="/automation" element={<Automation />} />
              <Route path="/settings" element={<Settings />} />
            </Routes>
          </main>
        </div>
      </div>
      <Toaster
        position="bottom-right"
        toastOptions={{
          style: {
            background: 'rgba(14, 13, 9, 0.96)',
            border: '1px solid rgba(245, 197, 24, 0.35)',
            color: '#f6eed6',
            borderRadius: 0,
            fontFamily: 'Bahnschrift, Segoe UI, sans-serif',
          },
        }}
      />
    </Router>
  );
}

