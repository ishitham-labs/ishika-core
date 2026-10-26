export type WebRtcConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'failed'
  | 'closed';

export interface WebRtcPeerOptions {
  rtcConfig?: RTCConfiguration;
  onRemoteStream?: (stream: MediaStream) => void;
  onStateChange?: (state: WebRtcConnectionState) => void;
  onIceCandidate?: (candidate: RTCIceCandidate) => void;
}

export const DEFAULT_ICE_SERVERS: RTCIceServer[] = [
  { urls: 'stun:stun.l.google.com:19302' },
  { urls: 'stun:stun1.l.google.com:19302' },
  { urls: 'stun:stun2.l.google.com:19302' },
];

export const DEFAULT_RTC_CONFIG: RTCConfiguration = {
  iceServers: DEFAULT_ICE_SERVERS,
  iceCandidatePoolSize: 2,
};

export class WebRtcPeerManager {
  private pc: RTCPeerConnection | null = null;
  private options: WebRtcPeerOptions;
  private candidateQueue: RTCIceCandidateInit[] = [];
  private state: WebRtcConnectionState = 'idle';

  constructor(options: WebRtcPeerOptions = {}) {
    this.options = options;
  }

  getState(): WebRtcConnectionState {
    return this.state;
  }

  private setState(newState: WebRtcConnectionState): void {
    this.state = newState;
    this.options.onStateChange?.(newState);
  }

  initPeer(): RTCPeerConnection {
    if (this.pc) {
      return this.pc;
    }

    const config = this.options.rtcConfig || DEFAULT_RTC_CONFIG;
    const pc = new RTCPeerConnection(config);
    this.pc = pc;
    this.setState('connecting');

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.options.onIceCandidate?.(event.candidate);
      }
    };

    pc.ontrack = (event) => {
      if (event.streams && event.streams[0]) {
        this.options.onRemoteStream?.(event.streams[0]);
      }
    };

    pc.onconnectionstatechange = () => {
      switch (pc.connectionState) {
        case 'connected':
          this.setState('connected');
          break;
        case 'disconnected':
          this.setState('disconnected');
          break;
        case 'failed':
          this.setState('failed');
          break;
        case 'closed':
          this.setState('closed');
          break;
        default:
          this.setState('connecting');
      }
    };

    return pc;
  }

  addLocalStream(stream: MediaStream): void {
    const pc = this.initPeer();
    stream.getTracks().forEach((track) => {
      pc.addTrack(track, stream);
    });
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    const pc = this.initPeer();
    const offer = await pc.createOffer({
      offerToReceiveVideo: true,
      offerToReceiveAudio: false,
    });
    await pc.setLocalDescription(offer);
    return offer;
  }

  async handleOffer(offer: RTCSessionDescriptionInit): Promise<RTCSessionDescriptionInit> {
    const pc = this.initPeer();
    if (pc.signalingState !== 'stable') {
      try {
        await Promise.all([
          pc.setLocalDescription({ type: 'rollback' }),
          pc.setRemoteDescription(new RTCSessionDescription(offer)),
        ]);
      } catch {
        await pc.setRemoteDescription(new RTCSessionDescription(offer));
      }
    } else {
      await pc.setRemoteDescription(new RTCSessionDescription(offer));
    }
    await this.flushCandidateQueue();
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    return answer;
  }

  async handleAnswer(answer: RTCSessionDescriptionInit): Promise<void> {
    if (!this.pc) return;
    if (this.pc.signalingState !== 'have-local-offer') {
      return;
    }
    await this.pc.setRemoteDescription(new RTCSessionDescription(answer));
    await this.flushCandidateQueue();
  }

  async addIceCandidate(candidate: RTCIceCandidateInit): Promise<void> {
    if (!this.pc) return;
    if (!this.pc.remoteDescription) {
      this.candidateQueue.push(candidate);
      return;
    }
    try {
      await this.pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch {
      // Ignore transient candidate failure
    }
  }

  private async flushCandidateQueue(): Promise<void> {
    if (!this.pc || !this.pc.remoteDescription) return;
    while (this.candidateQueue.length > 0) {
      const cand = this.candidateQueue.shift();
      if (cand) {
        try {
          await this.pc.addIceCandidate(new RTCIceCandidate(cand));
        } catch {
          // Ignore
        }
      }
    }
  }

  /**
   * Establishes a zero-server in-browser WebRTC loopback connection.
   * Connects sender PC to receiver PC using local ICE candidate exchange,
   * verifying true WebRTC H.264/VP8 video encoding and decoding in the client browser.
   */
  static async createLoopback(
    localStream: MediaStream,
    config: RTCConfiguration = DEFAULT_RTC_CONFIG
  ): Promise<{ sender: RTCPeerConnection; receiver: RTCPeerConnection; remoteStream: MediaStream }> {
    const sender = new RTCPeerConnection(config);
    const receiver = new RTCPeerConnection(config);

    // Cross-link ICE candidates locally
    sender.onicecandidate = (e) => {
      if (e.candidate) receiver.addIceCandidate(e.candidate).catch(console.warn);
    };
    receiver.onicecandidate = (e) => {
      if (e.candidate) sender.addIceCandidate(e.candidate).catch(console.warn);
    };

    // Prepare remote stream promise
    const remoteStreamPromise = new Promise<MediaStream>((resolve) => {
      receiver.ontrack = (event) => {
        if (event.streams && event.streams[0]) {
          resolve(event.streams[0]);
        }
      };
    });

    // Add tracks to sender
    localStream.getTracks().forEach((track) => {
      sender.addTrack(track, localStream);
    });

    // Negotiate SDP
    const offer = await sender.createOffer();
    await sender.setLocalDescription(offer);
    await receiver.setRemoteDescription(offer);

    const answer = await receiver.createAnswer();
    await receiver.setLocalDescription(answer);
    await sender.setRemoteDescription(answer);

    const remoteStream = await remoteStreamPromise;

    return { sender, receiver, remoteStream };
  }

  close(): void {
    if (this.pc) {
      this.pc.close();
      this.pc = null;
    }
    this.candidateQueue = [];
    this.setState('closed');
  }
}
