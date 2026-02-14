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
          <div className="prose prose-invert prose-sm max-w-none space-y-4 text-gray-300 max-h-[60vh] overflow-y-auto pr-2">
            <section>
              <h3 className="text-lg font-bold text-white">1. Overview</h3>
              <p>This game is a skill-based multiplayer game where players control shapes, collect points, and compete in short matches. All gameplay outcomes are determined by player skill, timing, and strategy, not chance.</p>
              <p>The game includes:</p>
              <ul className="list-disc pl-5 space-y-1">
                <li><strong>Free Mode:</strong> Play for fun, no monetary cost.</li>
                <li><strong>Paid Mode (USDC Mode):</strong> Optional mode where players pay a small fixed fee to participate. Leaderboards track performance; the developer collects a service fee only.</li>
              </ul>
              <p>No element of chance determines outcomes beyond balanced, evenly randomized in-game objects, and the developer does not profit from player losses.</p>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">2. Eligibility</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Players must be at least [Insert Age] years old.</li>
                <li>Players must comply with all applicable laws in their jurisdiction.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">3. Paid Mode (USDC Mode)</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Entry is a fixed fee; there are no bets or wagers beyond this fee.</li>
                <li>Players may leave a match at any time.</li>
                <li>Results are based entirely on skill and strategic play.</li>
                <li>Leaderboards display past performance; amounts are not guaranteed.</li>
                <li>The developer collects a service fee only; player losses are not transferred to the developer.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">4. Gameplay Rules</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Outcomes are skill-based only. Player decisions, timing, and strategy determine success.</li>
                <li>Random in-game elements (orbs) are evenly distributed and accessible to all players. While collecting them affects scores, no spawn location gives any player an unfair advantage.</li>
                <li>Cheating, exploiting, or manipulating gameplay may result in account suspension or ban.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">5. Points, Skins, and Rewards</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Points track player performance only.</li>
                <li>Cosmetic items or skins may be unlocked via playtime or eliminations.</li>
                <li>Skins or cosmetics do not provide competitive advantages.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">6. Disclaimers</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>All results are based on player performance.</li>
                <li>Displayed amounts in USDC Mode are not guaranteed.</li>
                <li>Entry fees are non-refundable.</li>
                <li>Developer provides no financial advice or guarantee of profit.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">7. Conduct</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>Players must behave respectfully.</li>
                <li>Exploiting or attempting to manipulate the game is prohibited.</li>
                <li>The developer reserves the right to adjust game mechanics, balance, or servers to ensure fairness.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">8. Limitation of Liability</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>The game is provided "as is".</li>
                <li>Developer is not liable for lost points, lost USDC, or technical issues.</li>
                <li>Participation is at the player's own risk.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">9. Legal Jurisdictions & Skill-Game Clause</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>The game is designed as a skill-based contest, not gambling.</li>
                <li>Outcomes are determined entirely by player skill, not chance, with all random in-game elements evenly distributed.</li>
                <li>This T&C is intended to comply with applicable US and UK law regarding skill-based games.</li>
                <li>By participating, players confirm that they understand this is not a gambling activity.</li>
              </ul>
            </section>

            <section>
              <h3 className="text-lg font-bold text-white">10. Changes to T&C</h3>
              <ul className="list-disc pl-5 space-y-1">
                <li>The developer may update these terms at any time.</li>
                <li>Updates will be communicated via in-game notice or email.</li>
              </ul>
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
