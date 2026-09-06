import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { DashboardPage } from './pages/DashboardPage';
import { CanvasPage } from './pages/CanvasPage';
import { SharedPage } from './pages/SharedPage';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
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
    </BrowserRouter>
  );
}

export default App;
