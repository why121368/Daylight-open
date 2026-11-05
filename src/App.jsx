import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Toaster } from '@/components/ui/sonner';
const AdminShell = lazy(() => import('@/components/admin-shell').then(module => ({ default: module.AdminShell })));
const AppShell = lazy(() => import('@/components/app-shell').then(module => ({ default: module.AppShell })));
import { BootScreen } from '@/components/boot-screen';
import { ErrorBoundary } from '@/components/error-boundary';
import { AttachmentViewerProvider } from '@/components/attachment-viewer-context';
import { ThemeProvider } from '@/components/theme-provider';
const WorkspaceEntry = lazy(() => import('@/components/workspace-entry'));
import { getAuthToken } from '@/lib/auth-api';
import { AuthProvider, useAuthUser } from '@/lib/auth-session';
const WorkbenchesPage = lazy(() => import('@/pages/workbenches-page'));
const OverviewPage = lazy(() => import('@/pages/overview'));
const CalendarPage = lazy(() => import('@/pages/calendar-page'));
const MailPage = lazy(() => import('@/pages/mail-page'));
const InvoicesPage = lazy(() => import('@/pages/invoices-page'));
const CampusPage = lazy(() => import('@/pages/campus-page'));
const MailDeskPage = lazy(() => import('@/pages/mail-desk-page'));
const RecruitmentPage = lazy(() => import('@/pages/recruitment-page'));
const SettingsPage = lazy(() => import('@/pages/settings-page'));
const TracesPage = lazy(() => import('@/pages/traces-page'));
const JobsPage = lazy(() => import('@/pages/jobs-page'));
const TodosPage = lazy(() => import('@/pages/todos-page'));
const AccountPage = lazy(() => import('@/pages/account-page'));
const LandingPage = lazy(() => import('@/pages/landing-page'));
const LoginPage = lazy(() => import('@/pages/login-page'));
const RegisterPage = lazy(() => import('@/pages/register-page'));
const ForgotPasswordPage = lazy(() => import('@/pages/forgot-password-page'));
const ResetPasswordPage = lazy(() => import('@/pages/reset-password-page'));
const LegalPage = lazy(() => import('@/pages/legal-page'));
const AdminPage = lazy(() => import('@/pages/admin-page'));
const AdminLoginPage = lazy(() => import('@/pages/admin-login-page'));
import { AppErrorPage, NotFoundPage, ServiceUnavailablePage } from '@/pages/error-page';

const CampusGuidePage = lazy(() => import('@/pages/campus-guide-page'));
const ExperiencePage = lazy(() => import('@/pages/experience-page'));
const EvidencePage = lazy(() => import('@/pages/evidence-page'));
const DemoPage = lazy(() => import('@/pages/demo-page'));

function RequireAuth({ children }) {
  const location = useLocation();
  const { user, loading, refresh } = useAuthUser();
  const [ready, setReady] = useState(() => Boolean(user) || !getAuthToken());

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!getAuthToken()) {
        if (!cancelled) setReady(true);
        return;
      }
      if (user) {
        if (!cancelled) setReady(true);
        return;
      }
      await refresh();
      if (!cancelled) setReady(true);
    }
    run();
    return () => { cancelled = true; };
  }, [refresh, user]);

  if (loading || !ready) {
    return <BootScreen label="正在验证登录…" />;
  }
  if (!getAuthToken() || !user) {
    return <Navigate to="/login" replace state={{ from: location }} />;
  }
  return children;
}

/** 管理端强制登录 + 管理员身份，与用户端门禁分离。 */
function RequireAdmin({ children }) {
  const location = useLocation();
  const { user, loading, isAdmin, refresh } = useAuthUser();
  const [ready, setReady] = useState(() => Boolean(user) || !getAuthToken());

  useEffect(() => {
    let cancelled = false;
    async function run() {
      if (!getAuthToken()) {
        if (!cancelled) setReady(true);
        return;
      }
      if (user) {
        if (!cancelled) setReady(true);
        return;
      }
      await refresh();
      if (!cancelled) setReady(true);
    }
    run();
    return () => { cancelled = true; };
  }, [refresh, user]);

  if (loading || !ready) {
    return <BootScreen label="正在进入管理端…" />;
  }
  if (!getAuthToken() || !user) {
    return <Navigate to="/admin/login" replace state={{ from: location }} />;
  }
  if (!isAdmin) {
    return <Navigate to="/admin/login" replace state={{ from: location, denied: true }} />;
  }
  return children;
}

