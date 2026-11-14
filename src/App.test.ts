// @vitest-environment jsdom
import { act, createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { expect, it, vi } from 'vitest';

const { loaded } = vi.hoisted(() => ({ loaded: [] as string[] }));
vi.mock('./pages/LoginPage', () => {
  loaded.push('Login');
  return { LoginPage: () => 'Login' };
});
vi.mock('./pages/SignupPage', () => {
  loaded.push('Signup');
  return { SignupPage: () => 'Signup' };
});
vi.mock('./pages/DashboardPage', () => {
  loaded.push('Dashboard');
  return { DashboardPage: () => 'Dashboard' };
});
vi.mock('./pages/CanvasPage', () => {
  loaded.push('Canvas');
  return { CanvasPage: () => 'Canvas' };
});
vi.mock('./pages/SharedPage', () => {
  loaded.push('Shared');
  return { SharedPage: () => 'Shared' };
});
vi.mock('./lib/authClient', () => ({
  useSession: () => ({ data: { user: { id: 'user' } }, isPending: false }),
}));

it('loads only the page for the current route and renders it after loading', async () => {
  const { default: App } = await import('./App');
  expect(loaded).toEqual([]);
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true);
  const host = document.createElement('div');
  document.body.append(host);
  const visited: string[] = [];
  try {
    for (const [path, page] of [
      ['/login', 'Login'], ['/signup', 'Signup'], ['/', 'Dashboard'],
      ['/s/token', 'Shared'], ['/d/diagram', 'Canvas'],
    ]) {
      window.history.replaceState({}, '', path);
      const root = createRoot(host);
      try {
        await act(async () => { root.render(createElement(App)); });
        expect(host.textContent).toBe(page);
        visited.push(page);
        expect(loaded).toEqual(visited);
      } finally {
        await act(async () => { root.unmount(); });
      }
    }
  } finally {
    host.remove();
    vi.unstubAllGlobals();
  }
});
