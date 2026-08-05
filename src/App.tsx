import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { LoginPage } from './pages/LoginPage';
import { SignupPage } from './pages/SignupPage';
import { DashboardPage } from './pages/DashboardPage';
import { CanvasPage } from './pages/CanvasPage';
import { ProtectedRoute } from './components/ProtectedRoute';

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/signup" element={<SignupPage />} />
        <Route element={<ProtectedRoute />}>
          <Route path="/" element={<DashboardPage />} />
          <Route path="/d/:id" element={<CanvasPage />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}

export default App;
