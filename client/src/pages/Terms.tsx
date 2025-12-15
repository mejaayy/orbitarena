import React from 'react';
import { useLocation } from 'wouter';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ArrowLeft, FileText } from 'lucide-react';

export default function Terms() {
  const [, setLocation] = useLocation();

  return (
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden bg-background p-4">
      <div className="absolute inset-0 grid grid-cols-[repeat(20,1fr)] grid-rows-[repeat(20,1fr)] opacity-20 pointer-events-none">
        {Array.from({ length: 400 }).map((_, i) => (
          <div key={i} className="border-[0.5px] border-white/5" />
        ))}
      </div>
      
      <Card className="w-full max-w-2xl bg-card/80 backdrop-blur-xl border-white/10 shadow-2xl relative z-10">
        <CardHeader className="text-center pb-2">
          <div className="mx-auto w-12 h-12 bg-primary/20 rounded-2xl flex items-center justify-center mb-4 border border-primary/50">
            <FileText className="w-6 h-6 text-primary-foreground" />
          </div>
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
