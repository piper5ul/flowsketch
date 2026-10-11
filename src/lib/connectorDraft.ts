/**
 * The connector tool's draft line, as a store of its own — see
 * `ConnectorDraftLine`, the one component that reads it.
 */
import { createStore, type StoreApi } from 'zustand/vanilla';
import type { Point } from './edgeGeometry';

export interface ConnectorDraft {
  from: Point;
  to: Point;
  stroke: string;
  strokePx: number;
  endArrow: boolean;
}

export type ConnectorDraftStore = StoreApi<{ draft: ConnectorDraft | null }>;

export function createConnectorDraftStore(): ConnectorDraftStore {
  return createStore<{ draft: ConnectorDraft | null }>(() => ({ draft: null }));
}
