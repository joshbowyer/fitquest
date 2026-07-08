import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './lib/auth';
import { ScrollToTop } from './components/ScrollToTop';
import { LoginPage } from './pages/Login';
import { RegisterPage } from './pages/Register';
// --- Lazy-loaded route chunks ---------------------------------------------
// Every non-pre-auth page is split into its own chunk. Three.js
// (Status/Calendar → BodyModel), Recharts (Insights/Nutrition/
// Measurements/BodyComp/Recovery/ActivityDetail/Today/Dashboard),
// and the gameplay pages (Quest/QuestWorld/Breach/Pet/Shop/etc.) are
// all behind these lazy boundaries, so the initial bundle only has
// the auth shell, the route table, and the shared layout.
//
// The `.then(m => ({ default: m.X }))` adapter lets us import a
// named export uniformly — `React.lazy` only reads `default`, so
// without this adapter every page would have to add a
// `export default` alongside its named one. The pages that already
// use a default export (Coach/Todo/Notifications) get the same
// treatment for consistency.
const DashboardPage = lazy(() =>
  import('./pages/Dashboard').then((m) => ({ default: m.DashboardPage })),
);
const ActivitiesPage = lazy(() =>
  import('./pages/Activities').then((m) => ({ default: m.ActivitiesPage })),
);
const CalendarPage = lazy(() =>
  import('./pages/Calendar').then((m) => ({ default: m.CalendarPage })),
);
const RoutinesPage = lazy(() =>
  import('./pages/Routines').then((m) => ({ default: m.RoutinesPage })),
);
const PortalLeakPage = lazy(() =>
  import('./pages/PortalLeak').then((m) => ({ default: m.PortalLeakPage })),
);
const ActivityDetailPage = lazy(() =>
  import('./pages/ActivityDetail').then((m) => ({ default: m.ActivityDetailPage })),
);
const MeasurementsPage = lazy(() =>
  import('./pages/Measurements').then((m) => ({ default: m.MeasurementsPage })),
);
const InsightsPage = lazy(() =>
  import('./pages/Insights').then((m) => ({ default: m.InsightsPage })),
);
const SettingsPage = lazy(() =>
  import('./pages/Settings').then((m) => ({ default: m.SettingsPage })),
);
const SkillTreePage = lazy(() =>
  import('./pages/SkillTree').then((m) => ({ default: m.SkillTreePage })),
);
const PartyPage = lazy(() =>
  import('./pages/Party').then((m) => ({ default: m.PartyPage })),
);
const TeamWorkoutPage = lazy(() =>
  import('./pages/TeamWorkout').then((m) => ({ default: m.TeamWorkoutPage })),
);
const ProfilePage = lazy(() =>
  import('./pages/Profile').then((m) => ({ default: m.ProfilePage })),
);
const AdminPage = lazy(() =>
  import('./pages/Admin').then((m) => ({ default: m.AdminPage })),
);
const QuestPage = lazy(() =>
  import('./pages/Quest').then((m) => ({ default: m.QuestPage })),
);
const QuestWorldPage = lazy(() =>
  import('./pages/QuestWorld').then((m) => ({ default: m.QuestWorldPage })),
);
const BreachPage = lazy(() =>
  import('./pages/Breach').then((m) => ({ default: m.BreachPage })),
);
const SpiritualPage = lazy(() =>
  import('./pages/Spiritual').then((m) => ({ default: m.SpiritualPage })),
);
const CoachPage = lazy(() => import('./pages/Coach'));
const TodoPage = lazy(() => import('./pages/Todo'));
const NotificationsPage = lazy(() => import('./pages/Notifications'));
const AchievementsPage = lazy(() =>
  import('./pages/Achievements').then((m) => ({ default: m.AchievementsPage })),
);
const HomeBaseFullPage = lazy(() =>
  import('./components/HomeBaseNew').then((m) => ({ default: m.HomeBaseFullPage })),
);
const InventoryPage = lazy(() =>
  import('./pages/Inventory').then((m) => ({ default: m.InventoryPage })),
);
const TodayPage = lazy(() =>
  import('./pages/Today').then((m) => ({ default: m.TodayPage })),
);
const HabitsPage = lazy(() =>
  import('./pages/Habits').then((m) => ({ default: m.HabitsPage })),
);
const NutritionPage = lazy(() =>
  import('./pages/Nutrition').then((m) => ({ default: m.NutritionPage })),
);
const RecoveryPage = lazy(() =>
  import('./pages/Recovery').then((m) => ({ default: m.RecoveryPage })),
);
const ImportPage = lazy(() =>
  import('./pages/Import').then((m) => ({ default: m.ImportPage })),
);
const ShopPage = lazy(() =>
  import('./pages/Shop').then((m) => ({ default: m.ShopPage })),
);
const PetPage = lazy(() =>
  import('./pages/Pet').then((m) => ({ default: m.PetPage })),
);
const StatusPage = lazy(() =>
  import('./pages/Status').then((m) => ({ default: m.StatusPage })),
);
const ToolsPage = lazy(() =>
  import('./pages/Tools').then((m) => ({ default: m.ToolsPage })),
);
const CheckInsPage = lazy(() =>
  import('./pages/CheckIns').then((m) => ({ default: m.CheckInsPage })),
);
const BodyCompPage = lazy(() =>
  import('./pages/BodyComp').then((m) => ({ default: m.BodyCompPage })),
);
const InsightsMetricsPage = lazy(() =>
  import('./pages/InsightsMetrics').then((m) => ({ default: m.InsightsMetricsPage })),
);
const ForecastPage = lazy(() =>
  import('./pages/Forecast').then((m) => ({ default: m.ForecastPage })),
);
// -------------------------------------------------------------------------

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
    <>
      <ScrollToTop />
      <Suspense fallback={<FullPageLoader />}>
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
        <Route path="/calendar" element={<RequireAuth><CalendarPage /></RequireAuth>} />
        <Route path="/habits" element={<RequireAuth><HabitsPage /></RequireAuth>} />
        <Route path="/nutrition" element={<RequireAuth><NutritionPage /></RequireAuth>} />
        <Route path="/recovery" element={<RequireAuth><RecoveryPage /></RequireAuth>} />
        <Route path="/import" element={<RequireAuth><ImportPage /></RequireAuth>} />
        <Route path="/insights" element={<RequireAuth><InsightsPage /></RequireAuth>} />
        <Route path="/insights/metrics" element={<RequireAuth><InsightsMetricsPage /></RequireAuth>} />
        <Route path="/tools" element={<RequireAuth><ToolsPage /></RequireAuth>} />
        <Route path="/check-ins" element={<RequireAuth><CheckInsPage /></RequireAuth>} />
        <Route path="/body-comp" element={<RequireAuth><BodyCompPage /></RequireAuth>} />
        <Route path="/forecast" element={<RequireAuth><ForecastPage /></RequireAuth>} />
        <Route path="/shop" element={<RequireAuth><ShopPage /></RequireAuth>} />
        <Route path="/pet" element={<RequireAuth><PetPage /></RequireAuth>} />
        <Route path="/settings" element={<RequireAuth><SettingsPage /></RequireAuth>} />
        <Route path="/skills" element={<RequireAuth><SkillTreePage /></RequireAuth>} />
        <Route path="/party" element={<RequireAuth><PartyPage /></RequireAuth>} />
        <Route path="/team-workout/:id" element={<RequireAuth><TeamWorkoutPage /></RequireAuth>} />
        <Route path="/spiritual" element={<RequireAuth><SpiritualPage /></RequireAuth>} />
        <Route path="/coach" element={<RequireAuth><CoachPage /></RequireAuth>} />
        <Route path="/todos" element={<RequireAuth><TodoPage /></RequireAuth>} />
        <Route path="/notifications" element={<RequireAuth><NotificationsPage /></RequireAuth>} />
        <Route path="/home-base" element={<RequireAuth><HomeBaseFullPage /></RequireAuth>} />
        <Route path="/portal-leak" element={<RequireAuth><PortalLeakPage /></RequireAuth>} />
        <Route path="/achievements" element={<RequireAuth><AchievementsPage /></RequireAuth>} />
        <Route path="/inventory" element={<RequireAuth><InventoryPage /></RequireAuth>} />
        <Route path="/profile" element={<RequireAuth><ProfilePage /></RequireAuth>} />
        <Route path="/admin" element={<RequireAuth><AdminPage /></RequireAuth>} />
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </Suspense>
    </>
  );
}
