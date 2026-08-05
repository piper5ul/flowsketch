import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ReactFlowProvider } from '@xyflow/react';
import { Canvas } from '../components/Canvas';
import { TooltipProvider } from '../components/Tooltip';
import { useDiagramStore } from '../store/useDiagramStore';
import { api } from '../lib/api';

export function CanvasPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const loadDiagram = useDiagramStore((s) => s.loadDiagram);
  const mounted = useRef(false);

  useEffect(() => {
    if (!id || mounted.current) return;
    mounted.current = true;

    api.getDiagram(id)
      .then((diagram) => {
        loadDiagram(diagram.id, diagram.title, diagram.starred, diagram.data);
        setLoading(false);
      })
      .catch(() => {
        navigate('/', { replace: true });
      });
  }, [id, loadDiagram, navigate]);

  useEffect(() => {
    if (loading || !id) return;

    let timer: ReturnType<typeof setTimeout>;
    const unsubscribe = useDiagramStore.subscribe((state, prev) => {
      if (state.nodes === prev.nodes && state.edges === prev.edges && state.title === prev.title) return;
      clearTimeout(timer);
      timer = setTimeout(() => {
        useDiagramStore.getState().saveDiagram();
      }, 2000);
    });

    return () => {
      clearTimeout(timer);
      unsubscribe();
    };
  }, [loading, id]);

  if (loading) {
    return (
      <div className="flex h-screen w-screen items-center justify-center bg-canvas">
        <div className="text-sm text-ink-600">Loading diagram...</div>
      </div>
    );
  }

  return (
    <TooltipProvider>
      <ReactFlowProvider>
        <div className="h-screen w-screen overflow-hidden">
          <Canvas />
        </div>
      </ReactFlowProvider>
    </TooltipProvider>
  );
}
