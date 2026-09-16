import React, { useEffect, useRef, useState } from 'react';
import { Camera, X, Clipboard, AlertCircle } from 'lucide-react';

interface CameraQrScannerProps {
  isOpen: boolean;
  onClose: () => void;
  onScan: (data: string) => void;
}

export const CameraQrScanner: React.FC<CameraQrScannerProps> = ({ isOpen, onClose, onScan }) => {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen) {
      stopCamera();
      return;
    }

    let intervalId: any = null;

    async function startCamera() {
      setErrorText(null);
      try {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
          throw new Error('Camera access is not supported by your browser.');
        }

        const stream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: { ideal: 'environment' } },
          audio: false,
        });

        streamRef.current = stream;
        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          await videoRef.current.play();
        }

        // Use native BarcodeDetector if available
        if ('BarcodeDetector' in window) {
          const barcodeDetector = new (window as any).BarcodeDetector({ formats: ['qr_code'] });
          intervalId = setInterval(async () => {
            if (videoRef.current && videoRef.current.readyState >= 2) {
              try {
                const barcodes = await barcodeDetector.detect(videoRef.current);
                if (barcodes.length > 0 && barcodes[0].rawValue) {
                  clearInterval(intervalId);
                  stopCamera();
                  onScan(barcodes[0].rawValue);
                }
              } catch (e) {
                // Ignore detection frame errors
              }
            }
          }, 300);
        }
      } catch (err: any) {
        console.warn('Camera scanner init error:', err);
        setErrorText(err.message || 'Unable to access camera. You can paste the link instead.');
      }
    }

    startCamera();

    return () => {
      if (intervalId) clearInterval(intervalId);
      stopCamera();
    };
  }, [isOpen]);

  const stopCamera = () => {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
  };

  const handlePasteClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        stopCamera();
        onScan(text);
      } else {
        setErrorText('Clipboard is empty.');
      }
    } catch (e) {
      setErrorText('Clipboard permission denied. Please paste manually.');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className="modal-card"
        style={{ maxWidth: '440px', textAlign: 'center', padding: '1.75rem' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ marginBottom: '1rem' }}>
          <h3 style={{ fontSize: '1.15rem', fontWeight: 700, color: '#ffffff', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Camera size={18} color="#249c6f" /> Scan Connection QR
          </h3>
          <button className="btn btn-secondary" style={{ padding: '0.35rem 0.55rem' }} onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <p style={{ fontSize: '0.84rem', color: 'rgba(255, 255, 255, 0.7)', marginBottom: '1.25rem' }}>
          Point your camera at your partner's ImiCall QR code to automatically add them to your Phone Book.
        </p>

        {/* Viewfinder Container */}
        <div
          style={{
            position: 'relative',
            width: '100%',
            height: '260px',
            borderRadius: '12px',
            overflow: 'hidden',
            background: '#0d0d0d',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            marginBottom: '1.25rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <video
            ref={videoRef}
            playsInline
            muted
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
            }}
          />

          {/* Aim Overlay Box */}
          <div
            style={{
              position: 'absolute',
              width: '180px',
              height: '180px',
              border: '2px dashed #249c6f',
              borderRadius: '12px',
              boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.5)',
              pointerEvents: 'none',
            }}
          />

          {errorText && (
            <div
              style={{
                position: 'absolute',
                inset: 0,
                background: 'rgba(20, 20, 20, 0.92)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                padding: '1.5rem',
                gap: '0.75rem',
                color: '#ffffff',
              }}
            >
              <AlertCircle size={28} color="#249c6f" />
              <p style={{ fontSize: '0.85rem', color: 'rgba(255, 255, 255, 0.8)' }}>
                {errorText}
              </p>
            </div>
          )}
        </div>

        {/* Action Controls */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.65rem' }}>
          <button
            className="btn btn-primary btn-full"
            style={{ padding: '0.75rem', fontSize: '0.9rem' }}
            onClick={handlePasteClipboard}
          >
            <Clipboard size={16} /> Paste Invite Link from Clipboard
          </button>
          <button className="btn btn-secondary btn-full" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
};
