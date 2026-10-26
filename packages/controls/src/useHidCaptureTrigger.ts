import { useEffect, useRef } from 'react';

// WebHID API interface declaration for environments where @types/w3c-web-hid is not loaded
interface HIDInputReportEvent extends Event {
  data: DataView;
  device: HIDDevice;
}

interface HIDConnectionEvent extends Event {
  device: HIDDevice;
}

interface HIDDevice extends EventTarget {
  opened: boolean;
  open(): Promise<void>;
  close(): Promise<void>;
}

export function useHidCaptureTrigger(onTrigger: () => void) {
  const onTriggerRef = useRef(onTrigger);

  useEffect(() => {
    onTriggerRef.current = onTrigger;
  }, [onTrigger]);

  useEffect(() => {
    const nav = typeof navigator !== 'undefined' ? (navigator as any) : null;
    if (!nav || !nav.hid) return;

    let activeDevices: HIDDevice[] = [];

    const handleInputReport = (event: Event) => {
      const reportEvent = event as HIDInputReportEvent;
      if (reportEvent.data && reportEvent.data.byteLength > 0) {
        const value = reportEvent.data.getUint8(0);
        if (value !== 0) {
          onTriggerRef.current();
        }
      }
    };

    const initHid = async () => {
      try {
        const devices: HIDDevice[] = await nav.hid.getDevices();
        activeDevices = devices;

        for (const device of devices) {
          if (!device.opened) {
            await device.open();
          }
          device.addEventListener('inputreport', handleInputReport);
        }
      } catch (err) {
        console.warn('Failed to initialize WebHID triggers:', err);
      }
    };

    initHid();

    const handleConnect = async (event: Event) => {
      const connEvent = event as HIDConnectionEvent;
      const device = connEvent.device;
      try {
        if (!device.opened) {
          await device.open();
        }
        device.addEventListener('inputreport', handleInputReport);
        activeDevices.push(device);
      } catch (err) {
        console.warn('Failed to open newly connected WebHID device:', err);
      }
    };

    nav.hid.addEventListener('connect', handleConnect);

    return () => {
      nav.hid.removeEventListener('connect', handleConnect);
      for (const device of activeDevices) {
        device.removeEventListener('inputreport', handleInputReport);
      }
    };
  }, []);
}
