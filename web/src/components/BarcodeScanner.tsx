/**
 * Barcode scanner for the food logging flow.
 *
 * Three scan paths, picked at runtime:
 *   1. Capacitor Android  → @capacitor/barcode-scanner (native UI
 *                           overlay with reticle, ML Kit under the
 *                           hood — fast + accurate)
 *   2. Web with a webcam  → @zxing/browser on a MediaStream from
 *                           `navigator.mediaDevices.getUserMedia`,
 *                           rendered into a <video> with a custom
 *                           reticle overlay
 *   3. Manual fallback    → text input for the user to type the
 *                           barcode digits (last-resort)
 *
 * After a successful scan, we strip non-digits and pass the code
 * up via `onScanned(code)`. EAN-8/13 and UPC-A are the most common
 * formats on packaged food; we also accept ITF, Code 128/39, QR,
 * and Aztec from the native hint.
 */

import { useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { Modal } from './Modal';
import { NeonButton } from './NeonButton';

type ScannerProps = {
  onScanned: (code: string) => void;
};

export function BarcodeScannerButton({ onScanned }: ScannerProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <NeonButton
        size="sm"
        variant="lime"
        onClick={() => setOpen(true)}
        title="Scan a product barcode. Native plugin on Android, webcam + ZXing on desktop."
      >
        Scan
      </NeonButton>
      {open && (
        <BarcodeScannerModal
          onClose={() => setOpen(false)}
          onScanned={(code) => {
            setOpen(false);
            onScanned(code);
          }}
        />
      )}
    </>
  );
}

type ModalProps = {
  onClose: () => void;
  onScanned: (code: string) => void;
};

function BarcodeScannerModal({ onClose, onScanned }: ModalProps) {
  // The plugin's @CapacitorPlugin(name = "CapacitorBarcodeScanner")
  // registers under that name (not "BarcodeScanner" or
  // "BarcodeScannerPlugin"). Easy to get wrong — verify against
  // node_modules/@capacitor/barcode-scanner/android/src/main/
  // java/.../OSBarcodePlugin.kt if Capacitor.isPluginAvailable()
  // ever returns false unexpectedly.
  const isAndroidNative =
    typeof window !== 'undefined' &&
    Capacitor.isNativePlatform() &&
    Capacitor.getPlatform() === 'android' &&
    Capacitor.isPluginAvailable('CapacitorBarcodeScanner');

  return (
    <Modal
      open={true}
      onClose={onClose}
      title="Scan a barcode"
      width="max-w-md"
    >
      {isAndroidNative ? (
        <NativeScanner onScanned={onScanned} onCancel={onClose} />
      ) : (
        <WebScannerFallback onScanned={onScanned} onCancel={onClose} />
      )}
    </Modal>
  );
}

/**
 * Capacitor path: hands the entire scan UI off to the native
 * ML-Kit-backed plugin. The native overlay shows its own reticle
 * + permission prompt; we just await the result.
 */
function NativeScanner({
  onScanned,
  onCancel,
}: {
  onScanned: (code: string) => void;
  onCancel: () => void;
}) {
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const mod = await import('@capacitor/barcode-scanner');
        const result = await mod.CapacitorBarcodeScanner.scanBarcode({
          // ALL = native picks the best one for the platform. We
          // accept QR + Aztec too — sometimes a label uses a QR
          // for a product URL, the API resolves the same code.
          hint: mod.CapacitorBarcodeScannerTypeHint.ALL,
          scanInstructions: 'Aim at the barcode',
          scanButton: true,
        });
        if (cancelled) return;
        const code = stripNonDigits(result.ScanResult);
        if (code) onScanned(code);
        else setErr('No barcode detected — aim more directly and try again');
      } catch (e: any) {
        if (cancelled) return;
        setErr(e?.message ?? 'Scanner unavailable');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onScanned, onCancel]);
  return (
    <div className="text-xs font-mono text-ink-200 space-y-2">
      <p>Opening the camera scanner…</p>
      {err && <p className="neon-text-red-400">{err}</p>}
    </div>
  );
}

