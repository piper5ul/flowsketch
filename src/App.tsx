import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { ProtectedRoute } from './components/ProtectedRoute';
import { ErrorBoundary } from './components/ErrorBoundary';

const LoginPage = lazy(() => import('./pages/LoginPage').then((module) => ({ default: module.LoginPage })));
const SignupPage = lazy(() => import('./pages/SignupPage').then((module) => ({ default: module.SignupPage })));
const DashboardPage = lazy(() => import('./pages/DashboardPage').then((module) => ({ default: module.DashboardPage })));
const CanvasPage = lazy(() => import('./pages/CanvasPage').then((module) => ({ default: module.CanvasPage })));
const SharedPage = lazy(() => import('./pages/SharedPage').then((module) => ({ default: module.SharedPage })));

function App() {
  return (
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={<div className="min-h-screen bg-canvas" />}>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        {/* Outside `ProtectedRoute` on purpose: the token in the path is the
            whole credential, and there is no session to bounce off. */}
        <Route path="/s/:token" element={<SharedPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/d/:id" element={<CanvasPage />} />
        </Route>
      </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  );
}

export default App;
