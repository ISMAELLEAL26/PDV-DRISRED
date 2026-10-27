import { useCallback, useEffect, useRef, useState } from 'react';
import { Camera, ScanLine, X, AlertTriangle, CheckCircle2 } from 'lucide-react';

type BarcodeFormat = string;
interface BarcodeDetectorResult { rawValue: string; format: string; }
interface BarcodeDetectorConstructor {
  new (options?: { formats?: BarcodeFormat[] }): {
    detect: (source: CanvasImageSource) => Promise<BarcodeDetectorResult[]>;
  };
}

declare global {
  interface Window { BarcodeDetector?: BarcodeDetectorConstructor; }
}

interface BarcodeScannerProps {
  open: boolean;
  onClose: () => void;
  onDetect: (code: string) => void;
  title?: string;
}

const SUPPORTED_FORMATS = [
  'ean_13', 'ean_8', 'code_128', 'code_39', 'code_93', 'upc_a', 'upc_e', 'codabar', 'itf', 'qr_code', 'data_matrix', 'pdf417',
];

export default function BarcodeScanner({ open, onClose, onDetect, title = 'Escanear código' }: BarcodeScannerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const detectorRef = useRef<ReturnType<BarcodeDetectorConstructor['prototype']['detect']> | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastCodeRef = useRef<string>('');
  const lastTimeRef = useRef<number>(0);
  const [status, setStatus] = useState<'starting' | 'scanning' | 'detected' | 'error' | 'unsupported'>('starting');
  const [message, setMessage] = useState<string>('');
  const [torchOn, setTorchOn] = useState(false);
  const [torchSupported, setTorchSupported] = useState(false);

  const stop = useCallback(() => {
    if (rafRef.current !== null) { cancelAnimationFrame(rafRef.current); rafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((track) => track.stop()); streamRef.current = null; }
    if (videoRef.current) videoRef.current.srcObject = null;
  }, []);

  const startScanLoop = useCallback(() => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const DetectorCtor = window.BarcodeDetector;
    if (!video || !canvas || !DetectorCtor) {
      setStatus('unsupported');
      setMessage('Tu navegador no soporta escaneo con cámara. Usa un lector USB o captura el código manualmente.');
      return;
    }
    const detector = new DetectorCtor({ formats: SUPPORTED_FORMATS });
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) return;

    const tick = async () => {
      if (!video || video.readyState !== video.HAVE_ENOUGH_DATA) { rafRef.current = requestAnimationFrame(tick); return; }
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      try {
        const results = await detector.detect(canvas);
        if (results.length > 0) {
          const code = results[0].rawValue.trim();
          const now = performance.now();
          if (code && (code !== lastCodeRef.current || now - lastTimeRef.current > 1500)) {
            lastCodeRef.current = code;
            lastTimeRef.current = now;
            setStatus('detected');
            setMessage(code);
            if (navigator.vibrate) navigator.vibrate(120);
            window.setTimeout(() => { onDetect(code); onClose(); }, 250);
            return;
          }
        }
      } catch { /* detector transient error - keep scanning */ }
      rafRef.current = requestAnimationFrame(tick);
    };
    setStatus('scanning');
    rafRef.current = requestAnimationFrame(tick);
  }, [onDetect, onClose]);

  const start = useCallback(async () => {
    setStatus('starting');
    setMessage('');
    lastCodeRef.current = '';
    lastTimeRef.current = 0;
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      setStatus('unsupported');
      setMessage('Este dispositivo o navegador no permite acceder a la cámara.');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play();
        const track = stream.getVideoTracks()[0];
        const capabilities = (track.getCapabilities?.() ?? {}) as MediaTrackCapabilities & { torch?: boolean };
        setTorchSupported(Boolean(capabilities.torch));
      }
      startScanLoop();
    } catch (err) {
      console.error('camera access failed', err);
      setStatus('error');
      const error = err as DOMException;
      if (error?.name === 'NotAllowedError') setMessage('Permiso de cámara denegado. Habilítalo en la configuración del navegador.');
      else if (error?.name === 'NotFoundError') setMessage('No se encontró ninguna cámara en este dispositivo.');
      else setMessage('No se pudo iniciar la cámara. Verifica los permisos e inténtalo de nuevo.');
    }
  }, [startScanLoop]);

  useEffect(() => {
    if (open) void start();
    else stop();
    return () => stop();
  }, [open, start, stop]);

  const toggleTorch = async () => {
    const track = streamRef.current?.getVideoTracks()[0];
    if (!track || !torchSupported) return;
    try {
      await track.applyConstraints({ advanced: [{ torch: !torchOn } as MediaTrackConstraintSet] });
      setTorchOn((value) => !value);
    } catch { /* torch toggle unsupported at runtime */ }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[60] flex flex-col bg-slate-950">
      <div className="flex items-center justify-between bg-slate-900 px-4 py-3 text-white">
        <div className="flex items-center gap-2"><Camera size={20} /><span className="font-semibold">{title}</span></div>
        <button onClick={onClose} className="rounded-lg p-2 text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Cerrar escáner"><X size={22} /></button>
      </div>

      <div className="relative flex-1 overflow-hidden bg-black">
        <video ref={videoRef} playsInline muted className="absolute inset-0 h-full w-full object-cover" />
        <canvas ref={canvasRef} className="hidden" />

        {status === 'scanning' && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
            <div className="relative h-48 w-72 max-w-[80%] rounded-xl border-2 border-white/70 shadow-lg">
              <div className="absolute inset-x-2 top-1/2 h-0.5 animate-scan-line bg-emerald-400 shadow-[0_0_12px_2px] shadow-emerald-400/80" />
            </div>
            <div className="absolute bottom-8 left-0 right-0 text-center text-sm text-white/80">Centra el código dentro del recuadro</div>
          </div>
        )}

        {status === 'detected' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 bg-emerald-600/20 backdrop-blur-sm">
            <CheckCircle2 size={56} className="text-emerald-400" />
            <div className="rounded-lg bg-white/95 px-4 py-2 font-mono text-base font-bold text-slate-800">{message}</div>
            <p className="text-sm text-white/90">Código detectado</p>
          </div>
        )}

        {(status === 'error' || status === 'unsupported') && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 p-6 text-center">
            <AlertTriangle size={48} className="text-amber-400" />
            <p className="max-w-xs text-sm text-white/90">{message}</p>
            <button onClick={() => void start()} className="mt-2 rounded-lg bg-white/10 px-4 py-2 text-sm font-medium text-white hover:bg-white/20">Reintentar</button>
          </div>
        )}

        {status === 'starting' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-white/80">
            <Camera size={40} className="animate-pulse" />
            <p className="text-sm">Iniciando cámara…</p>
          </div>
        )}
      </div>

      {status === 'scanning' && (
        <div className="flex items-center justify-between bg-slate-900 px-4 py-3">
          <div className="flex items-center gap-1.5 text-xs text-slate-300"><ScanLine size={14} /> Escaneando…</div>
          {torchSupported && (
            <button onClick={() => void toggleTorch()} className={`rounded-lg px-3 py-1.5 text-xs font-medium transition ${torchOn ? 'bg-amber-500 text-white' : 'bg-slate-700 text-slate-200 hover:bg-slate-600'}`}>
              Linterna {torchOn ? 'Encendida' : 'Apagada'}
            </button>
          )}
        </div>
      )}
    </div>
  );
}