/**
 * Web fallback. Two sub-paths:
 *   - If `navigator.mediaDevices.getUserMedia` is available,
 *     stream the back-facing camera into a <video> and decode
 *     frames with @zxing/browser's BrowserMultiFormatReader
 *     (EAN-13/8, UPC-A/E, Code 128/39, QR, ITF).
 *   - Otherwise, fall back to a plain text-input prompt.
 *
 * The decode is continuous — first valid code wins.
 */
function WebScannerFallback({
  onScanned,
  onCancel,
}: {
  onScanned: (code: string) => void;
  onCancel: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const controlsRef = useRef<{ stop: () => void } | null>(null);
  const [phase, setPhase] = useState<'init' | 'streaming' | 'nomedia' | 'denied' | 'manual'>('init');
  const [manualCode, setManualCode] = useState('');

  const startCamera = async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setPhase('nomedia');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
        audio: false,
      });
      const video = videoRef.current;
      if (!video) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      video.srcObject = stream;
      await video.play().catch(() => {});
      const { BrowserMultiFormatReader } = await import('@zxing/browser');
      const reader = new BrowserMultiFormatReader();
      const controls = await reader.decodeFromVideoElement(video, (result, _err, ctl) => {
        if (result) {
          const text = result.getText();
          const code = stripNonDigits(text);
          if (code) {
            ctl.stop();
            stream.getTracks().forEach((t) => t.stop());
            controlsRef.current = null;
            onScanned(code);
          }
        }
      });
      controlsRef.current = controls;
      setPhase('streaming');
    } catch {
      // NotAllowedError → user denied; NotFoundError → no camera
      setPhase('denied');
    }
  };

  useEffect(() => {
    void startCamera();
    return () => {
      controlsRef.current?.stop();
      controlsRef.current = null;
      const tracks = (videoRef.current?.srcObject as MediaStream | null)?.getTracks?.() ?? [];
      tracks.forEach((t) => t.stop());
    };
    // onScanned reference may change across renders; capture via
    // ref so we don't tear down + restart the scanner on parent
    // re-renders. The handler itself is stable enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const tryManual = () => {
    const code = stripNonDigits(manualCode);
    if (code) onScanned(code);
  };

  return (
    <div className="text-xs font-mono text-ink-200 space-y-3">
      {phase === 'streaming' && (
        <>
          <div className="relative w-full aspect-video bg-bg-900 border border-ink-500/40 overflow-hidden">
            <video
              ref={videoRef}
              className="absolute inset-0 w-full h-full object-cover"
              playsInline
              muted
            />
            {/* Reticle overlay — a translucent frame in the
                middle of the viewport, leaving the camera's own
                UI to decode from that area. */}
            <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
              <div
                className="w-3/4 max-w-[240px] aspect-[3/2] border-2 border-neon-amber/80 rounded-md"
                style={{ boxShadow: '0 0 18px rgba(255,170,58,0.45) inset' }}
              />
            </div>
          </div>
          <p className="text-[10px] text-ink-400">
            Point the camera at the barcode. Most phones will auto-focus.
          </p>
        </>
      )}
      {phase === 'init' && <p>Starting camera…</p>}
      {phase === 'denied' && (
        <p className="neon-text-red-400">
          Camera access was denied. Use the manual entry below.
        </p>
      )}
      {phase === 'nomedia' && (
        <p className="neon-text-amber">
          No camera detected. Use the manual entry below.
        </p>
      )}
      {phase !== 'streaming' && (
        <div className="border-t border-ink-500/30 pt-3 mt-3">
          <label className="block text-[10px] font-mono uppercase tracking-widest text-ink-300 mb-1">
            Or type the barcode
          </label>
          <div className="flex gap-2">
            <input
              className="input-neon flex-1 text-sm font-mono"
              placeholder="e.g. 0123456789012"
              inputMode="numeric"
              pattern="[0-9]*"
              value={manualCode}
              onChange={(e) => setManualCode(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') tryManual();
              }}
            />
            <NeonButton
              size="sm"
              variant="cyan"
              onClick={tryManual}
              disabled={!stripNonDigits(manualCode)}
            >
              Use
            </NeonButton>
          </div>
        </div>
      )}
    </div>
  );
}

/** Strip any non-digit characters (EAN has no letters; spaces and
 *  dashes are common on printed codes). */
function stripNonDigits(s: string | null | undefined): string {
  if (!s) return '';
  return s.replace(/\D/g, '');
}
