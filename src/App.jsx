import { Toaster } from "@/components/ui/toaster"
import { QueryClientProvider } from '@tanstack/react-query'
import { queryClientInstance } from '@/lib/query-client'
import NavigationTracker from '@/lib/NavigationTracker'
import { pagesConfig } from './pages.config'
import { Suspense } from 'react';
import { BrowserRouter as Router, Navigate, Route, Routes } from 'react-router-dom';
import PageNotFound from './lib/PageNotFound';
import { AuthProvider, useAuth } from '@/lib/AuthContext';
import UserNotRegisteredError from '@/components/UserNotRegisteredError';

const { Pages, Layout, mainPage } = pagesConfig;
const mainPageKey = mainPage ?? Object.keys(Pages)[0];
const MainPage = mainPageKey ? Pages[mainPageKey] : <></>;
const ADMIN_ONLY_PAGES = new Set([
    'AdminDashboard',
    'OperatorsManagement',
    'ClassManagement',
    'StudentsManagement',
    'PracticeSchedulesManagement',
    'PracticePeriodsManagement',
    'ScheduleManagement',
    'ClassPracticePlansManagement',
    'OperatorStudentsList',
]);

function canAccessPage(pageName, user) {
    if (pageName === 'Login') return true;
    if (user?.role === 'admin') return true;
    return !ADMIN_ONLY_PAGES.has(pageName);
}

const LayoutWrapper = ({ children, currentPageName }) => Layout ?
    <Layout currentPageName={currentPageName}>{children}</Layout>
    : <>{children}</>;

const AuthenticatedApp = () => {
    const { user, isLoadingAuth, isLoadingPublicSettings, authError, navigateToLogin } = useAuth();
    const LoginPage = Pages.Login || null;
    const landingPageKey = user?.role === 'admin'
        ? (Pages.AdminDashboard ? 'AdminDashboard' : mainPageKey)
        : (Pages.StudentHome ? 'StudentHome' : mainPageKey);
    const LandingPage = Pages[landingPageKey] || MainPage;

    // Show loading spinner while checking app public settings or auth
    if (isLoadingPublicSettings || isLoadingAuth) {
        return (
            <div className="fixed inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
            </div>
        );
    }

    // Handle authentication errors
    if (authError) {
        if (authError.type === 'auth_required' && LoginPage) {
            return (
                <Routes>
                    <Route path="/Login" element={<LoginPage />} />
                    <Route path="*" element={<Navigate to="/Login" replace />} />
                </Routes>
            );
        }

        if (authError.type === 'user_not_registered') {
            return <UserNotRegisteredError />;
        } else if (authError.type === 'auth_required') {
            // Redirect to login automatically
            navigateToLogin();
            return null;
        }

        return (
            <div className="fixed inset-0 flex items-center justify-center p-4 bg-slate-50">
                <div className="max-w-lg w-full bg-white border rounded-xl shadow-sm p-6 space-y-4">
                    <h2 className="text-xl font-semibold text-slate-900">Aplicatia nu poate porni</h2>
                    <p className="text-sm text-slate-600">
                        {authError.message || 'Configuratia aplicatiei este invalida sau incompleta.'}
                    </p>
                    <div className="bg-slate-100 rounded-lg p-3 text-xs text-slate-700">
                        Configureaza in `.env.local`:
                        <br />
                        `VITE_APP_ID=...`
                        <br />
                        `VITE_API_BASE_URL=https://api.exemplu.ro`
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => window.location.reload()}
                            className="px-4 py-2 rounded-md bg-slate-900 text-white text-sm"
                        >
                            Reincarca
                        </button>
                    </div>
                </div>
            </div>
        );
    }

    // Render the main app
    return (
        <Suspense fallback={
            <div className="fixed inset-0 flex items-center justify-center">
                <div className="w-8 h-8 border-4 border-slate-200 border-t-slate-800 rounded-full animate-spin"></div>
            </div>
        }>
            <Routes>
                {LoginPage && (
                    <Route path="/Login" element={<Navigate to="/" replace />} />
                )}
                <Route path="/" element={
                    <LayoutWrapper currentPageName={landingPageKey}>
                        <LandingPage />
                    </LayoutWrapper>
                } />
                {Object.entries(Pages).map(([path, Page]) => (
                    path === 'Login'
                        ? null
                        : (
                    <Route
                        key={path}
                        path={`/${path}`}
                        element={
                            canAccessPage(path, user)
                                ? (
                                    <LayoutWrapper currentPageName={path}>
                                        <Page />
                                    </LayoutWrapper>
                                )
                                : <Navigate to="/" replace />
                        }
                    />
                        )
                ))}
                <Route path="*" element={<PageNotFound />} />
            </Routes>
        </Suspense>
    );
};


function App() {

    return (
        <AuthProvider>
            <QueryClientProvider client={queryClientInstance}>
                <Router>
                    <NavigationTracker />
                    <AuthenticatedApp />
                </Router>
                <Toaster />
            </QueryClientProvider>
        </AuthProvider>
    )
}

export default App
