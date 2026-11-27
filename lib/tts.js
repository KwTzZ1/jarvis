// Voix naturelle locale (Piper) : le texte est transformé en audio sur le PC, sans internet.
// Piper est installé dans %LOCALAPPDATA%\Jarvis\piper (moteur + voices/*.onnx).
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { spawn } from "child_process";

const DIR = process.env.PIPER_DIR || path.join(process.env.LOCALAPPDATA || os.homedir(), "Jarvis", "piper");
const EXE = path.join(DIR, process.platform === "win32" ? "piper.exe" : "piper");
const VOICES = path.join(DIR, "voices");

export function piperVoices() {
  try {
    if (!fs.existsSync(EXE)) return [];
    return fs.readdirSync(VOICES).filter((f) => f.endsWith(".onnx")).map((f) => f.slice(0, -5));
  } catch {
    return [];
  }
}

// Une seule synthèse à la fois (évite de saturer le processeur).
let queue = Promise.resolve();

export function synthesize(text, { voice, rate = 1 } = {}) {
  const voices = piperVoices();
  if (!voices.length) return Promise.reject(new Error("Voix Piper non installée."));
  const name = voices.includes(voice) ? voice : voices.find((v) => v.includes("tom")) || voices[0];
  const clean = String(text || "").replace(/\s+/g, " ").trim().slice(0, 1200);
  if (!clean) return Promise.reject(new Error("Rien à dire."));
  const lengthScale = (1 / Math.min(1.6, Math.max(0.6, Number(rate) || 1))).toFixed(2);
  const run = () =>
    new Promise((resolve, reject) => {
      const out = path.join(os.tmpdir(), `jarvis-tts-${crypto.randomBytes(6).toString("hex")}.wav`);
      const child = spawn(EXE, ["-m", path.join(VOICES, name + ".onnx"), "-f", out, "--length_scale", lengthScale, "--sentence_silence", "0.15"], { cwd: DIR, windowsHide: true });
      const timer = setTimeout(() => child.kill(), 30_000);
      child.on("error", (e) => (clearTimeout(timer), reject(e)));
      child.on("close", () => {
        clearTimeout(timer);
        try {
          const buf = fs.readFileSync(out);
          fs.unlinkSync(out);
          resolve(buf);
        } catch {
          reject(new Error("Piper n'a pas produit de son."));
        }
      });
      child.stdin.end(clean, "utf8");
    });
  const p = queue.then(run, run);
  queue = p.catch(() => {});
  return p;
}
