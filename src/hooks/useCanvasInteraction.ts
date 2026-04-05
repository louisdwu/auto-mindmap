import { useState, useCallback, useEffect, useRef, RefObject } from 'react';

interface UseCanvasInteractionProps {
  containerRef: RefObject<HTMLDivElement>;
  offset: { x: number; y: number };
  setOffset: (offset: { x: number; y: number }) => void;
  scale: number;
  setScale: (scale: number) => void;
  onReset?: () => void;
}

export const useCanvasInteraction = ({
  containerRef,
  offset,
  setOffset,
  scale,
  setScale,
  onReset
}: UseCanvasInteractionProps) => {
  const [interactionMode, setInteractionMode] = useState<'move' | 'zoom'>('move');
  const [isDragging, setIsDragging] = useState(false);
  
  const dragRef = useRef({
    isDragging: false,
    startX: 0,
    startY: 0,
    offsetX: 0,
    offsetY: 0
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    dragRef.current.isDragging = true;
    dragRef.current.startX = e.clientX;
    dragRef.current.startY = e.clientY;
    dragRef.current.offsetX = offset.x;
    dragRef.current.offsetY = offset.y;
    setIsDragging(true);
  }, [offset]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    e.preventDefault();
    if (interactionMode === 'move') {
      let dx = e.deltaX;
      let dy = e.deltaY;
      if (e.shiftKey && dx === 0) {
        dx = dy;
        dy = 0;
      }
      setOffset({
        x: offset.x - dx,
        y: offset.y - dy
      });
    } else {
      const delta = e.deltaY > 0 ? 0.9 : 1.1;
      const newScale = Math.max(0.1, Math.min(5, scale * delta));
      if (newScale !== scale && containerRef.current) {
        const rect = containerRef.current.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const mouseRelX = (mouseX - offset.x) / scale;
        const mouseRelY = (mouseY - offset.y) / scale;
        setScale(newScale);
        setOffset({
          x: mouseX - mouseRelX * newScale,
          y: mouseY - mouseRelY * newScale
        });
      }
    }
  }, [interactionMode, scale, offset, setOffset, setScale, containerRef]);

  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!dragRef.current.isDragging) return;
      const dx = e.clientX - dragRef.current.startX;
      const dy = e.clientY - dragRef.current.startY;
      setOffset({
        x: dragRef.current.offsetX + dx,
        y: dragRef.current.offsetY + dy
      });
    };

    const handleMouseUp = () => {
      dragRef.current.isDragging = false;
      setIsDragging(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [setOffset]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    const pageStep = 300;
    const arrowStep = 50;
    switch (e.key) {
      case 'PageUp': e.preventDefault(); setOffset({ ...offset, y: offset.y + pageStep }); break;
      case 'PageDown': e.preventDefault(); setOffset({ ...offset, y: offset.y - pageStep }); break;
      case 'ArrowUp': e.preventDefault(); setOffset({ ...offset, y: offset.y + arrowStep }); break;
      case 'ArrowDown': e.preventDefault(); setOffset({ ...offset, y: offset.y - arrowStep }); break;
      case 'ArrowLeft': e.preventDefault(); setOffset({ ...offset, x: offset.x + arrowStep }); break;
      case 'ArrowRight': e.preventDefault(); setOffset({ ...offset, x: offset.x - arrowStep }); break;
      case 'Home': e.preventDefault(); onReset?.(); break;
    }
  }, [offset, setOffset, onReset]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    container.addEventListener('keydown', handleKeyDown);
    return () => container.removeEventListener('keydown', handleKeyDown);
  }, [containerRef, handleKeyDown]);

  return {
    interactionMode,
    setInteractionMode,
    isDragging,
    handleMouseDown,
    handleWheel
  };
};
