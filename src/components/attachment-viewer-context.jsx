import React, { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { openAttachmentViewer as openShared, setAttachmentOpener } from '@/lib/attachment-open';

const AttachmentViewerContext = createContext(null);
const AttachmentPreview = lazy(() => import('@/components/attachment-viewer').then(module => ({ default: module.AttachmentPreview })));

export { openShared as openAttachmentViewer };

export function AttachmentViewerProvider({ children }) {
  const [file, setFile] = useState(null);

  const open = useCallback((next) => {
    if (!next) return;
    setFile(next);
  }, []);

  const close = useCallback(() => setFile(null), []);

  useEffect(() => {
    setAttachmentOpener(open);
    return () => setAttachmentOpener(null);
  }, [open]);

  const value = useMemo(() => ({ open, close }), [open, close]);

  return (
    <AttachmentViewerContext.Provider value={value}>
      {children}
      {file ? (
        <Suspense fallback={<div role="status" className="fixed bottom-4 right-4 z-50 rounded-md border bg-background p-3 text-sm shadow">正在打开附件预览…</div>}>
        <AttachmentPreview
          file={file}
          open={Boolean(file)}
          onOpenChange={(next) => { if (!next) close(); }}
        />
        </Suspense>
      ) : null}
    </AttachmentViewerContext.Provider>
  );
}

export function useAttachmentViewer() {
  const ctx = useContext(AttachmentViewerContext);
  if (!ctx) {
    return { open: openShared, close: () => {} };
  }
  return ctx;
}
