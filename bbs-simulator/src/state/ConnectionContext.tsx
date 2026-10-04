import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { device, DeviceInfo } from '../device';

type Status = 'idle' | 'connecting' | 'connected' | 'failed';

interface ConnectionContextValue {
  status: Status;
  progress: number;
  device: DeviceInfo | null;
  connect: () => Promise<boolean>;
  disconnect: () => void;
}

const ConnectionContext = createContext<ConnectionContextValue | undefined>(undefined);

export function ConnectionProvider({ children }: { children: React.ReactNode }) {
  const [status, setStatus] = useState<Status>('idle');
  const [progress, setProgress] = useState(0);
  const [info, setInfo] = useState<DeviceInfo | null>(null);

  // If the ESP32 drops (power, Wi-Fi), show it as offline; RunContext saves any active run.
  useEffect(
    () =>
      device.onConnectionLost(() => {
        setInfo(null);
        setStatus('idle');
      }),
    []
  );

  const connect = useCallback(async () => {
    setStatus('connecting');
    setProgress(0);
    try {
      setInfo(await device.connect(setProgress));
      setStatus('connected');
      return true;
    } catch {
      setStatus('failed');
      return false;
    }
  }, []);

  const disconnect = useCallback(() => {
    device.disconnect();
    setInfo(null);
    setStatus('idle');
    setProgress(0);
  }, []);

  const value = useMemo(
    () => ({ status, progress, device: info, connect, disconnect }),
    [status, progress, info, connect, disconnect]
  );
  return <ConnectionContext.Provider value={value}>{children}</ConnectionContext.Provider>;
}

export function useConnection() {
  const ctx = useContext(ConnectionContext);
  if (!ctx) throw new Error('useConnection must be used within ConnectionProvider');
  return ctx;
}
