"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type RefObject,
} from "react";
import { Eraser } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";

// Signature pad — pointer events (touch + mouse + stylus),
// devicePixelRatio-scaled canvas, strokes stored for crisp redraws.

export function SignaturePad({
  canvasRef,
  onInkChange,
  invalid,
}: {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  onInkChange: (hasInk: boolean) => void;
  invalid?: boolean;
}) {
  const strokesRef = useRef<Array<Array<{ x: number; y: number }>>>([]);
  /** Pointer currently drawing — a second finger / palm or non-primary button is ignored. */
  const pointerIdRef = useRef<number | null>(null);
  const [inked, setInked] = useState(false);

  const applyStyle = useCallback((ctx: CanvasRenderingContext2D) => {
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = "#1e293b";
    ctx.fillStyle = "#1e293b";
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
  }, []);

  const redraw = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const rect = canvas.getBoundingClientRect();
    applyStyle(ctx);
    ctx.clearRect(0, 0, rect.width, rect.height);
    for (const stroke of strokesRef.current) {
      if (stroke.length === 0) continue;
      ctx.beginPath();
      ctx.moveTo(stroke[0].x, stroke[0].y);
      if (stroke.length === 1) {
        ctx.arc(stroke[0].x, stroke[0].y, 1.25, 0, Math.PI * 2);
        ctx.fill();
        continue;
      }
      for (let i = 1; i < stroke.length; i++) ctx.lineTo(stroke[i].x, stroke[i].y);
      ctx.stroke();
    }
  }, [applyStyle, canvasRef]);

  // Scale the backing store by devicePixelRatio for crisp lines; re-run on resize
  // (dialog open animation, rotation) and replay stored strokes.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2) return;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = Math.round(rect.width * dpr);
      canvas.height = Math.round(rect.height * dpr);
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      redraw();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [canvasRef, redraw]);

  const pointerPos = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  const handlePointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!e.isPrimary || e.button !== 0 || pointerIdRef.current !== null) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      /* pointer already released */
    }
    pointerIdRef.current = e.pointerId;
    const ctx = e.currentTarget.getContext("2d");
    if (!ctx) return;
    applyStyle(ctx);
    const p = pointerPos(e);
    strokesRef.current.push([p]);
    ctx.beginPath();
    ctx.arc(p.x, p.y, 1.25, 0, Math.PI * 2);
    ctx.fill();
  };

  const handlePointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current !== e.pointerId) return;
    const stroke = strokesRef.current[strokesRef.current.length - 1];
    const ctx = e.currentTarget.getContext("2d");
    if (!stroke || !ctx) return;
    const p = pointerPos(e);
    const prev = stroke[stroke.length - 1];
    applyStyle(ctx);
    ctx.beginPath();
    ctx.moveTo(prev.x, prev.y);
    ctx.lineTo(p.x, p.y);
    ctx.stroke();
    stroke.push(p);
    if (stroke.length >= 2 && !inked) {
      setInked(true);
      onInkChange(true);
    }
  };

  const endStroke = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (pointerIdRef.current === e.pointerId) pointerIdRef.current = null;
  };

  const clear = () => {
    strokesRef.current = [];
    pointerIdRef.current = null;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (canvas && ctx) {
      const rect = canvas.getBoundingClientRect();
      applyStyle(ctx);
      ctx.clearRect(0, 0, rect.width, rect.height);
    }
    setInked(false);
    onInkChange(false);
  };

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <Label id="pod-signature-label" className="text-sm font-medium">
          Recipient signature
        </Label>
        <Button type="button" variant="ghost" className="h-11 gap-1.5 px-3 text-sm" onClick={clear}>
          <Eraser className="size-4" aria-hidden="true" /> Clear
        </Button>
      </div>
      <div className="relative">
        <canvas
          ref={canvasRef}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endStroke}
          onPointerCancel={endStroke}
          onLostPointerCapture={endStroke}
          className={cn(
            "h-48 w-full touch-none cursor-crosshair rounded-xl border-2 border-dashed bg-white",
            invalid ? "border-rose-400" : "border-zinc-300 dark:border-zinc-500",
          )}
          role="img"
          aria-labelledby="pod-signature-label"
          aria-describedby="pod-signature-hint"
        />
        {!inked ? (
          <div className="pointer-events-none absolute inset-x-6 bottom-8 flex items-end gap-2 text-zinc-500" aria-hidden="true">
            <span className="text-lg leading-none">×</span>
            <span className="mb-0.5 h-px flex-1 bg-zinc-300" />
          </div>
        ) : null}
      </div>
      <p id="pod-signature-hint" className="text-sm text-muted-foreground">
        Draw with a finger or stylus. A signature, a photo, or both are required.
      </p>
    </div>
  );
}
