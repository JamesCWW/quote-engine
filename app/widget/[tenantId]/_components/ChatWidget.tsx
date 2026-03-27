'use client';

import { useState, useRef, useEffect, useCallback } from 'react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface Props {
  tenantId: string;
  tenantName: string;
}

export default function ChatWidget({ tenantId, tenantName }: Props) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Message[]>([
    {
      id: 'welcome',
      role: 'assistant',
      content:
        "Hi there! I'm the Helions Forge quote assistant. I can give you a rough estimate for your metalwork project.\n\nWhat type of metalwork are you looking for? (e.g. railings, gates, balustrades)",
    },
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [leadName, setLeadName] = useState('');
  const [leadEmail, setLeadEmail] = useState('');
  const [leadSubmitted, setLeadSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = useCallback(
    async (text: string) => {
      if (!text.trim() || isLoading) return;

      const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text };
      const updatedMessages = [...messages, userMsg];
      setMessages(updatedMessages);
      setInput('');
      setIsLoading(true);

      // Add a placeholder assistant message to stream into
      const assistantId = (Date.now() + 1).toString();
      setMessages((prev) => [
        ...prev,
        { id: assistantId, role: 'assistant', content: '' },
      ]);

      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            tenantId,
            messages: updatedMessages.map(({ role, content }) => ({ role, content })),
          }),
        });

        if (!res.ok || !res.body) {
          throw new Error('Chat request failed');
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let accumulated = '';

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          accumulated += decoder.decode(value, { stream: true });
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId ? { ...m, content: accumulated } : m
            )
          );
        }
      } catch {
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? {
                  ...m,
                  content:
                    "Sorry, something went wrong. Please try again or call us directly.",
                }
              : m
          )
        );
      } finally {
        setIsLoading(false);
      }
    },
    [messages, isLoading, tenantId]
  );

  async function uploadPhoto(file: File) {
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const res = await fetch('/api/upload', { method: 'POST', body: formData });
      const data = await res.json();
      if (data.url) setImageUrl(data.url);
    } catch {
      // non-fatal
    } finally {
      setUploading(false);
    }
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) uploadPhoto(file);
  }

  async function saveLead() {
    if (!leadEmail) return;
    setSaving(true);
    try {
      const conversationText = messages
        .map((m) => `${m.role === 'user' ? 'Customer' : 'Assistant'}: ${m.content}`)
        .join('\n\n');

      await fetch('/api/enquiries', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          tenantId,
          source: 'chatbot',
          raw_input: conversationText,
          image_urls: imageUrl ? [imageUrl] : [],
          contact_name: leadName,
          contact_email: leadEmail,
        }),
      });
      setLeadSubmitted(true);
    } catch {
      // non-fatal
    } finally {
      setSaving(false);
    }
  }

  const lastAssistantMsg = [...messages].reverse().find((m) => m.role === 'assistant');
  const asksForContact =
    lastAssistantMsg?.content &&
    (lastAssistantMsg.content.toLowerCase().includes('email') ||
      lastAssistantMsg.content.toLowerCase().includes('contact') ||
      lastAssistantMsg.content.toLowerCase().includes('formal quote'));

  return (
    <>
      {/* Floating launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: 56,
            height: 56,
            borderRadius: '50%',
            background: '#111',
            color: '#fff',
            border: 'none',
            cursor: 'pointer',
            fontSize: 24,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            boxShadow: '0 4px 16px rgba(0,0,0,0.25)',
            zIndex: 9999,
          }}
          aria-label="Open quote chat"
        >
          💬
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          style={{
            position: 'fixed',
            bottom: 20,
            right: 20,
            width: 'min(380px, calc(100vw - 32px))',
            height: 'min(560px, calc(100dvh - 40px))',
            background: '#fff',
            borderRadius: 16,
            boxShadow: '0 8px 40px rgba(0,0,0,0.18)',
            display: 'flex',
            flexDirection: 'column',
            fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
            fontSize: 14,
            zIndex: 9999,
            overflow: 'hidden',
          }}
        >
          {/* Header */}
          <div
            style={{
              background: '#111',
              color: '#fff',
              padding: '12px 16px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              flexShrink: 0,
            }}
          >
            <div>
              <div style={{ fontWeight: 600, fontSize: 15 }}>{tenantName}</div>
              <div style={{ fontSize: 11, opacity: 0.7 }}>Quote Assistant</div>
            </div>
            <button
              onClick={() => setOpen(false)}
              style={{
                background: 'none',
                border: 'none',
                color: '#fff',
                cursor: 'pointer',
                fontSize: 20,
                lineHeight: 1,
                padding: 4,
                opacity: 0.8,
              }}
              aria-label="Close"
            >
              ×
            </button>
          </div>

          {/* Messages */}
          <div
            style={{
              flex: 1,
              overflowY: 'auto',
              padding: '12px 14px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            {messages.map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex',
                  justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                }}
              >
                <div
                  style={{
                    maxWidth: '82%',
                    padding: '8px 12px',
                    borderRadius:
                      m.role === 'user'
                        ? '14px 14px 4px 14px'
                        : '14px 14px 14px 4px',
                    background: m.role === 'user' ? '#111' : '#f3f4f6',
                    color: m.role === 'user' ? '#fff' : '#111',
                    whiteSpace: 'pre-wrap',
                    lineHeight: 1.5,
                    fontSize: 13,
                  }}
                >
                  {m.content || (
                    <span style={{ opacity: 0.4, fontStyle: 'italic' }}>Typing…</span>
                  )}
                </div>
              </div>
            ))}

            {imageUrl && (
              <div style={{ fontSize: 11, color: '#888', textAlign: 'center' }}>
                📷 Photo attached
              </div>
            )}

            {/* Lead capture form */}
            {asksForContact && !leadSubmitted && (
              <div
                style={{
                  background: '#f8f9fa',
                  borderRadius: 10,
                  padding: '12px 14px',
                  border: '1px solid #e5e7eb',
                }}
              >
                <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                  Send to our team
                </div>
                <input
                  type="text"
                  placeholder="Your name"
                  value={leadName}
                  onChange={(e) => setLeadName(e.target.value)}
                  style={inputStyle}
                />
                <input
                  type="email"
                  placeholder="Email address"
                  value={leadEmail}
                  onChange={(e) => setLeadEmail(e.target.value)}
                  style={{ ...inputStyle, marginTop: 6 }}
                />
                <button
                  onClick={saveLead}
                  disabled={!leadEmail || saving}
                  style={{
                    marginTop: 8,
                    width: '100%',
                    padding: '8px 0',
                    background: leadEmail ? '#111' : '#ccc',
                    color: '#fff',
                    border: 'none',
                    borderRadius: 7,
                    cursor: leadEmail ? 'pointer' : 'default',
                    fontSize: 13,
                    fontWeight: 600,
                  }}
                >
                  {saving ? 'Sending…' : 'Send my details'}
                </button>
              </div>
            )}

            {leadSubmitted && (
              <div
                style={{
                  textAlign: 'center',
                  padding: '10px 14px',
                  background: '#f0fdf4',
                  borderRadius: 10,
                  color: '#16a34a',
                  fontSize: 13,
                  fontWeight: 500,
                }}
              >
                ✓ Details sent — the team will be in touch soon!
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          {/* Input */}
          <div
            style={{
              borderTop: '1px solid #e5e7eb',
              padding: '10px 12px',
              display: 'flex',
              gap: 8,
              alignItems: 'flex-end',
              flexShrink: 0,
            }}
          >
            <button
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              title="Attach a photo"
              style={{
                background: 'none',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '7px 9px',
                cursor: 'pointer',
                fontSize: 16,
                lineHeight: 1,
                color: imageUrl ? '#16a34a' : '#666',
                flexShrink: 0,
              }}
            >
              {uploading ? '⏳' : imageUrl ? '📷' : '📎'}
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={handleFileChange}
            />

            <textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  const msg = imageUrl
                    ? `${input}${input ? ' ' : ''}[Photo: ${imageUrl}]`
                    : input;
                  sendMessage(msg);
                  if (imageUrl) setImageUrl(null);
                }
              }}
              placeholder="Type a message…"
              rows={1}
              style={{
                flex: 1,
                resize: 'none',
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: '7px 10px',
                fontSize: 13,
                fontFamily: 'inherit',
                outline: 'none',
                lineHeight: 1.5,
              }}
            />
            <button
              onClick={() => {
                const msg = imageUrl
                  ? `${input}${input ? ' ' : ''}[Photo: ${imageUrl}]`
                  : input;
                sendMessage(msg);
                if (imageUrl) setImageUrl(null);
              }}
              disabled={isLoading || !input.trim()}
              style={{
                background: input.trim() && !isLoading ? '#111' : '#e5e7eb',
                color: input.trim() && !isLoading ? '#fff' : '#999',
                border: 'none',
                borderRadius: 8,
                padding: '7px 14px',
                cursor: input.trim() && !isLoading ? 'pointer' : 'default',
                fontSize: 13,
                fontWeight: 600,
                flexShrink: 0,
              }}
            >
              Send
            </button>
          </div>

          {/* Disclaimer */}
          <div
            style={{
              padding: '4px 14px 8px',
              fontSize: 10,
              color: '#aaa',
              textAlign: 'center',
              flexShrink: 0,
            }}
          >
            Estimates may vary subject to current material costs.
          </div>
        </div>
      )}
    </>
  );
}

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '7px 10px',
  border: '1px solid #e5e7eb',
  borderRadius: 7,
  fontSize: 13,
  fontFamily: 'inherit',
  outline: 'none',
  boxSizing: 'border-box',
};
