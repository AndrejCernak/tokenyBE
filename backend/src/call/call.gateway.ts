import {
  WebSocketGateway, OnGatewayConnection, OnGatewayDisconnect,
  SubscribeMessage, MessageBody, ConnectedSocket, WebSocketServer
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';

import { ClerkStrategy } from '../auth/clerk.strategy';
import { PrismaService } from '../db/prisma.service';
import { CallService } from './call.service';
import { TickerService } from './ticker.service';
import { randomUUID } from 'crypto';

type AuthedSocket = Socket & { user?: { dbId: string, role: 'admin'|'client' } };

@WebSocketGateway({ cors: { origin: '*' } })
export class CallGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server!: Server;

  // online mapovanie: userId -> socketId
  private online = new Map<string, string>();

  constructor(
    private clerk: ClerkStrategy,
    private prisma: PrismaService,
    private calls: CallService,
    private ticker: TickerService,
  ) {}

  async handleConnection(client: AuthedSocket) {
    try {
      const token = client.handshake.auth?.token || client.handshake.headers.authorization?.toString().replace(/^Bearer\s+/i,'');
      const auth = await this.clerk.verify(`Bearer ${token}`);
      let user = await this.prisma.user.findUnique({ where: { clerkUserId: auth.clerkId } });
      if (!user) {
        user = await this.prisma.user.create({
          data: { clerkUserId: auth.clerkId, email: auth.email ?? `user_${auth.clerkId}@local`, role: auth.role === 'admin' ? 'admin' : 'client' },
        });
      }
      client.user = { dbId: user.id, role: user.role };
      this.online.set(user.id, client.id);
      client.emit('online', { me: user.id });
    } catch {
      client.disconnect(true);
    }
  }

  handleDisconnect(client: AuthedSocket) {
    if (client.user) this.online.delete(client.user.dbId);
  }

  @SubscribeMessage('call:invite')
  async invite(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { calleeId: string }) {
    if (!client.user) return;
    const callerId = client.user.dbId;
    const calleeSock = this.online.get(body.calleeId);
    const call = await this.calls.createRinging(callerId, body.calleeId);
    if (calleeSock) {
      this.server.to(calleeSock).emit('call:ring', { callId: call.id, from: callerId });
    }
    client.emit('call:created', { callId: call.id });
  }

  @SubscribeMessage('call:answer')
  async answer(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { callId: string }) {
    if (!client.user) return;
    await this.calls.markActive(body.callId);
    // spusti tick (ak piatok)
    const call = await this.prisma.call.findUnique({ where: { id: body.callId } });
    if (call) await this.ticker.start(call.id, call.callerId);
    // povedz obom stranám, že je active
    const sockets = [...this.online.entries()];
    const other = sockets.find(([uid]) => uid === call?.callerId || uid === call?.calleeId);
    this.server.emit('call:active', { callId: body.callId });
  }

  @SubscribeMessage('webrtc:offer')
  relayOffer(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { callId: string; toUserId: string; sdp: any }) {
    const toSock = this.online.get(body.toUserId);
    if (toSock) this.server.to(toSock).emit('webrtc:offer', { callId: body.callId, from: client.user!.dbId, sdp: body.sdp });
  }

  @SubscribeMessage('webrtc:answer')
  relayAnswer(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { callId: string; toUserId: string; sdp: any }) {
    const toSock = this.online.get(body.toUserId);
    if (toSock) this.server.to(toSock).emit('webrtc:answer', { callId: body.callId, from: client.user!.dbId, sdp: body.sdp });
  }

  @SubscribeMessage('webrtc:ice')
  relayIce(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { callId: string; toUserId: string; candidate: any }) {
    const toSock = this.online.get(body.toUserId);
    if (toSock) this.server.to(toSock).emit('webrtc:ice', { callId: body.callId, from: client.user!.dbId, candidate: body.candidate });
  }

  @SubscribeMessage('call:end')
  async end(@ConnectedSocket() client: AuthedSocket, @MessageBody() body: { callId: string }) {
    await this.ticker.stop(body.callId);
    await this.calls.endCall(body.callId, 'ended');
    this.server.emit('call:ended', { callId: body.callId });
  }
}
