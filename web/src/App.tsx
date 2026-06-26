import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
import { DashboardPage } from './pages/Dashboard';
import { ActivitiesPage } from './pages/Activities';
import { RoutinesPage } from './pages/Routines';
import { PortalLeakPage } from './pages/PortalLeak';
import { ActivityDetailPage } from './pages/ActivityDetail';
import { MeasurementsPage } from './pages/Measurements';
import { InsightsPage } from './pages/Insights';
import { SettingsPage } from './pages/Settings';
import { SkillsPage } from './pages/Skills';
import { PartyPage } from './pages/Party';
import { TeamWorkoutPage } from './pages/TeamWorkout';
import { ProfilePage } from './pages/Profile';
import { AdminPage } from './pages/Admin';
import { QuestPage } from './pages/Quest';
import { QuestWorldPage } from './pages/QuestWorld';
import { BreachPage } from './pages/Breach';
import { SpiritualPage } from './pages/Spiritual';
import { AchievementsPage } from './pages/Achievements';
import { HomeBasePage } from './components/HomeBaseCard';
import { InventoryPage } from './pages/Inventory';
import { TodayPage } from './pages/Today';
import { HabitsPage } from './pages/Habits';
import { NutritionPage } from './pages/Nutrition';
import { RecoveryPage } from './pages/Recovery';
import { ImportPage } from './pages/Import';
import { StatusPage } from './pages/Status';
import { ToolsPage } from './pages/Tools';
import { CheckInsPage } from './pages/CheckIns';
import { BodyCompPage } from './pages/BodyComp';
import { InsightsMetricsPage } from './pages/InsightsMetrics';
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
      <Route path="/breach" element={<RequireAuth><BreachPage /></RequireAuth>} />
      <Route path="/status" element={<RequireAuth><StatusPage /></RequireAuth>} />
      <Route path="/workouts" element={<RequireAuth><ActivitiesPage /></RequireAuth>} />
      <Route path="/activities" element={<RequireAuth><ActivitiesPage /></RequireAuth>} />
      <Route path="/activities/:id" element={<RequireAuth><ActivityDetailPage /></RequireAuth>} />
      <Route path="/routines" element={<RequireAuth><RoutinesPage /></RequireAuth>} />
      <Route path="/routines/:id" element={<RequireAuth><RoutinesPage /></RequireAuth>} />
      <Route path="/measurements" element={<RequireAuth><MeasurementsPage /></RequireAuth>} />
      <Route path="/today" element={<RequireAuth><TodayPage /></RequireAuth>} />
      <Route path="/habits" element={<RequireAuth><HabitsPage /></RequireAuth>} />
      <Route path="/nutrition" element={<RequireAuth><NutritionPage /></RequireAuth>} />
      <Route path="/recovery" element={<RequireAuth><RecoveryPage /></RequireAuth>} />
      <Route path="/import" element={<RequireAuth><ImportPage /></RequireAuth>} />
      <Route path="/insights" element={<RequireAuth><InsightsPage /></RequireAuth>} />
      <Route path="/insights/metrics" element={<RequireAuth><InsightsMetricsPage /></RequireAuth>} />
      <Route path="/tools" element={<RequireAuth><ToolsPage /></RequireAuth>} />
      <Route path="/check-ins" element={<RequireAuth><CheckInsPage /></RequireAuth>} />
      <Route path="/body-comp" element={<RequireAuth><BodyCompPage /></RequireAuth>} />
      <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
      <Route path="/skills" element={<RequireAuth><SkillsPage /></RequireAuth>} />
      <Route path="/party" element={<RequireAuth><PartyPage /></RequireAuth>} />
      <Route path="/team-workout/:id" element={<RequireAuth><TeamWorkoutPage /></RequireAuth>} />
      <Route path="/spiritual" element={<RequireAuth><SpiritualPage /></RequireAuth>} />
      <Route path="/home-base" element={<RequireAuth><HomeBasePage /></RequireAuth>} />
      <Route path="/portal-leak" element={<RequireAuth><PortalLeakPage /></RequireAuth>} />
      <Route path="/achievements" element={<RequireAuth><AchievementsPage /></RequireAuth>} />
      <Route path="/inventory" element={<RequireAuth><InventoryPage /></RequireAuth>} />
      <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
      <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
