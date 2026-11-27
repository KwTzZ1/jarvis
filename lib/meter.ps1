# Niveau sonore de ce qui sort des haut-parleurs (vumètre de Windows) pour faire danser la sphère sur la musique.
# Aucun son n'est enregistré : on lit seulement le niveau de crête, comme la barre verte du mélangeur de volume.
# $Parent (processus de Jarvis) est ajouté en tête par lib/meter.js. Une valeur (0 à 1) par ligne, seulement quand elle bouge.
Add-Type -TypeDefinition @'
using System;
using System.Globalization;
using System.Runtime.InteropServices;
using System.Threading;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class JarvisDeviceEnumerator { }

[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IJarvisDeviceEnumerator {
    int EnumAudioEndpoints();
    [PreserveSig] int GetDefaultAudioEndpoint(int dataFlow, int role, out IJarvisDevice device);
}

[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IJarvisDevice {
    [PreserveSig] int Activate(ref Guid iid, int clsCtx, IntPtr activationParams, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
}

[ComImport, Guid("C02216F6-8C67-4B5B-9D00-D008E73E0064"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IJarvisMeter {
    [PreserveSig] int GetPeakValue(out float peak);
}

public static class JarvisMeterLoop {
    public static void Run(int parent) {
        var devices = (IJarvisDeviceEnumerator)new JarvisDeviceEnumerator();
        IJarvisMeter meter = null;
        float last = -1;
        for (int tick = 0; ; tick++) {
            // Toutes les ~3 s : Jarvis toujours là ? Et la sortie son par défaut (casque branché…).
            if (tick % 100 == 0) {
                try { System.Diagnostics.Process.GetProcessById(parent).Dispose(); } catch { return; }
                try {
                    IJarvisDevice dev;
                    object o;
                    Guid iid = typeof(IJarvisMeter).GUID;
                    if (devices.GetDefaultAudioEndpoint(0, 1, out dev) == 0 && dev.Activate(ref iid, 23, IntPtr.Zero, out o) == 0) meter = (IJarvisMeter)o;
                    else meter = null;
                } catch { meter = null; }
            }
            float v = 0;
            if (meter != null) { try { meter.GetPeakValue(out v); } catch { meter = null; } }
            if (Math.Abs(v - last) > 0.004f || (v == 0 && last != 0)) {
                Console.Out.WriteLine(v.ToString("0.000", CultureInfo.InvariantCulture));
                Console.Out.Flush();
                last = v;
            }
            Thread.Sleep(30);
        }
    }
}
'@
[JarvisMeterLoop]::Run($Parent)
