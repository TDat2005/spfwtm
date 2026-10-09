import { Toast } from "@shopify/polaris";
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

export interface ToastApi {
  show(message: string, options?: { isError?: boolean; duration?: number }): void;
}

const ToastContext = createContext<ToastApi | null>(null);

/**
 * Thông báo dùng chung cho hai chế độ: trong Shopify Admin dùng toast của
 * App Bridge, chế độ độc lập dùng Toast của Polaris (cần nằm trong `<Frame>`).
 */
export function useToast(): ToastApi {
  return useContext(ToastContext) ?? shopifyToast;
}

const shopifyToast: ToastApi = {
  show: (message, options) => window.shopify.toast.show(message, options),
};

interface ToastMessage {
  id: number;
  content: string;
  error: boolean;
  duration?: number;
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const show = useCallback<ToastApi["show"]>((content, options) => {
    setToast({ id: Date.now(), content, error: Boolean(options?.isError), duration: options?.duration });
  }, []);
  const api = useMemo<ToastApi>(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {toast && (
        <Toast
          key={toast.id}
          content={toast.content}
          error={toast.error}
          duration={toast.duration}
          onDismiss={() => setToast((current) => (current?.id === toast.id ? null : current))}
        />
      )}
    </ToastContext.Provider>
  );
}
