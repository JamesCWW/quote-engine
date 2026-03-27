'use client';

import { useEffect, useRef, useState } from 'react';
import { createClient } from '@/lib/supabase/client';

interface Toast {
  id: string;
  message: string;
  isHighPriority: boolean;
}

interface Props {
  tenantId: string;
}

export default function RealtimeNotifications({ tenantId }: Props) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const channelRef = useRef<ReturnType<ReturnType<typeof createClient>['channel']> | null>(null);

  useEffect(() => {
    const supabase = createClient();

    channelRef.current = supabase
      .channel(`enquiries:${tenantId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'enquiries',
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const enquiry = payload.new as {
            id: string;
            source: string;
            raw_input: string;
            extracted_specs?: { priority?: string };
          };

          if (enquiry.source !== 'chatbot') return;

          const isHighPriority = enquiry.extracted_specs?.priority === 'high';
          const preview = enquiry.raw_input?.slice(0, 60) ?? 'New enquiry';

          const toast: Toast = {
            id: enquiry.id,
            message: isHighPriority
              ? `🚨 High-priority chatbot lead — ${preview}…`
              : `💬 New chatbot lead — ${preview}…`,
            isHighPriority,
          };

          setToasts((prev) => [...prev, toast]);

          // Auto-dismiss after 6 s
          setTimeout(() => {
            setToasts((prev) => prev.filter((t) => t.id !== toast.id));
          }, 6000);
        }
      )
      .subscribe();

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
      }
    };
  }, [tenantId]);

  if (toasts.length === 0) return null;

  return (
    <div
      style={{
        position: 'fixed',
        bottom: 24,
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 9999,
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        alignItems: 'center',
        pointerEvents: 'none',
      }}
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`px-4 py-3 rounded-xl shadow-lg text-sm font-medium pointer-events-auto ${
            toast.isHighPriority
              ? 'bg-red-600 text-white'
              : 'bg-gray-900 text-white'
          }`}
          style={{ maxWidth: 400, animation: 'fadeInUp 0.25s ease' }}
        >
          {toast.message}
          <button
            onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
            className="ml-3 opacity-70 hover:opacity-100"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit' }}
          >
            ×
          </button>
        </div>
      ))}
    </div>
  );
}
