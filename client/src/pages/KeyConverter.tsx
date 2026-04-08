import { useState, useEffect, useRef } from 'react';
import { useLocation } from 'wouter';
import { Shield, Eye, EyeOff, Copy, Trash2, CheckCircle, AlertTriangle, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';

const B58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

function b58Decode(s: string): Uint8Array {
  const bytes = [0];
  for (const ch of s) {
    const idx = B58.indexOf(ch);
    if (idx < 0) throw new Error(`Invalid base58 character: "${ch}"`);
    let carry = idx;
    for (let i = 0; i < bytes.length; i++) {
      carry += bytes[i] * 58;
      bytes[i] = carry & 0xff;
      carry >>= 8;
    }
    while (carry > 0) {
      bytes.push(carry & 0xff);
      carry >>= 8;
    }
  }
  let leading = 0;
  for (const ch of s) { if (ch === '1') leading++; else break; }
  const out = new Uint8Array(leading + bytes.length);
  bytes.reverse().forEach((b, i) => { out[leading + i] = b; });
  return out;
}

export default function KeyConverter() {
  const [, setLocation] = useLocation();
  const [authed, setAuthed] = useState(false);
  const [checking, setChecking] = useState(true);
  const [input, setInput] = useState('');
  const [output, setOutput] = useState('');
  const [error, setError] = useState('');
  const [show, setShow] = useState(false);
  const [copied, setCopied] = useState(false);
  const [ttl, setTtl] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const clearTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

  useEffect(() => {
    const token = localStorage.getItem('adminToken');
    if (!token) { setChecking(false); return; }
    fetch('/api/admin/settings', { headers: { 'X-Admin-Token': token } })
      .then(r => { if (r.ok) setAuthed(true); })
      .catch(() => {})
      .finally(() => setChecking(false));
  }, []);

  useEffect(() => () => clearTimer(), []);

  const startTtl = () => {
    clearTimer();
    setTtl(60);
    timerRef.current = setInterval(() => {
      setTtl(t => {
        if (t <= 1) { clearAll(); return 0; }
        return t - 1;
      });
    }, 1000);
  };

  const clearAll = () => {
    setInput('');
    setOutput('');
    setError('');
    setShow(false);
    setCopied(false);
    setTtl(0);
    clearTimer();
  };

  const convert = () => {
    setError('');
    setOutput('');
    setCopied(false);
    const raw = input.trim();
    if (!raw) { setError('Paste your base58 private key first.'); return; }
    try {
      const bytes = b58Decode(raw);
      if (bytes.length !== 64) throw new Error(`Expected 64 bytes, got ${bytes.length}. Make sure this is your full private key, not just the public key.`);
      setOutput(JSON.stringify(Array.from(bytes)));
      setInput('');
      startTtl();
    } catch (e: any) {
      setError(e.message || 'Conversion failed. Check the key and try again.');
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(output);
      setCopied(true);
      setTimeout(() => setCopied(false), 3000);
    } catch {
      setError('Clipboard access denied — select all and copy manually.');
    }
  };

  if (checking) {
    return (
      <div className="min-h-screen bg-[#080812] flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-purple-500/50 border-t-purple-500 rounded-full animate-spin" />
      </div>
    );
  }

  if (!authed) {
    return (
      <div className="min-h-screen bg-[#080812] flex items-center justify-center p-4">
        <div className="bg-white/5 border border-white/10 rounded-2xl p-8 max-w-sm w-full text-center">
          <Lock className="w-10 h-10 text-gray-500 mx-auto mb-4" />
          <p className="text-gray-400 mb-4">Admin access required.</p>
          <Button onClick={() => setLocation('/admin')} variant="outline" className="gap-2">Go to Admin Login</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#080812] flex items-center justify-center p-4">
      <div className="max-w-xl w-full space-y-4">

        <div className="flex items-center gap-3 mb-2">
          <Shield className="w-6 h-6 text-purple-400" />
          <div>
            <h1 className="text-lg font-bold text-white">Private Key Converter</h1>
            <p className="text-xs text-gray-500">Base58 → JSON array · runs entirely in your browser</p>
          </div>
        </div>

        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl p-4 space-y-1.5">
          <div className="flex items-center gap-2 text-amber-400 font-semibold text-sm">
            <AlertTriangle className="w-4 h-4" /> Security rules
          </div>
          <ul className="text-xs text-amber-200/70 space-y-1 list-disc list-inside">
            <li>Nothing is sent to any server — conversion is 100% local</li>
            <li>No input or output is ever logged or stored</li>
            <li>Output auto-clears after 60 seconds</li>
            <li>Delete this page from your app after you're done</li>
            <li>Never share the output with anyone</li>
          </ul>
        </div>

        {!output ? (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
            <div>
              <label className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 block">
                Base58 Private Key
              </label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={input}
                  onChange={e => setInput(e.target.value)}
                  placeholder="Paste your base58 private key here..."
                  className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 pr-12 text-sm text-white placeholder-gray-600 focus:outline-none focus:border-purple-500/50 font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setShow(s => !s)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300"
                >
                  {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <div className="flex gap-2">
              <Button onClick={convert} className="flex-1 bg-purple-600 hover:bg-purple-700 text-white" disabled={!input.trim()}>
                Convert
              </Button>
              <Button onClick={() => setLocation('/')} variant="outline" className="text-gray-400">
                Cancel
              </Button>
            </div>
          </div>
        ) : (
          <div className="bg-white/5 border border-white/10 rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-gray-400 uppercase tracking-wider">JSON Array (64 bytes)</span>
              <span className={`text-xs font-mono px-2 py-0.5 rounded-full ${ttl <= 15 ? 'bg-red-500/20 text-red-400' : 'bg-white/5 text-gray-500'}`}>
                clears in {ttl}s
              </span>
            </div>
            <textarea
              readOnly
              value={output}
              className="w-full bg-black/40 border border-white/10 rounded-lg px-4 py-3 text-xs text-purple-300 font-mono resize-none focus:outline-none"
              rows={4}
            />
            {error && (
              <div className="text-red-400 text-xs bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                {error}
              </div>
            )}
            <div className="text-xs text-gray-500 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2">
              Copy this value, then go to <strong className="text-blue-300">Replit Secrets</strong> and update <code className="text-blue-300">PLATFORM_WALLET_PRIVATE_KEY</code> with it.
            </div>
            <div className="flex gap-2">
              <Button onClick={copy} className={`flex-1 gap-2 ${copied ? 'bg-green-600 hover:bg-green-700' : 'bg-purple-600 hover:bg-purple-700'} text-white`}>
                {copied ? <><CheckCircle className="w-4 h-4" /> Copied!</> : <><Copy className="w-4 h-4" /> Copy to Clipboard</>}
              </Button>
              <Button onClick={clearAll} variant="outline" className="gap-2 border-red-500/30 text-red-400 hover:bg-red-500/10">
                <Trash2 className="w-4 h-4" /> Clear
              </Button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
