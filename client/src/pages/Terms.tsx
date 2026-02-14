import React from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, FileText } from 'lucide-react';

export default function Terms() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background p-4">
      <canvas
        ref={(canvas) => {
          if (!canvas || canvas.dataset.drawn) return;
          canvas.dataset.drawn = 'true';
          const ctx = canvas.getContext('2d');
          if (!ctx) return;
          canvas.width = canvas.offsetWidth;
          canvas.height = canvas.offsetHeight;
          const hexSize = 100;
          const hexWidth = Math.sqrt(3) * hexSize;
          const vertSpacing = hexSize * 1.5;
          ctx.strokeStyle = 'rgba(255, 255, 255, 0.025)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          const rows = Math.ceil(canvas.height / vertSpacing) + 2;
          const cols = Math.ceil(canvas.width / hexWidth) + 2;
          for (let row = -1; row <= rows; row++) {
            for (let col = -1; col <= cols; col++) {
              const offsetX = (row % 2 === 0) ? 0 : hexWidth / 2;
              const cx = col * hexWidth + offsetX;
              const cy = row * vertSpacing;
              for (let i = 0; i < 6; i++) {
                const angle = (Math.PI / 3) * i - Math.PI / 6;
                const x = cx + hexSize * Math.cos(angle);
                const y = cy + hexSize * Math.sin(angle);
                if (i === 0) ctx.moveTo(x, y);
                else ctx.lineTo(x, y);
              }
              ctx.closePath();
            }
          }
          ctx.stroke();
        }}
        className="absolute inset-0 w-full h-full pointer-events-none"
      />
      
      <Card className="w-full max-w-2xl bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl relative z-10">
        <CardHeader className="text-center pb-2">
          <CardTitle className="text-3xl font-black tracking-tight bg-gradient-to-br from-white to-gray-500 bg-clip-text text-transparent font-mono uppercase">
            Terms & Conditions
          </CardTitle>
        </CardHeader>
        
        <CardContent className="space-y-6">
          <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300">
            <section>
              <h3 className="text-lg font-bold text-white">1. Acceptance of Terms</h3>
              <p>By accessing and playing Orbit Arena, you agree to be bound by these Terms and Conditions. If you do not agree, please do not use our service.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">2. Eligibility</h3>
              <p>You must be at least 18 years of age to play in Solana Mode (stake mode). Free play mode is available to all ages, subject to local laws.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">3. Game Rules</h3>
              <p>Orbit Arena is a skill-based multiplayer game. Players control circular avatars, consume food to grow, and can eliminate smaller players by absorbing them.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">4. Solana Mode (Stake Mode)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Entry fee: 1 USDC (Devnet)</li>
                <li>Exit fee: 10% of balance when leaving</li>
                <li>All transactions are on Solana Devnet</li>
                <li>Earnings depend on gameplay skill and are not guaranteed</li>
                <li>All deposits are non-refundable</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">5. Wallet Security</h3>
              <p>You are responsible for maintaining the security of your Phantom wallet. We are not liable for any losses due to compromised wallet credentials.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">6. Fair Play</h3>
              <p>Use of bots, scripts, or any form of cheating is strictly prohibited. Violators may be banned without refund.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">7. Disclaimer</h3>
              <p>The game is provided "as is" without warranties of any kind. We are not responsible for any losses, damages, or technical issues that may occur during gameplay.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">8. Changes to Terms</h3>
              <p>We reserve the right to modify these terms at any time. Continued use of the service constitutes acceptance of modified terms.</p>
            </section>
          </div>

          <Button 
            onClick={() => setLocation('/')}
            variant="outline"
            className="w-full gap-2"
            data-testid="button-back-to-lobby"
          >
            <ArrowLeft className="w-4 h-4" />
            Back to Lobby
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
