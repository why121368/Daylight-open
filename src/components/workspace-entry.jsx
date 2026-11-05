import React, { lazy } from 'react';
import { Outlet } from 'react-router-dom';
import { BootScreen } from '@/components/boot-screen';
import { OnboardingHost } from '@/components/onboarding';
import { WorkspaceProvider, useWorkspace } from '@/context/workspace';
import { WorkbenchesProvider } from '@/context/workbenches';
import { useAuthUser } from '@/lib/auth-session';
import { ServiceUnavailablePage } from '@/pages/error-page';

const EventDialog = lazy(() => import('@/components/event-dialog').then(module => ({ default: module.EventDialog })));

function OnboardingGate() {
  const { demo, configurationReady } = useAuthUser();
  return configurationReady && !demo ? <OnboardingHost /> : null;
}

function BootGate({ children }) {
  const { state, loadError, reload } = useWorkspace();
  if (loadError && !state) {
    return <ServiceUnavailablePage detail={loadError} onRetry={() => reload().catch(() => {})} />;
  }
  if (!state) return <BootScreen label="正在加载工作区…" />;
  return <div className="animate-in fade-in duration-300 fill-mode-both">{children}</div>;
}

/** Load account workspace state only after the route's authentication gate. */
export default function WorkspaceEntry() {
  return (
    <WorkspaceProvider>
      <BootGate>
        <WorkbenchesProvider>
          <Outlet />
          <EventDialog />
          <OnboardingGate />
        </WorkbenchesProvider>
      </BootGate>
    </WorkspaceProvider>
  );
}
