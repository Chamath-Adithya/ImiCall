import React, { useState, useRef, useEffect } from 'react';
import { X, Send, MessageSquare } from 'lucide-react';
import { ChatMessage } from '../core/types';

interface ChatDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
}

export const ChatDrawer: React.FC<ChatDrawerProps> = ({
  isOpen,
  onClose,
  messages,
  onSendMessage,
}) => {
  const [inputText, setInputText] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen) {
      messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, isOpen]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (inputText.trim()) {
      onSendMessage(inputText);
      setInputText('');
    }
  };

  if (!isOpen) return null;

  return (
    <div className="chat-drawer">
      <div className="chat-header">
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          <MessageSquare size={18} color="#249c6f" />
          <h3 style={{ fontSize: '0.95rem', fontWeight: 700, color: '#ffffff' }}>Emergency Text Channel</h3>
        </div>
        <button className="btn btn-secondary" style={{ padding: '0.35rem' }} onClick={onClose}>
          <X size={16} color="#ffffff" />
        </button>
      </div>

      <div className="chat-messages">
        {messages.length === 0 ? (
          <div style={{ color: 'rgba(255,255,255,0.45)', fontSize: '0.8rem', textAlign: 'center', margin: 'auto' }}>
            Zero-bandwidth text fallback. Messages travel directly peer-to-peer via WebRTC DataChannel.
          </div>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className={`chat-bubble ${msg.sender}`}>
              {msg.text}
              <div
                style={{
                  fontSize: '0.65rem',
                  opacity: 0.7,
                  marginTop: '0.2rem',
                  textAlign: msg.sender === 'me' ? 'right' : 'left',
                }}
              >
                {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </div>
            </div>
          ))
        )}
        <div ref={messagesEndRef} />
      </div>

      <form onSubmit={handleSubmit} className="chat-input-row">
        <input
          type="text"
          className="input-field"
          style={{ fontSize: '0.85rem', padding: '0.6rem 0.8rem' }}
          placeholder="Type message..."
          value={inputText}
          onChange={(e) => setInputText(e.target.value)}
        />
        <button type="submit" className="btn btn-primary" style={{ padding: '0.6rem 0.9rem' }}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
};
