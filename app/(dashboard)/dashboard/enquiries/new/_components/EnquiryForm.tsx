'use client';

import { useState, useRef } from 'react';
import QuoteResult, { type QuoteResultData } from './QuoteResult';

interface Props {
  tenantId: string;
}

type Stage = 'form' | 'loading' | 'result' | 'error';

export default function EnquiryForm({ tenantId }: Props) {
  const [stage, setStage] = useState<Stage>('form');
  const [enquiryText, setEnquiryText] = useState('');
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreview, setImagePreview] = useState<string | null>(null);
  const [uploadedImageUrls, setUploadedImageUrls] = useState<string[]>([]);
  const [loadingMsg, setLoadingMsg] = useState('');
  const [result, setResult] = useState<QuoteResultData | null>(null);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0] ?? null;
    setImageFile(file);
    if (file) {
      setImagePreview(URL.createObjectURL(file));
    } else {
      setImagePreview(null);
    }
  }

  function removeImage() {
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrls([]);
    if (fileRef.current) fileRef.current.value = '';
  }

  async function runQuote(text: string, imageUrls: string[]) {
    setStage('loading');
    setError('');
    setLoadingMsg('Analysing enquiry and finding similar jobs…');

    try {
      const res = await fetch('/api/quote', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enquiry_text: text,
          image_urls: imageUrls,
          tenant_id: tenantId,
        }),
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? 'Quote generation failed');
      }

      const data: QuoteResultData = await res.json();
      setResult(data);
      setStage('result');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong');
      setStage('error');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!enquiryText.trim()) return;

    setStage('loading');
    let imageUrls: string[] = [];

    if (imageFile) {
      setLoadingMsg('Uploading photo…');
      const fd = new FormData();
      fd.append('file', imageFile);
      const uploadRes = await fetch('/api/upload', { method: 'POST', body: fd });
      if (uploadRes.ok) {
        const { url } = await uploadRes.json();
        imageUrls = [url];
        setUploadedImageUrls(imageUrls);
      }
      // Non-fatal if upload fails — continue without image
    }

    await runQuote(enquiryText, imageUrls);
  }

  async function handleRegenerate(newText: string) {
    setEnquiryText(newText);
    await runQuote(newText, uploadedImageUrls);
  }

  function reset() {
    setStage('form');
    setEnquiryText('');
    setImageFile(null);
    setImagePreview(null);
    setUploadedImageUrls([]);
    setResult(null);
    setError('');
    if (fileRef.current) fileRef.current.value = '';
  }

  if (stage === 'loading') {
    return (
      <div className="rounded-lg border border-gray-200 bg-white p-8 text-center">
        <div className="inline-block w-8 h-8 border-2 border-gray-900 border-t-transparent rounded-full animate-spin mb-4" />
        <p className="text-sm text-gray-600">{loadingMsg}</p>
      </div>
    );
  }

  if (stage === 'result' && result) {
    return (
      <QuoteResult
        result={result}
        enquiryText={enquiryText}
        tenantId={tenantId}
        onReset={reset}
        onRegenerate={handleRegenerate}
      />
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      {stage === 'error' && (
        <div className="rounded-md bg-red-50 border border-red-200 p-3 text-sm text-red-700">
          {error}
        </div>
      )}

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Job description
        </label>
        <textarea
          value={enquiryText}
          onChange={(e) => setEnquiryText(e.target.value)}
          rows={6}
          required
          placeholder="Describe the job — product type, material, dimensions, location, any special requirements…"
          className="w-full border border-gray-300 rounded-md px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-y"
        />
      </div>

      <div>
        <label className="block text-sm font-medium text-gray-700 mb-1.5">
          Photo <span className="font-normal text-gray-400">(optional)</span>
        </label>

        {imagePreview ? (
          <div className="relative inline-block">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={imagePreview}
              alt="Preview"
              className="h-32 w-auto rounded-md border border-gray-200 object-cover"
            />
            <button
              type="button"
              onClick={removeImage}
              className="absolute -top-2 -right-2 w-5 h-5 bg-gray-900 text-white rounded-full text-xs flex items-center justify-center hover:bg-gray-700"
            >
              ×
            </button>
          </div>
        ) : (
          <label className="flex flex-col items-center justify-center w-full h-28 border-2 border-dashed border-gray-300 rounded-md cursor-pointer hover:border-gray-400 transition-colors bg-gray-50">
            <span className="text-sm text-gray-500">Click to upload a photo</span>
            <span className="text-xs text-gray-400 mt-0.5">JPEG, PNG, WebP</span>
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleFileChange}
              className="sr-only"
            />
          </label>
        )}
      </div>

      <button
        type="submit"
        disabled={!enquiryText.trim()}
        className="w-full bg-gray-900 text-white text-sm font-medium py-2.5 px-4 rounded-md hover:bg-gray-800 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        Generate Quote Estimate
      </button>
    </form>
  );
}
