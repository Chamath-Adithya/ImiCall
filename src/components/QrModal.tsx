import React, { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { X, QrCode as QrIcon, Copy, Check } from 'lucide-react';

interface QrModalProps {
  isOpen: boolean;
  onClose: () => void;
  inviteUrl: string;
}

export const QrModal: React.FC<QrModalProps> = ({ isOpen, onClose, inviteUrl }) => {
  const [qrSrc, setQrSrc] = useState<string>('');
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen && inviteUrl) {
      QRCode.toDataURL(inviteUrl, {
        width: 260,
        margin: 2,
        color: {
          dark: '#090d16',
          light: '#ffffff',
        },
      })
        .then((url) => setQrSrc(url))
        .catch((err) => console.error('QR generation failed:', err));
    }
  }, [isOpen, inviteUrl]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(inviteUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card" style={{ textAlign: 'center' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <QrIcon size={20} color="#10b981" />
            <h3 style={{ fontSize: '1.1rem', fontWeight: 700 }}>Scan with Mobile Camera</h3>
          </div>
          <button className="btn btn-secondary" style={{ padding: '0.4rem' }} onClick={onClose}>
            <X size={18} />
          </button>
        </div>

        <p style={{ fontSize: '0.82rem', color: '#94a3b8', marginBottom: '1.25rem' }}>
          Open your phone camera to join the private call room instantly without typing.
        </p>

        {qrSrc ? (
          <div
            style={{
              display: 'inline-block',
              padding: '12px',
              background: '#ffffff',
              borderRadius: '16px',
              boxShadow: '0 8px 30px rgba(0,0,0,0.5)',
              marginBottom: '1.25rem',
            }}
          >
            <img src={qrSrc} alt="Room QR Code" style={{ display: 'block', width: '220px', height: '220px' }} />
          </div>
        ) : (
          <div style={{ height: '220px', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            Generating QR...
          </div>
        )}

        <div style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            readOnly
            value={inviteUrl}
            className="input-field mono"
            style={{ fontSize: '0.78rem' }}
          />
          <button className="btn btn-primary" onClick={handleCopy} style={{ flexShrink: 0 }}>
            {copied ? <Check size={16} /> : <Copy size={16} />}
            {copied ? 'Copied' : 'Copy'}
          </button>
        </div>
      </div>
    </div>
  );
};
