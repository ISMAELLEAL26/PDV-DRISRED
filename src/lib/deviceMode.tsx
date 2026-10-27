import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';

export type DeviceMode = 'auto' | 'mobile' | 'desktop' | 'vertical';

interface DeviceModeValue {
  mode: DeviceMode;
  isMobile: boolean;
  setMode: (m: DeviceMode) => void;
}

const DeviceModeContext = createContext<DeviceModeValue | null>(null);

const STORAGE_KEY = 'pos_device_mode';

function detectMobile(): boolean {
  if (typeof window === 'undefined') return false;
  return window.innerWidth < 1024;
}

export function DeviceModeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<DeviceMode>(() => {
    if (typeof window === 'undefined') return 'auto';
    return (localStorage.getItem(STORAGE_KEY) as DeviceMode) || 'auto';
  });
  const [viewportMobile, setViewportMobile] = useState<boolean>(() => detectMobile());

  useEffect(() => {
    const handler = () => setViewportMobile(detectMobile());
    window.addEventListener('resize', handler);
    return () => window.removeEventListener('resize', handler);
  }, []);

  const isMobile = mode === 'auto' ? viewportMobile : mode === 'mobile';
  const deviceAttribute = mode === 'vertical' ? 'vertical' : isMobile ? 'mobile' : 'desktop';

  useEffect(() => {
    document.documentElement.setAttribute('data-device', deviceAttribute);
  }, [deviceAttribute]);

  const setMode = (m: DeviceMode) => {
    setModeState(m);
    localStorage.setItem(STORAGE_KEY, m);
  };

  return (
    <DeviceModeContext.Provider value={{ mode, isMobile, setMode }}>
      {children}
    </DeviceModeContext.Provider>
  );
}

export function useDeviceMode(): DeviceModeValue {
  const ctx = useContext(DeviceModeContext);
  if (!ctx) {
    const m: DeviceMode = 'auto';
    return { mode: m, isMobile: detectMobile(), setMode: () => {} };
  }
  return ctx;
}
