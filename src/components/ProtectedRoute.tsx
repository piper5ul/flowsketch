import { Navigate, Outlet } from 'react-router-dom';
import { useSession } from '../lib/authClient';

export function ProtectedRoute() {
  const { data: session, isPending } = useSession();

  if (isPending) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-canvas">
        <div className="text-sm text-ink-600">Loading...</div>
      </div>
    );
  }

  if (!session) return <Navigate to="/login" replace />;

  return <Outlet />;
}
