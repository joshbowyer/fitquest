import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { AuthProvider } from './lib/auth';
import { RewardOverlay } from './components/RewardOverlay';
import { FirstRunApiUrl } from './components/FirstRunApiUrl';
import './index.css';
import { scheduleMorningReminder } from './lib/morningReminder';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { refetchOnWindowFocus: false, retry: 1, staleTime: 30_000 },
  },
});

// Schedule the daily 8 AM local-time notification on app launch.
// No-op in browser dev (the plugin's web implementation is a
// stub; isPluginAvailable('LocalNotifications') is false). The
// schedule persists across app restarts in the Android job
// scheduler, so the user doesn't have to re-grant permission.
void scheduleMorningReminder();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AuthProvider>
          <App />
          <RewardOverlay />
          <FirstRunApiUrl />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>
);
