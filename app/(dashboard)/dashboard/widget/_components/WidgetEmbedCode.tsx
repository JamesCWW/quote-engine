'use client';

interface Props {
  tenantId: string;
}

export default function WidgetEmbedCode({ tenantId }: Props) {
  const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://your-domain.com';
  const embedSnippet = `<iframe
  src="${baseUrl}/widget/${tenantId}"
  style="position:fixed;bottom:0;right:0;width:420px;height:620px;border:none;z-index:9999;"
  title="Quote Assistant"
></iframe>`;

  function copy() {
    navigator.clipboard.writeText(embedSnippet);
  }

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 shadow-sm space-y-4">
      <h2 className="font-semibold text-gray-800">Embed code</h2>
      <p className="text-sm text-gray-500">
        Paste this snippet before the <code className="font-mono bg-gray-100 px-1 rounded">&lt;/body&gt;</code> tag of your website.
      </p>
      <div className="relative">
        <pre className="bg-gray-50 rounded-lg p-4 text-xs font-mono text-gray-700 overflow-x-auto border border-gray-200 whitespace-pre-wrap break-all">
          {embedSnippet}
        </pre>
        <button
          onClick={copy}
          className="absolute top-3 right-3 text-xs bg-white border border-gray-200 rounded-md px-2 py-1 text-gray-600 hover:bg-gray-50 transition-colors"
        >
          Copy
        </button>
      </div>
      <p className="text-xs text-gray-400">
        Your tenant ID: <code className="font-mono">{tenantId}</code>
      </p>
    </div>
  );
}
