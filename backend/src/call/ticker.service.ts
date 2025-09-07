import { Injectable } from '@nestjs/common';
import { CallService } from './call.service';

type ActiveTicker = { interval: NodeJS.Timeout; tokenId: string; callerId: string };

@Injectable()
export class TickerService {
  constructor(private callSvc: CallService) {}

  private tickers = new Map<string, ActiveTicker>(); // callId -> ticker

  private isFridayNow() {
    const local = new Date(new Date().toLocaleString('en-US', { timeZone: 'Europe/Bratislava' }));
    return local.getDay() === 5;
  }

  async start(callId: string, callerId: string) {
    // len v piatok účtujeme, inak netreba token
    if (!this.isFridayNow()) return;
    const token = await this.callSvc.reserveTokenForCall(callerId, callId);
    if (!token) {
      await this.callSvc.endCall(callId, 'failed');
      return;
    }
    const interval = setInterval(async () => {
      if (!this.isFridayNow()) return; // bezpečnostná poistka
      await this.callSvc.chargeMinute(callId, token.id);
    }, 60_000);
    this.tickers.set(callId, { interval, tokenId: token.id, callerId });
  }

  async stop(callId: string) {
    const t = this.tickers.get(callId);
    if (t) {
      clearInterval(t.interval);
      await this.callSvc.releaseToken(t.tokenId);
      this.tickers.delete(callId);
    }
  }
}
