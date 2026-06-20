import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { DashboardPage } from './pages/Dashboard';
import { WorkoutsPage } from './pages/Workouts';
import { MeasurementsPage } from './pages/Measurements';
import { InsightsPage } from './pages/Insights';
import { SettingsPage } from './pages/Settings';
import { SkillsPage } from './pages/Skills';
import { PartyPage } from './pages/Party';
import { ProfilePage } from './pages/Profile';
import { QuestPage } from './pages/Quest';
import { QuestWorldPage } from './pages/QuestWorld';
import { SpiritualPage } from './pages/Spiritual';
import { AchievementsPage } from './pages/Achievements';
import { TodayPage } from './pages/Today';
import { HabitsPage } from './pages/Habits';
import { NutritionPage } from './pages/Nutrition';
import { RecoveryPage } from './pages/Recovery';
import { ImportPage } from './pages/Import';
import { StatusPage } from './pages/Status';
import type { ReactNode } from 'react';

function FullPageLoader() {
  return (
    <div className="min-h-screen grid-bg flex items-center justify-center">
      <div className="text-center">
        <div className="font-display tracking-[0.5em] text-2xl neon-text-cyan animate-pulse-slow">FIT//QUEST</div>
        <div className="text-xs font-mono text-ink-300 mt-2 tracking-widest">booting…</div>
      </div>
    </div>
  );
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" state={{ from: location.pathname }} replace />;
  return <>{children}</>;
}

function RedirectIfAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/dashboard" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<RedirectIfAuth><LoginPage /></RedirectIfAuth>} />
      <Route path="/register" element={<RedirectIfAuth><RegisterPage /></RedirectIfAuth>} />
      <Route path="/dashboard" element={<RequireAuth><DashboardPage /></RequireAuth>} />
      <Route path="/quest" element={<RequireAuth><QuestPage /></RequireAuth>} />
      <Route path="/quest/:worldId" element={<RequireAuth><QuestWorldPage /></RequireAuth>} />
      <Route path="/quest/:worldId/:levelId" element={<RequireAuth><QuestWorldPage /></RequireAuth>} />
      <Route path="/status" element={<RequireAuth><StatusPage /></RequireAuth>} />
      <Route path="/workouts" element={<RequireAuth><WorkoutsPage /></RequireAuth>} />
      <Route path="/measurements" element={<RequireAuth><MeasurementsPage /></RequireAuth>} />
      <Route path="/today" element={<RequireAuth><TodayPage /></RequireAuth>} />
      <Route path="/habits" element={<RequireAuth><HabitsPage /></RequireAuth>} />
      <Route path="/nutrition" element={<RequireAuth><NutritionPage /></RequireAuth>} />
      <Route path="/recovery" element={<RequireAuth><RecoveryPage /></RequireAuth>} />
      <Route path="/import" element={<RequireAuth><ImportPage /></RequireAuth>} />
      <Route path="/insights" element={<RequireAuth><InsightsPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/skills" element={<RequireAuth><SkillsPage /></RequireAuth>} />
      <Route path="/party" element={<RequireAuth><PartyPage /></RequireAuth>} />
      <Route path="/spiritual" element={<RequireAuth><SpiritualPage /></RequireAuth>} />
      <Route path="/achievements" element={<RequireAuth><AchievementsPage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
