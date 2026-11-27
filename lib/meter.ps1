# Son du PC pour Jarvis : niveau de ce qui sort des haut-parleurs (la sphère danse sur la musique)
# et volume général de Windows (curseur, « Jarvis, volume à 30 »).
# Aucun son n'est enregistré : on lit seulement le niveau de crête, comme la barre verte du mélangeur de volume.
# $Parent (processus de Jarvis) est ajouté en tête par lib/meter.js.
# Sortie, une ligne par info : « 0.523 » (niveau, seulement quand il bouge) ou « vol 0.420 0 » (volume, muet 0/1).
# Entrée : « get », « set 0.42 », « mute 1 ».
Add-Type -TypeDefinition @'
using System;
using System.Collections.Concurrent;
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

[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IJarvisVolume {
    int RegisterControlChangeNotify(IntPtr notify);
    int UnregisterControlChangeNotify(IntPtr notify);
    int GetChannelCount(out uint count);
    int SetMasterVolumeLevel(float levelDb, ref Guid context);
    [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
    int GetMasterVolumeLevel(out float levelDb);
    [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
    int SetChannelVolumeLevel(uint channel, float levelDb, ref Guid context);
    int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
    int GetChannelVolumeLevel(uint channel, out float levelDb);
    int GetChannelVolumeLevelScalar(uint channel, out float level);
    [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}

public static class JarvisAudio {
    static readonly CultureInfo Inv = CultureInfo.InvariantCulture;
    static readonly ConcurrentQueue<string> Commands = new ConcurrentQueue<string>();
    static IJarvisMeter meter;
    static IJarvisVolume volume;
    static float lastVol = -1;
    static bool lastMute;

    static void Send(string line) {
        Console.Out.WriteLine(line);
        Console.Out.Flush();
    }

    static object Activate(IJarvisDevice dev, Type type) {
        object o;
        Guid iid = type.GUID;
        return dev.Activate(ref iid, 23, IntPtr.Zero, out o) == 0 ? o : null;
    }

    // Envoie le volume s'il a changé (touches du clavier, mélangeur…) ou si on le demande.
    static void ReportVolume(bool force) {
        if (volume == null) return;
        float v;
        bool m;
        if (volume.GetMasterVolumeLevelScalar(out v) != 0 || volume.GetMute(out m) != 0) return;
        if (!force && Math.Abs(v - lastVol) < 0.005f && m == lastMute) return;
        lastVol = v;
        lastMute = m;
        Send("vol " + v.ToString("0.000", Inv) + " " + (m ? "1" : "0"));
    }

    static void Handle(string cmd) {
        if (volume == null) return;
        string[] p = cmd.Trim().Split(' ');
        Guid ctx = Guid.Empty;
        float v;
        if (p[0] == "set" && p.Length > 1 && float.TryParse(p[1], NumberStyles.Float, Inv, out v)) {
            volume.SetMasterVolumeLevelScalar(Math.Max(0f, Math.Min(1f, v)), ref ctx);
            if (v > 0) volume.SetMute(false, ref ctx);
        } else if (p[0] == "mute" && p.Length > 1) {
            volume.SetMute(p[1] == "1", ref ctx);
        }
        ReportVolume(true);
    }

    public static void Run(int parent) {
        var reader = new Thread(() => {
            string line;
            try { while ((line = Console.In.ReadLine()) != null) Commands.Enqueue(line); } catch { }
        });
        reader.IsBackground = true;
        reader.Start();
        var devices = (IJarvisDeviceEnumerator)new JarvisDeviceEnumerator();
        float last = -1;
        for (int tick = 0; ; tick++) {
            // Toutes les ~3 s : Jarvis toujours là ? Et la sortie son par défaut (casque branché…).
            if (tick % 100 == 0) {
                try { System.Diagnostics.Process.GetProcessById(parent).Dispose(); } catch { return; }
                try {
                    IJarvisDevice dev;
                    if (devices.GetDefaultAudioEndpoint(0, 1, out dev) == 0) {
                        meter = Activate(dev, typeof(IJarvisMeter)) as IJarvisMeter;
                        volume = Activate(dev, typeof(IJarvisVolume)) as IJarvisVolume;
                    } else { meter = null; volume = null; }
                } catch { meter = null; volume = null; }
            }
            string cmd;
            while (Commands.TryDequeue(out cmd)) { try { Handle(cmd); } catch { } }
            float v = 0;
            if (meter != null) { try { meter.GetPeakValue(out v); } catch { meter = null; } }
            if (Math.Abs(v - last) > 0.004f || (v == 0 && last != 0)) {
                Send(v.ToString("0.000", Inv));
                last = v;
            }
            if (tick % 10 == 0) { try { ReportVolume(false); } catch { volume = null; } }
            Thread.Sleep(30);
        }
    }
}
'@
[JarvisAudio]::Run($Parent)