function AppWorkspace() {
  return (
    <RequireAuth>
      <WorkspaceEntry />
    </RequireAuth>
  );
}

function AdminPortal() {
  return (
    <RequireAdmin>
      <AdminShell />
    </RequireAdmin>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <AttachmentViewerProvider>
        <BrowserRouter>
          <ErrorBoundary>
            <Suspense fallback={<BootScreen label="正在打开页面…" />}><Routes>
              <Route path="/" element={<LandingPage />} />
              <Route path="/experience" element={<ExperiencePage />} />
              <Route path="/evidence" element={<EvidencePage />} />
              <Route path="/demo" element={<DemoPage />} />
              <Route path="/campus" element={<Suspense fallback={<BootScreen label="正在打开校园生活…" />}><CampusGuidePage /></Suspense>} />
              <Route path="/app/campus-guide" element={<Navigate to="/campus" replace />} />
              <Route path="/login" element={<LoginPage />} />
              <Route path="/register" element={<RegisterPage />} />
              <Route path="/forgot-password" element={<ForgotPasswordPage />} />
              <Route path="/reset-password" element={<ResetPasswordPage />} />
              <Route path="/legal/:doc" element={<LegalPage />} />
              <Route path="/terms" element={<Navigate to="/legal/terms" replace />} />
              <Route path="/privacy" element={<Navigate to="/legal/privacy" replace />} />
              <Route path="/policies" element={<Navigate to="/legal/policies" replace />} />
              <Route path="/502" element={<ServiceUnavailablePage />} />
              <Route path="/500" element={<AppErrorPage />} />

              {/* 用户工作区 */}
              <Route path="/app" element={<AppWorkspace />}>
                <Route element={<AppShell />}>
                  <Route index element={<OverviewPage />} />
                  <Route path="workbenches" element={<WorkbenchesPage />} />
                  <Route path="workbenches/:id" element={<WorkbenchesPage />} />
                  <Route path="calendar" element={<CalendarPage />} />
                  <Route path="todos" element={<TodosPage />} />
                  <Route path="mail" element={<MailPage />} />
                  <Route path="invoices" element={<InvoicesPage />} />
                  <Route path="recruitment" element={<RecruitmentPage />} />
                  <Route path="campus" element={<CampusPage />} />
                  <Route path="mail-desk" element={<MailDeskPage />} />
                  <Route path="traces" element={<TracesPage />} />
                  <Route path="jobs" element={<JobsPage />} />
                  <Route path="settings" element={<SettingsPage />} />
                  <Route path="account" element={<AccountPage />} />
                  <Route path="*" element={<NotFoundPage embedded />} />
                </Route>
              </Route>

              {/* 独立管理端：先登录，再进入控制台 */}
              <Route path="/admin/login" element={<AdminLoginPage />} />
              <Route path="/admin" element={<AdminPortal />}>
                <Route index element={<AdminPage />} />
                <Route path="monitor/jobs" element={<AdminPage />} />
                <Route path="monitor/traces" element={<AdminPage />} />
                <Route path="users" element={<AdminPage />} />
                <Route path="users/:id" element={<AdminPage />} />
                <Route path="mailboxes" element={<AdminPage />} />
                <Route path="storage" element={<AdminPage />} />
                <Route path="storage/oss" element={<AdminPage />} />
                <Route path="mail" element={<AdminPage />} />
                <Route path="workspace" element={<AdminPage />} />
                <Route path="onboarding" element={<AdminPage />} />
                <Route path="auth" element={<AdminPage />} />
                <Route path="*" element={<NotFoundPage embedded />} />
              </Route>

              <Route path="/app/admin" element={<Navigate to="/admin" replace />} />
              <Route path="/calendar" element={<Navigate to="/app/calendar" replace />} />
              <Route path="/mail" element={<Navigate to="/app/mail" replace />} />
              <Route path="/traces" element={<Navigate to="/app/traces" replace />} />
              <Route path="/settings" element={<Navigate to="/app/settings" replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Routes></Suspense>
            <Toaster richColors position="bottom-center" />
          </ErrorBoundary>
        </BrowserRouter>
        </AttachmentViewerProvider>
      </AuthProvider>
    </ThemeProvider>
  );
}
